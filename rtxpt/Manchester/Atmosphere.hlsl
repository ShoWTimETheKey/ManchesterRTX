/*
* ManchesterRTX atmosphere, applied to the HDR frame after DLSS Ray Reconstruction and before bloom and tone mapping.
*
* MarchCS (quarter resolution): for each pixel a primary ray finds the first surface; the air in front of it is
*   ray-marched, and at every step a shadow ray towards the sun is traced through the scene's acceleration structure, so
*   towers, viaducts and trees cut real shafts of light into the haze (single scattering, Henyey-Greenstein phase).
*   The haze is denser near the ground (exponential height falloff). The sun's colour and the sky's ambient light come
*   from the same precomputed atmosphere as the procedural sky, and the sky's own moving cloud field shades the air.
*   Results are jittered per frame and accumulated with reprojection. The same pass works out, for the surface the texel
*   sees, how much a cloud's shadow takes from its sunlight, and accumulates that too.
* CompositeCS (full resolution): traces the primary ray again, attenuates the frame by the haze's transmittance, adds the
*   upsampled in-scattering (depth aware), and darkens sunlit surfaces that lie under a cloud's shadow. Pixels on a
*   silhouette are supersampled, so the haze's edges are as smooth and as steady as the antialiased frame under them.
*/

#include "AtmosphereShared.h"

cbuffer AtmosphereCB : register(b0)
{
    AtmosphereConstants g;
};

RaytracingAccelerationStructure t_TLAS  : register(t0);
TextureCube<float4> t_Env               : register(t1);
Texture2D           t_SkyTransmittance  : register(t2);
Texture3D           t_SkyScatter        : register(t3);
Texture2D           t_SkyIrradiance     : register(t4);
Texture3D           t_Clouds            : register(t5);
Texture2D           t_Noise             : register(t6);
Texture2D<float4>   t_March             : register(t7);     // MarchCS: last frame's result; CompositeCS: this frame's
Texture2D<float2>   t_Aux               : register(t8);     // same, samples accumulated and cloud-shadow factor
SamplerState        s_LinearWrap        : register(s0);
SamplerState        s_LinearClamp       : register(s1);
RWTexture2D<float4> u_Out               : register(u0);     // MarchCS: this frame's result; CompositeCS: the HDR frame
RWTexture2D<float2> u_Aux               : register(u1);     // MarchCS: this frame's samples and cloud factor

static const float kSkyDistance = 1e7;

ProceduralSkyWorkingContext SkyContext()
{
    ProceduralSkyWorkingContext c;
    c.Consts = g.Sky;
    c.SamplerLinearWrap = s_LinearWrap;
    c.TransmittanceTexture = t_SkyTransmittance;
    c.ScatterTexture = t_SkyScatter;
    c.IrradianceTexture = t_SkyIrradiance;
    c.CloudsTexture = t_Clouds;
    c.NoiseTexture = t_Noise;
    return c;
}

// direction of the view ray through uv. The matrix is camera-relative (rotation and projection only): a world-space
// inverse unprojects to a point half a metre from the camera while the city's coordinates run to kilometres, and float
// rounding then bent every ray by about a pixel, in a pattern that changed with each camera position - the haze's edges,
// the cloud shadows and the stars no longer sat on the frame under them and shimmered as the camera moved
float3 ViewDir(float2 uv)
{
    const float4 w = mul(float4(uv.x * 2 - 1, 1 - uv.y * 2, 0.5, 1), g.ClipToWorld);
    return normalize(w.xyz / w.w);
}

// distance to the first surface, or kSkyDistance
float TraceDistance(float3 o, float3 d)
{
    RayDesc r; r.Origin = o; r.Direction = d; r.TMin = 0.02; r.TMax = 2e5;
    RayQuery<RAY_FLAG_FORCE_OPAQUE | RAY_FLAG_SKIP_PROCEDURAL_PRIMITIVES> q;
    q.TraceRayInline(t_TLAS, RAY_FLAG_NONE, 0xFF, r);
    q.Proceed();
    return q.CommittedStatus() == COMMITTED_TRIANGLE_HIT ? q.CommittedRayT() : kSkyDistance;
}

