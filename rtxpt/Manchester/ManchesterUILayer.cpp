/*
* ManchesterRTX UI layer and liquid glass pass, see ManchesterUILayer.h and LiquidGlass.hlsl.
*/

#include "ManchesterUILayer.h"

#include <donut/engine/ShaderFactory.h>
#include <donut/engine/CommonRenderPasses.h>
#include <donut/engine/BindingCache.h>
#include <donut/core/log.h>
#include <nvrhi/utils.h>

#include <algorithm>

using namespace donut;
using namespace donut::math;

namespace
{
    constexpr uint32_t kMaxShapes = 64;     // matches MAX_GLASS_SHAPES in LiquidGlass.hlsl

    struct BlurConstants
    {
        float2 sourceTexel;
        float2 direction;
        float  decodePQ;        // 1: the source holds HDR10 PQ code values (the scene in HDR mode)
        float  invWhiteNits;    // ... converted to linear light relative to the GUI's white
        float2 pad;
    };

    struct GlassShapeGPU
    {
        float4 rect;
        float4 shape;   // radius, layer, opacity, lens
        float4 tint;    // rgb, amount
        float4 look;    // frost, shadow, highlight, darkness
    };

    struct GlassConstants
    {
        float2 screenSize;
        float2 invScreenSize;
        float2 lightDir;
        float  dpi;
        float  clarity;
        uint32_t shapeCount;
        float  time;
        float  dim;
        float  hdr;             // 1: scene is PQ-encoded, output is linear for the encode pass
        float  invWhiteNits;
        float  whiteNits;
        float2 pad;
        GlassShapeGPU shapes[kMaxShapes];
    };
}

ManchesterUILayer::ManchesterUILayer(nvrhi::IDevice* device, std::shared_ptr<engine::ShaderFactory> shaderFactory,
    std::shared_ptr<engine::CommonRenderPasses> commonPasses)
    : m_device(device), m_shaderFactory(shaderFactory), m_commonPasses(commonPasses)
{
    m_bindingCache = std::make_unique<engine::BindingCache>(device);
    const std::vector<engine::ShaderMacro> downsample = { { "GLASS_DOWNSAMPLE", "1" } };
    const std::vector<engine::ShaderMacro> blur = { { "GLASS_BLUR", "1" } };
    const std::vector<engine::ShaderMacro> glass = { { "GLASS_SHADE", "1" } };
    const std::vector<engine::ShaderMacro> encode = { { "GLASS_ENCODE", "1" } };
    m_downsamplePS = m_shaderFactory->CreateShader("app/Manchester/LiquidGlass.hlsl", "DownsamplePS", &downsample, nvrhi::ShaderType::Pixel);
    m_blurPS = m_shaderFactory->CreateShader("app/Manchester/LiquidGlass.hlsl", "BlurPS", &blur, nvrhi::ShaderType::Pixel);
    m_glassPS = m_shaderFactory->CreateShader("app/Manchester/LiquidGlass.hlsl", "GlassPS", &glass, nvrhi::ShaderType::Pixel);
    m_encodePS = m_shaderFactory->CreateShader("app/Manchester/LiquidGlass.hlsl", "EncodePS", &encode, nvrhi::ShaderType::Pixel);
    if (!m_downsamplePS || !m_blurPS || !m_glassPS || !m_encodePS)
        log::error("ManchesterRTX: liquid glass shaders failed to load");

    nvrhi::BindingLayoutDesc blurLayout;
    blurLayout.visibility = nvrhi::ShaderType::Pixel;
    blurLayout.bindings = { nvrhi::BindingLayoutItem::VolatileConstantBuffer(0), nvrhi::BindingLayoutItem::Texture_SRV(0), nvrhi::BindingLayoutItem::Sampler(0) };
    m_blurLayout = m_device->createBindingLayout(blurLayout);

    nvrhi::BindingLayoutDesc glassLayout;
    glassLayout.visibility = nvrhi::ShaderType::Pixel;
    glassLayout.bindings = { nvrhi::BindingLayoutItem::VolatileConstantBuffer(0), nvrhi::BindingLayoutItem::Texture_SRV(0),
        nvrhi::BindingLayoutItem::Texture_SRV(1), nvrhi::BindingLayoutItem::Texture_SRV(2), nvrhi::BindingLayoutItem::Sampler(0) };
    m_glassLayout = m_device->createBindingLayout(glassLayout);

    m_blurCB = m_device->createBuffer(nvrhi::utils::CreateVolatileConstantBufferDesc(sizeof(BlurConstants), "ManchesterGlassBlurCB", 32));
    m_glassCB = m_device->createBuffer(nvrhi::utils::CreateVolatileConstantBufferDesc(sizeof(GlassConstants), "ManchesterGlassCB", 16));

    nvrhi::SamplerDesc samplerDesc;
    samplerDesc.setAllFilters(true).setAllAddressModes(nvrhi::SamplerAddressMode::Clamp);
    m_sampler = m_device->createSampler(samplerDesc);
}

