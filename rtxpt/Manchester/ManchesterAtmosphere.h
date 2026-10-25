/*
* ManchesterRTX atmosphere pass: ray-traced sun shafts in a height-falling haze, aerial perspective and drifting cloud
* shadows, applied to the HDR frame after DLSS Ray Reconstruction (see Atmosphere.hlsl).
*/

#pragma once

#include <donut/core/math/math.h>
#include <nvrhi/nvrhi.h>
#include <memory>

namespace donut::engine { class ShaderFactory; class CommonRenderPasses; class BindingCache; }
struct ProceduralSkyConstants;

struct AtmosphereSettings
{
    float   HazeDensity     = 0.00025f;     // extinction at ground level, 1/m (visibility ~ 3.9 / density)
    float   HazeHeight      = 380.0f;       // scale height, m
    float   ShaftStrength   = 1.0f;         // sunlight scattered by the haze
    float   AmbientStrength = 1.0f;         // skylight scattered by the haze
    float   PhaseG          = 0.72f;        // forward scattering: glow and shafts towards the sun
    float   CloudShadow     = 0.0f;         // how much of a sunlit surface's light a cloud's shadow takes away
    dm::float3 AmbientOverride = dm::float3(0.f);   // night: fixed glow of the city's lights in the haze
    float   MaxDistance     = 2400.0f;
    uint32_t Steps          = 24;
    uint32_t DebugView      = 0;            // F7 cycles developer views (see Atmosphere.hlsl)
    float   Stars           = 0.0f;         // night: star field, drawn per pixel over the sky (crisp at any field of view)
};

struct AtmosphereInputs
{
    nvrhi::rt::IAccelStruct*    TLAS = nullptr;
    nvrhi::ITexture*            Color = nullptr;            // HDR frame at display resolution (UAV)
    nvrhi::ITexture*            EnvCube = nullptr;
    nvrhi::ITexture*            SkyTransmittance = nullptr; // procedural sky textures (null with a captured sky)
    nvrhi::ITexture*            SkyScatter = nullptr;
    nvrhi::ITexture*            SkyIrradiance = nullptr;
    nvrhi::ITexture*            Clouds = nullptr;
    nvrhi::ITexture*            Noise = nullptr;
    const ProceduralSkyConstants* Sky = nullptr;
    dm::float4x4                ClipToWorld, PrevWorldToClip;   // camera-relative: no translation (see ViewDir in Atmosphere.hlsl)
    dm::float3                  CameraPos;
    dm::float3                  CameraMotion = dm::float3(0.f); // this frame's camera position minus the previous one's
    dm::float3                  SunDir = dm::float3(0, 1, 0);
    float                       SunVisibility = 0.0f;       // 0..1: below the horizon or behind an overcast deck the shafts fade
    dm::float3                  SkyMultiplier = dm::float3(1.f);
    dm::float3                  EnvMultiplier = dm::float3(1.f);
    bool                        CameraCut = false;          // drop the history (teleport, weather change)
};

class ManchesterAtmosphere
{
public:
    ManchesterAtmosphere(nvrhi::IDevice* device, std::shared_ptr<donut::engine::ShaderFactory> shaderFactory, std::shared_ptr<donut::engine::CommonRenderPasses> commonPasses);
    ~ManchesterAtmosphere();

    void Render(nvrhi::ICommandList* commandList, const AtmosphereInputs& in, const AtmosphereSettings& s);

private:
    void Resize(uint32_t width, uint32_t height);

    nvrhi::DeviceHandle                 m_device;
    std::shared_ptr<donut::engine::CommonRenderPasses> m_commonPasses;
    std::unique_ptr<donut::engine::BindingCache> m_bindingCache;
    nvrhi::ShaderHandle                 m_marchCS, m_compositeCS;
    nvrhi::ComputePipelineHandle        m_marchPso, m_compositePso;
    nvrhi::BindingLayoutHandle          m_layout;
    nvrhi::BufferHandle                 m_cb;
    nvrhi::SamplerHandle                m_wrap, m_clamp;
    nvrhi::TextureHandle                m_march[2];         // in-scattered light and first-surface distance
    nvrhi::TextureHandle                m_aux[2];           // samples accumulated, cloud-shadow factor of the surface
    uint32_t                            m_width = 0, m_height = 0, m_frame = 0;
    int                                 m_current = 0;
    bool                                m_historyValid = false;
};