bool SeesSun(float3 p)
{
    RayDesc r; r.Origin = p; r.Direction = g.SunDir; r.TMin = 0.03; r.TMax = 5000;
    RayQuery<RAY_FLAG_FORCE_OPAQUE | RAY_FLAG_ACCEPT_FIRST_HIT_AND_END_SEARCH | RAY_FLAG_SKIP_PROCEDURAL_PRIMITIVES> q;
    q.TraceRayInline(t_TLAS, RAY_FLAG_NONE, 0xFF, r);
    q.Proceed();
    return q.CommittedStatus() == COMMITTED_NOTHING;
}

float Density(float y) { return g.HazeDensity * exp(-max(y, 0.0) / g.HazeHeight); }

// optical depth of the exponential haze along o + d t, t in [0, t1]
float OpticalDepth(float3 o, float3 d, float t1)
{
    const float H = g.HazeHeight;
    if (abs(d.y) < 1e-3) return Density(o.y) * t1;
    const float y0 = max(o.y, 0.0), y1 = max(o.y + d.y * t1, 0.0);
    return g.HazeDensity * H * abs((exp(-y0 / H) - exp(-y1 / H)) / d.y);
}

float PhaseHG(float c, float k) { const float k2 = k * k; return (1 - k2) / (4 * 3.14159265 * pow(max(1e-4, 1 + k2 - 2 * k * c), 1.5)); }

// sun irradiance at the city in scene units (its colour after the atmosphere: white at noon, amber near the horizon)
float3 SunIrradiance()
{
    if (g.ProceduralSky == 0 || g.SunVisible <= 0) return 0;
    float3 camera = float3(0, 0, 6360.1), tr;
    GetSkyRadiance(g.Sky.SkyParams, t_SkyTransmittance, s_LinearWrap, t_SkyScatter, s_LinearWrap, camera, g.Sky.SunDir, g.Sky.SunDir, tr);
    return tr * g.Sky.FinalRadianceMultiplier * g.SkyMultiplier * g.SunVisible;     // SunVisible: 0..1, fades at the horizon and behind an overcast deck
}

// light scattered into the haze from the whole sky, as radiance: the sky's irradiance on the ground is pi times its
// average radiance, and the haze sees that sky over the upper half of its surroundings plus a dim ground below
float3 SkyAmbient()
{
    if (any(g.AmbientOverride > 0)) return g.AmbientOverride;
    if (g.ProceduralSky != 0)
    {
        float3 camera = float3(0, 0, 6360.1);
        return GetSkyIrradiance(g.Sky.SkyParams, t_SkyTransmittance, s_LinearWrap, t_SkyIrradiance, s_LinearWrap, camera, float3(0, 0, 1), g.Sky.SunDir)
            * g.Sky.FinalRadianceMultiplier * g.SkyMultiplier * (0.6 / 3.14159265);
    }
    return t_Env.SampleLevel(s_LinearWrap, float3(0, 1, 0), 7).rgb * g.EnvMultiplier;    // a captured sky: its zenith, heavily filtered
}

