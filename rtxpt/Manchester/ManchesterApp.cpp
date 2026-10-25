/*
* ManchesterRTX app mode GUI, see ManchesterApp.h.
* This file is compiled with /utf-8; every non-ASCII character in it is collected into ManchesterGlyphs.h by
* tools/glyphs.mjs so that the font atlas carries exactly the Chinese text the UI uses.
*/

#define IMGUI_DEFINE_MATH_OPERATORS
#include "ManchesterApp.h"
#include "ManchesterGlyphs.h"

#include "../Sample.h"
#include "../SampleUI.h"
#include "../Materials/MaterialsBaker.h"
#include "../SampleCommon/SampleCommon.h"
#include "../Lighting/Distant/EnvMapBaker.h"
#include "../Lighting/Distant/SampleProceduralSky.h"

#include <donut/app/ApplicationBase.h>
#include <donut/app/DeviceManager.h>
#include <donut/engine/SceneGraph.h>
#include <donut/core/log.h>
#include <json/json.h>
#include <GLFW/glfw3.h>
#include <imgui_internal.h>

#include <algorithm>
#include <cmath>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <unordered_set>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <shellapi.h>
#pragma comment(lib, "version.lib")
#endif

using namespace donut;
using namespace donut::math;

namespace
{
    // RTXPT's swap chain is SRGBA8, so ImGui colours are taken as linear and blended in linear light. The palette is written
    // in sRGB and converted here; translucent fills use alphas tuned for linear blending (white overlays need far less).
    float  SrgbToLinear(float c)    { return c <= 0.04045f ? c / 12.92f : powf((c + 0.055f) / 1.055f, 2.4f); }
    ImU32  Lin(int r, int g, int b, int a = 255)
    {
        auto ch = [](int v) { return int(SrgbToLinear(v / 255.0f) * 255.0f + 0.5f); };
        return IM_COL32(ch(r), ch(g), ch(b), a);
    }
    ImVec4 LinV(float r, float g, float b, float a) { return ImVec4(SrgbToLinear(r), SrgbToLinear(g), SrgbToLinear(b), a); }
    float3 LinF(int r, int g, int b) { return float3(SrgbToLinear(r / 255.0f), SrgbToLinear(g / 255.0f), SrgbToLinear(b / 255.0f)); }

    // the University of Manchester's colours: its purple (#660099) tints the glass and the selection lenses, its gold
    // (#FFCC33) marks what is active (badges, sliders, switches, selected icons) with deep purple on top. Labels follow the
    // iOS hierarchy (label, secondary, tertiary) in white and lavender greys; NVIDIA green stays on the RTX badge
    const ImU32     kText       = Lin(250, 248, 255);
    const ImU32     kMuted      = Lin(196, 186, 214);
    const ImU32     kTertiary   = Lin(146, 134, 166);
    // fills and hairlines on the glass are lavender, not white or black, so they stay in the glass's hue instead of
    // washing it to grey
    const ImU32     kFaint      = Lin(214, 192, 255, 9);
    const ImU32     kHover      = Lin(214, 192, 255, 20);
    const ImU32     kSeparator  = Lin(214, 192, 255, 24);
    const ImU32     kGroup      = Lin(214, 192, 255, 13);
    const ImU32     kTrack      = Lin(22, 6, 40, 96);
    const ImU32     kAccent     = Lin(255, 204, 51);
    const ImU32     kOnAccent   = Lin(46, 10, 74);
    const ImU32     kSwitchOn   = Lin(255, 204, 51);
    const ImU32     kGreen      = Lin(118, 185, 0);
    const ImU32     kAmber      = Lin(255, 179, 64);
    const ImU32     kRed        = Lin(255, 92, 82);
    const ImVec4    kEdge       = ImVec4(1.f, 1.f, 1.f, 0.0f);
    float           g_textShadow = 1.5f;    // px offset of the soft shadow under GUI text (set from the DPI each frame)

    // Segoe Fluent Icons code points
    constexpr unsigned IcMoon = 0xE708, IcCloud = 0xE753, IcPin = 0xE707, IcCamera = 0xE722, IcPhoto = 0xE91B, IcFull = 0xE740,
        IcWindow = 0xE73F, IcSettings = 0xE713, IcHelp = 0xE897, IcPlay = 0xE768, IcPause = 0xE769, IcEye = 0xE890, IcFolder = 0xE838,
        IcClose = 0xE711, IcSliders = 0xE9E9, IcSun = 0xE706, IcPower = 0xE7E8, IcClock = 0xE823, IcChevron = 0xE76C, IcCode = 0xE943;
    constexpr unsigned kIconsUsed[] = { IcMoon, IcCloud, IcPin, IcCamera, IcPhoto, IcFull, IcWindow, IcSettings, IcHelp, IcPlay, IcPause, IcEye, IcFolder, IcClose, IcSliders, IcSun, IcPower, IcClock, IcChevron, IcCode };

    std::string U8(unsigned cp)
    {
        std::string s;
        if (cp < 0x80) s += char(cp);
        else if (cp < 0x800) { s += char(0xC0 | (cp >> 6)); s += char(0x80 | (cp & 0x3F)); }
        else { s += char(0xE0 | (cp >> 12)); s += char(0x80 | ((cp >> 6) & 0x3F)); s += char(0x80 | (cp & 0x3F)); }
        return s;
    }

    ImU32 Alpha(ImU32 c, float a)
    {
        const unsigned alpha = unsigned(((c >> IM_COL32_A_SHIFT) & 0xFF) * std::clamp(a, 0.0f, 1.0f) + 0.5f);
        return (c & ~IM_COL32_A_MASK) | (alpha << IM_COL32_A_SHIFT);
    }

    ImVec2 TextSize(ImFont* f, const char* t)       { return f->CalcTextSizeA(f->LegacySize, FLT_MAX, 0.0f, t); }
    // GUI text carries a faint, soft shadow (vibrancy): it keeps light labels legible where the glass is over a bright sky
    void   Text(ImDrawList* dl, ImFont* f, ImVec2 p, ImU32 c, const char* t)
    {
        const float a = float((c >> IM_COL32_A_SHIFT) & 0xFF) / 255.0f;
        dl->AddText(f, f->LegacySize, ImFloor(p) + ImVec2(0.0f, g_textShadow), IM_COL32(0, 0, 0, int(44 * a)), t);
        dl->AddText(f, f->LegacySize, ImFloor(p), c, t);
    }
    void   PushFont(ImFont* f)                      { ImGui::PushFont(f, f->LegacySize); }

    // the GUI speaks Chinese or English: every string is written in both where it is used and L() picks one (format
    // strings take the same printf arguments in both)
    bool        g_english = false;
    const char* L(const char* zh, const char* en)   { return g_english ? en : zh; }

    float  Ease(float t)                            { return t < 0.5f ? 4.0f * t * t * t : 1.0f - powf(-2.0f * t + 2.0f, 3.0f) * 0.5f; }

    float3 RotateY(const float3& v, float a)
    {
        const float c = cosf(a), s = sinf(a);
        return float3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
    }
    float3 RotateAxis(const float3& v, const float3& k, float a)   // Rodrigues
    {
        const float c = cosf(a), s = sinf(a);
        return v * c + cross(k, v) * s + k * dot(k, v) * (1.0f - c);
    }
    float3 SlerpDir(const float3& a, const float3& b, float t)
    {
        const float d = std::clamp(dot(a, b), -1.0f, 1.0f);
        if (d > 0.9995f) return normalize(lerp(a, b, t));
        float3 c = b - a * d;
        if (length(c) < 1e-4f) c = cross(a, float3(0, 1, 0));
        c = normalize(c);
        const float th = acosf(d) * t;
        return normalize(a * cosf(th) + c * sinf(th));
    }

    /* ---------------- liquid glass styles ---------------- */

    std::vector<GlassShapeDesc>* g_glassShapes = nullptr;      // shapes of the UI being built

    GlassShapeDesc PanelGlass(ImVec2 p0, ImVec2 p1, float radius, int layer, float opacity)
    {
        GlassShapeDesc g;
        g.Rect = float4(p0.x, p0.y, p1.x, p1.y);
        g.Radius = radius;
        g.Layer = layer;
        g.Opacity = opacity;
        // regular Liquid Glass: heavily diffused, smoked with the university's deep purple, brightness held in a dark band
        // for white labels (the purple keeps it glass, not a grey slab, over a bright sky)
        g.Tint = LinF(50, 18, 80);
        g.TintAmount = layer >= 2 ? 0.5f : 0.42f;
        g.Frost = 0.95f;
        g.Shadow = 0.0f;        // no drop shadow: blended in PQ (HDR) or sRGB (SDR) space it read as a grey halo
        g.Highlight = 1.0f;
        g.Darkness = layer >= 2 ? 1.2f : 1.15f;
        g.Lens = 1.0f;
        return g;
    }

    // a glass window: the panel's background is a glass shape (drawn before ImGui), ImGui only draws the content
    struct PanelScope
    {
        float Radius; int Layer; float Opacity;
        PanelScope(const char* name, ImVec2 pos, ImVec2 pivot, float s, ImVec2 size = ImVec2(0, 0), ImVec2 pad = ImVec2(16, 14),
                   float alpha = 1.0f, float radius = 24.0f, int layer = 0)
            : Radius(radius * s), Layer(layer), Opacity(alpha)
        {
            ImGui::SetNextWindowPos(pos, ImGuiCond_Always, pivot);
            if (size.x > 0) ImGui::SetNextWindowSize(size, ImGuiCond_Always);
            ImGui::PushStyleVar(ImGuiStyleVar_Alpha, alpha);
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(pad.x * s, pad.y * s));
            ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(6.0f * s, 6.0f * s));
            ImGui::PushStyleVar(ImGuiStyleVar_WindowMinSize, ImVec2(1, 1));
            ImGuiWindowFlags flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoFocusOnAppearing
                | ImGuiWindowFlags_NoNav | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoBackground;
            if (size.x <= 0) flags |= ImGuiWindowFlags_AlwaysAutoResize;
            ImGui::Begin(name, nullptr, flags);
        }
        ~PanelScope()
        {
            const ImVec2 p = ImGui::GetWindowPos(), sz = ImGui::GetWindowSize();
            if (g_glassShapes && Opacity > 0.01f)
                g_glassShapes->push_back(PanelGlass(p, p + sz, Radius, Layer, Opacity));
            ImGui::End();
            ImGui::PopStyleVar(5);
        }
    };

    // a rounded button drawn by hand; returns true when clicked. Selected state is shown by a glass lens drawn by the caller.
    bool Chip(const char* id, const char* label, bool selected, ImVec2 size, ImFont* font, bool enabled = true, ImU32 selectedText = kAccent)
    {
        ImGui::PushID(id);
        const ImVec2 p = ImGui::GetCursorScreenPos();
        if (!enabled) ImGui::BeginDisabled();
        const bool pressed = ImGui::InvisibleButton("##chip", size);
        if (!enabled) ImGui::EndDisabled();
        const bool hovered = enabled && ImGui::IsItemHovered();
        ImDrawList* dl = ImGui::GetWindowDrawList();
        if (!selected) dl->AddRectFilled(p, p + size, hovered ? kHover : kFaint, size.y * 0.5f);
        const ImVec2 ts = TextSize(font, label);
        Text(dl, font, p + (size - ts) * 0.5f, selected ? selectedText : (enabled ? kText : Alpha(kMuted, 0.5f)), label);
        ImGui::PopID();
        return pressed && enabled;
    }

    void Label(const char* t, ImFont* f, ImU32 c = kMuted)
    {
        const ImVec2 p = ImGui::GetCursorScreenPos(), ts = TextSize(f, t);
        Text(ImGui::GetWindowDrawList(), f, p, c, t);
        ImGui::Dummy(ts);
    }

    void DrawWeatherIcon(ImDrawList* dl, ImVec2 c, float r, const std::string& kind, ImU32 col, float s, ImFont* icons)
    {
        const float t = 1.7f * s;
        auto rays = [&](float r0, float r1, int count, float a0, float step)
        {
            for (int k = 0; k < count; k++)
            {
                const float a = a0 + step * k;
                dl->AddLine(ImVec2(c.x + cosf(a) * r0, c.y + sinf(a) * r0), ImVec2(c.x + cosf(a) * r1, c.y + sinf(a) * r1), col, t);
            }
        };
        auto glyph = [&](unsigned cp, ImVec2 at)
        {
            const std::string g = U8(cp);
            const ImVec2 ts = TextSize(icons, g.c_str());
            Text(dl, icons, at - ts * 0.5f, col, g.c_str());
        };
        if (kind == "noon")
        {
            dl->AddCircleFilled(c, r * 0.36f, col);
            rays(r * 0.56f, r * 0.9f, 8, 0.0f, IM_PI * 0.25f);
        }
        else if (kind == "afternoon")
        {
            dl->AddCircle(c, r * 0.36f, col, 0, t);
            rays(r * 0.56f, r * 0.84f, 8, IM_PI * 0.125f, IM_PI * 0.25f);
        }
        else if (kind == "dusk")
        {
            const float hy = c.y + r * 0.28f;
            dl->PathArcTo(ImVec2(c.x, hy), r * 0.46f, IM_PI, IM_PI * 2.0f, 16);
            dl->PathStroke(col, 0, t);
            dl->AddLine(ImVec2(c.x - r * 0.95f, hy), ImVec2(c.x + r * 0.95f, hy), col, t);
            dl->AddLine(ImVec2(c.x - r * 0.5f, hy + r * 0.34f), ImVec2(c.x + r * 0.5f, hy + r * 0.34f), Alpha(col, 0.7f), t);
            for (float a : { -IM_PI * 0.5f, -IM_PI * 0.82f, -IM_PI * 0.18f })
                dl->AddLine(ImVec2(c.x + cosf(a) * r * 0.66f, hy + sinf(a) * r * 0.66f), ImVec2(c.x + cosf(a) * r * 0.92f, hy + sinf(a) * r * 0.92f), col, t);
        }
        else if (kind == "cloudy")
            glyph(IcCloud, c);
        else if (kind == "rain")
        {
            glyph(IcCloud, ImVec2(c.x, c.y - r * 0.22f));
            for (int k = -1; k <= 1; k++)
            {
                const float x = c.x + k * r * 0.42f;
                dl->AddLine(ImVec2(x + r * 0.08f, c.y + r * 0.42f), ImVec2(x - r * 0.12f, c.y + r * 0.92f), col, t);
            }
        }
        else if (kind == "sun")
            glyph(IcSun, c);
        else
        {
            glyph(IcMoon, ImVec2(c.x - r * 0.08f, c.y + r * 0.04f));
            dl->AddCircleFilled(ImVec2(c.x + r * 0.62f, c.y - r * 0.62f), 1.4f * s, col);
            dl->AddCircleFilled(ImVec2(c.x + r * 0.9f, c.y - r * 0.12f), 1.0f * s, col);
        }
    }

    const char* QualityName(int i)
    {
        static const char* const zh[] = { "流畅", "均衡", "高画质", "极致" }, * const en[] = { "Smooth", "Balanced", "High", "Ultimate" };
        return L(zh[i], en[i]);
    }
    const char* QualityCaption(int i)
    {
        static const char* const zh[] = {
            "DLSS 性能模式 · 路径追踪 12 次反弹",
            "DLSS 均衡模式 · 路径追踪 18 次反弹",
            "DLSS 质量模式 · 路径追踪 24 次反弹",
            "DLAA 原生分辨率 · 路径追踪 48 次反弹" };
        static const char* const en[] = {
            "DLSS Performance · 12 path-tracing bounces",
            "DLSS Balanced · 18 path-tracing bounces",
            "DLSS Quality · 24 path-tracing bounces",
            "DLAA native resolution · 48 path-tracing bounces" };
        return L(zh[i], en[i]);
    }
    const int kQualityPreset[] = { 1, 2, 3, 4 };    // SampleUI performance presets: Performance, Balanced, Quality, Ultra Quality

#if DONUT_WITH_STREAMLINE
    const char* DlssModeName(SI::DLSSMode m)
    {
        switch (m)
        {
        case SI::DLSSMode::eDLAA:               return "DLAA";
        case SI::DLSSMode::eMaxQuality:         return L("质量", "Quality");
        case SI::DLSSMode::eBalanced:           return L("均衡", "Balanced");
        case SI::DLSSMode::eMaxPerformance:     return L("性能", "Performance");
        case SI::DLSSMode::eUltraPerformance:   return L("超性能", "Ultra Performance");
        case SI::DLSSMode::eUltraQuality:       return L("超质量", "Ultra Quality");
        default:                                return L("关", "off");
        }
    }
#endif

    std::filesystem::path CapturesFolder()
    {
        // Rtxpt.exe lives in <project>/renderer/bin
        return donut::app::GetDirectoryWithExecutable().parent_path().parent_path() / "captures";
    }
    std::filesystem::path AppDataFile() { return GetLocalPath(c_AssetsFolder) / "manchester.app.json"; }

    std::string FileVersion(const std::filesystem::path& file)
    {
#ifdef _WIN32
        DWORD handle = 0;
        const DWORD size = GetFileVersionInfoSizeW(file.wstring().c_str(), &handle);
        if (size == 0) return "";
        std::vector<char> data(size);
        if (!GetFileVersionInfoW(file.wstring().c_str(), 0, size, data.data())) return "";
        VS_FIXEDFILEINFO* info = nullptr;
        UINT len = 0;
        if (!VerQueryValueW(data.data(), L"\\", reinterpret_cast<void**>(&info), &len) || info == nullptr) return "";
        return std::to_string(HIWORD(info->dwFileVersionMS)) + "." + std::to_string(LOWORD(info->dwFileVersionMS)) + "." + std::to_string(HIWORD(info->dwFileVersionLS));
#else
        return "";
#endif
    }

    // names of materials rain must not wet: glass, water, lights
    bool RainSkips(const std::string& n)
    {
        static const char* prefixes[] = { "glass", "win", "water", "canal", "fountain", "spray", "cloud", "etfe", "vwin", "shop", "phone", "acerFrit", "acerLit", "lamp", "led", "flood", "avi", "lantern", "clock", "head", "dest", "goldTxt",
                                          "leaded", "spandrel", "plinth", "table", "slabSide", "gilt" };
        for (const char* p : prefixes) if (n.rfind(p, 0) == 0) return true;
        return false;
    }
}

/* ---------------- settings ---------------- */

std::string ManchesterSettings::Path()
{
    return (donut::app::GetDirectoryWithExecutable() / "ManchesterRTX.ini").string();
}

