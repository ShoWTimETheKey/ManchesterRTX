// ManchesterRTX liquid glass: the GUI's panels are rendered as glass over the path-traced frame, after Apple's iOS 26/27
// Liquid Glass material. The frame behind is diffused (two strengths) and refracted through a lens-like rim with a touch
// of dispersion; selection lenses magnify what is under them. Brightness under the glass is compressed into a narrow,
// dark range so white text stays legible over sky and sunlit stone alike, while colour comes through with extra
// vibrancy. Rims carry a thin specular line and a highlight that follows the light (strongest on the side facing it, a
// weaker internal reflection opposite), shapes in the same layer melt into each other when close, and a soft, wide shadow
// lifts the glass off the city. Everything is computed in linear light: written straight into the sRGB UI layer in SDR,
// or into a linear layer that EncodePS turns into premultiplied PQ code values for HDR10 (DLSS-G UI buffer).

#ifndef QUAD_Z
#define QUAD_Z 0
#endif

SamplerState s_Linear : register(s0);

float Luma(float3 c) { return dot(c, float3(0.2126, 0.7152, 0.0722)); }

// HDR10 helpers: SMPTE ST 2084 and BT.709 <-> BT.2020 primaries
float3 EncodePQ(float3 nits)
{
    const float m1 = 0.1593017578125, m2 = 78.84375, c1 = 0.8359375, c2 = 18.8515625, c3 = 18.6875;
    const float3 y = pow(saturate(nits / 10000.0), m1);
    return pow((c1 + c2 * y) / (1.0 + c3 * y), m2);
}
float3 DecodePQ(float3 code)
{
    const float m1 = 0.1593017578125, m2 = 78.84375, c1 = 0.8359375, c2 = 18.8515625, c3 = 18.6875;
    const float3 p = pow(saturate(code), 1.0 / m2);
    return pow(max(p - c1, 0) / (c2 - c3 * p), 1.0 / m1) * 10000.0;
}
float3 Rec709ToRec2020(float3 c)
{
    return float3(dot(c, float3(0.6274040, 0.3292820, 0.0433136)), dot(c, float3(0.0690970, 0.9195400, 0.0113612)), dot(c, float3(0.0163916, 0.0880132, 0.8955950)));
}
float3 Rec2020ToRec709(float3 c)
{
    return float3(dot(c, float3(1.6604910, -0.5876411, -0.0728499)), dot(c, float3(-0.1245505, 1.1328999, -0.0083494)), dot(c, float3(-0.0181508, -0.1005789, 1.1187297)));
}

/* ---------------- blur chain: downsample (13-tap), separable Gaussian, HDR10 encode ---------------- */

#if defined(GLASS_DOWNSAMPLE) || defined(GLASS_BLUR) || defined(GLASS_ENCODE)

cbuffer BlurConstants : register(b0)
{
    float2 g_SourceTexel;   // 1 / source size
    float2 g_Direction;     // blur direction in source texels (Gaussian pass)
    float  g_DecodePQ;      // 1: the source is the HDR10 frame (PQ code values)
    float  g_Scale;         // decode: 1 / GUI white (nits); encode: GUI white (nits)
    float2 g_BlurPad;
};

Texture2D<float4> t_Source : register(t0);

float3 Fetch(float2 uv)
{
    float3 c = t_Source.SampleLevel(s_Linear, uv, 0).rgb;
    if (g_DecodePQ > 0)     // linear light relative to the GUI's white; the sun's disc is clamped so it cannot flare through the frost
        c = min(max(Rec2020ToRec709(DecodePQ(c)), 0) * g_Scale, 12.0);
    return c;
}

float4 DownsamplePS(float4 pos : SV_Position, float2 uv : UV) : SV_Target
{
    // Jimenez' 13-tap downsample: smooth, no shimmering when the camera moves
    const float2 t = g_SourceTexel;
    float3 a = Fetch(uv + t * float2(-2, -2));
    float3 b = Fetch(uv + t * float2( 0, -2));
    float3 c = Fetch(uv + t * float2( 2, -2));
    float3 d = Fetch(uv + t * float2(-2,  0));
    float3 e = Fetch(uv);
    float3 f = Fetch(uv + t * float2( 2,  0));
    float3 g = Fetch(uv + t * float2(-2,  2));
    float3 h = Fetch(uv + t * float2( 0,  2));
    float3 i = Fetch(uv + t * float2( 2,  2));
    float3 j = Fetch(uv + t * float2(-1, -1));
    float3 k = Fetch(uv + t * float2( 1, -1));
    float3 l = Fetch(uv + t * float2(-1,  1));
    float3 m = Fetch(uv + t * float2( 1,  1));
    float3 o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
    return float4(o, 1);
}