ManchesterUILayer::~ManchesterUILayer() = default;

nvrhi::GraphicsPipelineHandle ManchesterUILayer::CreatePipeline(nvrhi::IShader* ps, nvrhi::IFramebuffer* fb, nvrhi::BindingLayoutHandle layout, bool premultipliedBlend)
{
    nvrhi::GraphicsPipelineDesc desc;
    desc.primType = nvrhi::PrimitiveType::TriangleStrip;
    desc.VS = m_commonPasses->m_FullscreenVS;
    desc.PS = ps;
    desc.bindingLayouts = { layout };
    desc.renderState.rasterState.setCullNone();
    desc.renderState.depthStencilState.depthTestEnable = false;
    desc.renderState.depthStencilState.stencilEnable = false;
    if (premultipliedBlend)
        desc.renderState.blendState.targets[0].setBlendEnable(true)
            .setSrcBlend(nvrhi::BlendFactor::One).setDestBlend(nvrhi::BlendFactor::InvSrcAlpha)
            .setSrcBlendAlpha(nvrhi::BlendFactor::One).setDestBlendAlpha(nvrhi::BlendFactor::InvSrcAlpha);
    return m_device->createGraphicsPipeline(desc, fb);
}

void ManchesterUILayer::Resize(uint32_t width, uint32_t height, bool hdr)
{
    if (width == m_width && height == m_height && hdr == m_hdr && m_layer)
        return;
    m_width = width;
    m_height = height;
    m_hdr = hdr;
    m_bindingCache->Clear();

    auto target = [&](uint32_t w, uint32_t h, nvrhi::Format format, const char* name)
    {
        nvrhi::TextureDesc desc;
        desc.width = std::max(1u, w);
        desc.height = std::max(1u, h);
        desc.format = format;
        desc.isRenderTarget = true;
        desc.initialState = nvrhi::ResourceStates::ShaderResource;
        desc.keepInitialState = true;
        desc.clearValue = nvrhi::Color(0.f);
        desc.useClearValue = true;
        desc.debugName = name;
        return m_device->createTexture(desc);
    };
    // The GUI is drawn in linear light (m_linear), then encoded once into m_layer the way the back buffer is encoded:
    // 8-bit sRGB code values in SDR, PQ code values in a half-float target in HDR10, premultiplied in that encoding. Both
    // our composite and DLSS-G's UI recomposition then blend the same raw values the same way, so generated frames show
    // exactly the GUI of rendered ones - no lighter veils or darker shadows flickering in between
    m_layer = target(width, height, hdr ? nvrhi::Format::RGBA16_FLOAT : nvrhi::Format::RGBA8_UNORM, "ManchesterUILayer");
    m_linear = target(width, height, nvrhi::Format::RGBA16_FLOAT, "ManchesterUILinear");
    m_compositeFBs.clear();
    m_half = target(width / 2, height / 2, nvrhi::Format::RGBA16_FLOAT, "ManchesterGlassHalf");
    m_quarterA = target(width / 4, height / 4, nvrhi::Format::RGBA16_FLOAT, "ManchesterGlassQuarterA");
    m_quarterB = target(width / 4, height / 4, nvrhi::Format::RGBA16_FLOAT, "ManchesterGlassQuarterB");
    m_eighthA = target(width / 8, height / 8, nvrhi::Format::RGBA16_FLOAT, "ManchesterGlassEighthA");
    m_eighthB = target(width / 8, height / 8, nvrhi::Format::RGBA16_FLOAT, "ManchesterGlassEighthB");
    m_layerFB = m_device->createFramebuffer(nvrhi::FramebufferDesc().addColorAttachment(m_layer));
    m_linearFB = m_device->createFramebuffer(nvrhi::FramebufferDesc().addColorAttachment(m_linear));
    m_halfFB = m_device->createFramebuffer(nvrhi::FramebufferDesc().addColorAttachment(m_half));
    m_quarterAFB = m_device->createFramebuffer(nvrhi::FramebufferDesc().addColorAttachment(m_quarterA));
    m_quarterBFB = m_device->createFramebuffer(nvrhi::FramebufferDesc().addColorAttachment(m_quarterB));
    m_eighthAFB = m_device->createFramebuffer(nvrhi::FramebufferDesc().addColorAttachment(m_eighthA));
    m_eighthBFB = m_device->createFramebuffer(nvrhi::FramebufferDesc().addColorAttachment(m_eighthB));

    if (m_downsamplePS && m_blurPS && m_glassPS && m_encodePS)
    {
        m_downsampleHalfPso = CreatePipeline(m_downsamplePS, m_halfFB, m_blurLayout, false);
        m_downsampleQuarterPso = CreatePipeline(m_downsamplePS, m_quarterAFB, m_blurLayout, false);
        m_downsampleEighthPso = CreatePipeline(m_downsamplePS, m_eighthAFB, m_blurLayout, false);
        m_blurQuarterPso = CreatePipeline(m_blurPS, m_quarterAFB, m_blurLayout, false);
        m_blurEighthPso = CreatePipeline(m_blurPS, m_eighthAFB, m_blurLayout, false);
        m_glassPso = CreatePipeline(m_glassPS, m_linearFB, m_glassLayout, false);
        m_encodePso = CreatePipeline(m_encodePS, m_layerFB, m_blurLayout, false);
    }
}