// fraction of sunlight that gets through the sky's cloud layer to world point p: the layer's coverage along the ray to
// the sun, thresholded so the thin veil the field has almost everywhere casts nothing and the thick parts cast shadows
float CloudShade(float3 p)
{
    if (g.CloudsEnabled == 0 || g.ProceduralSky == 0) return 1;
    const float3 sun = g.Sky.SunDir;                // sky frame: z up
    const float sz = max(sun.z, 0.06);
    const float3 q = float3(p.x, p.z, p.y) * 0.001; // metres -> km, sky frame
    const float tStart = (CLOUD_START - q.z) / sz, tLen = CLOUD_HEIGHT / sz;
    ProceduralSkyWorkingContext ctx = SkyContext();
    float cover = 0;
    [unroll] for (int i = 0; i < 3; i++)
    {
        const float f = (i + 0.5) / 3.0;
        const float dens = GetDensity(ctx, q + sun * (tStart + f * tLen), CLOUD_HEIGHT, f * CLOUD_HEIGHT);
        cover += max(0, dens - g.Sky.cloud_density_offset) / (1.001 - g.Sky.cloud_density_offset);
    }
    return 1.0 - 0.85 * smoothstep(0.30, 0.62, cover / 3.0);
}

float InterleavedGradientNoise(float2 p) { return frac(52.9829189 * frac(dot(p, float2(0.06711056, 0.00583715)))); }

// how much of the sky along view direction dw (world) the cloud layer covers
float SkyCloudCover(float3 dw)
{
    const float3 dir = float3(dw.x, dw.z, dw.y);
    if (g.ProceduralSky == 0) return 0;
    if (dir.z <= 0.02) return 1;
    ProceduralSkyWorkingContext ctx = SkyContext();
    float cover = 0;
    [unroll] for (int i = 0; i < 3; i++)
    {
        const float f = (i + 0.5) / 3.0;
        const float dens = GetDensity(ctx, dir * ((CLOUD_START + f * CLOUD_HEIGHT) / dir.z), CLOUD_HEIGHT, f * CLOUD_HEIGHT);
        cover += max(0, dens - g.Sky.cloud_density_offset) / (1.001 - g.Sky.cloud_density_offset);
    }
    return saturate(cover / 3.0 * 4.0);
}

// stars over the night sky, evaluated per display pixel so they stay pin-sharp at any field of view (the sky's cube map is
// far too coarse for them): a hashed grid on the sphere, one candidate per cell, few lit and the bright ones rare; each
// keeps its light whatever the pixel size, and a slow, faint scintillation. Clouds hide them, the glow near the horizon too.
// Each star spreads over about a pixel and a half: one narrower than a pixel lights it fully when it sits at the pixel's
// centre and a fifth as much at its corner, so it would flash on and off as the camera turns
float3 StarField(float3 dw, float pixelAngle)
{
    const float3 dir = float3(dw.x, dw.z, dw.y);
    const float h = dir.z;
    if (h < 0.03) return 0;
    const float el = asin(saturate(h)), az = atan2(dir.y, dir.x);
    const float cell = 0.0035;
    const float2 gq = float2(az * cos(el), el) / cell, gi = floor(gq);
    const float size = max(pixelAngle * 1.05, 0.00008), ref = 0.00022;
    float3 s = 0;
    [unroll] for (int j = -1; j <= 1; j++)
    [unroll] for (int i = -1; i <= 1; i++)
    {
        const float2 c = gi + float2(i, j);
        const uint hsh = Hash32Combine(Hash32(asuint(c.x) + 7919u), asuint(c.y));
        if (Hash32ToFloat(hsh) < 0.972) continue;
        const float2 jitter = float2(Hash32ToFloat(Hash32(hsh + 1u)), Hash32ToFloat(Hash32(hsh + 2u))) * 0.8 + 0.1;
        const float dist = length(gq - c - jitter) * cell;
        const float mag = 0.08 + 2.4 * pow(Hash32ToFloat(Hash32(hsh + 3u)), 9.0);
        const float3 tint = lerp(float3(0.75, 0.84, 1.0), float3(1.0, 0.86, 0.68), Hash32ToFloat(Hash32(hsh + 4u)));
        const float twinkle = 0.85 + 0.15 * sin(g.Time * (1.3 + 2.0 * Hash32ToFloat(Hash32(hsh + 5u))) + 6.28 * Hash32ToFloat(hsh));
        s += mag * twinkle * tint * exp(-dist * dist / (size * size)) * min(4.0, (ref * ref) / (size * size));
    }
    return s * g.Stars * smoothstep(0.03, 0.3, h);
}