ManchesterSettings ManchesterSettings::Load()
{
    ManchesterSettings s;
    std::ifstream f(Path());
    std::string line;
    while (std::getline(f, line))
    {
        const size_t eq = line.find('=');
        if (line.empty() || line[0] == '#' || eq == std::string::npos) continue;
        const std::string k = line.substr(0, eq), v = line.substr(eq + 1);
        try
        {
            if (k == "weather")         s.Weather = v;
            else if (k == "rain")       s.Rain = v == "1";
            else if (k == "quality")    s.Quality = std::clamp(std::stoi(v), 0, 3);
            else if (k == "frameGen")   s.FrameGen = std::clamp(std::stoi(v), 0, 3);
            else if (k == "exposure")   s.Exposure = std::clamp(std::stof(v), -3.0f, 3.0f);
            else if (k == "clarity")    s.Clarity = std::clamp(std::stof(v), 0.0f, 1.0f);
            else if (k == "hdr")        s.Hdr = v == "1";
            else if (k == "paperWhite") s.PaperWhite = std::clamp(std::stof(v), 0.0f, 480.0f);
            else if (k == "hdrPeak")    s.HdrPeak = std::clamp(std::stof(v), 0.0f, 10000.0f);
            else if (k == "fullscreen") s.Fullscreen = v == "1";
            else if (k == "pins")       s.Pins = v == "1";
            else if (k == "stats")      s.ShowStats = v == "1";
            else if (k == "language")   s.Language = (v == "zh" || v == "en") ? v : "auto";
        }
        catch (...) {}
    }
    return s;
}

void ManchesterSettings::Save() const
{
    std::ofstream f(Path(), std::ios::trunc);
    f << "# ManchesterRTX settings, written by the app\n"
      << "weather=" << Weather << "\nrain=" << (Rain ? 1 : 0) << "\nquality=" << Quality << "\nframeGen=" << FrameGen
      << "\nexposure=" << Exposure << "\nclarity=" << Clarity
      << "\nhdr=" << (Hdr ? 1 : 0) << "\npaperWhite=" << PaperWhite << "\nhdrPeak=" << HdrPeak
      << "\nfullscreen=" << (Fullscreen ? 1 : 0) << "\npins=" << (Pins ? 1 : 0) << "\nstats=" << (ShowStats ? 1 : 0)
      << "\nlanguage=" << Language << "\n";
}

bool ManchesterSettings::English() const
{
    if (Language == "en") return true;
    if (Language == "zh") return false;
#ifdef _WIN32
    return PRIMARYLANGID(GetUserDefaultUILanguage()) != LANG_CHINESE;   // auto: Chinese on a Chinese Windows, else English
#else
    return true;
#endif
}

/* ---------------- setup ---------------- */

ManchesterApp::ManchesterApp(Sample& app, SampleUIData& ui)
    : m_app(app), m_ui(ui)
{
    m_settings = ManchesterSettings::Load();
    g_english = m_settings.English();
    m_quality = m_settings.Quality;
    m_dlssVersion = FileVersion(donut::app::GetDirectoryWithExecutable() / "nvngx_dlssd.dll");
}

ManchesterApp::~ManchesterApp() = default;

std::string ManchesterApp::CollectDataText()
{
    std::ifstream f(AppDataFile(), std::ios::binary);
    std::stringstream ss; ss << f.rdbuf();
    return ss.str();
}

void ManchesterApp::BuildGlyphRanges(ImVector<ImWchar>& textRanges, ImVector<ImWchar>& iconRanges)
{
    ImFontGlyphRangesBuilder text;
    text.AddRanges(ImGui::GetIO().Fonts->GetGlyphRangesDefault());
    text.AddText(kManchesterGlyphText);
    const std::string data = CollectDataText();
    text.AddText(data.c_str());
    text.BuildRanges(&textRanges);

    ImFontGlyphRangesBuilder icons;
    for (unsigned cp : kIconsUsed) icons.AddChar(ImWchar(cp));
    icons.BuildRanges(&iconRanges);
}

bool ManchesterApp::LoadData()
{
    Json::Value root;
    if (!LoadJsonFromFile(AppDataFile(), root) || !root.isObject())
    {
        log::warning("ManchesterRTX: %s missing, run exporter/export.mjs", AppDataFile().string().c_str());
        return false;
    }
    auto f3 = [](const Json::Value& v) { return float3(v[0].asFloat(), v[1].asFloat(), v[2].asFloat()); };
    auto num = [](const Json::Value& o, const char* k, float d) { return o.isMember(k) ? o[k].asFloat() : d; };
    // display text: Chinese at the top level, English under "en"
    auto text2 = [](const Json::Value& o, const char* k) { return Text2{ o[k].asString(), o["en"].isObject() ? o["en"][k].asString() : std::string() }; };
    if (const Json::Value& d = root["date"]; d.isObject())
    {
        m_dayOfYear = d["dayOfYear"].asInt();
        m_latitude = num(d, "lat", m_latitude); m_longitude = num(d, "lon", m_longitude); m_utcOffset = num(d, "utcOffset", m_utcOffset);
    }
    for (const Json::Value& w : root["weathers"])
    {
        Weather x;
        x.Id = w["id"].asString(); x.Names = text2(w, "name"); x.Descs = text2(w, "desc"); x.Icon = w["icon"].asString();
        for (const std::string& name : w["emissive"].getMemberNames())
            x.Emissive[name] = w["emissive"][name].asFloat();
        // lighting: the clock time, the sky (clouds, overcast, brightness, night glow, stars), haze, bloom and grade
        Lighting& L = x.Light;
        L.Time = num(w, "time", 17.5f);
        L.Exposure = num(w, "exposure", 0.0f); L.ExposureMin = num(w, "exposureMin", -2.0f); L.ExposureMax = num(w, "exposureMax", 14.0f);
        L.Moon = num(w, "moon", 0.0f);
        if (const Json::Value& s = w["sky"]; s.isObject())
        {
            L.Clouds = num(s, "clouds", 0.42f); L.Overcast = num(s, "overcast", 0.0f);
            L.SkyBrightness = num(s, "brightness", 1.0f); L.SunBrightness = num(s, "sun", 5.0f);
            L.NightGlow = num(s, "nightGlow", 0.0f); L.CloudUnderglow = num(s, "underglow", 0.0f); L.Stars = num(s, "stars", 0.0f);
        }
        if (const Json::Value& a = w["haze"]; a.isObject())
        {
            L.Atmo.HazeDensity = num(a, "density", L.Atmo.HazeDensity); L.Atmo.HazeHeight = num(a, "height", L.Atmo.HazeHeight);
            L.Atmo.ShaftStrength = num(a, "shafts", L.Atmo.ShaftStrength); L.Atmo.AmbientStrength = num(a, "ambient", L.Atmo.AmbientStrength);
            L.Atmo.PhaseG = num(a, "g", L.Atmo.PhaseG); L.Atmo.CloudShadow = num(a, "cloudShadow", L.Atmo.CloudShadow);
            if (a.isMember("glow")) L.Atmo.AmbientOverride = float3(a["glow"][0].asFloat(), a["glow"][1].asFloat(), a["glow"][2].asFloat());
        }
        if (const Json::Value& gr = w["grade"]; gr.isObject())
        {
            L.Bloom = num(gr, "bloom", L.Bloom); L.BloomRadius = num(gr, "bloomRadius", L.BloomRadius);
            L.Saturation = num(gr, "saturation", L.Saturation); L.Contrast = num(gr, "contrast", L.Contrast);
            L.Vignette = num(gr, "vignette", L.Vignette); L.WhitePoint = num(gr, "whitePoint", L.WhitePoint);
        }
        m_weathers.push_back(x);
    }
    for (const Json::Value& v : root["views"])
        m_views.push_back({ v["key"].asString(), "", "", f3(v["eye"]), f3(v["at"]), v["fov"].asFloat(), text2(v, "name"), text2(v, "desc") });
    for (const Json::Value& h : root["towers"])
        m_towers.push_back({ h["n"].asInt(), h["name"].asString(), h["brand"].asString(), h["addr"].asString(), f3(h["pos"]), h["view"].asInt(), h["side"].asInt() });
    // the towers panel's wording comes with the data (neutral unless exporter/data/personal.json says otherwise)
    const Json::Value& ht = root["towersText"];
    m_towerTitles = ht.isObject() ? text2(ht, "title") : Text2{ "精选建筑", "Featured towers" };
    m_towerPinsLabels = ht.isObject() ? text2(ht, "pins") : Text2{ "在地图上标出精选建筑", "Show the featured towers on the map" };
    ApplyLanguage(false);
    return !m_weathers.empty() && !m_views.empty();
}

void ManchesterApp::ApplyLanguage(bool announce)
{
    g_english = m_settings.English();
    for (Weather& w : m_weathers) { w.Name = w.Names.Get(g_english); w.Desc = w.Descs.Get(g_english); }
    for (View& v : m_views) { v.Name = v.Names.Get(g_english); v.Desc = v.Descs.Get(g_english); }
    m_towerTitle = m_towerTitles.Get(g_english);
    m_towerPinsLabel = m_towerPinsLabels.Get(g_english);
    if (announce) ShowToast(L("界面语言  ·  中文", "Interface language  ·  English"));
}

void ManchesterApp::SceneLoaded()
{
    // the developer panel can still load RTXPT's sample scenes; the GUI only drives the Manchester ones
    m_sceneReady = false;
    m_emissives.clear();
    m_surfaces.clear();
    m_dryState.clear();
    m_moon = nullptr;
    StopCameraAutomation();
    if (m_app.GetCurrentSceneName().rfind("manchester", 0) != 0)
        return;
    if (!m_dataLoaded)
        m_dataLoaded = LoadData();
    if (!m_dataLoaded)
        return;

    // emissive materials the weather presets drive, everything else rain can wet, and the moon
    std::unordered_set<std::string> driven;
    for (const Weather& w : m_weathers)
        for (const auto& kv : w.Emissive) driven.insert(kv.first);
    for (const auto& material : m_app.GetScene()->GetSceneGraph()->GetMaterials())
    {
        if (driven.count(material->name))
            m_emissives.push_back({ material, material->name });
        else if (!RainSkips(material->name))
            m_surfaces.push_back({ material, material->name });
    }
    for (const auto& light : m_app.m_lights)
        if (auto dir = std::dynamic_pointer_cast<engine::DirectionalLight>(light))
            if (dir->GetName() == "Moon") m_moon = dir;
    // each weather's emissive levels, in the order of m_emissives
    for (Weather& w : m_weathers)
    {
        w.Light.Emissive.assign(m_emissives.size(), 0.0f);
        for (size_t i = 0; i < m_emissives.size(); i++)
            if (auto it = w.Emissive.find(m_emissives[i].second); it != w.Emissive.end()) w.Light.Emissive[i] = it->second;
    }
    m_appliedEmissive.clear();
    m_appliedWet = -1.0f;
    m_materialsApplied = false;

    // clock hands (nodes named "clockhand:<tower>:<face>:hour|minute", pivoting about their local z axis)
    m_clockHands.clear();
    m_appliedClock = -1.0f;
    for (engine::SceneGraphWalker walker(m_app.GetScene()->GetSceneGraph()->GetRootNode().get()); walker; walker.Next(true))
    {
        const std::string& name = walker->GetName();
        if (name.rfind("clockhand:", 0) == 0)
            m_clockHands.push_back({ walker.Get(), walker->GetRotation(), name.size() >= 5 && name.compare(name.size() - 5, 5, ":hour") == 0 });
    }

    // one sky for every weather: the physical sky with the sun placed by the clock
    m_app.SetEnvMapOverrideSource("==PROCEDURAL_SKY_MIDDAY==");
    m_ui.EnvironmentMapParams.RotationXYZ = float3(0.0f);
    m_ui.EnvironmentMapParams.TintColor = float3(1.0f);

    m_app.m_selectedCameraIndex = 0;    // free flight; the GUI moves the camera between viewpoints

    int weather = 0;
    for (int i = 0; i < (int)m_weathers.size(); i++) if (m_weathers[i].Id == m_settings.Weather) weather = i;
    m_weather = weather;
    m_light = WeatherLighting(weather);
    StartTransition(m_light, 0.0f);
    m_lightSnap = true;
    m_atmosphereCut = true;
    m_adaptFrames = 40;
    ApplyQuality(m_settings.Quality, false);
    ApplyFrameGen(m_settings.FrameGen, false);
    m_qualityPending = true;

    // open with a slow glide down onto the overview, started once the first frames are on screen (see Animate)
    const Pose overview = ViewPose(0);
    Pose start = overview;
    start.Pos = overview.Pos - overview.Dir * 420.0f + float3(0, 160.0f, 0);
    SetCameraPose(start);
    m_introPending = true;
    m_readyFrames = 0;
    m_curtain = 1.0f;
    m_sceneReady = true;
}

/* ---------------- state changes ---------------- */

ManchesterApp::Lighting ManchesterApp::WeatherLighting(int index) const
{
    Lighting L = m_weathers[std::clamp(index, 0, (int)m_weathers.size() - 1)].Light;
    if (m_settings.Rain)
    {
        // rain closes the sky in: an overcast deck swallows the sun, the light dims and cools, the haze thickens, the stars
        // go out, the deck glows with the city's light at night, and streets, roofs and facades turn wet and glossy
        L.Clouds = std::min(L.Clouds, 0.05f);
        L.Overcast = 1.0f;
        L.SkyBrightness *= 0.6f;
        L.Stars = 0.0f;
        L.CloudUnderglow *= 1.6f;
        L.Atmo.HazeDensity *= 2.2f; L.Atmo.HazeHeight *= 1.5f;
        L.Atmo.ShaftStrength *= 0.25f; L.Atmo.CloudShadow = 0.0f;
        L.Saturation = std::min(L.Saturation, 0.92f);
        L.WhitePoint = std::min(L.WhitePoint, 6200.0f);
        L.Exposure += 0.3f;
        L.Moon = 0.0f;
        L.Wet = 1.0f;
    }
    return L;
}

void ManchesterApp::StartTransition(const Lighting& target, float duration)
{
    m_from = m_light;
    m_to = target;
    if (m_from.Emissive.size() != m_to.Emissive.size()) m_from.Emissive = m_to.Emissive;
    // the clock runs the shorter way round (forward on a near tie, so night to noon passes through the sunrise)
    const float forward = std::fmod(target.Time - m_light.Time + 48.0f, 24.0f);
    m_transHours = forward <= 13.0f ? forward : forward - 24.0f;
    m_transDuration = duration >= 0.0f ? duration : std::clamp(2.2f + std::fabs(m_transHours) * 0.22f, 2.2f, 5.0f);
    m_transT = 0.0f;
}

void ManchesterApp::ApplyWeather(int index, bool announce)
{
    if (index < 0 || index >= (int)m_weathers.size()) return;
    const Weather& w = m_weathers[index];
    m_weather = index;
    StartTransition(WeatherLighting(index));
    m_settings.Weather = w.Id;
    m_settings.Save();
    if (announce) ShowToast(w.Name + "  ·  " + ClockText(w.Light.Time) + (m_settings.Rain ? L("  ·  雨", "  ·  rain") : "") + "  ·  " + w.Desc);
}

void ManchesterApp::SetRain(bool rain, bool announce)
{
    if (rain == m_settings.Rain) return;
    m_settings.Rain = rain;
    StartTransition(WeatherLighting(m_weather), 2.8f);
    m_settings.Save();
    if (announce) ShowToast(rain ? L("下雨了  ·  路面、屋顶和立面湿润反光", "Rain  ·  streets, roofs and facades turn wet and glossy")
                                 : L("雨停了  ·  天空放晴", "The rain stops  ·  the sky clears"));
}

bool ManchesterApp::ApplyMaterials()
{
    // RTXPT creates its path tracer materials on the first render after loading: remember the dry look of every surface
    // rain can touch once they are there
    if (m_dryState.empty())
    {
        for (auto& [material, name] : m_surfaces)
        {
            std::shared_ptr<PTMaterial> pt = PTMaterial::SafeCast(material);
            if (!pt) { m_dryState.clear(); return false; }
            m_dryState.push_back({ pt, pt->Roughness, pt->BaseOrDiffuseColor });
        }
    }
    // window, street and sign lights: written only when their level changes. A small floor keeps every light in RTXPT's
    // light list, so lights coming on at dusk only brighten - the list (and its sampling history) is never rebuilt
    if (m_appliedEmissive.size() != m_emissives.size()) m_appliedEmissive.assign(m_emissives.size(), -1.0f);
    for (size_t i = 0; i < m_emissives.size(); i++)
    {
        const float level = std::max(i < m_light.Emissive.size() ? m_light.Emissive[i] : 0.0f, 1e-3f);
        if (std::fabs(level - m_appliedEmissive[i]) <= 1e-4f * std::max(1.0f, level)) continue;
        std::shared_ptr<PTMaterial> pt = PTMaterial::SafeCast(m_emissives[i].first);
        if (!pt) return false;
        pt->EmissiveIntensity = level;
        pt->GPUDataDirty = true;
        m_appliedEmissive[i] = level;
    }
    // wet: darker (water fills the pores) and much smoother, so streets and roofs mirror the sky and the lights
    if (m_appliedWet < 0.0f || std::fabs(m_light.Wet - m_appliedWet) > 0.002f)
    {
        const float w = std::clamp(m_light.Wet, 0.0f, 1.0f);
        for (WetBackup& b : m_dryState)
        {
            b.Material->Roughness = b.Roughness + (std::max(b.Roughness * 0.32f, 0.035f) - b.Roughness) * w;
            b.Material->BaseOrDiffuseColor = b.Base * (1.0f - 0.32f * w);
            b.Material->GPUDataDirty = true;
        }
        m_appliedWet = w;
    }
    return true;
}

void ManchesterApp::UpdateClocks()
{
    if (m_clockHands.empty()) return;
    const float t = std::fmod(m_light.Time + 24.0f, 24.0f);
    if (std::fabs(t - m_appliedClock) < 1.0f / 3600.0f) return;
    m_appliedClock = t;
    const double minutes = std::fmod(double(t), 1.0) * 60.0, hours = std::fmod(double(t), 12.0);
    for (const ClockHand& h : m_clockHands)
    {
        // the hand's mesh points at twelve along its local +y and the dial faces local +z: clockwise seen from the front
        const double turns = h.Hour ? hours / 12.0 : minutes / 60.0, half = -turns * dm::PI_d;
        h.Node->SetRotation(h.Base * dm::dquat(std::cos(half), 0.0, 0.0, std::sin(half)));
    }
}

float3 ManchesterApp::SunDirection(float clock) const
{
    // NOAA's simplified solar position: declination and the equation of time for the day, then the hour angle from the
    // local clock (time zone and longitude); azimuth from north, clockwise
    const double rad = dm::PI_d / 180.0, d = m_dayOfYear;
    const double decl = 23.44 * rad * std::sin(2.0 * dm::PI_d * (284.0 + d) / 365.0);
    const double B = 2.0 * dm::PI_d * (d - 81.0) / 364.0;
    const double eot = 9.87 * std::sin(2.0 * B) - 7.53 * std::cos(B) - 1.5 * std::sin(B);
    const double solar = clock - m_utcOffset + m_longitude / 15.0 + eot / 60.0;
    const double H = (solar - 12.0) * 15.0 * rad, lat = m_latitude * rad;
    const double el = std::asin(std::clamp(std::sin(lat) * std::sin(decl) + std::cos(lat) * std::cos(decl) * std::cos(H), -1.0, 1.0));
    const double az = std::atan2(std::sin(H), std::cos(H) * std::sin(lat) - std::tan(decl) * std::cos(lat)) + dm::PI_d;
    return normalize(float3(float(std::sin(az) * std::cos(el)), float(std::sin(el)), float(-std::cos(az) * std::cos(el))));
}

