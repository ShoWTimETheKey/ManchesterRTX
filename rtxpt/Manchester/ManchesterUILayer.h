/*
* ManchesterRTX UI layer: the GUI is drawn into its own premultiplied colour + alpha texture instead of straight into the
* back buffer. That lets DLSS Frame Generation recompose the UI separately from the scene (Streamline UI recomposition,
* "preset B"), and gives the liquid glass pass a place to draw refracted, diffused glass under the ImGui content.
*/

#pragma once

#include <donut/core/math/math.h>
#include <nvrhi/nvrhi.h>

#include <memory>
#include <unordered_map>
#include <vector>

namespace donut::engine { class ShaderFactory; class CommonRenderPasses; class BindingCache; }

struct GlassShapeDesc
{
    dm::float4  Rect;                   // x0, y0, x1, y1 in pixels
    float       Radius      = 20.0f;
    int         Layer       = 0;        // 0 panels, 1 lenses over panels (selection), 2 modal cards above the scrim, 3 lenses on modal cards
    float       Opacity     = 1.0f;
    float       Lens        = 1.0f;     // refraction strength at the rim
    dm::float3  Tint        = dm::float3(0.02f, 0.025f, 0.035f);    // linear
    float       TintAmount  = 0.18f;
    float       Frost       = 0.85f;    // 0 sharp background .. 1 fully diffused
    float       Shadow      = 0.55f;
    float       Highlight   = 1.0f;
    float       Darkness    = 0.65f;    // how far bright backgrounds are pulled down for legibility
};

struct GlassFrame
{
    std::vector<GlassShapeDesc> Shapes;
    float       Dpi         = 1.0f;
    float       Clarity     = 0.5f;     // iOS 27 slider: 0 fully tinted .. 1 ultra clear
    dm::float2  LightDir    = dm::float2(-0.45f, -0.89f);
    float       Time        = 0.0f;
    float       Dim         = 0.0f;     // modal scrim strength
};

// how the frame under the UI is encoded: SDR (sRGB back buffer) or HDR10 (PQ code values, BT.2020)
struct UILayerOutput
{
    bool        Hdr10       = false;
    float       UIWhiteNits = 203.0f;   // HDR10: brightness of the GUI's white (and of the glass's paper white)
};

class ManchesterUILayer
{
public:
    ManchesterUILayer(nvrhi::IDevice* device, std::shared_ptr<donut::engine::ShaderFactory> shaderFactory,
        std::shared_ptr<donut::engine::CommonRenderPasses> commonPasses);
    ~ManchesterUILayer();

    // clears the UI layer (resizing it to the back buffer) and draws the glass shapes over 'scene'; returns the framebuffer
    // ImGui draws into. The glass and ImGui are drawn in linear light: straight into the sRGB layer in SDR, into a linear
    // half-float layer in HDR10 that Finish() encodes to PQ
    nvrhi::IFramebuffer*    Begin(nvrhi::ICommandList* commandList, nvrhi::ITexture* backBuffer, nvrhi::ITexture* scene, const GlassFrame& glass, const UILayerOutput& output);
    void                    Finish(nvrhi::ICommandList* commandList);
    // premultiplied 'over' onto the back buffer's raw code values (the way DLSS-G recomposes the GUI)
    void                    Composite(nvrhi::ICommandList* commandList, nvrhi::IFramebuffer* backBufferFramebuffer, nvrhi::ITexture* backBuffer);
    nvrhi::ITexture*        GetTexture() const { return m_layer; }

private:
    void                    Resize(uint32_t width, uint32_t height, bool hdr);
    nvrhi::GraphicsPipelineHandle CreatePipeline(nvrhi::IShader* ps, nvrhi::IFramebuffer* fb, nvrhi::BindingLayoutHandle layout, bool premultipliedBlend);
    void                    FullscreenPass(nvrhi::ICommandList* commandList, nvrhi::IGraphicsPipeline* pso, nvrhi::IFramebuffer* fb, nvrhi::IBindingSet* set);

    nvrhi::DeviceHandle     m_device;
    std::shared_ptr<donut::engine::ShaderFactory> m_shaderFactory;
    std::shared_ptr<donut::engine::CommonRenderPasses> m_commonPasses;
    std::unique_ptr<donut::engine::BindingCache> m_bindingCache;

    nvrhi::ShaderHandle     m_downsamplePS, m_blurPS, m_glassPS, m_encodePS;
    nvrhi::BindingLayoutHandle m_blurLayout, m_glassLayout;
    nvrhi::BufferHandle     m_blurCB, m_glassCB;
    nvrhi::SamplerHandle    m_sampler;

    uint32_t                m_width = 0, m_height = 0;
    bool                    m_hdr = false;
    UILayerOutput           m_output;
    nvrhi::TextureHandle    m_layer;                    // UI colour + alpha, premultiplied, encoded like the back buffer (DLSS-G UI buffer)
    nvrhi::FramebufferHandle m_layerFB;
    nvrhi::TextureHandle    m_linear;                   // the GUI in linear light, before it is encoded like the back buffer
    nvrhi::FramebufferHandle m_linearFB;
    std::unordered_map<nvrhi::ITexture*, nvrhi::FramebufferHandle> m_compositeFBs;  // SDR: UNORM views of the swap chain images
    uint32_t                m_encodeFrame = 0;
    nvrhi::TextureHandle    m_half, m_quarterA, m_quarterB, m_eighthA, m_eighthB;
    nvrhi::FramebufferHandle m_halfFB, m_quarterAFB, m_quarterBFB, m_eighthAFB, m_eighthBFB;
    nvrhi::GraphicsPipelineHandle m_downsampleHalfPso, m_downsampleQuarterPso, m_downsampleEighthPso, m_blurQuarterPso, m_blurEighthPso, m_glassPso, m_encodePso;
};