#ifdef ATMO_MARCH
[numthreads(ATMOSPHERE_GROUP, ATMOSPHERE_GROUP, 1)]
void MarchCS(uint2 id : SV_DispatchThreadID)
{
    if (any(id >= g.MarchSize)) return;
    const float2 uv = (float2(id) + 0.5) / float2(g.MarchSize);
    const float3 o = g.CameraPos, d = ViewDir(uv);
    const float tHit = TraceDistance(o, d);
    const float tEnd = min(tHit, g.MaxDistance);
    const bool sky = tHit >= kSkyDistance * 0.5;

    // this texel's history: the same air as seen from last frame's camera. Sky texels reproject as directions (no
    // parallax), surface texels through the point they hit; each of the four history texels around that spot counts only
    // if it saw the same surface - its distance from the old camera matches - so texels on a silhouette keep their history
    // while the camera moves, and a texel whose surface is newly in view starts afresh. Sky just beyond last frame's
    // border borrows the border's history (the haze over the sky changes slowly with direction).
    float3 hist = 0; float histN = 0, histF = 0, wsum = 0, n = 0;
    if (g.MaxHistory > 0)
    {
        const float3 rel = d * tHit + g.CameraMotion;     // the surface point relative to last frame's camera
        const float4 pc = sky ? mul(float4(d, 0), g.PrevWorldToClip) : mul(float4(rel, 1), g.PrevWorldToClip);
        if (pc.w > 1e-6)
        {
            const float2 puv = float2(pc.x / pc.w * 0.5 + 0.5, 0.5 - pc.y / pc.w * 0.5);
            const bool inside = all(puv > 0) && all(puv < 1);
            if (inside || sky)
            {
                const float expected = length(rel);
                const float2 hp = clamp(puv, 0, 1) * float2(g.MarchSize) - 0.5;
                const int2 hb = int2(floor(hp));
                const float2 hf = hp - float2(hb);
                [unroll] for (int j = 0; j < 2; j++) [unroll] for (int i = 0; i < 2; i++)
                {
                    const int2 q = clamp(hb + int2(i, j), int2(0, 0), int2(g.MarchSize) - 1);
                    const float4 h = t_March[q];
                    const float2 a = t_Aux[q];
                    const bool hsky = h.a >= kSkyDistance * 0.5;
                    const bool same = sky ? hsky : (!hsky && abs(h.a - expected) < 0.04 * expected + 0.5);
                    const float w = (i ? hf.x : 1 - hf.x) * (j ? hf.y : 1 - hf.y);
                    if (same && w > 0 && all(h.rgb == h.rgb)) { hist += h.rgb * w; histN += a.x * w; histF += a.y * w; wsum += w; }
                }
                if (wsum > 0.05)
                {
                    hist /= wsum; histF /= wsum;
                    // fewer matching texels, less trust; borrowed border history counts half
                    n = min(histN / wsum * saturate(wsum * 2.0) * (inside ? 1.0 : 0.5), g.MaxHistory);
                }
            }
        }
    }

    const float3 sunE = SunIrradiance() * g.ShaftStrength, amb = SkyAmbient() * g.AmbientStrength;
    const float phase = PhaseHG(dot(d, g.SunDir), g.PhaseG) * 0.85 + 0.15 / (4 * 3.14159265);
    const float jitter = frac(InterleavedGradientNoise(float2(id) + 5.588238 * float(g.FrameIndex & 63)) + float(g.FrameIndex) * 0.6180339);
    const uint N = max(g.Steps, 1u) * (n < 1.5 ? 2u : 1u);     // a texel without much history marches twice as finely
    const bool shafts = g.SunVisible > 0 && any(sunE > 0);

    // steps crowd towards the camera (t grows with the square of the step), where shafts between buildings are sharpest
    float3 L = 0;
    for (uint i = 0; i < N; i++)
    {
        const float u = (float(i) + jitter) / N;
        const float t = tEnd * u * u, dt = tEnd * 2 * u / N;
        const float3 p = o + d * t;
        const float T = exp(-OpticalDepth(o, d, t));
        float3 lit = amb;
        if (shafts && SeesSun(p)) lit += sunE * phase * CloudShade(p);
        L += Density(p.y) * T * lit * dt;
    }
    // the haze beyond the marched range (or up to the horizon for the sky) is lit without shadows
    const float tFar = min(tHit, 20000.0);
    if (tFar > tEnd)
    {
        const float3 lit = amb + (shafts ? sunE * phase : 0);
        const float Tn = exp(-OpticalDepth(o, d, tEnd)), Tf = exp(-OpticalDepth(o, d, tFar));
        L += lit * max(0, Tn - Tf);   // integral of density * T dt between the two distances
    }

    // how much of its sunlight a cloud's shadow takes from the surface this texel sees (1: none, or not in the sun at
    // all). Worked out here, at quarter resolution and accumulated, rather than with a shadow ray per display pixel: a
    // binary test per pixel stair-steps along every shadow edge, and the steps crawl as the camera moves
    float f = 1;
    if (!sky && g.CloudsEnabled != 0 && g.SunVisible > 0 && g.CloudShadow > 0)
    {
        const float3 p = o + d * (tHit - 0.04) + g.SunDir * 0.03;
        if (SeesSun(p)) f = lerp(1.0, CloudShade(p), g.CloudShadow);
    }

    // a running mean over the last frames (up to MaxHistory of them): a fresh texel converges in a few frames instead of
    // carrying its first noisy sample for a long time
    const float k = n / (n + 1);
    u_Out[id] = float4(lerp(L, hist, k), tHit);
    u_Aux[id] = float2(n + 1, lerp(f, histF, k));
}
#endif