std::string ManchesterApp::ClockText(float hours) const
{
    const int m = int(std::fmod(hours + 24.0f, 24.0f) * 60.0f + 0.5f) % (24 * 60);
    char buf[16];
    snprintf(buf, sizeof(buf), "%02d:%02d", m / 60, m % 60);
    return buf;
}

float ManchesterApp::GetUIWhiteNits() const
{
    if (!g_HdrOutput) return 80.0f;
    // SDR white follows Windows' "SDR content brightness" unless set in the app, so the GUI matches the rest of the desktop -
    // but stays at or below 40% of the display's peak, which keeps headroom for the sun, glints on glass and lit windows
    if (m_settings.PaperWhite > 0.0f) return m_settings.PaperWhite;
    return std::clamp(g_DisplayHdr.SdrWhiteNits, 160.0f, std::max(160.0f, GetPeakNits() * 0.4f));
}

float ManchesterApp::GetPeakNits() const
{
    if (m_settings.HdrPeak > 0.0f) return m_settings.HdrPeak;
    return g_DisplayHdr.MaxLuminance > 300.0f ? g_DisplayHdr.MaxLuminance : 1000.0f;
}

void ManchesterApp::ApplyExposure()
{
    m_ui.ToneMappingParams.autoExposure = true;
    // RTXPT's auto exposure keys the log-average luminance to 0.042, tuned for its Hable curve; the ACES curve the app uses
    // (with its 0.6 pre-scale) puts that key about 1.5 EV darker, so the base exposure is raised to match
    const float kAcesExposure = 1.4f;
    m_ui.ToneMappingParams.exposureCompensation = kAcesExposure + m_light.Exposure + m_settings.Exposure;
    m_ui.ToneMappingParams.exposureValueMin = m_light.ExposureMin;
    m_ui.ToneMappingParams.exposureValueMax = m_light.ExposureMax;
}

void ManchesterApp::UpdateLighting(float dt)
{
    // the time-lapse: smootherstep from the state at the switch to the new weather's
    if (m_lightSnap) m_transT = m_transDuration;
    m_transT = std::min(m_transT + std::max(dt, 0.0f), m_transDuration);
    const float u = m_transDuration > 0.0f ? std::clamp(m_transT / m_transDuration, 0.0f, 1.0f) : 1.0f;
    const float e = u * u * u * (u * (u * 6.0f - 15.0f) + 10.0f);
    const Lighting& A = m_from; const Lighting& B = m_to;
    Lighting L = B;
    auto mix = [e](float a, float b) { return a + (b - a) * e; };
    L.Time = std::fmod(A.Time + m_transHours * e + 24.0f, 24.0f);
    L.Clouds = mix(A.Clouds, B.Clouds); L.Overcast = mix(A.Overcast, B.Overcast);
    L.SkyBrightness = mix(A.SkyBrightness, B.SkyBrightness); L.SunBrightness = mix(A.SunBrightness, B.SunBrightness);
    L.NightGlow = mix(A.NightGlow, B.NightGlow); L.CloudUnderglow = mix(A.CloudUnderglow, B.CloudUnderglow); L.Stars = mix(A.Stars, B.Stars);
    L.Atmo.HazeDensity = mix(A.Atmo.HazeDensity, B.Atmo.HazeDensity); L.Atmo.HazeHeight = mix(A.Atmo.HazeHeight, B.Atmo.HazeHeight);
    L.Atmo.ShaftStrength = mix(A.Atmo.ShaftStrength, B.Atmo.ShaftStrength); L.Atmo.AmbientStrength = mix(A.Atmo.AmbientStrength, B.Atmo.AmbientStrength);
    L.Atmo.PhaseG = mix(A.Atmo.PhaseG, B.Atmo.PhaseG); L.Atmo.CloudShadow = mix(A.Atmo.CloudShadow, B.Atmo.CloudShadow);
    L.Atmo.AmbientOverride = lerp(A.Atmo.AmbientOverride, B.Atmo.AmbientOverride, e);
    L.Bloom = mix(A.Bloom, B.Bloom); L.BloomRadius = mix(A.BloomRadius, B.BloomRadius);
    L.Saturation = mix(A.Saturation, B.Saturation); L.Contrast = mix(A.Contrast, B.Contrast);
    L.Vignette = mix(A.Vignette, B.Vignette); L.WhitePoint = mix(A.WhitePoint, B.WhitePoint);
    L.Exposure = mix(A.Exposure, B.Exposure); L.ExposureMin = mix(A.ExposureMin, B.ExposureMin); L.ExposureMax = mix(A.ExposureMax, B.ExposureMax);
    L.Moon = mix(A.Moon, B.Moon); L.Wet = mix(A.Wet, B.Wet);
    for (size_t i = 0; i < L.Emissive.size() && i < A.Emissive.size(); i++) L.Emissive[i] = mix(A.Emissive[i], B.Emissive[i]);
    m_light = L;
    m_lightSnap = false;
    m_sunDir = SunDirection(L.Time);

    // the physical sky follows: sun from the clock, cloud cover, brightness, night glow and stars. The clouds drift with the
    // wind (about 12 m/s) and are re-baked every frame, so they glide instead of stepping; a still photo keeps them still
    ProceduralSkyOverride& sky = g_ProceduralSkyOverride;
    sky.Enabled = true;
    sky.SunDirWorld = m_sunDir;
    sky.CloudDensityOffset = L.Clouds;
    sky.Brightness = L.SkyBrightness;
    sky.SunBrightness = L.SunBrightness;
    sky.SunAboveClouds = 1.0f - L.Overcast;
    sky.NightGlow = L.NightGlow;
    sky.CloudUnderglow = L.CloudUnderglow;
    sky.Stars = 0.0f;       // the stars are drawn per pixel by the atmosphere pass instead (the cube map is too coarse)
    if (!m_photoMode) m_cloudsTime += double(std::max(dt, 0.0f)) * 0.34;
    sky.CloudsTime = m_cloudsTime;
    if (m_moon) m_moon->irradiance = L.Moon;

    // exposure follows the scene like an eye, a little slower than the time-lapse; it snaps for the first frames of a scene
    ApplyExposure();
    m_ui.ToneMappingParams.adaptationRate = 2.2f;
    m_ui.ToneMappingParams.resetAdaptation = m_adaptFrames > 0;
    if (m_adaptFrames > 0) m_adaptFrames--;

    // HDR10 or SDR output
    m_ui.ToneMappingParams.outputMode = g_HdrOutput ? TONEMAPPING_OUTPUT_HDR10 : TONEMAPPING_OUTPUT_SDR;
    m_ui.ToneMappingParams.paperWhiteNits = GetUIWhiteNits();
    m_ui.ToneMappingParams.peakNits = GetPeakNits();

    // filmic tone curve, white balance, bloom and grade
    m_ui.ToneMappingParams.toneMapOperator = ToneMapperOperator::Aces;
    m_ui.ToneMappingParams.whiteBalance = std::abs(L.WhitePoint - 6500.0f) > 1.0f;
    m_ui.ToneMappingParams.whitePoint = L.WhitePoint;
    m_ui.ToneMappingParams.saturation = L.Saturation;
    m_ui.ToneMappingParams.contrast = L.Contrast;
    m_ui.ToneMappingParams.vignette = m_photoMode ? L.Vignette * 0.6f : L.Vignette;
    m_ui.EnableBloom = L.Bloom > 0.0f;
    m_ui.BloomIntensity = L.Bloom;
    m_ui.BloomRadius = L.BloomRadius;
}

void ManchesterApp::RenderAtmosphere(nvrhi::ICommandList* commandList)
{
    if (!m_sceneReady || !m_app.m_topLevelAS || !m_app.m_envMapBaker || !m_app.m_renderTargets || !m_app.m_view || !m_app.m_viewPrevious) return;
    if (!m_atmosphere)
        m_atmosphere = std::make_unique<ManchesterAtmosphere>(m_app.GetDevice(), m_app.GetShaderFactory(), m_app.GetCommonPasses());

    AtmosphereInputs in;
    in.TLAS = m_app.m_topLevelAS;
    in.Color = m_app.m_renderTargets->ProcessedOutputColor;
    in.EnvCube = m_app.m_envMapBaker->GetEnvMapCube();
    const std::shared_ptr<SampleProceduralSky>& sky = m_app.m_envMapBaker->GetProceduralSky();
    const bool procedural = sky != nullptr && m_app.m_envMapBaker->IsProcedural();
    if (procedural)
    {
        in.Sky = &sky->GetLastConstants();
        in.SkyTransmittance = sky->GetTransmittanceTexture();
        in.SkyScatter = sky->GetScatterringTexture();
        in.SkyIrradiance = sky->GetIrradianceTexture();
        in.Clouds = sky->GetCloudsTexture();
        in.Noise = sky->GetNoiseTexture();
    }
    // camera-relative view-projections (rotation and projection only): unprojecting through a world-space matrix loses
    // the ray directions to float rounding kilometres from the origin (see ViewDir in Atmosphere.hlsl)
    auto relative = [](const engine::PlanarView& v)
    {
        affine3 view = v.GetViewMatrix();
        view.m_translation = float3(0.f);
        return affineToHomogeneous(view) * v.GetProjectionMatrix(false);
    };
    in.ClipToWorld = inverse(relative(*m_app.m_view));
    in.PrevWorldToClip = relative(*m_app.m_viewPrevious);
    in.CameraPos = m_app.m_camera.GetPosition();
    in.CameraMotion = m_atmospherePrevCamera.has_value() ? in.CameraPos - *m_atmospherePrevCamera : float3(0.f);
    m_atmospherePrevCamera = in.CameraPos;
    in.SunDir = m_sunDir;
    // shafts fade as the sun sets and as an overcast deck closes over it
    const float horizon = std::clamp((m_sunDir.y + 0.004f) / 0.03f, 0.0f, 1.0f);
    in.SunVisibility = procedural ? (1.0f - m_light.Overcast) * horizon * horizon * (3.0f - 2.0f * horizon) : 0.0f;
    // the baked cube already carries the baker's radiance scale (1/4); the sky model's raw units do not
    const float3 cm = m_app.m_envMapSceneParams.ColorMultiplier;
    in.EnvMultiplier = cm;
    in.SkyMultiplier = cm * 0.25f;
    in.CameraCut = m_atmosphereCut;
    m_atmosphereCut = false;
    // seen from high above (the overview) the whole model would sit under a veil; thin the haze with the camera's altitude
    AtmosphereSettings s = m_light.Atmo;
    const float alt = std::clamp((in.CameraPos.y - 250.0f) / 1600.0f, 0.0f, 1.0f);
    s.HazeDensity *= 1.0f - 0.72f * alt * alt * (3.0f - 2.0f * alt);
    s.DebugView = m_atmosphereDebug;
    s.Stars = procedural ? m_light.Stars : 0.0f;
    m_atmosphere->Render(commandList, in, s);
}

void ManchesterApp::ApplyQuality(int index, bool announce)
{
    index = std::clamp(index, 0, 3);
    ApplyPerformancePresetIndex(m_ui, kQualityPreset[index]);
#if DONUT_WITH_STREAMLINE
    m_ui.DLSSModeStartup = m_ui.DLSSMode;
    m_ui.DLSRRPreset = SI::DLSSRRPreset::ePresetF;      // DLSS 310.9 second-generation transformer Ray Reconstruction
#endif
    m_ui.RealtimeAA = 3;    // DLSS Ray Reconstruction (falls back to DLSS / TAA when unsupported)
    // RTXPT samples textures a full mip sharper than the ray cones ask for (-1, plus DLSS's own -0.4): on fine brick,
    // ashlar joints and window grids that beats into moire. A slightly positive bias keeps them crisp but clean
    m_ui.TexLODBias = 0.25f;
    m_quality = index;
    m_settings.Quality = index;
    m_settings.Save();
    if (announce) ShowToast(std::string(L("画质  ·  ", "Quality  ·  ")) + QualityName(index) + L("（", " (") + QualityCaption(index) + L("）", ")"));
}

void ManchesterApp::ApplyFrameGen(int frames, bool announce)
{
#if DONUT_WITH_STREAMLINE
    frames = std::clamp(frames, 0, 3);
    if (frames > 0 && !m_ui.IsDLSSFGSupported)
    {
        if (announce) ShowToast(L("这块显卡不支持 DLSS 帧生成", "This GPU does not support DLSS Frame Generation"));
        frames = 0;
    }
    m_ui.DLSSFGMode = frames > 0 ? SI::DLSSGMode::eOn : SI::DLSSGMode::eOff;
    m_ui.DLSSFGNumFramesToGenerate = std::max(1, frames);
    m_settings.FrameGen = frames;
    m_settings.Save();
    if (announce) ShowToast(frames > 0 ? (std::to_string(frames + 1) + L("× 帧生成已开启  ·  Reflex 低延迟", "× Frame Generation on  ·  Reflex low latency"))
                                       : std::string(L("帧生成已关闭", "Frame Generation off")));
#endif
}

void ManchesterApp::SetFullscreen(bool fullscreen)
{
    m_settings.Fullscreen = fullscreen;
    m_settings.Save();
    m_fullscreenPending = true;     // applied in Animate, outside the UI pass
}

void ManchesterApp::TogglePhotoMode()
{
    m_photoMode = !m_photoMode;
    StopCameraAutomation();
    if (m_photoMode)
    {
        m_savedAccumulationTarget = m_ui.AccumulationTarget;
        m_ui.AccumulationTarget = m_photoTarget;
        m_ui.RealtimeMode = false;
        ShowToast(L("照片模式  ·  镜头静止时逐帧累积，得到无噪点的参考级路径追踪画面", "Photo mode  ·  a still camera accumulates frames into a noise-free reference path-traced image"));
    }
    else
    {
        m_ui.RealtimeMode = true;
        if (m_savedAccumulationTarget > 0) m_ui.AccumulationTarget = m_savedAccumulationTarget;
        ShowToast(L("已回到实时模式", "Back to real time"));
    }
    m_ui.ResetAccumulation = true;
}

void ManchesterApp::RequestScreenshot()
{
    std::error_code ec;
    std::filesystem::create_directories(CapturesFolder(), ec);
    std::time_t now = std::time(nullptr);
    std::tm local{};
    localtime_s(&local, &now);
    char name[64];
    std::strftime(name, sizeof(name), "ManchesterRTX-%Y%m%d-%H%M%S.png", &local);
    m_lastScreenshot = (CapturesFolder() / name).string();
    m_screenshotRequested = true;
}

bool ManchesterApp::TakeRawScreenshotRequest(std::string& path)
{
    if (!m_rawScreenshotRequested) return false;
    m_rawScreenshotRequested = false;
    std::error_code ec;
    std::filesystem::create_directories(CapturesFolder(), ec);
    path = (CapturesFolder() / (g_HdrOutput ? "raw-hdr10.png" : "raw-sdr.png")).string();
    return true;
}

int ManchesterApp::RecordSlot()
{
    if (m_recordLeft <= 0) return -1;
    const int slot = m_recordTotal - m_recordLeft--;
    const float3 p = m_app.m_camera.GetPosition(), d = m_app.m_camera.GetDir();
    int fg = 0;
#if DONUT_WITH_STREAMLINE
    fg = m_ui.ActualDLSSFGMode() == SI::DLSSGMode::eOn ? m_ui.DLSSFGNumFramesToGenerate + 1 : 1;
#endif
    GLFWwindow* window = m_app.GetGLFWWindow();
    const int focus = window ? glfwGetWindowAttrib(window, GLFW_FOCUSED) : 0;
    char line[200];
    snprintf(line, sizeof(line), "%d,%.3f,%.3f,%.4f,%.3f,%.3f,%.3f,%.5f,%.5f,%.5f,%.3f,%d,%d\n", slot, m_dt * 1000.0f, m_rawDt * 1000.0f, m_time, p.x, p.y, p.z, d.x, d.y, d.z, m_curtain, fg, focus);
    m_recordLog += line;
    return m_recordImages ? slot : -1;
}

bool ManchesterApp::TakeRecording(std::string& folder, std::string& log)
{
    if (m_recordTotal == 0 || m_recordLeft > 0) return false;
    std::error_code ec;
    std::filesystem::create_directories(CapturesFolder(), ec);
    folder = CapturesFolder().string();
    log = "frame,dt_ms,raw_ms,time,x,y,z,dx,dy,dz,curtain,fg,focus\n" + m_recordLog;
    m_recordTotal = 0;
    m_recordLog.clear();
    return true;
}

bool ManchesterApp::TakeScreenshotRequest(std::string& path)
{
    if (!m_screenshotRequested) return false;
    m_screenshotRequested = false;
    path = m_lastScreenshot;
    return true;
}

void ManchesterApp::ScreenshotDone(const std::string& path, bool ok)
{
    ShowToast(ok ? (L("截图已保存  ·  captures\\", "Screenshot saved  ·  captures\\") + std::filesystem::path(path).filename().string())
                 : std::string(L("截图保存失败", "Could not save the screenshot")));
}

void ManchesterApp::OpenCapturesFolder() const
{
#ifdef _WIN32
    std::error_code ec;
    std::filesystem::create_directories(CapturesFolder(), ec);
    ShellExecuteW(nullptr, L"open", CapturesFolder().wstring().c_str(), nullptr, nullptr, SW_SHOWNORMAL);
#endif
}

void ManchesterApp::ToggleTour()
{
    if (m_touring) { StopCameraAutomation(); ShowToast(L("漫游已停止", "Tour stopped")); return; }
    if (m_photoMode) TogglePhotoMode();
    const int next = (m_activeView >= 0) ? (m_activeView + 1) % (int)m_views.size() : 0;
    FlyTo(next, 1.35f);
    m_touring = true;
    ShowToast(L("自动漫游  ·  按任意移动键或拖动鼠标即可接管镜头", "Auto tour  ·  press a movement key or drag the mouse to take over"));
}

void ManchesterApp::RequestExit()
{
    m_settings.Save();
    m_exitRequested = true;     // the window is closed from Animate
}

void ManchesterApp::ShowToast(const std::string& text)
{
    m_toasts.push_back({ text, 0.0f });
    if (m_toasts.size() > 3) m_toasts.erase(m_toasts.begin());
}

/* ---------------- camera ---------------- */

ManchesterApp::Pose ManchesterApp::CurrentPose() const
{
    return { m_app.m_camera.GetPosition(), m_app.m_camera.GetDir(), m_app.m_cameraVerticalFOV };
}

ManchesterApp::Pose ManchesterApp::ViewPose(int view) const
{
    const View& v = m_views[std::clamp(view, 0, (int)m_views.size() - 1)];
    return { v.Eye, normalize(v.At - v.Eye), v.Fov };
}

void ManchesterApp::SetCameraPose(const Pose& pose)
{
    float3 dir = normalize(pose.Dir);
    dir.y = std::clamp(dir.y, -0.995f, 0.995f);
    dir = normalize(dir);
    m_app.m_camera.LookTo(pose.Pos, dir, float3(0, 1, 0));
    m_app.m_cameraVerticalFOV = pose.Fov;
}

