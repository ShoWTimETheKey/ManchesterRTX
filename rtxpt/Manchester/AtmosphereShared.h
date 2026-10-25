/*
* ManchesterRTX atmosphere: constants shared by ManchesterAtmosphere.cpp and Atmosphere.hlsl.
*/

#ifndef MANCHESTER_ATMOSPHERE_SHARED_H
#define MANCHESTER_ATMOSPHERE_SHARED_H

#if !defined(__cplusplus)
#pragma pack_matrix(row_major)
#include "../Lighting/Distant/SampleProceduralSky.hlsli"
#endif

#define ATMOSPHERE_GROUP 8

struct AtmosphereConstants
{
    ProceduralSkyConstants  Sky;                // the procedural sky: sun colour through the atmosphere, cloud field

    float4x4    ClipToWorld;                    // this frame, display view, without jitter; camera-relative (no translation)
    float4x4    PrevWorldToClip;                // previous frame, relative to the previous camera

    float3      CameraPos;          float   MaxDistance;        // ray-marched range (m); beyond it the haze is lit without shadows
    float3      SunDir;             float   SunVisible;         // towards the sun (world); 0 when there is no sun to cast shafts
    float3      SkyMultiplier;      float   HazeDensity;        // sky model units -> scene radiance; extinction at ground level (1/m)
    float3      EnvMultiplier;      float   HazeHeight;         // baked cube map -> scene radiance; scale height of the haze (m)
    float3      AmbientOverride;    float   AmbientStrength;    // night: a fixed glow (light pollution); otherwise derived from the sky
    float       ShaftStrength;      float   PhaseG;             float   CloudShadow;    float   MaxHistory;     // frames the march accumulates (0: start afresh)
    uint2       MarchSize;          uint2   OutSize;
    uint        FrameIndex;         uint    Steps;              uint    ProceduralSky;  uint    CloudsEnabled;
    uint        DebugView;          float   Stars;              float   Time;           uint    _pad2;          // debug view; star field brightness (scene radiance); seconds
    float3      CameraMotion;       uint    _pad3;              // camera position minus last frame's
};

#endif
