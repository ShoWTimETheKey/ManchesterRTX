/*
* ManchesterRTX atmosphere pass, see ManchesterAtmosphere.h and Atmosphere.hlsl.
*/

#include "ManchesterAtmosphere.h"

#include <donut/engine/ShaderFactory.h>
#include <donut/engine/CommonRenderPasses.h>
#include <donut/engine/BindingCache.h>
#include <nvrhi/utils.h>

#include "../Lighting/Distant/SampleProceduralSky.h"

using namespace donut::math;
#include "AtmosphereShared.h"

static_assert(sizeof(ProceduralSkyConstants) % 16 == 0, "ProceduralSkyConstants must keep its 16-byte packing");
static_assert(sizeof(AtmosphereConstants) % 16 == 0, "AtmosphereConstants must keep its 16-byte packing");

ManchesterAtmosphere::ManchesterAtmosphere(nvrhi::IDevice* device, std::shared_ptr<donut::engine::ShaderFactory> shaderFactory, std::shared_ptr<donut::engine::CommonRenderPasses> commonPasses)
    : m_device(device), m_commonPasses(commonPasses)
{
    m_bindingCache = std::make_unique<donut::engine::BindingCache>(device);
    std::vector<donut::engine::ShaderMacro> march = { { "ATMO_MARCH", "1" } }, composite = { { "ATMO_COMPOSITE", "1" } };
    m_marchCS = shaderFactory->CreateShader("app/Manchester/Atmosphere.hlsl", "MarchCS", &march, nvrhi::ShaderType::Compute);
    m_compositeCS = shaderFactory->CreateShader("app/Manchester/Atmosphere.hlsl", "CompositeCS", &composite, nvrhi::ShaderType::Compute);

    nvrhi::BindingLayoutDesc layout;
    layout.visibility = nvrhi::ShaderType::Compute;
    layout.bindings = {
        nvrhi::BindingLayoutItem::VolatileConstantBuffer(0),
        nvrhi::BindingLayoutItem::RayTracingAccelStruct(0),
        nvrhi::BindingLayoutItem::Texture_SRV(1), nvrhi::BindingLayoutItem::Texture_SRV(2), nvrhi::BindingLayoutItem::Texture_SRV(3),
        nvrhi::BindingLayoutItem::Texture_SRV(4), nvrhi::BindingLayoutItem::Texture_SRV(5), nvrhi::BindingLayoutItem::Texture_SRV(6),
        nvrhi::BindingLayoutItem::Texture_SRV(7), nvrhi::BindingLayoutItem::Texture_SRV(8),
        nvrhi::BindingLayoutItem::Sampler(0), nvrhi::BindingLayoutItem::Sampler(1),
        nvrhi::BindingLayoutItem::Texture_UAV(0), nvrhi::BindingLayoutItem::Texture_UAV(1),
    };
    m_layout = m_device->createBindingLayout(layout);
    m_cb = m_device->createBuffer(nvrhi::utils::CreateVolatileConstantBufferDesc(sizeof(AtmosphereConstants), "AtmosphereCB", 16));

    nvrhi::SamplerDesc s; s.setAllFilters(true).setAllAddressModes(nvrhi::SamplerAddressMode::Wrap);
    m_wrap = m_device->createSampler(s);
    s.setAllAddressModes(nvrhi::SamplerAddressMode::Clamp);
    m_clamp = m_device->createSampler(s);

    if (m_marchCS && m_compositeCS)
    {
        m_marchPso = m_device->createComputePipeline(nvrhi::ComputePipelineDesc().setComputeShader(m_marchCS).addBindingLayout(m_layout));
        m_compositePso = m_device->createComputePipeline(nvrhi::ComputePipelineDesc().setComputeShader(m_compositeCS).addBindingLayout(m_layout));
    }
}

ManchesterAtmosphere::~ManchesterAtmosphere() = default;

void ManchesterAtmosphere::Resize(uint32_t width, uint32_t height)
{
    if (width == m_width && height == m_height && m_march[0]) return;
    m_width = width; m_height = height;
    nvrhi::TextureDesc d;
    d.width = std::max(1u, (width + 3) / 4); d.height = std::max(1u, (height + 3) / 4);
    d.format = nvrhi::Format::RGBA32_FLOAT;     // in-scattered light and the distance of the first surface
    d.isUAV = true; d.keepInitialState = true; d.initialState = nvrhi::ResourceStates::ShaderResource;
    d.debugName = "AtmosphereMarchA"; m_march[0] = m_device->createTexture(d);
    d.debugName = "AtmosphereMarchB"; m_march[1] = m_device->createTexture(d);
    d.format = nvrhi::Format::RG16_FLOAT;       // samples accumulated, cloud-shadow factor of the surface
    d.debugName = "AtmosphereAuxA"; m_aux[0] = m_device->createTexture(d);
    d.debugName = "AtmosphereAuxB"; m_aux[1] = m_device->createTexture(d);
    m_bindingCache->Clear();
    m_historyValid = false;
}