float ManchesterApp::CameraAltitude() const { return std::max(m_app.m_camera.GetPosition().y, 1.0f); }

void ManchesterApp::FlyToPose(const Pose& pose, float speedScale)
{
    m_flyFrom = CurrentPose();
    m_flyTo = pose;
    const float dist = length(m_flyTo.Pos - m_flyFrom.Pos);
    const float angle = acosf(std::clamp(dot(normalize(m_flyFrom.Dir), normalize(m_flyTo.Dir)), -1.0f, 1.0f));
    m_flyDuration = std::clamp(1.1f + dist / 520.0f + angle * 0.45f, 1.0f, 4.2f) * speedScale;
    m_flyArc = dist > 60.0f ? std::clamp(dist * 0.16f, 0.0f, 200.0f) : 0.0f;
    m_flyT = 0.0f;
    m_flying = true;
    m_dollyVelocity = 0.0f;
    m_activeView = -1;
}

void ManchesterApp::FlyTo(int view, float speedScale)
{
    if (m_views.empty()) return;
    FlyToPose(ViewPose(view), speedScale);
    m_flyTarget = view;
}

void ManchesterApp::StopCameraAutomation()
{
    m_flying = false;
    m_touring = false;
    m_flyTarget = -1;
}

bool ManchesterApp::Project(const float3& world, ImVec2& screen) const
{
    if (m_app.m_view == nullptr) return false;
    const float4 clip = float4(world, 1.0f) * m_app.m_view->GetViewProjectionMatrix(false);
    if (clip.w <= 0.01f) return false;
    const ImVec2 ds = ImGui::GetIO().DisplaySize;
    screen = ImVec2((clip.x / clip.w * 0.5f + 0.5f) * ds.x, (0.5f - clip.y / clip.w * 0.5f) * ds.y);
    return screen.x > -200 && screen.y > -200 && screen.x < ds.x + 200 && screen.y < ds.y + 200;
}

float ManchesterApp::SmoothFrameTime(float dt)
{
    // With frame generation the driver shows frames at an even pace, but the CPU loop's own intervals wobble around it
    // (a repeating 16 / 21 / 27 ms pattern at 4x); a camera stepped by those raw intervals moves unevenly from one shown frame
    // to the next and judders on every fast move. A running average (time constant about ten frames) evens the steps out
    // without drifting from real time, and a stall (loading, paging) pauses the motion instead of making it jump.
    if (m_recordDt < 0)
    {
        const char* fixed = std::getenv("MRTX_RECORD_DT");
        m_recordDt = fixed ? std::max(0.0f, float(std::atof(fixed)) * 0.001f) : 0.0f;
    }
    m_rawDt = dt;
    if (m_recordLeft > 0 && m_recordDt > 0) return m_recordDt;    // developer recordings: the same step every frame
    dt = std::clamp(dt, 0.0f, 0.15f);
    m_smoothDt = m_smoothDt > 0.0f ? m_smoothDt + (dt - m_smoothDt) * 0.1f : dt;
    return m_smoothDt;
}

void ManchesterApp::Animate(float dt)
{
    m_time += dt;
    m_dt = dt;
    for (Toast& t : m_toasts) t.Age += dt;
    m_toasts.erase(std::remove_if(m_toasts.begin(), m_toasts.end(), [](const Toast& t) { return t.Age > 3.2f; }), m_toasts.end());

    GLFWwindow* window = m_app.GetGLFWWindow();
    // the window is created hidden and shown once the start-up curtain has been presented a few times, so no blank or
    // half-initialised frame ever appears around the launcher's splash
    if (!m_windowShown && window && m_frame >= 4)
    {
        glfwShowWindow(window);
        m_windowShown = true;
    }
    if (m_exitRequested && window)
    {
        glfwSetWindowShouldClose(window, GLFW_TRUE);
        return;
    }
    if (m_fullscreenPending)
    {
        m_fullscreenPending = false;
        GLFWmonitor* monitor = glfwGetPrimaryMonitor();
        const GLFWvidmode* mode = monitor ? glfwGetVideoMode(monitor) : nullptr;
        if (window && mode)
        {
            int mx = 0, my = 0;
            glfwGetMonitorPos(monitor, &mx, &my);
            if (m_settings.Fullscreen)
            {
                glfwSetWindowAttrib(window, GLFW_DECORATED, GLFW_FALSE);
                glfwSetWindowMonitor(window, nullptr, mx, my, mode->width, mode->height, GLFW_DONT_CARE);
            }
            else
            {
                const int w = int(mode->width * 0.8f), h = int(mode->height * 0.8f);
                glfwSetWindowAttrib(window, GLFW_DECORATED, GLFW_TRUE);
                glfwSetWindowMonitor(window, nullptr, mx + (mode->width - w) / 2, my + (mode->height - h) / 2, w, h, GLFW_DONT_CARE);
            }
        }
    }

    if (!m_sceneReady) return;

    // the UI is created after the first scene load and applies its own default performance preset; ours goes on top
    if (m_qualityPending)
    {
        m_qualityPending = false;
        ApplyQuality(m_settings.Quality, false);
    }

    // the time-lapse, then the materials (window and street lights, wet surfaces) and the clock towers it drives
    UpdateLighting(dt);
    if (ApplyMaterials()) m_materialsApplied = true;
    UpdateClocks();

    // start-up: everything is under an opaque curtain until the image has settled - loading done, materials in, the
    // exposure adapted over a second of frames. Then the launcher drops its splash, and once frame generation is running
    // (it starts when the window gets the focus) the curtain lifts and the camera glides onto the overview
    if (!m_readySignalled && !m_app.HasAsyncLoadingInProgress() && m_materialsApplied && ++m_readyFrames > 50)
    {
#ifdef _WIN32
        if (HANDLE ready = OpenEventW(EVENT_MODIFY_STATE, FALSE, L"Local\\ManchesterRTX.Ready"))
        {
            SetEvent(ready);
            CloseHandle(ready);
        }
#endif
        m_readySignalled = true;
        m_readyTime = 0.0f;
    }
    if (m_readySignalled) m_readyTime += dt;
    if (m_readySignalled && m_curtain > 0.0f)
    {
        bool frameGenSettled = true;
#if DONUT_WITH_STREAMLINE
        frameGenSettled = m_ui.DLSSFGMode != SI::DLSSGMode::eOn || m_ui.ActualDLSSFGMode() == SI::DLSSGMode::eOn || m_readyTime > 1.6f;
#endif
        if (m_readyTime > 0.45f && frameGenSettled)
            m_curtain = std::max(0.0f, m_curtain - std::min(dt, 0.05f) / 0.9f);
    }
    if (m_introPending && m_curtain < 1.0f)
    {
        m_introPending = false;
        FlyToPose(ViewPose(0), 1.9f);
        m_flyTarget = 0;
        if (const char* rec = std::getenv("MRTX_RECORD_STARTUP"); rec && m_recordLeft <= 0)
        {
            const int n = std::atoi(rec);
            m_recordImages = n > 0;     // negative: frame times only
            m_recordTotal = m_recordLeft = m_recordImages ? std::min(n, 64) : std::clamp(-n, 1, 2000);
            m_recordLog.clear();
        }
    }

    const float alt = CameraAltitude();
    m_ui.CameraMoveSpeed = std::clamp(alt * 1.3f, 7.0f, 520.0f);   // keyboard speed follows height above the streets

    Pose pose = CurrentPose();
    bool changed = false, arrived = false;
    const float2 md = m_mouse - m_mousePrev;
    m_mousePrev = m_mouse;

    if (m_flying)
    {
        m_flyT += dt / m_flyDuration;
        const float t = std::min(m_flyT, 1.0f), e = Ease(t);
        pose.Pos = lerp(m_flyFrom.Pos, m_flyTo.Pos, e) + float3(0.0f, m_flyArc * sinf(IM_PI * e), 0.0f);
        pose.Dir = SlerpDir(normalize(m_flyFrom.Dir), normalize(m_flyTo.Dir), e);
        pose.Fov = m_flyFrom.Fov + (m_flyTo.Fov - m_flyFrom.Fov) * e;
        changed = true;
        if (t >= 1.0f)
        {
            m_flying = false;
            m_activeView = m_flyTarget;
            m_tourHold = 0.0f;
            arrived = true;
        }
    }
    else if (m_touring && m_activeView >= 0)
    {
        // drift slowly around the viewpoint's subject, then move on
        m_tourHold += dt;
        const float3 pivot = m_views[m_activeView].At;
        const float a = radians(2.4f) * dt;
        pose.Pos = pivot + RotateY(pose.Pos - pivot, a);
        pose.Dir = RotateY(pose.Dir, a);
        changed = true;
        if (m_tourHold > 9.0f)
        {
            const int next = (m_activeView + 1) % (int)m_views.size();
            SetCameraPose(pose);
            FlyTo(next, 1.35f);
            m_touring = true;
            return;
        }
    }
    else
    {
        if (m_keyUp || m_keyDown)
        {
            const float v = m_ui.CameraMoveSpeed * (m_keyShift ? 3.0f : 1.0f) * dt;
            pose.Pos.y += (m_keyUp ? v : 0.0f) - (m_keyDown ? v : 0.0f);
            changed = true;
        }
        if (m_panning && (md.x != 0 || md.y != 0))
        {
            const float k = std::max(alt, 5.0f) * 0.0011f;
            const float3 right = normalize(cross(pose.Dir, float3(0, 1, 0)));
            float3 fwd = float3(pose.Dir.x, 0.0f, pose.Dir.z);
            fwd = length(fwd) > 1e-3f ? normalize(fwd) : float3(0, 0, -1);
            pose.Pos += (-right * md.x + fwd * md.y) * k;
            changed = true;
        }
        if (m_orbiting && (md.x != 0 || md.y != 0))
        {
            const float yaw = -md.x * 0.0045f, pitch = -md.y * 0.0045f;
            float3 off = RotateY(pose.Pos - m_orbitPivot, yaw);
            float3 dir = RotateY(pose.Dir, yaw);
            const float3 right = normalize(cross(dir, float3(0, 1, 0)));
            const float3 dir2 = RotateAxis(dir, right, pitch);
            if (dir2.y > -0.97f && dir2.y < 0.3f)
            {
                off = RotateAxis(off, right, pitch);
                dir = dir2;
            }
            pose.Pos = m_orbitPivot + off;
            pose.Dir = dir;
            changed = true;
        }
        if (length(m_dollyVelocity) > 0.05f)
        {
            pose.Pos += m_dollyVelocity * dt;
            m_dollyVelocity *= expf(-5.0f * dt);
            changed = true;
        }
        else
            m_dollyVelocity = 0.0f;
    }

    if (changed)
    {
        pose.Pos.y = std::max(pose.Pos.y, 1.0f);
        SetCameraPose(pose);
    }

    // a resting viewpoint stays highlighted until the camera is moved away from it
    if (m_flying || m_touring || arrived)
    {
        m_restPos = m_app.m_camera.GetPosition();
        m_restDir = m_app.m_camera.GetDir();
    }
    else if (m_activeView >= 0)
    {
        if (length(m_app.m_camera.GetPosition() - m_restPos) > 0.5f || dot(m_app.m_camera.GetDir(), m_restDir) < 0.999f)
            m_activeView = -1;
    }
}

/* ---------------- input ---------------- */

bool ManchesterApp::KeyboardUpdate(int key, int scancode, int action, int mods)
{
    const bool press = action == GLFW_PRESS;
    if (m_showExit)
    {
        // the exit card is modal: Enter confirms, Esc cancels, everything else waits
        if (press && (key == GLFW_KEY_ENTER || key == GLFW_KEY_KP_ENTER)) RequestExit();
        if (press && key == GLFW_KEY_ESCAPE) m_showExit = false;
        return true;
    }
    if (key == GLFW_KEY_LEFT_SHIFT || key == GLFW_KEY_RIGHT_SHIFT) { m_keyShift = action != GLFW_RELEASE; return false; }
    if (key == GLFW_KEY_Q || key == GLFW_KEY_E)
    {
        // vertical moves follow world up rather than the camera's tilted up vector
        const bool down = action != GLFW_RELEASE;
        (key == GLFW_KEY_Q ? m_keyDown : m_keyUp) = down;
        if (down) StopCameraAutomation();
        return true;
    }
    if (key == GLFW_KEY_Z || key == GLFW_KEY_C || key == GLFW_KEY_SPACE)
        return true;    // no camera roll, no animation toggle in app mode
    if (key == GLFW_KEY_W || key == GLFW_KEY_A || key == GLFW_KEY_S || key == GLFW_KEY_D
        || key == GLFW_KEY_LEFT || key == GLFW_KEY_RIGHT || key == GLFW_KEY_UP || key == GLFW_KEY_DOWN)
    {
        if (press) StopCameraAutomation();
        return false;
    }
    if (!press) return false;

    switch (key)
    {
    case GLFW_KEY_H:
        m_immersive = !m_immersive;
        if (m_immersive) ShowToast(L("界面已隐藏  ·  按 H 恢复", "Interface hidden  ·  press H to bring it back"));
        return true;
    case GLFW_KEY_F1:   m_showHelp = !m_showHelp; return true;
    case GLFW_KEY_F11:  SetFullscreen(!m_settings.Fullscreen); return true;
    case GLFW_KEY_F12:  RequestScreenshot(); return true;
    case GLFW_KEY_P:    TogglePhotoMode(); return true;
    case GLFW_KEY_T:    ToggleTour(); return true;
    case GLFW_KEY_R:    SetRain(!m_settings.Rain, true); return true;
    case GLFW_KEY_F7:   // developer: atmosphere debug views
        m_atmosphereDebug = (m_atmosphereDebug + 1) % 6;
        ShowToast("Atmosphere debug view " + std::to_string(m_atmosphereDebug));
        return true;
    case GLFW_KEY_F8:   m_rawScreenshotRequested = true; return true;                      // developer: captures\raw-hdr10.png
    case GLFW_KEY_F9:   // developer: captures\rec-NN.bmp + rec.csv; F10 only the frame times, over 400 frames
    case GLFW_KEY_F10:
        if (m_recordLeft <= 0) { m_recordImages = key == GLFW_KEY_F9; m_recordTotal = m_recordLeft = m_recordImages ? 48 : 400; m_recordLog.clear(); }
        return true;
    case GLFW_KEY_ESCAPE:
        // close whatever is open first; with nothing open, Esc asks whether to quit
        if (m_showHelp) m_showHelp = false;
        else if (m_showSettings) m_showSettings = false;
        else if (m_photoMode) TogglePhotoMode();
        else if (m_immersive) m_immersive = false;
        else m_showExit = true;
        return true;
    default: break;
    }
    if (key >= GLFW_KEY_1 && key <= GLFW_KEY_9)
    {
        const int i = key - GLFW_KEY_1;
        if (mods & GLFW_MOD_SHIFT) { if (i < (int)m_weathers.size()) ApplyWeather(i, true); }
        else if (i < (int)m_views.size()) { StopCameraAutomation(); FlyTo(i); }
        return true;
    }
    return false;
}

bool ManchesterApp::MouseButtonUpdate(int button, int action, int mods)
{
    const bool press = action == GLFW_PRESS;
    if (m_showExit) return true;    // modal
    if (button == GLFW_MOUSE_BUTTON_LEFT)
    {
        if (press && m_hoverPin >= 0 && m_hoverPin < (int)m_towers.size())
        {
            StopCameraAutomation();
            FlyTo(m_towers[m_hoverPin].View);
            return true;
        }
        if (press && (mods & GLFW_MOD_ALT))
        {
            StopCameraAutomation();
            const Pose p = CurrentPose();
            m_orbitPivot = p.Dir.y < -0.05f ? p.Pos + p.Dir * std::min(-p.Pos.y / p.Dir.y, 2000.0f) : p.Pos + p.Dir * 300.0f;
            m_orbiting = true;
            m_mousePrev = m_mouse;
            return true;
        }
        if (!press && m_orbiting) { m_orbiting = false; return false; }
        if (press) StopCameraAutomation();
        return false;
    }
    if (button == GLFW_MOUSE_BUTTON_RIGHT)
    {
        // right drag pans; also keeps RTXPT's right-click pixel picking (which stalls the GPU) out of app mode
        if (press) StopCameraAutomation();
        m_panning = press;
        m_mousePrev = m_mouse;
        return true;
    }
    if (button == GLFW_MOUSE_BUTTON_MIDDLE)
    {
        if (press)
        {
            StopCameraAutomation();
            const Pose p = CurrentPose();
            m_orbitPivot = p.Dir.y < -0.05f ? p.Pos + p.Dir * std::min(-p.Pos.y / p.Dir.y, 2000.0f) : p.Pos + p.Dir * 300.0f;
        }
        m_orbiting = press;
        m_mousePrev = m_mouse;
        return true;
    }
    return false;
}

void ManchesterApp::MousePosUpdate(double xpos, double ypos)
{
    m_mouse = float2(float(xpos), float(ypos));
}

bool ManchesterApp::MouseScrollUpdate(double xoffset, double yoffset)
{
    if (m_showExit) return true;
    StopCameraAutomation();
    const float step = std::clamp(CameraAltitude() * 0.35f, 3.0f, 160.0f);
    m_dollyVelocity += normalize(CurrentPose().Dir) * float(yoffset) * step * 4.0f;
    return true;
}

/* ---------------- liquid glass ---------------- */

float4 ManchesterApp::SpringTo(const char* id, const float4& target, float stiffness, float damping)
{
    Spring& sp = m_springs[id];
    if (!sp.Init || sp.LastFrame < m_frame - 2)    // (re)appearing: start where it should be
    {
        sp.Pos = target;
        sp.Vel = 0.0f;
        sp.Init = true;
    }
    sp.LastFrame = m_frame;
    // slightly underdamped spring, two semi-implicit substeps: the lens overshoots a touch and settles, like a droplet
    const float dt = std::min(m_dt, 1.0f / 30.0f), c = 2.0f * damping * sqrtf(stiffness);
    for (int i = 0; i < 2; i++)
    {
        const float h = dt * 0.5f;
        sp.Vel += (stiffness * (target - sp.Pos) - c * sp.Vel) * h;
        sp.Pos += sp.Vel * h;
    }
    return sp.Pos;
}

float ManchesterApp::SpringValue(const char* id, float target, float stiffness, float damping)
{
    Spring& sp = m_springs[id];
    if (!sp.Init) { sp.Pos = float4(target); sp.Init = true; }
    sp.LastFrame = m_frame;
    const float dt = std::min(m_dt, 1.0f / 30.0f), c = 2.0f * damping * sqrtf(stiffness);
    for (int i = 0; i < 2; i++)
    {
        const float h = dt * 0.5f;
        sp.Vel.x += (stiffness * (target - sp.Pos.x) - c * sp.Vel.x) * h;
        sp.Pos.x += sp.Vel.x * h;
    }
    if (fabsf(sp.Pos.x - target) < 0.002f && fabsf(sp.Vel.x) < 0.01f) { sp.Pos.x = target; sp.Vel.x = 0; }
    return sp.Pos.x;
}