void ManchesterUILayer::FullscreenPass(nvrhi::ICommandList* commandList, nvrhi::IGraphicsPipeline* pso, nvrhi::IFramebuffer* fb, nvrhi::IBindingSet* set)
{
    nvrhi::GraphicsState state;
    state.pipeline = pso;
    state.framebuffer = fb;
    state.bindings = { set };
    state.viewport.addViewportAndScissorRect(fb->getFramebufferInfo().getViewport());
    commandList->setGraphicsState(state);
    nvrhi::DrawArguments args;
    args.vertexCount = 4;
    args.instanceCount = 1;
    commandList->draw(args);
}

nvrhi::IFramebuffer* ManchesterUILayer::Begin(nvrhi::ICommandList* commandList, nvrhi::ITexture* backBuffer, nvrhi::ITexture* scene, const GlassFrame& glass, const UILayerOutput& output)
{
    const auto& bb = backBuffer->getDesc();
    Resize(bb.width, bb.height, output.Hdr10);
    m_output = output;
    nvrhi::IFramebuffer* drawFB = m_linearFB.Get();
    nvrhi::ITexture* drawTex = m_linear.Get();

    if (!m_glassPso || scene == nullptr)
    {
        commandList->clearTextureFloat(drawTex, nvrhi::AllSubresources, nvrhi::Color(0.f));
        return drawFB;
    }

    commandList->beginMarker("ManchesterLiquidGlass");
    const float invWhite = 1.0f / std::max(output.UIWhiteNits, 1.0f);
    auto blurPass = [&](nvrhi::IGraphicsPipeline* pso, nvrhi::ITexture* source, nvrhi::IFramebuffer* target, float2 direction, bool decode)
    {
        const auto& sd = source->getDesc();
        const BlurConstants c = { float2(1.0f / sd.width, 1.0f / sd.height), direction, decode ? 1.0f : 0.0f, invWhite, float2(0.f) };
        commandList->writeBuffer(m_blurCB, &c, sizeof(c));
        nvrhi::BindingSetDesc desc;
        desc.bindings = { nvrhi::BindingSetItem::ConstantBuffer(0, m_blurCB), nvrhi::BindingSetItem::Texture_SRV(0, source), nvrhi::BindingSetItem::Sampler(0, m_sampler) };
        FullscreenPass(commandList, pso, target, m_bindingCache->GetOrCreateBindingSet(desc, m_blurLayout));
    };
    // diffused copies of the frame in linear light: 13-tap downsamples to 1/2, 1/4 and 1/8, a Gaussian at 1/4 (light
    // frost: lenses, clear glass) and a wider one at 1/8 (panels)
    blurPass(m_downsampleHalfPso, scene, m_halfFB, float2(0.f), m_hdr);
    blurPass(m_downsampleQuarterPso, m_half, m_quarterAFB, float2(0.f), false);
    blurPass(m_downsampleEighthPso, m_quarterA, m_eighthAFB, float2(0.f), false);
    blurPass(m_blurQuarterPso, m_quarterA, m_quarterBFB, float2(1.f, 0.f), false);
    blurPass(m_blurQuarterPso, m_quarterB, m_quarterAFB, float2(0.f, 1.f), false);
    for (int i = 0; i < 2; i++)     // twice: a wide, smooth frost (about 45 px at 4K), so city lights melt into the glass
    {
        blurPass(m_blurEighthPso, m_eighthA, m_eighthBFB, float2(1.f + i, 0.f), false);
        blurPass(m_blurEighthPso, m_eighthB, m_eighthAFB, float2(0.f, 1.f + i), false);
    }

    GlassConstants gc = {};
    gc.screenSize = float2(float(bb.width), float(bb.height));
    gc.invScreenSize = float2(1.0f / bb.width, 1.0f / bb.height);
    gc.lightDir = normalize(glass.LightDir);
    gc.dpi = glass.Dpi;
    gc.clarity = glass.Clarity;
    gc.time = glass.Time;
    gc.dim = glass.Dim;
    gc.hdr = m_hdr ? 1.0f : 0.0f;
    gc.invWhiteNits = invWhite;
    gc.whiteNits = output.UIWhiteNits;
    gc.shapeCount = std::min<uint32_t>((uint32_t)glass.Shapes.size(), kMaxShapes);
    for (uint32_t i = 0; i < gc.shapeCount; i++)
    {
        const GlassShapeDesc& s = glass.Shapes[i];
        gc.shapes[i].rect = s.Rect;
        gc.shapes[i].shape = float4(s.Radius, float(s.Layer), s.Opacity, s.Lens);
        gc.shapes[i].tint = float4(s.Tint, s.TintAmount);
        gc.shapes[i].look = float4(s.Frost, s.Shadow, s.Highlight, s.Darkness);
    }
    commandList->writeBuffer(m_glassCB, &gc, sizeof(gc));
    nvrhi::BindingSetDesc glassSet;
    glassSet.bindings = { nvrhi::BindingSetItem::ConstantBuffer(0, m_glassCB), nvrhi::BindingSetItem::Texture_SRV(0, scene),
        nvrhi::BindingSetItem::Texture_SRV(1, m_quarterA), nvrhi::BindingSetItem::Texture_SRV(2, m_eighthA), nvrhi::BindingSetItem::Sampler(0, m_sampler) };
    FullscreenPass(commandList, m_glassPso, drawFB, m_bindingCache->GetOrCreateBindingSet(glassSet, m_glassLayout));     // writes every pixel, so it also clears the layer
    commandList->endMarker();
    return drawFB;
}