#ifdef ATMO_COMPOSITE
// the quarter-resolution in-scattering (rgb) and cloud-shadow factor (a) for a ray through uv that ends at tHit:
// depth-aware upsampling - the march texels around it (2x2, or 4x4 under a tent on a silhouette), each weighted by how
// well the surface it saw matches this ray's
float4 Upsample(float2 uv, float tHit, bool sky, bool wide)
{
    const float2 mp = uv * float2(g.MarchSize) - 0.5;
    const int2 b = int2(floor(mp));
    const int r0 = wide ? -1 : 0, r1 = wide ? 2 : 1;
    float4 acc = 0, plain = 0; float wsum = 0, psum = 0;
    for (int j = r0; j <= r1; j++) for (int i = r0; i <= r1; i++)
    {
        const int2 q = clamp(b + int2(i, j), int2(0, 0), int2(g.MarchSize) - 1);
        const float2 dd = abs(float2(b + int2(i, j)) - mp);
        const float ws = wide ? max(0, 1.5 - dd.x) * max(0, 1.5 - dd.y) : (1 - dd.x) * (1 - dd.y);
        const float4 s = float4(t_March[q].rgb, t_Aux[q].y);
        const float sa = t_March[q].a;
        const bool ssky = sa >= kSkyDistance * 0.5;
        const float wd = (sky || ssky) ? (sky == ssky ? 1.0 : 0.0) : exp(-abs(sa - tHit) / (0.03 * tHit + 0.5));
        acc += s * ws * wd; wsum += ws * wd;
        plain += s * ws; psum += ws;
    }
    return wsum > 1e-3 * psum ? acc / wsum : plain / max(psum, 1e-6);
}

// sample positions inside a pixel for silhouettes (the standard 8x MSAA pattern, in pixels)
static const float2 kSubPixel[8] = {
    float2( 1, -3) / 16, float2(-1,  3) / 16, float2( 5,  1) / 16, float2(-3, -5) / 16,
    float2(-5,  5) / 16, float2(-7, -1) / 16, float2( 3,  7) / 16, float2( 7, -7) / 16 };