float4 BlurPS(float4 pos : SV_Position, float2 uv : UV) : SV_Target
{
    // 17-tap Gaussian (sigma ~4 texels) folded into 9 bilinear fetches
    static const float w[5] = { 0.1585, 0.2470, 0.1366, 0.0458, 0.0089 };
    static const float o[5] = { 0.0, 1.4615, 3.4065, 5.3534, 7.3015 };
    float3 sum = t_Source.SampleLevel(s_Linear, uv, 0).rgb * w[0];
    [unroll] for (int n = 1; n < 5; n++)
    {
        const float2 off = g_Direction * g_SourceTexel * o[n];
        sum += (t_Source.SampleLevel(s_Linear, uv + off, 0).rgb + t_Source.SampleLevel(s_Linear, uv - off, 0).rgb) * w[n];
    }
    return float4(sum / (w[0] + 2 * (w[1] + w[2] + w[3] + w[4])), 1);
}

// the linear, premultiplied GUI to premultiplied code values in the back buffer's encoding - PQ in HDR10, sRGB in SDR -
// which our composite and DLSS-G's UI recomposition both blend over the frame's raw values the same way
float4 EncodePS(float4 pos : SV_Position, float2 uv : UV) : SV_Target
{
    const float4 c = t_Source.Load(int3(pos.xy, 0));
    if (c.a <= 1e-5)
        return 0;
    const float3 straight = max(c.rgb / c.a, 0);
    if (g_DecodePQ > 0)
        return float4(EncodePQ(Rec709ToRec2020(straight) * g_Scale) * c.a, c.a);
    // SDR: sRGB code values with a triangular dither of one code value (changing every frame) before the 8-bit target
    float3 e = select(straight <= 0.0031308, straight * 12.92, 1.055 * pow(straight, 1.0 / 2.4) - 0.055);
    uint h = uint(pos.x) * 1973u + uint(pos.y) * 9277u + uint(g_Direction.x) * 26699u;
    h ^= h >> 13; h *= 0x5bd1e995u; h ^= h >> 15;
    const float tri = float(h & 0xffffu) / 65535.0 + float(h >> 16) / 65535.0 - 1.0;
    e = saturate(e + tri / 255.0);
    return float4(e * c.a, c.a);
}

#endif

/* ---------------- glass ---------------- */

#ifdef GLASS_SHADE

#define MAX_GLASS_SHAPES 64

struct GlassShape
{
    float4 rect;        // x0, y0, x1, y1 in pixels
    float4 shape;       // corner radius, layer (0 panels, 1 lenses on top, 2 modal cards, 3 lenses on cards), opacity, lens strength
    float4 tint;        // rgb (linear), tint amount
    float4 look;        // frost, shadow, highlight, darkness
};

cbuffer GlassConstants : register(b0)
{
    float2 g_ScreenSize;
    float2 g_InvScreenSize;
    float2 g_LightDir;      // screen-space direction towards the light (normalised; up-left by default)
    float  g_Dpi;
    float  g_Clarity;       // 0 = fully tinted, 1 = ultra clear (iOS 27 slider)
    uint   g_ShapeCount;
    float  g_Time;
    float  g_Dim;           // modal scrim over the frame and the lower glass layers
    float  g_Hdr;           // 1: the scene is HDR10 (PQ), the output is linear relative to the GUI's white
    float  g_InvWhite;
    float  g_WhiteNits;
    float2 g_Pad;
    GlassShape g_Shapes[MAX_GLASS_SHAPES];
};

Texture2D<float4> t_Scene : register(t0);      // hudless frame
Texture2D<float4> t_BlurQ : register(t1);      // light frost (quarter resolution)
Texture2D<float4> t_BlurE : register(t2);      // heavy frost (eighth resolution)

float3 SceneSharp(float2 uv)
{
    float3 c = t_Scene.SampleLevel(s_Linear, uv, 0).rgb;
    if (g_Hdr > 0)
        c = min(max(Rec2020ToRec709(DecodePQ(c)), 0) * g_InvWhite, 12.0);
    return c;
}