void ManchesterAtmosphere::Render(nvrhi::ICommandList* commandList, const AtmosphereInputs& in, const AtmosphereSettings& s)
{
    if (!m_marchPso || !m_compositePso || !in.TLAS || !in.Color || !in.EnvCube) return;
    const nvrhi::TextureDesc& cd = in.Color->getDesc();
    Resize(cd.width, cd.height);
    if (in.CameraCut) m_historyValid = false;

    AtmosphereConstants c = {};
    if (in.Sky) c.Sky = *in.Sky;
    c.ClipToWorld = in.ClipToWorld;
    c.PrevWorldToClip = in.PrevWorldToClip;
    c.CameraPos = in.CameraPos;            c.MaxDistance = s.MaxDistance;
    c.SunDir = normalize(in.SunDir);       c.SunVisible = std::clamp(in.SunVisibility, 0.0f, 1.0f);
    c.SkyMultiplier = in.SkyMultiplier;    c.HazeDensity = s.HazeDensity;
    c.EnvMultiplier = in.EnvMultiplier;    c.HazeHeight = std::max(s.HazeHeight, 10.0f);
    c.AmbientOverride = s.AmbientOverride; c.AmbientStrength = s.AmbientStrength;
    c.ShaftStrength = s.ShaftStrength;     c.PhaseG = s.PhaseG;   c.CloudShadow = s.CloudShadow;
    c.MaxHistory = m_historyValid ? 14.0f : 0.0f;       // a long history: the jittered shafts and haze settle instead of shimmering
    c.CameraMotion = m_historyValid ? in.CameraMotion : float3(0.f);
    c.MarchSize = uint2(m_march[0]->getDesc().width, m_march[0]->getDesc().height);
    c.OutSize = uint2(cd.width, cd.height);
    c.FrameIndex = m_frame++;
    c.Steps = s.Steps;
    c.ProceduralSky = (in.Sky && in.SkyTransmittance) ? 1u : 0u;
    c.CloudsEnabled = (c.ProceduralSky && in.Clouds && s.CloudShadow > 0.0f) ? 1u : 0u;
    c.DebugView = s.DebugView;
    c.Stars = s.Stars;
    c.Time = float(m_frame) / 60.0f;
    commandList->writeBuffer(m_cb, &c, sizeof(c));

    auto tex = [&](nvrhi::ITexture* t, nvrhi::ITexture* fallback) { return t ? t : fallback; };
    nvrhi::ITexture* black2D = m_commonPasses->m_BlackTexture, * black3D = m_commonPasses->m_BlackTexture3D;
    auto bindings = [&](nvrhi::ITexture* srv7, nvrhi::ITexture* srv8, nvrhi::ITexture* uav0, nvrhi::ITexture* uav1)
    {
        nvrhi::BindingSetDesc b;
        b.bindings = {
            nvrhi::BindingSetItem::ConstantBuffer(0, m_cb),
            nvrhi::BindingSetItem::RayTracingAccelStruct(0, in.TLAS),
            nvrhi::BindingSetItem::Texture_SRV(1, in.EnvCube).setDimension(nvrhi::TextureDimension::TextureCube),
            nvrhi::BindingSetItem::Texture_SRV(2, tex(in.SkyTransmittance, black2D)),
            nvrhi::BindingSetItem::Texture_SRV(3, tex(in.SkyScatter, black3D)),
            nvrhi::BindingSetItem::Texture_SRV(4, tex(in.SkyIrradiance, black2D)),
            nvrhi::BindingSetItem::Texture_SRV(5, tex(in.Clouds, black3D)),
            nvrhi::BindingSetItem::Texture_SRV(6, tex(in.Noise, black2D)),
            nvrhi::BindingSetItem::Texture_SRV(7, srv7), nvrhi::BindingSetItem::Texture_SRV(8, srv8),
            nvrhi::BindingSetItem::Sampler(0, m_wrap), nvrhi::BindingSetItem::Sampler(1, m_clamp),
            nvrhi::BindingSetItem::Texture_UAV(0, uav0), nvrhi::BindingSetItem::Texture_UAV(1, uav1),
        };
        return m_bindingCache->GetOrCreateBindingSet(b, m_layout);
    };

    commandList->beginMarker("ManchesterAtmosphere");
    const int cur = m_current, prev = 1 - m_current;
    {   // ray-marched in-scattering at quarter resolution, accumulated over frames
        nvrhi::ComputeState st; st.pipeline = m_marchPso; st.bindings = { bindings(m_march[prev], m_aux[prev], m_march[cur], m_aux[cur]) };
        commandList->setComputeState(st);
        commandList->dispatch((c.MarchSize.x + ATMOSPHERE_GROUP - 1) / ATMOSPHERE_GROUP, (c.MarchSize.y + ATMOSPHERE_GROUP - 1) / ATMOSPHERE_GROUP, 1);
    }
    {   // composite onto the HDR frame
        // (the composite writes no history; the other aux texture only fills the layout's second UAV slot)
        nvrhi::ComputeState st; st.pipeline = m_compositePso; st.bindings = { bindings(m_march[cur], m_aux[cur], in.Color, m_aux[prev]) };
        commandList->setComputeState(st);
        commandList->dispatch((cd.width + ATMOSPHERE_GROUP - 1) / ATMOSPHERE_GROUP, (cd.height + ATMOSPHERE_GROUP - 1) / ATMOSPHERE_GROUP, 1);
    }
    commandList->endMarker();
    m_current = prev;
    m_historyValid = true;
}