void ManchesterApp::AddGlass(ImVec2 p0, ImVec2 p1, float radius, int layer, float opacity)
{
    m_glassBuild.Shapes.push_back(PanelGlass(p0, p1, radius, layer, opacity));
}

void ManchesterApp::AddLens(const char* id, ImVec2 p0, ImVec2 p1, float radius, int layer, bool accent)
{
    // the selection is a lens of clearer glass that slides between items on a spring, stretching as it moves
    const float4 r = SpringTo(id, float4(p0.x, p0.y, p1.x, p1.y));
    const Spring& sp = m_springs[id];
    const float speed = (fabsf(sp.Vel.x) + fabsf(sp.Vel.z)) * 0.5f + (fabsf(sp.Vel.y) + fabsf(sp.Vel.w)) * 0.5f;
    const float stretch = std::clamp(speed * 0.00022f, 0.0f, 0.22f);
    const float2 c = float2(r.x + r.z, r.y + r.w) * 0.5f, h = float2(r.z - r.x, r.w - r.y) * 0.5f;
    const bool horizontal = fabsf(sp.Vel.x) >= fabsf(sp.Vel.y);
    const float2 hs = horizontal ? float2(h.x * (1 + stretch), h.y * (1 - stretch * 0.5f)) : float2(h.x * (1 - stretch * 0.5f), h.y * (1 + stretch));
    GlassShapeDesc g;
    g.Rect = float4(c.x - hs.x, c.y - hs.y, c.x + hs.x, c.y + hs.y);
    g.Radius = radius;
    g.Layer = layer;
    // the selection: a lens of brighter glass in the university's purple (gold for toggles that are on) that magnifies and
    // bends what is under it, with bright rims
    g.Tint = accent ? LinF(255, 204, 51) : LinF(116, 58, 176);
    g.TintAmount = accent ? 0.7f : 0.55f;
    g.Frost = 0.7f;
    g.Shadow = 0.0f;
    g.Highlight = 1.35f;
    g.Darkness = 0.7f;
    g.Lens = 1.5f;
    m_glassBuild.Shapes.push_back(g);
}

/* ---------------- UI ---------------- */

bool ManchesterApp::ToggleSwitch(const char* id, bool* v, float s)
{
    // iOS switch: a 51 x 31 pt track that fills with green when on, and a white knob that slides over on a spring
    ImGui::PushID(id);
    const ImVec2 size(51 * s, 31 * s), p = ImGui::GetCursorScreenPos();
    const bool pressed = ImGui::InvisibleButton("##switch", size);
    if (pressed) *v = !*v;
    const float t = SpringValue((std::string("switch.") + id).c_str(), *v ? 1.0f : 0.0f, 340.0f, 0.78f);
    ImDrawList* dl = ImGui::GetWindowDrawList();
    dl->AddRectFilled(p, p + size, ImGui::IsItemHovered() ? Lin(214, 192, 255, 46) : Lin(214, 192, 255, 34), size.y * 0.5f);
    if (t > 0.01f) dl->AddRectFilled(p, p + size, Alpha(kSwitchOn, std::clamp(t, 0.0f, 1.0f)), size.y * 0.5f);
    const float r = 13.5f * s, x = p.x + 2 * s + r + (size.x - 4 * s - 2 * r) * std::clamp(t, -0.08f, 1.08f), y = p.y + size.y * 0.5f;
    dl->AddCircleFilled(ImVec2(x, y + 1.5f * s), r + 1.0f * s, IM_COL32(0, 0, 0, 46), 32);
    dl->AddCircleFilled(ImVec2(x, y), r, IM_COL32(255, 255, 255, 255), 32);
    ImGui::PopID();
    return pressed;
}

bool ManchesterApp::GlassSlider(const char* id, float* v, float lo, float hi, float width, float s)
{
    // a thin track filled with the accent up to a white thumb; while it is dragged the thumb turns into a glass lens
    ImGui::PushID(id);
    const float h = 30 * s, track = 6 * s, knob = 13 * s;
    const ImVec2 p = ImGui::GetCursorScreenPos();
    ImGui::InvisibleButton("##slider", ImVec2(width, h));
    const bool active = ImGui::IsItemActive();
    bool changed = false;
    const float x0 = p.x + knob, x1 = p.x + width - knob;
    if (active)
    {
        const float t = std::clamp((ImGui::GetIO().MousePos.x - x0) / std::max(x1 - x0, 1.0f), 0.0f, 1.0f);
        const float nv = lo + (hi - lo) * t;
        if (nv != *v) { *v = nv; changed = true; }
    }
    const float t = std::clamp((*v - lo) / (hi - lo), 0.0f, 1.0f), cx = x0 + (x1 - x0) * t, cy = p.y + h * 0.5f;
    ImDrawList* dl = ImGui::GetWindowDrawList();
    dl->AddRectFilled(ImVec2(x0, cy - track * 0.5f), ImVec2(x1, cy + track * 0.5f), Lin(214, 192, 255, 40), track);
    dl->AddRectFilled(ImVec2(x0, cy - track * 0.5f), ImVec2(std::max(cx, x0 + track), cy + track * 0.5f), kAccent, track);
    if (active)
        AddLens((std::string("slider.") + id).c_str(), ImVec2(cx - knob * 1.45f, cy - knob * 1.05f), ImVec2(cx + knob * 1.45f, cy + knob * 1.05f), knob * 1.05f, 1);
    else
    {
        dl->AddCircleFilled(ImVec2(cx, cy + 1.5f * s), knob + 1.0f * s, IM_COL32(0, 0, 0, 50), 32);
        dl->AddCircleFilled(ImVec2(cx, cy), knob, IM_COL32(255, 255, 255, 255), 32);
    }
    ImGui::PopID();
    return changed;
}

float ManchesterApp::Hover(const std::string& id, bool on, float rate)
{
    // highlights ease in and out (about 70 ms) instead of snapping on and off under the pointer
    float& v = m_anims[id];
    v += ((on ? 1.0f : 0.0f) - v) * (1.0f - std::exp(-std::max(m_dt, 0.0f) * rate));
    if (std::fabs(v - (on ? 1.0f : 0.0f)) < 0.002f) v = on ? 1.0f : 0.0f;
    return v;
}

void ManchesterApp::Tip(const std::string& text, bool above)
{
    // a widget asks for its tooltip while hovered; it is shown under (or above) the widget after a short dwell
    m_tip = text;
    m_tipAbove = above;
    const ImVec2 a = ImGui::GetItemRectMin(), b = ImGui::GetItemRectMax();
    m_tipAnchor = ImVec2((a.x + b.x) * 0.5f, above ? a.y : b.y);
}

void ManchesterApp::DrawTip(float s)
{
    // the tooltip: a small capsule of deep university purple with one line of text, fading in after 0.45 s of dwell
    if (!m_tip.empty() && m_tip == m_tipShown) m_tipTime += m_dt;
    else if (!m_tip.empty()) { m_tipShown = m_tip; m_tipTime = 0.0f; }
    const bool visible = !m_tip.empty() && m_tipTime > 0.45f;
    m_tipAlpha = std::clamp(m_tipAlpha + (visible ? 1.0f : -1.0f) * m_dt / 0.12f, 0.0f, 1.0f);
    if (m_tip.empty() && m_tipAlpha <= 0.0f) m_tipShown.clear();
    m_tip.clear();
    if (m_tipAlpha <= 0.0f || m_tipShown.empty()) return;
    ImDrawList* dl = ImGui::GetForegroundDrawList();
    // a trailing shortcut ("…  H", "…  ·  Shift+2") is set apart in the secondary colour
    std::string label = m_tipShown, key;
    if (const size_t k = label.rfind("  "); k != std::string::npos && label.size() - k - 2 <= 8)
    {
        key = label.substr(k + 2);
        label = label.substr(0, k);
        if (label.size() >= 4 && label.compare(label.size() - 4, 4, "  ·") == 0) label.resize(label.size() - 4);
        else if (label.size() >= 3 && label.compare(label.size() - 3, 3, " ·") == 0) label.resize(label.size() - 3);
    }
    const ImVec2 ds = ImGui::GetIO().DisplaySize, lts = TextSize(m_fonts.Small, label.c_str());
    const float keyW = key.empty() ? 0.0f : TextSize(m_fonts.Small, key.c_str()).x + 14 * s;
    const ImVec2 ts(lts.x + keyW, lts.y), size(ts.x + 26 * s, ts.y + 14 * s);
    const float gap = 10 * s, rise = (1.0f - m_tipAlpha) * 4 * s;
    ImVec2 p0(m_tipAnchor.x - size.x * 0.5f, m_tipAbove ? m_tipAnchor.y - gap - size.y + rise : m_tipAnchor.y + gap - rise);
    p0.x = std::clamp(p0.x, 12 * s, ds.x - size.x - 12 * s);
    p0.y = std::clamp(p0.y, 12 * s, ds.y - size.y - 12 * s);
    const int a = int(255 * m_tipAlpha);
    dl->AddRectFilled(p0 + ImVec2(0, 2 * s), p0 + size + ImVec2(0, 2 * s), IM_COL32(0, 0, 0, a / 6), size.y * 0.5f);
    dl->AddRectFilled(p0, p0 + size, Lin(48, 16, 76, int(242 * m_tipAlpha)), size.y * 0.5f);
    dl->AddRect(p0, p0 + size, IM_COL32(255, 255, 255, int(22 * m_tipAlpha)), size.y * 0.5f, 0, 1.0f);
    Text(dl, m_fonts.Small, p0 + ImVec2(13 * s, 7 * s), Alpha(kText, m_tipAlpha), label.c_str());
    if (!key.empty()) Text(dl, m_fonts.Small, p0 + ImVec2(13 * s + lts.x + 14 * s, 7 * s), Alpha(kMuted, m_tipAlpha), key.c_str());
}

void ManchesterApp::BuildUI(const ManchesterFonts& fonts, float dpiScale)
{
    ImFont* fallback = ImGui::GetFont();
    m_fonts = fonts;
    for (ImFont** f : { &m_fonts.Body, &m_fonts.Small, &m_fonts.Bold, &m_fonts.Title, &m_fonts.Brand, &m_fonts.Digits, &m_fonts.Icons, &m_fonts.Clock, &m_fonts.SmallBold })
        if (*f == nullptr) *f = fallback;
    m_dpi = dpiScale;
    m_frame++;
    const float s = dpiScale;
    g_textShadow = std::max(1.0f, 1.0f * s);

    m_glassBuild.Shapes.clear();
    g_glassShapes = &m_glassBuild.Shapes;

    ImGui::PushStyleColor(ImGuiCol_PopupBg, LinV(0.16f, 0.07f, 0.24f, 0.97f));   // tooltips: deep university purple
    ImGui::PushStyleColor(ImGuiCol_Border, kEdge);
    ImGui::PushStyleColor(ImGuiCol_Text, ImGui::ColorConvertU32ToFloat4(kText));
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(1, 1, 1, 0.025f));
    ImGui::PushStyleColor(ImGuiCol_FrameBgHovered, ImVec4(1, 1, 1, 0.04f));
    ImGui::PushStyleColor(ImGuiCol_FrameBgActive, ImVec4(1, 1, 1, 0.055f));
    ImGui::PushStyleColor(ImGuiCol_SliderGrab, ImGui::ColorConvertU32ToFloat4(kText));
    ImGui::PushStyleColor(ImGuiCol_SliderGrabActive, ImGui::ColorConvertU32ToFloat4(kAccent));
    ImGui::PushStyleVar(ImGuiStyleVar_PopupRounding, 14.0f * s);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 12.0f * s);
    ImGui::PushStyleVar(ImGuiStyleVar_GrabRounding, 12.0f * s);
    ImGui::PushStyleVar(ImGuiStyleVar_GrabMinSize, 22.0f * s);
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(8.0f * s, 6.0f * s));
    ImGui::PushStyleVar(ImGuiStyleVar_PopupBorderSize, 0.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(10.0f * s, 8.0f * s));
    PushFont(m_fonts.Body);

    m_hoverPin = -1;
    if (!m_immersive && m_sceneReady)
    {
        DrawRain(s);
        DrawPins(s);
        DrawBrand(s);
        DrawToolbar(s);
        DrawViews(s);
        DrawWeatherDock(s);
        DrawLegend(s);      // the towers list stays; the pins on the map are optional (off by default)
        DrawSettings(s);
        if (m_photoMode) DrawPhotoBar(s);
        DrawHints(s);
        DrawHelp(s);
        DrawExitDialog(s);
    }
    else if (m_sceneReady)
    {
        DrawRain(s);
        DrawExitDialog(s);
    }
    DrawToasts(s);
    DrawTip(s);
    DrawLoading(s);

    ImGui::PopFont();
    ImGui::PopStyleVar(7);
    ImGui::PopStyleColor(8);

    // the glass under this UI, drawn before the ImGui content of the same frame
    g_glassShapes = nullptr;
    m_glassBuild.Dpi = s;
    m_glassBuild.Clarity = m_settings.Clarity;
    m_glassBuild.Time = m_time;
    const float modal = std::max(m_springs.count("helpAnim") ? m_springs["helpAnim"].Pos.x : 0.0f, m_springs.count("exitAnim") ? m_springs["exitAnim"].Pos.x : 0.0f);
    m_glassBuild.Dim = std::clamp(modal, 0.0f, 1.0f) * 0.45f;
    // the highlight follows the pointer a little, so the glass rims catch the light as the mouse moves (iOS tilt highlight)
    const ImVec2 ds = ImGui::GetIO().DisplaySize;
    const float2 m = float2(m_mouse.x / std::max(ds.x, 1.0f) - 0.5f, m_mouse.y / std::max(ds.y, 1.0f) - 0.5f);
    m_glassBuild.LightDir = normalize(float2(-0.45f - m.x * 0.6f, -0.89f - m.y * 0.3f));
    std::swap(m_glass, m_glassBuild);
}

void ManchesterApp::DrawBrand(float s)
{
    // the wordmark in a slim glass capsule; the live status in a smaller one beneath it
    float bottom = 0.0f;
    {
        PanelScope panel("##mrtx_brand", ImVec2(24 * s, 22 * s), ImVec2(0, 0), s, ImVec2(0, 0), ImVec2(20, 11), 1.0f, 999.0f);
        ImDrawList* dl = ImGui::GetWindowDrawList();
        const ImVec2 p = ImGui::GetCursorScreenPos();
        const char* word = "MANCHESTER";
        float x = p.x;
        const float track = 3.2f * s;
        for (const char* c = word; *c; ++c)
        {
            const char glyph[2] = { *c, 0 };
            Text(dl, m_fonts.Brand, ImVec2(x, p.y), kText, glyph);
            x += TextSize(m_fonts.Brand, glyph).x + track;
        }
        const float brandH = TextSize(m_fonts.Brand, "M").y;
        const ImVec2 bts = TextSize(m_fonts.Bold, "RTX");
        const ImVec2 b0(x + 6 * s, p.y + (brandH - bts.y - 6 * s) * 0.5f), b1(b0.x + bts.x + 12 * s, b0.y + bts.y + 6 * s);
        dl->AddRectFilled(b0, b1, kGreen, 7 * s);
        dl->AddText(m_fonts.Bold, m_fonts.Bold->LegacySize, ImFloor(ImVec2(b0.x + 6 * s, b0.y + 3 * s)), Lin(10, 16, 4), "RTX");
        ImGui::Dummy(ImVec2(b1.x - p.x, brandH));
        bottom = ImGui::GetWindowPos().y + ImGui::GetWindowSize().y;
    }
    if (!m_settings.ShowStats || bottom <= 0.0f) return;

    const double frameTime = m_app.GetDeviceManager()->GetAverageFrameTimeSeconds();
#if DONUT_WITH_STREAMLINE
    const bool fg = m_ui.ActualDLSSFGMode() == SI::DLSSGMode::eOn;
    const float fps = frameTime > 0 ? float((fg ? std::max(1u, m_ui.DLSSFGMultiplier) : 1u) / frameTime) : 0.0f;
#else
    const bool fg = false;
    const float fps = frameTime > 0 ? float(1.0 / frameTime) : 0.0f;
#endif
    std::vector<std::string> parts;
    char buf[128];
    snprintf(buf, sizeof(buf), "%.0f FPS", fps); parts.push_back(buf);
    if (!m_ui.RealtimeMode) parts.push_back(L("参考路径追踪", "Reference path tracing"));
    else
    {
#if DONUT_WITH_STREAMLINE
        snprintf(buf, sizeof(buf), m_ui.RealtimeAA == 3 ? L("DLSS 光线重建 F · %s", "DLSS Ray Reconstruction F · %s") : "DLSS %s", DlssModeName(m_ui.DLSSMode)); parts.push_back(buf);
        if (fg) { snprintf(buf, sizeof(buf), L("%u× 帧生成", "%u× Frame Gen"), std::max(2u, m_ui.DLSSFGMultiplier)); parts.push_back(buf); }
#endif
    }
    if (g_HdrOutput) parts.push_back("HDR10");
    PanelScope panel("##mrtx_status", ImVec2(24 * s, bottom + 8 * s), ImVec2(0, 0), s, ImVec2(0, 0), ImVec2(14, 7), 1.0f, 999.0f);
    ImDrawList* dl = ImGui::GetWindowDrawList();
    const ImVec2 p = ImGui::GetCursorScreenPos();
    const float lineH = TextSize(m_fonts.Small, "A").y;
    float x = p.x;
    dl->AddCircleFilled(ImVec2(x + 4 * s, p.y + lineH * 0.5f + 1 * s), 3.5f * s, fps >= 60 ? kSwitchOn : (fps >= 30 ? kAmber : kRed));
    x += 14 * s;
    for (size_t i = 0; i < parts.size(); i++)
    {
        if (i) { Text(dl, m_fonts.Small, ImVec2(x, p.y), kTertiary, "·"); x += TextSize(m_fonts.Small, "·").x + 8 * s; }
        Text(dl, m_fonts.Small, ImVec2(x, p.y), i == 0 ? kText : kMuted, parts[i].c_str());
        x += TextSize(m_fonts.Small, parts[i].c_str()).x + 8 * s;
    }
    ImGui::Dummy(ImVec2(x - p.x - 8 * s, lineH));
}