// cubic B-spline filtering from four bilinear taps: the low-resolution blur upsamples without blocks or seams
float3 SampleSmooth(Texture2D<float4> t, float2 uv)
{
    float2 size; t.GetDimensions(size.x, size.y);
    const float2 p = uv * size - 0.5, fi = floor(p), f = p - fi;
    const float2 w0 = (1.0 / 6.0) * (1 - f) * (1 - f) * (1 - f);
    const float2 w1 = (1.0 / 6.0) * (4 - 6 * f * f + 3 * f * f * f);
    const float2 w2 = (1.0 / 6.0) * (1 + 3 * f + 3 * f * f - 3 * f * f * f);
    const float2 w3 = (1.0 / 6.0) * f * f * f;
    const float2 g0 = w0 + w1, g1 = w2 + w3;
    const float2 h0 = (fi - 1.0 + w1 / g0 + 0.5) / size, h1 = (fi + 1.0 + w3 / g1 + 0.5) / size;
    return g0.y * (g0.x * t.SampleLevel(s_Linear, float2(h0.x, h0.y), 0).rgb + g1.x * t.SampleLevel(s_Linear, float2(h1.x, h0.y), 0).rgb)
         + g1.y * (g0.x * t.SampleLevel(s_Linear, float2(h0.x, h1.y), 0).rgb + g1.x * t.SampleLevel(s_Linear, float2(h1.x, h1.y), 0).rgb);
}

float sdRoundBox(float2 p, float4 rect, float r)
{
    const float2 c = (rect.xy + rect.zw) * 0.5, h = (rect.zw - rect.xy) * 0.5;
    r = min(r, min(h.x, h.y));
    const float2 q = abs(p - c) - h + r;
    return length(max(q, 0)) + min(max(q.x, q.y), 0) - r;
}

float smin(float a, float b, float k)
{
    const float h = saturate(0.5 + 0.5 * (b - a) / k);
    return lerp(b, a, h) - k * h * (1 - h);
}

// signed distance of one layer: neighbouring shapes melt together within 'k' pixels; also returns the nearest shape
float LayerSDF(float2 p, uint layer, out uint nearest)
{
    const float k = 14.0 * g_Dpi;
    float d = 1e6, best = 1e6;
    nearest = 0;
    for (uint i = 0; i < g_ShapeCount; i++)
    {
        const GlassShape s = g_Shapes[i];
        if ((uint)s.shape.y != layer) continue;
        const float di = sdRoundBox(p, s.rect, s.shape.x);
        d = smin(d, di, k);
        if (di < best) { best = di; nearest = i; }
    }
    return d;
}

bool NearAnyShape(float2 p, float margin)
{
    for (uint i = 0; i < g_ShapeCount; i++)
    {
        const float4 r = g_Shapes[i].rect + float4(-margin, -margin, margin, margin * 1.8);
        if (all(p >= r.xy) && all(p <= r.zw)) return true;
    }
    return false;
}

float3 Saturation(float3 c, float s)
{
    const float l = Luma(c);
    return max(lerp(l.xxx, c, s), 0);
}

float Hash(float2 p) { return frac(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453); }