void ManchesterUILayer::Finish(nvrhi::ICommandList* commandList)
{
    if (!m_encodePso)
        return;
    // the linear GUI (glass + ImGui) to premultiplied code values in the back buffer's encoding (PQ or sRGB, dithered)
    m_encodeFrame++;
    const BlurConstants c = { float2(1.0f / m_width, 1.0f / m_height), float2(float(m_encodeFrame & 1023u), 0.f), m_hdr ? 1.0f : 0.0f,
        std::max(m_output.UIWhiteNits, 1.0f), float2(0.f) };
    commandList->writeBuffer(m_blurCB, &c, sizeof(c));
    nvrhi::BindingSetDesc desc;
    desc.bindings = { nvrhi::BindingSetItem::ConstantBuffer(0, m_blurCB), nvrhi::BindingSetItem::Texture_SRV(0, m_linear), nvrhi::BindingSetItem::Sampler(0, m_sampler) };
    FullscreenPass(commandList, m_encodePso, m_layerFB, m_bindingCache->GetOrCreateBindingSet(desc, m_blurLayout));
}

void ManchesterUILayer::Composite(nvrhi::ICommandList* commandList, nvrhi::IFramebuffer* backBufferFramebuffer, nvrhi::ITexture* backBuffer)
{
    // blend the encoded layer over the back buffer's raw code values, as DLSS-G does: in SDR through a UNORM view of the
    // sRGB back buffer (no conversion on write), in HDR10 the back buffer is UNORM already
    nvrhi::IFramebuffer* target = backBufferFramebuffer;
    if (!m_hdr && backBuffer)
    {
        nvrhi::FramebufferHandle& fb = m_compositeFBs[backBuffer];
        if (!fb)
            fb = m_device->createFramebuffer(nvrhi::FramebufferDesc().addColorAttachment(
                nvrhi::FramebufferAttachment().setTexture(backBuffer).setFormat(nvrhi::Format::RGBA8_UNORM)));
        target = fb;
    }
    engine::BlitParameters blit;
    blit.targetFramebuffer = target;
    blit.sourceTexture = m_layer;
    blit.blendState.setBlendEnable(true)
        .setSrcBlend(nvrhi::BlendFactor::One).setDestBlend(nvrhi::BlendFactor::InvSrcAlpha)
        .setSrcBlendAlpha(nvrhi::BlendFactor::One).setDestBlendAlpha(nvrhi::BlendFactor::InvSrcAlpha);
    m_commonPasses->BlitTexture(commandList, blit);
}