void ManchesterApp::DrawToolbar(float s)
{
    const ImVec2 ds = ImGui::GetIO().DisplaySize;
    PanelScope panel("##mrtx_toolbar", ImVec2(ds.x - 24 * s, 22 * s), ImVec2(1, 0), s, ImVec2(0, 0), ImVec2(6, 6), 1.0f, 999.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(2 * s, 2 * s));
    auto button = [&](const char* id, unsigned icon, const char* tip, bool active, ImU32 iconColor = 0) -> bool
    {
        const ImVec2 size(46 * s, 46 * s);
        ImGui::PushID(id);
        const ImVec2 p = ImGui::GetCursorScreenPos();
        const bool pressed = ImGui::InvisibleButton("##tb", size);
        const bool hovered = ImGui::IsItemHovered();
        ImDrawList* dl = ImGui::GetWindowDrawList();
        if (active) AddLens(id, p, p + size, size.y * 0.5f, 1);
        else if (const float hv = Hover(std::string("tb.") + id, hovered); hv > 0.0f) dl->AddCircleFilled(p + size * 0.5f, size.y * 0.5f, Alpha(kHover, hv * (ImGui::IsItemActive() ? 1.0f : 0.7f) * 1.4f), 40);
        const std::string g = U8(icon);
        const ImVec2 ts = TextSize(m_fonts.Icons, g.c_str());
        Text(dl, m_fonts.Icons, p + (size - ts) * 0.5f, iconColor ? iconColor : (active ? kAccent : kText), g.c_str());
        if (hovered) Tip(tip);
        ImGui::PopID();
        ImGui::SameLine();
        return pressed;
    };
    if (button("tour", m_touring ? IcPause : IcPlay, m_touring ? L("停止漫游  T", "Stop tour  T") : L("自动漫游  T", "Auto tour  T"), m_touring)) ToggleTour();
    if (button("photo", IcPhoto, L("照片模式：静止累积采样，参考级画质  P", "Photo mode: still-camera accumulation, reference quality  P"), m_photoMode)) TogglePhotoMode();
    if (button("shot", IcCamera, L("截图（不含界面）  F12", "Screenshot (without the interface)  F12"), false)) RequestScreenshot();
    if (button("immersive", IcEye, L("沉浸模式：隐藏全部界面  H", "Immersive: hide the interface  H"), false))
    {
        m_immersive = true;
        ShowToast(L("界面已隐藏  ·  按 H 恢复", "Interface hidden  ·  press H to bring it back"));
    }
    if (button("full", m_settings.Fullscreen ? IcWindow : IcFull, m_settings.Fullscreen ? L("切换到窗口  F11", "Windowed  F11") : L("全屏  F11", "Full screen  F11"), false))
        SetFullscreen(!m_settings.Fullscreen);
    if (button("settings", IcSettings, L("画质、显示与玻璃设置", "Quality, display, glass and language"), m_showSettings)) m_showSettings = !m_showSettings;
    if (button("help", IcHelp, L("操作说明  F1", "Controls  F1"), m_showHelp)) m_showHelp = !m_showHelp;
    {
        const ImVec2 p = ImGui::GetCursorScreenPos();
        ImGui::GetWindowDrawList()->AddLine(ImVec2(p.x + 3 * s, p.y + 13 * s), ImVec2(p.x + 3 * s, p.y + 33 * s), kSeparator, 1.0f * s);
        ImGui::Dummy(ImVec2(6 * s, 46 * s));
        ImGui::SameLine();
    }
    if (button("quit", IcPower, L("退出  Esc", "Quit  Esc"), m_showExit, kRed)) m_showExit = true;
    ImGui::NewLine();
    ImGui::PopStyleVar();
}

void ManchesterApp::DrawViews(float s)
{
    // a floating sidebar: one line per viewpoint; the selected one sits under a sliding glass lens and opens to show what
    // it looks at
    const ImVec2 ds = ImGui::GetIO().DisplaySize;
    const float pad = 10;
    float width = 292 * s;     // wide enough for the longest name and caption (English runs longer)
    for (const View& v : m_views)
        width = std::max(width, 2 * pad * s + 48 * s + std::max(TextSize(m_fonts.Bold, v.Name.c_str()).x, TextSize(m_fonts.Small, v.Desc.c_str()).x) + 18 * s);
    width = std::min(width, 400 * s);
    PanelScope panel("##mrtx_views", ImVec2(24 * s, ds.y * 0.5f - 20 * s), ImVec2(0, 0.5f), s, ImVec2(width, 0), ImVec2(pad, 10), 1.0f, 30.0f);
    ImDrawList* dl = ImGui::GetWindowDrawList();
    const float innerW = width - 2 * pad * s;
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0, 2 * s));

    {
        const ImVec2 p = ImGui::GetCursorScreenPos();
        Text(dl, m_fonts.Small, ImVec2(p.x + 12 * s, p.y + 4 * s), kMuted, L("视角", "Views"));
        ImGui::Dummy(ImVec2(innerW, TextSize(m_fonts.Small, "A").y + 10 * s));
    }
    const int selected = (m_flying && m_flyTarget >= 0) ? m_flyTarget : m_activeView;
    for (int i = 0; i < (int)m_views.size(); i++)
    {
        const View& v = m_views[i];
        const bool active = i == selected;
        const float h = SpringValue((std::string("viewH") + std::to_string(i)).c_str(), active ? 62.0f : 44.0f, 300.0f, 0.86f) * s;
        const float open = std::clamp((h / s - 44.0f) / 18.0f, 0.0f, 1.0f);
        ImGui::PushID(i);
        const ImVec2 p = ImGui::GetCursorScreenPos(), size(innerW, h);
        if (ImGui::InvisibleButton("##view", size)) { StopCameraAutomation(); FlyTo(i); }
        const bool hovered = ImGui::IsItemHovered();
        if (active) AddLens("viewsLens", p, p + size, 20 * s, 1);
        else if (const float hv = Hover("view." + std::to_string(i), hovered); hv > 0.0f) dl->AddRectFilled(p, p + size, Alpha(kHover, hv), 20 * s);
        const ImVec2 bc(p.x + 24 * s, p.y + 22 * s + (h - 44 * s) * 0.5f);
        if (active) dl->AddCircleFilled(bc, 13 * s, kAccent, 32);
        else dl->AddCircle(bc, 12.5f * s, Alpha(kTertiary, 0.9f), 32, 1.3f * s);
        const std::string n = std::to_string(i + 1);
        const ImVec2 nts = TextSize(m_fonts.SmallBold, n.c_str());
        Text(dl, m_fonts.SmallBold, bc - nts * 0.5f, active ? kOnAccent : kMuted, n.c_str());
        ImFont* title = active ? m_fonts.Bold : m_fonts.Body;
        const float th = TextSize(title, "A").y, sh = TextSize(m_fonts.Small, "A").y;
        const float ty = p.y + (h - (th + open * (sh + 3 * s))) * 0.5f;
        Text(dl, title, ImVec2(p.x + 48 * s, ty), kText, v.Name.c_str());
        if (open > 0.05f)
            Text(dl, m_fonts.Small, ImVec2(p.x + 48 * s, ty + th + 3 * s), Alpha(kMuted, open), v.Desc.c_str());
        if (hovered && !active) Tip(v.Desc + "  ·  " + std::to_string(i + 1));
        ImGui::PopID();
    }
    ImGui::Dummy(ImVec2(1, 6 * s));
    {
        const ImVec2 p = ImGui::GetCursorScreenPos(), size(innerW, 44 * s);
        if (ImGui::InvisibleButton("##tour", size)) ToggleTour();
        const bool hovered = ImGui::IsItemHovered();
        if (m_touring) AddLens("tourLens", p, p + size, size.y * 0.5f, 1, true);
        else dl->AddRectFilled(p, p + size, Alpha(Lin(214, 192, 255, 26), 0.5f + 0.5f * Hover("tour", hovered)), size.y * 0.5f);
        const std::string g = U8(m_touring ? IcPause : IcPlay);
        const char* label = m_touring ? L("停止漫游", "Stop tour") : L("自动漫游", "Auto tour");
        const ImVec2 gts = TextSize(m_fonts.Icons, g.c_str()), lts = TextSize(m_fonts.Bold, label);
        const float total = gts.x + 9 * s + lts.x, x0 = p.x + (size.x - total) * 0.5f;
        const ImU32 c = m_touring ? kOnAccent : kText;
        Text(dl, m_fonts.Icons, ImVec2(x0, p.y + (size.y - gts.y) * 0.5f), c, g.c_str());
        Text(dl, m_fonts.Bold, ImVec2(x0 + gts.x + 9 * s, p.y + (size.y - lts.y) * 0.5f), c, label);
    }
    ImGui::PopStyleVar();
}

void ManchesterApp::DrawWeatherDock(float s)
{
    // the bottom dock: the clock (the time of day the city is lit for, running during a time-lapse), the five times and
    // weathers under a sliding glass lens, and the rain as a round glass button of its own
    const ImVec2 ds = ImGui::GetIO().DisplaySize;
    const int n = (int)m_weathers.size();
    const float tileW = 84 * s, tileH = 64 * s, gap = 2 * s, pad = 6, between = 12 * s;
    const std::string clock = ClockText(m_light.Time);
    int month = 7, day = 26;
    {
        static const int lengths[] = { 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 };
        int d = std::max(1, m_dayOfYear);
        for (month = 1; month <= 12 && d > lengths[month - 1]; month++) d -= lengths[month - 1];
        day = d;
    }
    char dateBuf[64];
    static const char* const kMonths[] = { "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December" };
    if (g_english) snprintf(dateBuf, sizeof(dateBuf), "%d %s  ·  Manchester", day, kMonths[std::clamp(month, 1, 12) - 1]);
    else snprintf(dateBuf, sizeof(dateBuf), "%d月%d日  ·  曼彻斯特", month, day);
    const float clockW = std::max(TextSize(m_fonts.Clock, "00:00").x, TextSize(m_fonts.Small, dateBuf).x) + 2 * 20 * s;
    const float dockW = n * tileW + (n - 1) * gap + 2 * pad * s, rainW = tileH + 2 * pad * s;
    const float totalW = clockW + between + dockW + between + rainW;
    const float left = ds.x * 0.5f - totalW * 0.5f, bottom = ds.y - 24 * s, height = tileH + 2 * pad * s;
    ImDrawList* dl = nullptr;
    {   // the clock
        PanelScope panel("##mrtx_clock", ImVec2(left, bottom), ImVec2(0, 1), s, ImVec2(clockW, height), ImVec2(20, 0), 1.0f, 999.0f);
        dl = ImGui::GetWindowDrawList();
        const ImVec2 wp = ImGui::GetWindowPos();
        const ImVec2 cts = TextSize(m_fonts.Clock, clock.c_str()), dts = TextSize(m_fonts.Small, dateBuf);
        const float y0 = wp.y + (height - cts.y - dts.y - 2 * s) * 0.5f;
        Text(dl, m_fonts.Clock, ImVec2(wp.x + (clockW - cts.x) * 0.5f, y0), kText, clock.c_str());
        Text(dl, m_fonts.Small, ImVec2(wp.x + (clockW - dts.x) * 0.5f, y0 + cts.y + 2 * s), kMuted, dateBuf);
        ImGui::Dummy(ImVec2(1, 1));
    }
    {   // times and weathers
        PanelScope panel("##mrtx_weather", ImVec2(left + clockW + between, bottom), ImVec2(0, 1), s, ImVec2(0, 0), ImVec2(pad, pad), 1.0f, 999.0f);
        dl = ImGui::GetWindowDrawList();
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(gap, gap));
        for (int i = 0; i < n; i++)
        {
            const Weather& w = m_weathers[i];
            if (i) ImGui::SameLine();
            ImGui::PushID(i);
            const ImVec2 p = ImGui::GetCursorScreenPos(), size(tileW, tileH);
            if (ImGui::InvisibleButton("##weather", size) && i != m_weather) ApplyWeather(i, true);
            const bool hovered = ImGui::IsItemHovered(), selected = i == m_weather;
            if (selected) AddLens("weatherLens", p, p + size, size.y * 0.5f, 1);
            else if (const float hv = Hover("weather." + std::to_string(i), hovered); hv > 0.0f) dl->AddRectFilled(p, p + size, Alpha(kHover, hv), size.y * 0.5f);
            const ImU32 col = selected ? kAccent : kText;
            DrawWeatherIcon(dl, ImVec2(p.x + size.x * 0.5f, p.y + 24 * s), 12.5f * s, w.Icon, col, s, m_fonts.Icons);
            ImFont* f = selected ? m_fonts.SmallBold : m_fonts.Small;
            const ImVec2 ts = TextSize(f, w.Name.c_str());
            Text(dl, f, ImVec2(p.x + (size.x - ts.x) * 0.5f, p.y + 42 * s), selected ? kText : kMuted, w.Name.c_str());
            if (hovered) Tip(ClockText(w.Light.Time) + "  ·  " + w.Desc + "  ·  Shift+" + std::to_string(i + 1), true);
            ImGui::PopID();
        }
        ImGui::PopStyleVar();
    }
    {   // rain
        PanelScope panel("##mrtx_rain", ImVec2(left + clockW + between + dockW + between, bottom), ImVec2(0, 1), s, ImVec2(0, 0), ImVec2(pad, pad), 1.0f, 999.0f);
        dl = ImGui::GetWindowDrawList();
        const ImVec2 p = ImGui::GetCursorScreenPos(), size(tileH, tileH);
        if (ImGui::InvisibleButton("##rain", size)) SetRain(!m_settings.Rain, true);
        const bool hovered = ImGui::IsItemHovered();
        if (m_settings.Rain) AddLens("rainLens", p, p + size, size.y * 0.5f, 1, true);
        else if (const float hv = Hover("rain", hovered); hv > 0.0f) dl->AddCircleFilled(p + size * 0.5f, size.y * 0.5f, Alpha(kHover, hv), 48);
        const ImU32 col = m_settings.Rain ? kOnAccent : kText;
        DrawWeatherIcon(dl, ImVec2(p.x + size.x * 0.5f, p.y + 24 * s), 12.5f * s, "rain", col, s, m_fonts.Icons);
        ImFont* f = m_settings.Rain ? m_fonts.SmallBold : m_fonts.Small;
        const char* label = L("雨", "Rain");
        const ImVec2 ts = TextSize(f, label);
        Text(dl, f, ImVec2(p.x + (size.x - ts.x) * 0.5f, p.y + 42 * s), m_settings.Rain ? kOnAccent : kMuted, label);
        if (hovered) Tip(std::string(m_settings.Rain ? L("雨停，天空放晴", "Stop the rain, clear the sky") : L("下雨：湿润的路面与屋顶倒映灯光", "Rain: wet streets and roofs mirror the lights")) + "  ·  R", true);
    }
}

void ManchesterApp::DrawLegend(float s)
{
    if (m_towers.empty()) return;
    const ImVec2 ds = ImGui::GetIO().DisplaySize;
    PanelScope panel("##mrtx_legend", ImVec2(24 * s, ds.y - 24 * s), ImVec2(0, 1), s, ImVec2(0, 0), ImVec2(10, 10), 1.0f, 26.0f);
    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0, 2 * s));
    {
        const ImVec2 p = ImGui::GetCursorScreenPos();
        const std::string g = U8(IcPin);
        Text(dl, m_fonts.Icons, ImVec2(p.x + 12 * s, p.y + 4 * s), kAccent, g.c_str());
        Text(dl, m_fonts.Small, ImVec2(p.x + 38 * s, p.y + 5 * s), kMuted, m_towerTitle.c_str());
        ImGui::Dummy(ImVec2(100 * s, TextSize(m_fonts.Small, "A").y + 12 * s));
    }
    float rowW = 0;
    for (const Tower& h : m_towers)
        rowW = std::max(rowW, 50 * s + std::max(TextSize(m_fonts.Bold, h.Name.c_str()).x, TextSize(m_fonts.Small, (h.Brand + "  ·  " + h.Addr).c_str()).x) + 16 * s);
    for (int i = 0; i < (int)m_towers.size(); i++)
    {
        const Tower& h = m_towers[i];
        ImGui::PushID(i);
        const ImVec2 p = ImGui::GetCursorScreenPos(), size(rowW, 54 * s);
        if (ImGui::InvisibleButton("##tower", size)) { StopCameraAutomation(); FlyTo(h.View); }
        const bool hovered = ImGui::IsItemHovered();
        if (const float hv = Hover("tower." + std::to_string(i), hovered); hv > 0.0f) dl->AddRectFilled(p, p + size, Alpha(kHover, hv), 16 * s);
        const ImVec2 bc(p.x + 24 * s, p.y + size.y * 0.5f);
        dl->AddCircleFilled(bc, 13 * s, kAccent, 32);
        const std::string n = std::to_string(h.N);
        const ImVec2 nts = TextSize(m_fonts.SmallBold, n.c_str());
        Text(dl, m_fonts.SmallBold, bc - nts * 0.5f, kOnAccent, n.c_str());
        Text(dl, m_fonts.Bold, ImVec2(p.x + 48 * s, p.y + 8 * s), kText, h.Name.c_str());
        Text(dl, m_fonts.Small, ImVec2(p.x + 48 * s, p.y + 31 * s), kMuted, (h.Brand + "  ·  " + h.Addr).c_str());
        if (hovered) Tip(L("飞往这栋楼", "Fly to this building"));
        ImGui::PopID();
    }
    ImGui::PopStyleVar();
}

void ManchesterApp::DrawPins(float s)
{
    if (!m_settings.Pins) return;
    ImDrawList* dl = ImGui::GetBackgroundDrawList();
    const ImGuiIO& io = ImGui::GetIO();
    for (int i = 0; i < (int)m_towers.size(); i++)
    {
        const Tower& h = m_towers[i];
        ImVec2 pin, roof;
        if (!Project(h.Pos, pin) || !Project(h.Pos - float3(0, 9.0f, 0), roof)) continue;
        const bool hovered = !io.WantCaptureMouse && ImLengthSqr(io.MousePos - pin) < (18 * s) * (18 * s);
        if (hovered) m_hoverPin = i;
        const float r = SpringValue((std::string("pin") + std::to_string(i)).c_str(), hovered ? 15.5f : 13.0f, 300.0f, 0.7f) * s;
        dl->AddLine(pin, roof, IM_COL32(255, 255, 255, 200), 1.6f * s);
        dl->AddCircleFilled(roof, 2.6f * s, IM_COL32(255, 255, 255, 230));
        dl->AddCircleFilled(pin + ImVec2(0, 2.0f * s), r + 4 * s, IM_COL32(0, 0, 0, 70), 40);
        dl->AddCircleFilled(pin, r + 2.2f * s, IM_COL32(255, 255, 255, 245), 40);
        dl->AddCircleFilled(pin, r, kAccent, 40);
        const std::string n = std::to_string(h.N);
        const ImVec2 nts = TextSize(m_fonts.SmallBold, n.c_str());
        Text(dl, m_fonts.SmallBold, pin - nts * 0.5f, kOnAccent, n.c_str());
        // name tag beside the pin, on the side that keeps the two tags apart
        const ImVec2 ts = TextSize(m_fonts.Small, h.Name.c_str());
        const float tagH = ts.y + 10 * s, tagW = ts.x + 20 * s;
        const float tx = h.Side < 0 ? pin.x - r - 10 * s - tagW : pin.x + r + 10 * s;
        const ImVec2 t0(tx, pin.y - tagH * 0.5f), t1(tx + tagW, pin.y + tagH * 0.5f);
        dl->AddRectFilled(t0 + ImVec2(0, 1.5f * s), t1 + ImVec2(0, 1.5f * s), IM_COL32(0, 0, 0, 50), tagH * 0.5f);
        dl->AddRectFilled(t0, t1, Lin(44, 14, 70, 240), tagH * 0.5f);
        Text(dl, m_fonts.Small, ImVec2(t0.x + 10 * s, t0.y + 5 * s), kText, h.Name.c_str());
        if (hovered)
        {
            Tip(h.Brand + "  ·  " + h.Addr + L("  ·  点击飞往", "  ·  click to fly there"));
            m_tipAnchor = ImVec2(pin.x, pin.y + r + 8 * s);     // under the pin, not under the last widget
        }
    }
}