// shade one glass layer at pixel p; returns premultiplied colour + alpha (glass and its soft shadow)
float4 ShadeLayer(float2 p, uint layer)
{
    uint ni;
    const float d = LayerSDF(p, layer, ni);
    const GlassShape s = g_Shapes[ni];
    const float opacity = s.shape.z;
    const bool lens = (layer & 1) != 0;

    // a soft, wide shadow a little below the glass; tighter under lenses
    uint dummy;
    const float ds = LayerSDF(p - float2(0, (lens ? 2.0 : 7.0) * g_Dpi), layer, dummy);
    const float spread = (lens ? 8.0 : 26.0) * g_Dpi;
    const float shadow = s.look.y * 0.6 * exp(-max(ds, 0) / spread) * saturate(ds / (3.0 * g_Dpi) + 1.0);

    const float coverage = saturate(0.5 - d);
    if (coverage <= 0)
        return float4(0, 0, 0, shadow * opacity * 0.5);

    // outward normal from the field gradient
    uint n0, n1;
    const float dx = LayerSDF(p + float2(1, 0), layer, n0) - d;
    const float dy = LayerSDF(p + float2(0, 1), layer, n1) - d;
    float2 n = float2(dx, dy);
    n = dot(n, n) > 1e-8 ? normalize(n) : float2(0, -1);

    // bevel: a circular cross-section that is flat inside and steepens towards the rim
    const float bevel = clamp(s.shape.x * 0.55, 10.0 * g_Dpi, 24.0 * g_Dpi);
    const float t = saturate(-d / bevel), edge = 1.0 - t;
    const float curve = 1.0 - sqrt(saturate(1.0 - edge * edge));

    // refraction: the rim bends the frame inwards like the edge of a thick lens; lenses also magnify a little
    const float2 centre = (s.rect.xy + s.rect.zw) * 0.5;
    float2 q = p - n * curve * s.shape.w * bevel * 0.9;
    if (lens) q = centre + (q - centre) * 0.93;
    const float2 uv = q * g_InvScreenSize;
    const float2 ca = n * curve * 1.5 * g_Dpi * g_InvScreenSize;     // dispersion at the rim
    float3 sharp;
    sharp.r = SceneSharp(uv + ca).r;
    sharp.g = SceneSharp(uv).g;
    sharp.b = SceneSharp(uv - ca).b;
    const float3 light = SampleSmooth(t_BlurQ, uv), heavy = SampleSmooth(t_BlurE, uv);

    // frost: sharp -> light diffusion -> heavy diffusion; the clarity slider trades frost and tint for transparency
    const float frost = saturate(s.look.x * lerp(1.1, 0.45, g_Clarity));
    float3 c = frost < 0.5 ? lerp(sharp, light, frost * 2.0) : lerp(light, heavy, frost * 2.0 - 1.0);
    c = Saturation(c, lens ? 1.3 : 1.18);                             // vibrancy

    // legibility: the brightness behind the glass (smooth, from the heavy blur) is compressed into a narrow range - dark
    // for panels, lighter for lenses - so the GUI's white text keeps its contrast over any part of the city
    const float L = max(Luma(SampleSmooth(t_BlurE, p * g_InvScreenSize)), 1e-4);
    const float lo = lens ? 0.07 : 0.024, hi = lens ? 0.21 : 0.085;
    const float Ld = lo + (hi - lo) * (L / (L + 0.3));
    const float strength = saturate(s.look.w * lerp(1.25, 0.55, g_Clarity));
    // the target brightness blends the background's (capped at the GUI's white, so an HDR sky several times brighter
    // than white cannot leak through as a pale veil) with the legible band; dark backgrounds (night) are lifted only a
    // little, so the glass stays smoky
    float T = lerp(min(L, 0.9), Ld, strength);
    if (T > L) T = L + (T - L) * 0.22;
    c *= T / L;
    // the tint brings its hue at the glass's own brightness (it does not darken or lighten it): over a white sky the
    // glass is purple smoked glass, not a grey slab, while part of what lies behind still shows through
    const float3 tintAtT = s.tint.rgb * (dot(c, 1.0 / 3.0) / max(dot(s.tint.rgb, 1.0 / 3.0), 1e-4));    // (matched in mean, not luma, which would make purple glare)
    c = lerp(c, tintAtT, saturate(s.tint.a * lerp(1.35, 0.5, g_Clarity)));

    // depth: a faint inner shadow on the side away from the light, a soft glow along the rim
    const float facing = dot(n, g_LightDir);
    c *= 1.0 - 0.22 * pow(edge, 4.0) * saturate(-facing);
    c += 0.035 * s.look.z * pow(edge, 3.0);

    // specular: a highlight on the rim that faces the light and a weaker internal reflection opposite, a crisp hairline
    // around the whole shape, and a gentle sheen across the top
    const float rim = pow(edge, 9.0);
    const float spec = s.look.z * rim * (0.95 * pow(saturate(facing), 2.0) + 0.38 * pow(saturate(-facing), 2.0));
    const float hairline = s.look.z * saturate(1.0 - abs(d + 0.9) / 0.9) * (0.12 + 0.30 * saturate(facing));
    const float sheen = 0.03 * s.look.z * saturate(1.0 - (p.y - s.rect.y) / max(s.rect.w - s.rect.y, 1.0) * 1.8);
    const float hdrGain = g_Hdr > 0 ? 1.6 : 1.0;    // in HDR the glints may rise a little above the GUI's white
    c += (spec * hdrGain + hairline + sheen).xxx;

    const float a = coverage * opacity;
    const float4 glass = float4(c * a, a);
    const float4 shade = float4(0, 0, 0, shadow * opacity * 0.5 * (1.0 - a));
    return glass + shade * (1.0 - glass.a);
}

// layers: 0 panels, 1 lenses over panels, 2 modal cards (above the scrim), 3 lenses over modal cards
float4 Over(float4 top, float4 bottom) { return top + bottom * (1.0 - top.a); }

float4 GlassPS(float4 pos : SV_Position, float2 uv : UV) : SV_Target
{
    const float2 p = pos.xy;
    float4 result = 0;
    const bool near = g_ShapeCount > 0 && NearAnyShape(p, 48.0 * g_Dpi);
    if (near)
        result = Over(ShadeLayer(p, 1), ShadeLayer(p, 0));
    if (g_Dim > 0)
    {
        result = Over(float4(0, 0, 0, g_Dim), result);
        if (near)
            result = Over(Over(ShadeLayer(p, 3), ShadeLayer(p, 2)), result);
    }
    return result;
}

#endif