[numthreads(ATMOSPHERE_GROUP, ATMOSPHERE_GROUP, 1)]
void CompositeCS(uint2 id : SV_DispatchThreadID)
{
    if (any(id >= g.OutSize)) return;
    const float2 uv = (float2(id) + 0.5) / float2(g.OutSize);
    const float3 o = g.CameraPos, d = ViewDir(uv);
    const float tHit = TraceDistance(o, d);
    const bool sky = tHit >= kSkyDistance * 0.5;

    // a pixel on a silhouette - its march texels saw a different surface (or sky) than its own ray - is supersampled: the
    // frame under it is antialiased, a building and the sky behind it blended, and one ray would give it all of the
    // haze of the one or the other; those stair-steps crawl along every skyline while the camera moves
    bool edge = false;
    {
        const int2 b = int2(floor(uv * float2(g.MarchSize) - 0.5));
        [unroll] for (int j = 0; j < 2; j++) [unroll] for (int i = 0; i < 2; i++)
        {
            const float sa = t_March[clamp(b + int2(i, j), int2(0, 0), int2(g.MarchSize) - 1)].a;
            const bool ssky = sa >= kSkyDistance * 0.5;
            edge = edge || ssky != sky || (!sky && abs(sa - tHit) > 0.06 * tHit + 1.0);
        }
    }

    // per sample: transmittance of the haze in front of the surface (times the cloud shadow on it), the light the haze
    // scatters in, and how much of the pixel is open sky (for the stars)
    float fT = 0, skyT = 0; float3 L = 0;
    const uint count = edge ? 8 : 1;
    for (uint s = 0; s < count; s++)
    {
        const float2 suv = edge ? uv + kSubPixel[s] / float2(g.OutSize) : uv;
        const float3 sd = edge ? ViewDir(suv) : d;
        const float st = edge ? TraceDistance(o, sd) : tHit;
        const bool ssky = st >= kSkyDistance * 0.5;
        const float T = exp(-OpticalDepth(o, sd, ssky ? 20000.0 : st));
        const float4 u = Upsample(suv, st, ssky, edge);
        fT += u.a * T; L += u.rgb; skyT += ssky ? T : 0;
    }
    fT /= count; L /= count; skyT /= count;

    float4 c = u_Out[id];
    c.rgb *= fT;
    // stars, behind the clouds and the haze
    if (skyT > 0 && g.Stars > 0)
    {
        const float pixelAngle = length(ViewDir(uv + float2(1.0 / g.OutSize.x, 0)) - d);
        c.rgb += StarField(d, pixelAngle) * (1.0 - SkyCloudCover(d)) * skyT;
    }
    c.rgb += L;
    // developer views (F7 cycles): in-scattered light; sun irradiance and sky light (top/bottom halves);
    // cloud-shadow factor at the surface; sun visibility at the surface; frames of history the march holds (white: full,
    // black: just started) with the supersampled silhouette pixels in red
    if (g.DebugView == 1) c.rgb = L * 4.0;
    else if (g.DebugView == 2) c.rgb = uv.y < 0.5 ? SunIrradiance() * 0.1 : SkyAmbient();
    else if (g.DebugView == 3) c.rgb = sky ? float3(0, 0, 1) : Upsample(uv, tHit, false, false).aaa;
    else if (g.DebugView == 4) c.rgb = sky ? float3(0, 0, 1) : (SeesSun(o + d * (tHit - 0.04) + g.SunDir * 0.03) ? float3(1, 1, 1) : float3(0.05, 0, 0));
    else if (g.DebugView == 5) c.rgb = edge ? float3(1, 0.1, 0.1) : (t_Aux.SampleLevel(s_LinearClamp, uv, 0).x / (g.MaxHistory + 1)).xxx;
    u_Out[id] = c;
}
#endif