void ManchesterApp::DrawSettings(float s)
{
    const float a = SpringValue("settingsAnim", m_showSettings ? 1.0f : 0.0f, 260.0f, 0.8f);
    if (a < 0.01f) return;
    const ImVec2 ds = ImGui::GetIO().DisplaySize;
    const float width = (g_english ? 440 : 420) * s, pad = 16;     // English runs a little longer
    // an inset-grouped sheet that slides in under the toolbar and settles with a little spring
    PanelScope panel("##mrtx_settings", ImVec2(ds.x - 24 * s + (1.0f - a) * 52.0f * s, 22 * s + 58 * s + 12 * s), ImVec2(1, 0), s, ImVec2(width, 0),
        ImVec2(pad, 16), std::clamp(a, 0.0f, 1.0f), 32.0f);
    const float innerW = width - 2 * pad * s;
    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0, 0));
    {
        const ImVec2 p = ImGui::GetCursorScreenPos();
        Text(dl, m_fonts.Title, ImVec2(p.x + 6 * s, p.y + 2 * s), kText, L("设置", "Settings"));
        const ImVec2 cs(32 * s, 32 * s), cp(p.x + innerW - cs.x, p.y);
        ImGui::SetCursorScreenPos(cp);
        if (ImGui::InvisibleButton("##close", cs)) m_showSettings = false;
        dl->AddCircleFilled(cp + cs * 0.5f, cs.x * 0.5f, ImGui::IsItemHovered() ? Lin(214, 192, 255, 44) : Lin(214, 192, 255, 28), 32);
        const std::string g = U8(IcClose);
        const ImVec2 gts = TextSize(m_fonts.Small, g.c_str());
        Text(dl, m_fonts.Icons, cp + (cs - TextSize(m_fonts.Icons, g.c_str())) * 0.5f, kMuted, g.c_str());
        (void)gts;
        ImGui::SetCursorScreenPos(ImVec2(p.x, p.y + 44 * s));
    }

    // sections: a small grey header, then a rounded group of rows (label on the left, control on the right)
    const float rowH = 48 * s, rowPad = 14 * s;
    const ImU32 groupFill = kGroup;
    auto header = [&](const char* t)
    {
        ImGui::Dummy(ImVec2(1, 10 * s));
        const ImVec2 p = ImGui::GetCursorScreenPos();
        Text(dl, m_fonts.Small, ImVec2(p.x + 14 * s, p.y), kMuted, t);
        ImGui::Dummy(ImVec2(innerW, TextSize(m_fonts.Small, "A").y + 6 * s));
    };
    auto group = [&](float h) { const ImVec2 p = ImGui::GetCursorScreenPos(); dl->AddRectFilled(p, p + ImVec2(innerW, h), groupFill, 16 * s); return p; };
    auto separator = [&](float y) { const ImVec2 p = ImGui::GetCursorScreenPos(); dl->AddLine(ImVec2(p.x + rowPad, y), ImVec2(p.x + innerW, y), kSeparator, 1.0f); };
    auto rowLabel = [&](ImVec2 p, float h, const char* label, const char* caption = nullptr)
    {
        const float lh = TextSize(m_fonts.Body, "A").y, ch = caption ? TextSize(m_fonts.Small, "A").y + 2 * s : 0.0f;
        const float y = p.y + (h - lh - ch) * 0.5f;
        Text(dl, m_fonts.Body, ImVec2(p.x + rowPad, y), kText, label);
        if (caption) Text(dl, m_fonts.Small, ImVec2(p.x + rowPad, y + lh + 2 * s), kMuted, caption);
    };
    // segmented control with a sliding lens, full width of the group
    auto segmented = [&](const char* id, const char* lensId, const char* const* labels, int count, int current, const bool* enabled) -> int
    {
        ImGui::PushID(id);
        const float h = 36 * s, tp = 3 * s;
        const ImVec2 t0 = ImGui::GetCursorScreenPos() + ImVec2(rowPad * 0.7f, 0), t1 = t0 + ImVec2(innerW - rowPad * 1.4f, h + 2 * tp);
        dl->AddRectFilled(t0, t1, kTrack, (h + 2 * tp) * 0.5f);
        const float w = (t1.x - t0.x - 2 * tp) / count;
        int result = -1;
        for (int i = 0; i < count; i++)
        {
            const ImVec2 p = t0 + ImVec2(tp + w * i, tp);
            ImGui::SetCursorScreenPos(p);
            ImGui::PushID(i);
            const bool en = enabled ? enabled[i] : true;
            if (i == current) AddLens(lensId, p, p + ImVec2(w, h), h * 0.5f, 1);
            if (Chip("seg", labels[i], i == current, ImVec2(w, h), i == current ? m_fonts.Bold : m_fonts.Body, en, kText)) result = i;
            ImGui::PopID();
        }
        ImGui::SetCursorScreenPos(ImVec2(t0.x - rowPad * 0.7f, t1.y));
        ImGui::Dummy(ImVec2(innerW, 1));
        ImGui::PopID();
        return result;
    };

    /* rendering */
    header(L("渲染", "Rendering"));
    {
        const float h = 136 * s + 2 * TextSize(m_fonts.Small, "A").y;
        const ImVec2 g0 = group(h);
        ImGui::Dummy(ImVec2(1, 8 * s));
        const char* qualityNames[] = { QualityName(0), QualityName(1), QualityName(2), QualityName(3) };
        const int q = segmented("quality", "qualityLens", qualityNames, 4, m_quality, nullptr);
        if (q >= 0 && q != m_quality) ApplyQuality(q, true);
        { const ImVec2 p = ImGui::GetCursorScreenPos(); Text(dl, m_fonts.Small, ImVec2(p.x + rowPad, p.y + 7 * s), kMuted, QualityCaption(m_quality)); ImGui::Dummy(ImVec2(1, TextSize(m_fonts.Small, "A").y + 14 * s)); }
        separator(ImGui::GetCursorScreenPos().y);
        ImGui::Dummy(ImVec2(1, 8 * s));
#if DONUT_WITH_STREAMLINE
        const char* fgNames[] = { L("帧生成 关", "FG off"), "2×", "3×", "4×" };
        const int maxFrames = std::max(1, (int)m_ui.DLSSFGMaxNumFramesToGenerate);
        const bool fgEnabled[] = { true, m_ui.IsDLSSFGSupported, m_ui.IsDLSSFGSupported && maxFrames >= 2, m_ui.IsDLSSFGSupported && maxFrames >= 3 };
        const int fgCurrent = m_ui.DLSSFGMode == SI::DLSSGMode::eOn ? std::clamp((int)m_ui.DLSSFGNumFramesToGenerate, 1, 3) : 0;
        const int fgPick = segmented("fg", "fgLens", fgNames, 4, fgCurrent, fgEnabled);
        if (fgPick >= 0 && fgPick != fgCurrent) ApplyFrameGen(fgPick, true);
        const char* fgCaption = !m_ui.IsDLSSFGSupported ? L("这块显卡不支持帧生成", "This GPU does not support Frame Generation")
            : (m_photoMode ? L("照片模式下帧生成自动暂停", "Frame Generation pauses in photo mode")
            : (fgCurrent > 0 ? L("DLSS 多帧生成  ·  界面单独重组合  ·  Reflex 低延迟", "DLSS Multi Frame Generation · UI recomposition · Reflex")
            : L("显示实际渲染帧率", "Showing the rendered frame rate")));
        { const ImVec2 p = ImGui::GetCursorScreenPos(); Text(dl, m_fonts.Small, ImVec2(p.x + rowPad, p.y + 7 * s), kMuted, fgCaption); ImGui::Dummy(ImVec2(1, TextSize(m_fonts.Small, "A").y + 14 * s)); }
#endif
        ImGui::SetCursorScreenPos(ImVec2(g0.x, g0.y + h));
    }

    /* display */
    header(L("显示", "Display"));
    {
        const bool hdrRows = g_HdrOutput;
        const float h = rowH * (hdrRows ? 4 : 2) + 10 * s;
        const ImVec2 g0 = group(h);
        // HDR output (applies at the next start)
        {
            const ImVec2 p = ImGui::GetCursorScreenPos();
            char caption[128];
            if (!g_DisplayHdr.Active) snprintf(caption, sizeof(caption), "%s", L("显示器未开启 HDR（Windows 设置 → 显示 → 使用 HDR）", "HDR is off in Windows (Settings → Display → Use HDR)"));
            else if (g_HdrOutput != m_settings.Hdr) snprintf(caption, sizeof(caption), "%s", L("重新打开 Manchester RTX 后生效", "Takes effect when Manchester RTX restarts"));
            else if (g_HdrOutput) snprintf(caption, sizeof(caption), L("HDR10  ·  显示器峰值 %.0f 尼特", "HDR10  ·  display peak %.0f nits"), GetPeakNits());
            else snprintf(caption, sizeof(caption), "%s", L("SDR 输出", "SDR output"));
            rowLabel(p, rowH + 8 * s, L("HDR 输出", "HDR output"), caption);
            ImGui::SetCursorScreenPos(ImVec2(p.x + innerW - rowPad - 51 * s, p.y + (rowH + 8 * s - 31 * s) * 0.5f));
            bool hdr = m_settings.Hdr;
            if (ToggleSwitch("hdr", &hdr, s))
            {
                m_settings.Hdr = hdr;
                m_settings.Save();
                ShowToast(hdr ? L("HDR 输出将在重新打开后开启", "HDR output turns on at the next start") : L("HDR 输出将在重新打开后关闭", "HDR output turns off at the next start"));
            }
            ImGui::SetCursorScreenPos(ImVec2(p.x, p.y + rowH + 8 * s));
        }
        auto sliderRow = [&](const char* id, const char* label, const char* value, float* v, float lo, float hi) -> bool
        {
            separator(ImGui::GetCursorScreenPos().y);
            const ImVec2 p = ImGui::GetCursorScreenPos();
            const float lh = TextSize(m_fonts.Body, "A").y;
            Text(dl, m_fonts.Body, ImVec2(p.x + rowPad, p.y + (rowH - lh) * 0.5f), kText, label);
            const ImVec2 vts = TextSize(m_fonts.Small, value);
            Text(dl, m_fonts.Small, ImVec2(p.x + innerW - rowPad - vts.x, p.y + (rowH - vts.y) * 0.5f), kMuted, value);
            const float sw = innerW * 0.46f;
            ImGui::SetCursorScreenPos(ImVec2(p.x + innerW - rowPad - vts.x - 12 * s - sw, p.y + (rowH - 30 * s) * 0.5f));
            const bool changed = GlassSlider(id, v, lo, hi, sw, s);
            const bool done = ImGui::IsItemDeactivated();
            ImGui::SetCursorScreenPos(ImVec2(p.x, p.y + rowH));
            return changed || done;
        };
        char value[64];
        if (hdrRows)
        {
            float white = GetUIWhiteNits();
            snprintf(value, sizeof(value), m_settings.PaperWhite > 0 ? L("%.0f 尼特", "%.0f nits") : L("自动 %.0f", "Auto %.0f"), white);
            if (sliderRow("white", L("白色亮度", "White level"), value, &white, 120.0f, 480.0f)) { m_settings.PaperWhite = std::round(white / 5.0f) * 5.0f; m_settings.Save(); }
            float peak = GetPeakNits();
            snprintf(value, sizeof(value), m_settings.HdrPeak > 0 ? L("%.0f 尼特", "%.0f nits") : L("自动 %.0f", "Auto %.0f"), peak);
            if (sliderRow("peak", L("峰值亮度", "Peak"), value, &peak, 400.0f, 2000.0f)) { m_settings.HdrPeak = std::round(peak / 50.0f) * 50.0f; m_settings.Save(); }
        }
        snprintf(value, sizeof(value), "%+.1f EV", m_settings.Exposure);
        if (sliderRow("exposure", L("曝光补偿", "Exposure"), value, &m_settings.Exposure, -2.0f, 2.0f)) { m_settings.Exposure = std::round(m_settings.Exposure * 10.0f) / 10.0f; ApplyExposure(); m_settings.Save(); }
        ImGui::SetCursorScreenPos(ImVec2(g0.x, g0.y + h));
    }

    /* interface */
    header(L("界面", "Interface"));
    {
        const float h = rowH * 5;
        const ImVec2 g0 = group(h);
        {   // language: each named in its own language, in a two-way segmented control at the right of the row
            const ImVec2 p = ImGui::GetCursorScreenPos();
            rowLabel(p, rowH, L("语言", "Language"));
            static const char* const names[] = { "中文", "English" };
            const float ch = 30 * s, tp = 3 * s, cw = 84 * s;
            const ImVec2 t1(p.x + innerW - rowPad * 0.7f, p.y + (rowH + ch) * 0.5f + tp), t0(t1.x - 2 * cw - 2 * tp, t1.y - ch - 2 * tp);
            dl->AddRectFilled(t0, t1, kTrack, (ch + 2 * tp) * 0.5f);
            const int current = g_english ? 1 : 0;
            for (int i = 0; i < 2; i++)
            {
                const ImVec2 c0 = t0 + ImVec2(tp + cw * i, tp);
                ImGui::SetCursorScreenPos(c0);
                ImGui::PushID(i);
                if (i == current) AddLens("languageLens", c0, c0 + ImVec2(cw, ch), ch * 0.5f, 1);
                if (Chip("language", names[i], i == current, ImVec2(cw, ch), i == current ? m_fonts.Bold : m_fonts.Body, true, kText) && i != current)
                {
                    m_settings.Language = i ? "en" : "zh";
                    m_settings.Save();
                    ApplyLanguage(true);
                }
                ImGui::PopID();
            }
            ImGui::SetCursorScreenPos(ImVec2(p.x, p.y + rowH));
        }
        {
            separator(ImGui::GetCursorScreenPos().y);
            const ImVec2 p = ImGui::GetCursorScreenPos();
            const float lh = TextSize(m_fonts.Body, "A").y;
            const char* label = L("液态玻璃", "Liquid glass");
            Text(dl, m_fonts.Body, ImVec2(p.x + rowPad, p.y + (rowH - lh) * 0.5f), kText, label);
            const char* tint = L("着色", "Tinted"), * clear = L("通透", "Clear");
            // the slider takes half the row, less whatever the label and its two ends need
            const float room = innerW - 2 * rowPad - TextSize(m_fonts.Body, label).x - TextSize(m_fonts.Small, tint).x - TextSize(m_fonts.Small, clear).x - 40 * s;
            const float sw = std::min(innerW * 0.5f, room), sx = p.x + innerW - rowPad - sw - TextSize(m_fonts.Small, clear).x - 8 * s;
            Text(dl, m_fonts.Small, ImVec2(sx - TextSize(m_fonts.Small, tint).x - 8 * s, p.y + (rowH - TextSize(m_fonts.Small, "A").y) * 0.5f), kMuted, tint);
            Text(dl, m_fonts.Small, ImVec2(sx + sw + 8 * s, p.y + (rowH - TextSize(m_fonts.Small, "A").y) * 0.5f), kMuted, clear);
            ImGui::SetCursorScreenPos(ImVec2(sx, p.y + (rowH - 30 * s) * 0.5f));
            GlassSlider("clarity", &m_settings.Clarity, 0.0f, 1.0f, sw, s);
            if (ImGui::IsItemDeactivated()) m_settings.Save();
            ImGui::SetCursorScreenPos(ImVec2(p.x, p.y + rowH));
        }
        auto switchRow = [&](const char* id, const char* label, bool* v) -> bool
        {
            separator(ImGui::GetCursorScreenPos().y);
            const ImVec2 p = ImGui::GetCursorScreenPos();
            rowLabel(p, rowH, label);
            ImGui::SetCursorScreenPos(ImVec2(p.x + innerW - rowPad - 51 * s, p.y + (rowH - 31 * s) * 0.5f));
            const bool changed = ToggleSwitch(id, v, s);
            ImGui::SetCursorScreenPos(ImVec2(p.x, p.y + rowH));
            return changed;
        };
        if (switchRow("pins", m_towerPinsLabel.c_str(), &m_settings.Pins)) m_settings.Save();
        if (switchRow("stats", L("显示帧率与 DLSS 状态", "Show frame rate and DLSS status"), &m_settings.ShowStats)) m_settings.Save();
        bool fullscreen = m_settings.Fullscreen;
        if (switchRow("fullscreen", L("全屏（无边框）", "Full screen (borderless)"), &fullscreen)) SetFullscreen(fullscreen);
        ImGui::SetCursorScreenPos(ImVec2(g0.x, g0.y + h));
    }

    /* about */
    header(L("正在运行", "Running on"));
    {
        char lines[4][256];
        snprintf(lines[0], sizeof(lines[0]), "%s", m_app.GetDeviceManager()->GetRendererString());
        const uint2 rs = m_app.GetRenderSize(), dsz = m_app.GetDisplaySize();
        snprintf(lines[1], sizeof(lines[1]), L("渲染 %u×%u  →  显示 %u×%u%s", "Render %u×%u  →  display %u×%u%s"), rs.x, rs.y, dsz.x, dsz.y, g_HdrOutput ? "  ·  HDR10" : "");
        snprintf(lines[2], sizeof(lines[2]), L("DLSS %s  ·  光线重建预设 F  ·  帧生成 UI 重组合", "DLSS %s  ·  Ray Reconstruction preset F  ·  FG UI recomposition"), m_dlssVersion.empty() ? "?" : m_dlssVersion.c_str());
        snprintf(lines[3], sizeof(lines[3]), L("RTX Path Tracing 1.8.1  ·  最多 %d 次反弹  ·  光线追踪大气", "RTX Path Tracing 1.8.1  ·  up to %d bounces  ·  ray-traced atmosphere"), m_ui.BounceCount);
        const float lh = TextSize(m_fonts.Small, "A").y + 5 * s, h = 4 * lh + 20 * s;
        const ImVec2 g0 = group(h);
        for (int i = 0; i < 4; i++) Text(dl, m_fonts.Small, ImVec2(g0.x + rowPad, g0.y + 10 * s + i * lh), i == 0 ? kText : kMuted, lines[i]);
        ImGui::SetCursorScreenPos(ImVec2(g0.x, g0.y + h));
    }
    ImGui::Dummy(ImVec2(1, 12 * s));
    {
        const float half = (innerW - 8 * s) * 0.5f;
        const ImVec2 p = ImGui::GetCursorScreenPos();
        if (Chip("folder", L("打开截图文件夹", "Open captures folder"), false, ImVec2(half, 40 * s), m_fonts.Body)) OpenCapturesFolder();
        ImGui::SetCursorScreenPos(ImVec2(p.x + half + 8 * s, p.y));
        if (Chip("dev", m_ui.ShowUI ? L("关闭开发者面板", "Close developer panel") : L("开发者面板  F2", "Developer panel  F2"), false, ImVec2(half, 40 * s), m_fonts.Body))
            m_ui.ShowUI = !m_ui.ShowUI;
    }
    ImGui::PopStyleVar();
}

void ManchesterApp::DrawPhotoBar(float s)
{
    const ImVec2 ds = ImGui::GetIO().DisplaySize;
    PanelScope panel("##mrtx_photo", ImVec2(ds.x * 0.5f, 22 * s), ImVec2(0.5f, 0), s, ImVec2(0, 0), ImVec2(20, 8), 1.0f, 999.0f);
    ImDrawList* dl = ImGui::GetWindowDrawList();
    const int target = std::max(1, m_ui.AccumulationTarget);
    const int done = std::clamp(m_app.GetAccumulationSampleIndex(), 0, target);
    const bool complete = m_app.AccumulationCompleted() || done >= target;

    const ImVec2 p = ImGui::GetCursorScreenPos();
    const float lineH = 40 * s;
    const char* title = L("照片模式", "Photo mode");
    Text(dl, m_fonts.Bold, ImVec2(p.x, p.y + (lineH - TextSize(m_fonts.Bold, "A").y) * 0.5f), kText, title);
    const float barX = p.x + TextSize(m_fonts.Bold, title).x + 16 * s, barW = 240 * s, barH = 6 * s, barY = p.y + lineH * 0.5f - barH * 0.5f;
    dl->AddRectFilled(ImVec2(barX, barY), ImVec2(barX + barW, barY + barH), Lin(214, 192, 255, 36), barH);
    dl->AddRectFilled(ImVec2(barX, barY), ImVec2(barX + std::max(barH, barW * float(done) / target), barY + barH), complete ? kSwitchOn : kAccent, barH);
    char buf[96];
    if (complete) snprintf(buf, sizeof(buf), L("已收敛  ·  %d 次采样", "Converged  ·  %d samples"), target);
    else snprintf(buf, sizeof(buf), L("累积采样 %d / %d", "Accumulating %d / %d"), done, target);
    const float textX = barX + barW + 12 * s;
    Text(dl, m_fonts.Small, ImVec2(textX, p.y + (lineH - TextSize(m_fonts.Small, "A").y) * 0.5f), kMuted, buf);
    ImGui::Dummy(ImVec2(textX + TextSize(m_fonts.Small, L("累积采样 0000 / 0000", "Converged  ·  0000 samples")).x + 10 * s - p.x, lineH));
    ImGui::SameLine();
    const float saveW = (g_english ? 118 : 108) * s;
    {
        const ImVec2 bp = ImGui::GetCursorScreenPos();
        if (complete) AddLens("photoSave", bp, bp + ImVec2(saveW, lineH), lineH * 0.5f, 1, true);
        if (Chip("save", L("保存照片", "Save photo"), complete, ImVec2(saveW, lineH), complete ? m_fonts.Bold : m_fonts.Body, true, kOnAccent)) RequestScreenshot();
    }
    ImGui::SameLine();
    if (Chip("exit", L("退出", "Done"), false, ImVec2(76 * s, lineH), m_fonts.Body)) TogglePhotoMode();
}

void ManchesterApp::DrawHelp(float s)
{
    const float a = SpringValue("helpAnim", m_showHelp ? 1.0f : 0.0f, 240.0f, 0.72f);
    if (a < 0.01f) return;
    const ImVec2 ds = ImGui::GetIO().DisplaySize;
    const float scale = 0.94f + 0.06f * a;
    const float width = 660 * s * scale, pad = 26;
    PanelScope panel("##mrtx_help", ImVec2(ds.x * 0.5f, ds.y * 0.5f), ImVec2(0.5f, 0.5f), s, ImVec2(width, 0), ImVec2(pad, 22),
        std::clamp(a, 0.0f, 1.0f), 34.0f, 2);
    ImDrawList* dl = ImGui::GetWindowDrawList();
    const float innerW = width - 2 * pad * s;
    {
        const ImVec2 p = ImGui::GetCursorScreenPos();
        Text(dl, m_fonts.Title, p, kText, L("操作说明", "Controls"));
        const ImVec2 cs(32 * s, 32 * s), cp(p.x + innerW - cs.x, p.y);
        ImGui::SetCursorScreenPos(cp);
        if (ImGui::InvisibleButton("##close", cs)) m_showHelp = false;
        dl->AddCircleFilled(cp + cs * 0.5f, cs.x * 0.5f, ImGui::IsItemHovered() ? Lin(214, 192, 255, 44) : Lin(214, 192, 255, 28), 32);
        const std::string g = U8(IcClose);
        Text(dl, m_fonts.Icons, cp + (cs - TextSize(m_fonts.Icons, g.c_str())) * 0.5f, kMuted, g.c_str());
        ImGui::SetCursorScreenPos(ImVec2(p.x, p.y + TextSize(m_fonts.Title, "A").y + 16 * s));
    }
    // key, what it does: Chinese, then English
    static const char* const rows[][4] = {
        { "W A S D", "前后左右移动", "W A S D", "Move" },                        { "1 – 8", "飞往视角", "1 – 8", "Fly to a view" },
        { "Q / E", "下降 / 上升", "Q / E", "Down / up" },                        { "Shift + 1 – 5", "切换时间与天气", "Shift + 1 – 5", "Time and weather" },
        { "Shift / Ctrl", "加速 / 减速", "Shift / Ctrl", "Faster / slower" },    { "R", "晴 / 雨", "R", "Dry / rain" },
        { "左键拖动", "环顾四周", "Left drag", "Look around" },                  { "T", "自动漫游", "T", "Auto tour" },
        { "右键拖动", "平移", "Right drag", "Pan" },                             { "P", "照片模式", "P", "Photo mode" },
        { "中键拖动", "绕中心环绕", "Middle drag", "Orbit" },                    { "F12", "截图", "F12", "Screenshot" },
        { "滚轮", "推近 / 拉远", "Scroll", "Dolly in / out" },                   { "H", "隐藏 / 显示界面", "H", "Show / hide UI" },
        { "点击地标", "飞往那栋楼", "Click a landmark", "Fly to it" },           { "F11", "全屏 / 窗口", "F11", "Full screen / window" },
        { "F2", "NVIDIA 开发者面板", "F2", "NVIDIA developer panel" },           { "Esc", "关闭面板 / 退出", "Esc", "Close a panel / quit" },
    };
    const float colW = (innerW - 24 * s) * 0.5f, rowH = 38 * s;
    const int lang = g_english ? 2 : 0;
    for (int i = 0; i < IM_ARRAYSIZE(rows); i++)
    {
        const ImVec2 p = ImGui::GetCursorScreenPos() + ImVec2((i % 2) * (colW + 24 * s), 0);
        const ImVec2 kts = TextSize(m_fonts.Small, rows[i][lang]);
        const ImVec2 k0(p.x, p.y + (rowH - kts.y - 10 * s) * 0.5f), k1(k0.x + kts.x + 18 * s, k0.y + kts.y + 10 * s);
        dl->AddRectFilled(k0 + ImVec2(0, 1.5f * s), k1 + ImVec2(0, 1.5f * s), IM_COL32(0, 0, 0, 40), 8 * s);
        dl->AddRectFilled(k0, k1, Lin(214, 192, 255, 30), 8 * s);
        Text(dl, m_fonts.Small, ImVec2(k0.x + 9 * s, k0.y + 5 * s), kText, rows[i][lang]);
        Text(dl, m_fonts.Body, ImVec2(p.x + 150 * s, p.y + (rowH - TextSize(m_fonts.Body, "A").y) * 0.5f), kMuted, rows[i][lang + 1]);
        if (i % 2 == 1) ImGui::Dummy(ImVec2(innerW, rowH));
    }
    ImGui::Dummy(ImVec2(1, 8 * s));
    Label(L("切换天气是一段延时摄影：时钟、太阳、云和灯光一起过渡。设置自动保存。",
            "A weather change is a time-lapse: clock, sun, clouds and lights move together. Settings save automatically."), m_fonts.Small);
}

void ManchesterApp::DrawExitDialog(float s)
{
    // an iOS alert: title and message centred, then two buttons side by side under a hairline
    const float a = SpringValue("exitAnim", m_showExit ? 1.0f : 0.0f, 320.0f, 0.66f);
    if (a < 0.01f) return;
    const ImVec2 ds = ImGui::GetIO().DisplaySize;
    const float scale = 1.08f - 0.08f * a;      // settles from slightly larger, like an iOS alert
    const float width = 360 * s * scale;
    PanelScope panel("##mrtx_exit", ImVec2(ds.x * 0.5f, ds.y * 0.5f), ImVec2(0.5f, 0.5f), s, ImVec2(width, 0), ImVec2(0, 0),
        std::clamp(a, 0.0f, 1.0f), 30.0f, 2);
    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0, 0));
    auto centred = [&](const char* text, ImFont* f, ImU32 col, float gapAfter)
    {
        const ImVec2 p = ImGui::GetCursorScreenPos(), ts = TextSize(f, text);
        Text(dl, f, ImVec2(p.x + (width - ts.x) * 0.5f, p.y), col, text);
        ImGui::Dummy(ImVec2(width, ts.y + gapAfter));
    };
    ImGui::Dummy(ImVec2(1, 24 * s));
    centred(L("退出 Manchester RTX？", "Quit Manchester RTX?"), m_fonts.Title, kText, 8 * s);
    centred(L("设置已经自动保存，下次打开会回到这里。", "Your settings are saved for next time."), m_fonts.Small, kMuted, 4 * s);
    centred(L("Enter 退出  ·  Esc 取消", "Enter quits  ·  Esc cancels"), m_fonts.Small, kTertiary, 20 * s);
    const ImVec2 p = ImGui::GetCursorScreenPos();
    const float h = 54 * s, half = width * 0.5f;
    dl->AddLine(p, ImVec2(p.x + width, p.y), kSeparator, 1.0f);
    dl->AddLine(ImVec2(p.x + half, p.y), ImVec2(p.x + half, p.y + h), kSeparator, 1.0f);
    ImGui::SetCursorScreenPos(p);
    if (ImGui::InvisibleButton("##cancel", ImVec2(half, h))) m_showExit = false;
    if (ImGui::IsItemHovered()) dl->AddRectFilled(p + ImVec2(1, 1), p + ImVec2(half - 1, h), Lin(214, 192, 255, 22), 26 * s, ImDrawFlags_RoundCornersBottomLeft);
    { const char* t = L("取消", "Cancel"); const ImVec2 ts = TextSize(m_fonts.Body, t); Text(dl, m_fonts.Body, ImVec2(p.x + (half - ts.x) * 0.5f, p.y + (h - ts.y) * 0.5f), kText, t); }
    ImGui::SetCursorScreenPos(ImVec2(p.x + half, p.y));
    if (ImGui::InvisibleButton("##quit", ImVec2(half, h))) RequestExit();
    if (ImGui::IsItemHovered()) dl->AddRectFilled(p + ImVec2(half + 1, 1), p + ImVec2(width - 1, h), IM_COL32(255, 92, 82, 26), 26 * s, ImDrawFlags_RoundCornersBottomRight);
    { const char* t = L("退出", "Quit"); const ImVec2 ts = TextSize(m_fonts.Bold, t); Text(dl, m_fonts.Bold, ImVec2(p.x + half + (half - ts.x) * 0.5f, p.y + (h - ts.y) * 0.5f), kRed, t); }
    ImGui::SetCursorScreenPos(ImVec2(p.x, p.y + h));
    ImGui::Dummy(ImVec2(width, 1));
    ImGui::PopStyleVar();
}

void ManchesterApp::DrawHints(float s)
{
    // a one-line capsule for the first seconds after the city appears, then it fades away
    const float fade = std::clamp((14.0f - m_readyTime) / 2.0f, 0.0f, 1.0f) * (1.0f - m_curtain) * (m_readySignalled ? 1.0f : 0.0f);
    if (fade <= 0.0f || m_showHelp) return;
    const ImVec2 ds = ImGui::GetIO().DisplaySize;
    PanelScope panel("##mrtx_hints", ImVec2(ds.x - 24 * s, ds.y - 24 * s), ImVec2(1, 1), s, ImVec2(0, 0), ImVec2(18, 10), fade, 999.0f);
    Label(L("拖动环顾  ·  右键平移  ·  滚轮推拉  ·  WASD 移动  ·  F1 帮助", "Drag to look  ·  right-drag to pan  ·  scroll to dolly  ·  WASD to move  ·  F1 help"), m_fonts.Small, kMuted);
}

void ManchesterApp::DrawToasts(float s)
{
    // notices drop in at the top centre as a dark glass capsule that springs open (Dynamic Island style)
    ImDrawList* dl = ImGui::GetForegroundDrawList();
    const ImVec2 ds = ImGui::GetIO().DisplaySize;
    float y = (m_photoMode && !m_immersive ? 92.0f : 22.0f) * s;
    for (const Toast& t : m_toasts)
    {
        const float in = std::clamp(t.Age / 0.35f, 0.0f, 1.0f), out = std::clamp((3.2f - t.Age) / 0.4f, 0.0f, 1.0f);
        const float grow = 1.0f - powf(1.0f - in, 3.0f) * (1.0f + 1.6f * in), a = std::min(in * 2.0f, 1.0f) * out;
        const ImVec2 ts = TextSize(m_fonts.Body, t.Text.c_str());
        const ImVec2 full(ts.x + 48 * s, ts.y + 24 * s);
        const ImVec2 size(full.x * (0.55f + 0.45f * grow), full.y * (0.8f + 0.2f * grow));
        const ImVec2 p0(ds.x * 0.5f - size.x * 0.5f, y);
        if (g_glassShapes)
        {
            GlassShapeDesc g = PanelGlass(p0, p0 + size, size.y * 0.5f, 2, a);
            g.Darkness = 1.1f; g.TintAmount = 0.7f; g.Tint = LinF(34, 8, 56);
            g_glassShapes->push_back(g);
        }
        const float ta = std::clamp((t.Age - 0.12f) / 0.25f, 0.0f, 1.0f) * out;
        if (ta > 0.0f)
        {
            dl->PushClipRect(p0, p0 + size, true);
            Text(dl, m_fonts.Body, ImVec2(ds.x * 0.5f - ts.x * 0.5f, y + (size.y - ts.y) * 0.5f), Alpha(kText, ta), t.Text.c_str());
            dl->PopClipRect();
        }
        y += full.y + 10 * s;
    }
}

void ManchesterApp::DrawLoading(float s)
{
    // start-up curtain: opaque (the deep blue-black of the splash's night sky) until the image has settled, then it fades
    // and the city appears; nothing of the engine's first frames - placeholder colours, lights coming on, the exposure
    // finding its level, frame generation starting - ever reaches the screen
    const bool loading = !m_sceneReady || m_app.HasAsyncLoadingInProgress();
    const float c = m_readySignalled ? m_curtain : 1.0f, a = c * c * (3.0f - 2.0f * c);
    ImDrawList* dl = ImGui::GetForegroundDrawList();
    const ImVec2 ds = ImGui::GetIO().DisplaySize;
    if (a > 0.0f)
    {
        const ImU32 top = Lin(16, 9, 26, int(255 * a + 0.5f)), bottom = Lin(5, 3, 9, int(255 * a + 0.5f));
        dl->AddRectFilledMultiColor(ImVec2(0, 0), ds, top, top, bottom, bottom);
    }
    if (!loading && m_readySignalled) return;
    // a quiet activity ring and one line of text, centred (above the curtain, or as a small pill over the city later on)
    const char* text = m_sceneReady ? (m_readySignalled ? L("正在更新光照与着色器…", "Updating lighting and shaders…") : L("正在点亮曼彻斯特…", "Lighting up Manchester…"))
                                    : L("正在载入曼彻斯特…", "Loading Manchester…");
    const ImVec2 ts = TextSize(m_fonts.Body, text);
    const ImVec2 centre(ds.x * 0.5f, ds.y * 0.5f + (m_readySignalled ? 0.0f : 140.0f * s));
    if (m_readySignalled)
    {
        const ImVec2 size(ts.x + 70 * s, ts.y + 26 * s), p0 = centre - size * 0.5f;
        if (g_glassShapes) g_glassShapes->push_back(PanelGlass(p0, p0 + size, size.y * 0.5f, 2, 1.0f));
    }
    const float a0 = m_time * 4.2f;
    const ImVec2 ring(centre.x - ts.x * 0.5f - 18 * s, centre.y);
    dl->PathArcTo(ring, 8 * s, a0, a0 + IM_PI * 1.35f, 24);
    dl->PathStroke(Alpha(kText, 0.85f), 0, 2.0f * s);
    Text(dl, m_fonts.Body, ImVec2(centre.x - ts.x * 0.5f + 6 * s, centre.y - ts.y * 0.5f), Alpha(kText, 0.85f), text);
}

void ManchesterApp::DrawRain(float s)
{
    // falling rain over the frame: thin, slanted streaks in three depth bands (far ones short, slow and faint); the
    // glass panels stay clear of it. Photo mode keeps a still frame, so no streaks there.
    const float target = (m_settings.Rain && m_ui.RealtimeMode) ? 1.0f : 0.0f;
    const float amount = SpringValue("rainAmount", target, 30.0f, 1.0f);
    if (amount < 0.01f) return;
    ImDrawList* dl = ImGui::GetBackgroundDrawList();
    const ImVec2 ds = ImGui::GetIO().DisplaySize;
    dl->AddRectFilled(ImVec2(0, 0), ds, IM_COL32(170, 180, 195, int(10 * amount)));     // mist
    const float wind = 0.16f;
    const int count = int(1100 * amount);
    for (int i = 0; i < count; i++)
    {
        const uint32_t hsh = uint32_t(i) * 2654435761u;
        const float r0 = float(hsh & 0xFFFF) / 65535.0f, r1 = float((hsh >> 16) & 0xFFFF) / 65535.0f;
        const float r2 = float(((uint32_t(i) * 40503u) >> 4) & 0xFFFF) / 65535.0f;
        const int band = i % 3;                                    // 0 near, 1 mid, 2 far
        const float speed = (band == 0 ? 2.6f : band == 1 ? 1.8f : 1.2f) * ds.y;
        const float len = (band == 0 ? 46.0f : band == 1 ? 30.0f : 16.0f) * s * (0.7f + 0.6f * r2);
        const float y = fmodf(r1 * (ds.y + len) + m_time * speed, ds.y + len) - len;
        const float x = fmodf(r0 * (ds.x + 200 * s) + y * wind, ds.x + 200 * s) - 100 * s;
        const ImVec2 a(x, y), b(x - len * wind, y + len);
        bool underGlass = false;
        for (const GlassShapeDesc& g : m_glass.Shapes)
            if (a.x >= g.Rect.x && a.x <= g.Rect.z && b.y >= g.Rect.y && a.y <= g.Rect.w) { underGlass = true; break; }
        if (underGlass) continue;
        const int alpha = int((band == 0 ? 34 : band == 1 ? 22 : 12) * amount);
        dl->AddLine(a, b, IM_COL32(220, 228, 240, alpha), (band == 0 ? 1.4f : 1.0f) * s);
    }
}
