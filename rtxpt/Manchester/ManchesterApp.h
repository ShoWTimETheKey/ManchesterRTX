/*
* ManchesterRTX app mode (Rtxpt.exe --app): a presentation GUI over the path tracer.
* Weather / time of day (and rain) switch live - sky, emissive lights, wet materials, moon, exposure - the camera flies
* between named viewpoints, two featured towers get a legend (and optional map pins), and the render settings sit in a
* settings sheet. The GUI speaks Chinese or English (Settings > Interface > Language; by default Windows' language).
* The GUI is drawn as liquid glass (ManchesterUILayer + LiquidGlass.hlsl, after Apple's iOS 26/27 Liquid Glass):
* panels register glass shapes, selections are spring-animated glass lenses, modal cards sit above a scrim.
* Data comes from Assets/manchester.app.json, written by exporter/export.mjs. The NVIDIA developer panel stays on F2.
*/

#pragma once

#include <donut/core/math/math.h>
#include <imgui.h>

#include "ManchesterUILayer.h"
#include "ManchesterAtmosphere.h"

#include <memory>
#include <optional>
#include <string>
#include <vector>
#include <unordered_map>

class Sample;
class SampleUIData;
struct PTMaterial;
struct ImFont;
struct ImDrawList;
namespace donut::engine { class DirectionalLight; struct Material; class SceneGraphNode; }

// Settings the app remembers between runs (ManchesterRTX.ini next to Rtxpt.exe)
struct ManchesterSettings
{
    std::string Weather     = "clear";
    bool        Rain        = false;
    int         Quality     = 2;        // 0 smooth, 1 balanced, 2 high, 3 ultimate (path tracing preset + DLSS mode)
    int         FrameGen    = 3;        // 0 off, 1..3 generated frames (2x..4x)
    float       Exposure    = 0.0f;     // user exposure offset (EV)
    float       Clarity     = 0.5f;     // liquid glass: 0 fully tinted .. 1 ultra clear (iOS 27)
    bool        Hdr         = true;     // HDR10 output when Windows HDR is on (takes effect at the next start)
    float       PaperWhite  = 0.0f;     // HDR10: nits of SDR white and of the GUI; 0 follows Windows' SDR content brightness
    float       HdrPeak     = 0.0f;     // HDR10: peak nits the tone curve rolls off to; 0 uses what the display reports
    bool        Fullscreen  = true;     // borderless window covering the monitor
    bool        Pins        = false;    // pins on the map for the featured towers (their list is always shown)
    bool        ShowStats   = true;     // frame rate chip
    std::string Language    = "auto";   // GUI language: zh, en, or auto (follows Windows' display language)

    static std::string  Path();
    bool                English() const;    // the GUI language, resolved
    static ManchesterSettings Load();
    void                Save() const;
};

struct ManchesterFonts
{
    ImFont *    Body    = nullptr;  // 16 px DengXian
    ImFont *    Small   = nullptr;  // 13.5 px
    ImFont *    Bold    = nullptr;  // 16 px bold
    ImFont *    Title   = nullptr;  // 23 px bold
    ImFont *    Brand   = nullptr;  // 25 px Bahnschrift (Latin)
    ImFont *    Digits  = nullptr;  // 16 px (Latin)
    ImFont *    Icons   = nullptr;  // 18 px Segoe Fluent Icons
    ImFont *    Clock   = nullptr;  // 30 px Bahnschrift: the time of day
    ImFont *    SmallBold = nullptr;    // 13.5 px bold: badges, selected captions
};

class ManchesterApp
{
public:
    ManchesterApp(Sample & app, SampleUIData & ui);
    ~ManchesterApp();

    void            SceneLoaded();
    float           SmoothFrameTime(float dt);                      // the frame time all motion runs on
    void            Animate(float dt);                              // after the free-flight camera has taken its input
    void            BuildUI(const ManchesterFonts & fonts, float dpiScale);
    const GlassFrame & GetGlassFrame() const { return m_glass; }    // glass shapes from the last UI build (drawn before ImGui)

    // input; return true when the event is consumed
    bool            KeyboardUpdate(int key, int scancode, int action, int mods);
    bool            MouseButtonUpdate(int button, int action, int mods);
    void            MousePosUpdate(double xpos, double ypos);
    bool            MouseScrollUpdate(double xoffset, double yoffset);

    // atmosphere (sun shafts, haze, cloud shadows) on the HDR frame, before bloom and tone mapping
    void            RenderAtmosphere(nvrhi::ICommandList * commandList);

    // screenshots are taken by Sample::Render once the frame is complete
    bool            TakeScreenshotRequest(std::string & path);
    bool            ScreenshotPending() const { return m_screenshotRequested; }
    bool            TakeRawScreenshotRequest(std::string & path);  // developer (F8): the frame as encoded for the display
    void            ScreenshotDone(const std::string & path, bool ok);
    // developer (F9): a run of consecutive frames, each tone mapped for SDR, saved as captures\rec-NN.bmp with the frame
    // times and camera in captures\rec.csv, to study flicker and judder; MRTX_RECORD_STARTUP=1 records the opening glide
    int             RecordSlot();                                   // this frame's slot in the recording, or -1
    bool            TakeRecording(std::string & folder, std::string & log);    // once the run is complete
    bool            IsRecording() const { return m_recordLeft > 0; }

    // HDR10: brightness of SDR white (the GUI, paper white of the tone curve) and the peak the tone curve rolls off to
    float           GetUIWhiteNits() const;
    float           GetPeakNits() const;

    // glyphs for the font atlas: the UI's own text (ManchesterGlyphs.h, generated from this module's sources) plus the data file
    static void     BuildGlyphRanges(ImVector<ImWchar> & textRanges, ImVector<ImWchar> & iconRanges);
    static std::string CollectDataText();

private:
    // how a weather lights the city. Every weather is a time of day on the model's date plus a state of the sky; switching
    // runs a time-lapse from the current state to the new one: the clock (and the sun along Manchester's real path with
    // it) moves forward or back the shorter way, clouds build up or clear, haze, grade, exposure, window and street lights,
    // moonlight and wet surfaces all ease together
    struct Lighting
    {
        float       Time            = 17.5f;    // local clock time, hours
        float       Clouds          = 0.42f;    // procedural sky cloud density offset: 0 overcast .. 1 clear
        float       Overcast        = 0.0f;     // 0: the sun shines above broken cloud, 1: it is hidden behind the deck
        float       SkyBrightness   = 1.0f;
        float       SunBrightness   = 5.0f;
        float       NightGlow = 0.0f, CloudUnderglow = 0.0f, Stars = 0.0f;
        AtmosphereSettings Atmo;
        float       Bloom = 0.004f, BloomRadius = 8.0f;
        float       Saturation = 1.0f, Contrast = 1.0f, Vignette = 0.0f, WhitePoint = 6500.0f;
        float       Exposure = 0.0f, ExposureMin = -2.0f, ExposureMax = 14.0f;
        float       Moon = 0.0f;                // moonlight irradiance
        float       Wet = 0.0f;                 // rain on streets, roofs and facades
        std::vector<float> Emissive;            // level of each driven emissive material (m_emissives)
    };
    struct Text2    { std::string Zh, En; const std::string & Get(bool english) const { return english && !En.empty() ? En : Zh; } };
    struct Weather
    {
        std::string Id, Name, Desc, Icon;       // Name, Desc: in the GUI's language (ApplyLanguage)
        Text2       Names, Descs;
        Lighting    Light;
        std::unordered_map<std::string, float> Emissive;
    };
    struct ClockHand { donut::engine::SceneGraphNode * Node = nullptr; dm::dquat Base; bool Hour = false; };
    struct View     { std::string Key, Name, Desc; dm::float3 Eye, At; float Fov = 1.0f; Text2 Names, Descs; };
    struct Tower    { int N = 0; std::string Name, Brand, Addr; dm::float3 Pos; int View = 1; int Side = 1; };
    struct Pose     { dm::float3 Pos, Dir; float Fov; };
    struct Toast    { std::string Text; float Age = 0; };
    struct Spring   { dm::float4 Pos = 0.f, Vel = 0.f; bool Init = false; int LastFrame = -1; };
    struct WetBackup{ std::shared_ptr<PTMaterial> Material; float Roughness; dm::float3 Base; };

    bool            LoadData();
    void            ApplyLanguage(bool announce);                   // Chinese or English throughout the GUI
    void            ApplyWeather(int index, bool announce);
    Lighting        WeatherLighting(int index) const;               // the weather's lighting, with rain if it is raining
    void            StartTransition(const Lighting & target, float duration = -1.0f);
    void            ApplyQuality(int index, bool announce);
    void            ApplyFrameGen(int frames, bool announce);
    void            ApplyExposure();
    void            UpdateLighting(float dt);                       // runs the time-lapse and drives sky, sun, haze, grade, lights
    bool            ApplyMaterials();                               // emissive levels and wetness of the current lighting
    void            UpdateClocks();                                 // the clock towers' hands show the time of day
    dm::float3      SunDirection(float clockHours) const;           // towards the sun at this time on the model's date
    std::string     ClockText(float hours) const;
    void            FlyTo(int view, float speedScale = 1.0f);
    void            FlyToPose(const Pose & pose, float speedScale);
    void            StopCameraAutomation();
    void            SetFullscreen(bool fullscreen);
    void            TogglePhotoMode();
    void            RequestScreenshot();
    void            ToggleTour();
    void            SetRain(bool rain, bool announce);
    void            RequestExit();
    void            ShowToast(const std::string & text);
    Pose            CurrentPose() const;
    Pose            ViewPose(int view) const;
    void            SetCameraPose(const Pose & pose);
    float           CameraAltitude() const;
    bool            Project(const dm::float3 & world, ImVec2 & screen) const;
    void            OpenCapturesFolder() const;

    // liquid glass helpers
    void            AddGlass(ImVec2 p0, ImVec2 p1, float radius, int layer, float opacity = 1.0f);
    void            AddLens(const char * id, ImVec2 p0, ImVec2 p1, float radius, int layer, bool accent = false);
    dm::float4      SpringTo(const char * id, const dm::float4 & target, float stiffness = 240.0f, float damping = 0.72f);
    float           SpringValue(const char * id, float target, float stiffness = 200.0f, float damping = 0.8f);

    // controls (iOS): a switch with a sliding knob, a slider with a glass thumb; both return true when the value changes
    bool            ToggleSwitch(const char * id, bool * v, float s);
    bool            GlassSlider(const char * id, float * v, float lo, float hi, float width, float s);
    // motion and help: a hover/press highlight that fades in and out, and a tooltip capsule shown after a short dwell
    float           Hover(const std::string & id, bool on, float rate = 14.0f);
    void            Tip(const std::string & text, bool above = false);
    void            DrawTip(float s);

    // UI pieces
    void            DrawBrand(float s);
    void            DrawToolbar(float s);
    void            DrawViews(float s);
    void            DrawWeatherDock(float s);
    void            DrawLegend(float s);
    void            DrawPins(float s);
    void            DrawSettings(float s);
    void            DrawPhotoBar(float s);
    void            DrawHelp(float s);
    void            DrawExitDialog(float s);
    void            DrawToasts(float s);
    void            DrawHints(float s);
    void            DrawLoading(float s);
    void            DrawRain(float s);

    Sample &                    m_app;
    SampleUIData &              m_ui;
    ManchesterSettings          m_settings;
    ManchesterFonts             m_fonts;
    std::string                 m_dlssVersion;

    std::vector<Weather>        m_weathers;
    std::vector<View>           m_views;
    std::vector<Tower>          m_towers;
    Text2                       m_towerTitles, m_towerPinsLabels;   // the towers panel's title and its map-pins switch
    std::string                 m_towerTitle, m_towerPinsLabel;     // ... in the GUI's language
    bool                        m_dataLoaded = false;

    // scene objects driven by the GUI. RTXPT creates its path tracer materials on the first render after loading, so the
    // weather's emissive levels and the rain's wet surfaces are applied from Animate once every material is there
    std::vector<std::pair<std::shared_ptr<donut::engine::Material>, std::string>> m_emissives;     // material, name
    std::vector<std::pair<std::shared_ptr<donut::engine::Material>, std::string>> m_surfaces;      // everything rain can wet
    std::vector<WetBackup>      m_dryState;
    std::vector<float>          m_appliedEmissive;          // levels last written to the materials
    float                       m_appliedWet = -1.0f;
    bool                        m_materialsApplied = false; // RTXPT has built its materials and the first levels are in
    std::vector<ClockHand>      m_clockHands;
    float                       m_appliedClock = -1.0f;
    std::shared_ptr<donut::engine::DirectionalLight> m_moon;
    bool                        m_sceneReady = false;
    int                         m_readyFrames = 0;          // frames rendered since loading finished
    float                       m_readyTime = 0.0f;         // seconds since the launcher was told to drop its splash
    bool                        m_readySignalled = false;   // told the launcher (named event) to drop its splash
    bool                        m_introPending = false;     // glide onto the overview once the first frames are up
    bool                        m_qualityPending = false;   // SampleUI applies its default preset after the scene loads; re-apply ours
    float                       m_curtain = 1.0f;           // opaque cover over the frame until the image is stable, then fades
    bool                        m_windowShown = false;      // the window starts hidden (see Animate)

    int                         m_weather = 1;
    int                         m_activeView = 0;           // view the camera is resting at, -1 once the user moves away
    int                         m_quality = 2;

    // camera automation
    bool                        m_flying = false;
    Pose                        m_flyFrom, m_flyTo;
    float                       m_flyT = 0, m_flyDuration = 1, m_flyArc = 0;
    int                         m_flyTarget = -1;
    bool                        m_touring = false;
    float                       m_tourHold = 0;
    dm::float3                  m_dollyVelocity = 0.f;
    bool                        m_keyUp = false, m_keyDown = false, m_keyShift = false;
    bool                        m_panning = false, m_orbiting = false;
    dm::float2                  m_mouse = 0.f, m_mousePrev = 0.f;
    dm::float3                  m_orbitPivot = 0.f;
    dm::float3                  m_restPos = 0.f, m_restDir = 0.f;     // pose the camera arrived at, to notice when the user moves away

    // UI state
    bool                        m_immersive = false;
    bool                        m_showSettings = false;
    bool                        m_showHelp = false;
    bool                        m_showExit = false;
    bool                        m_photoMode = false;
    int                         m_photoTarget = 1024;
    int                         m_savedAccumulationTarget = 0;
    bool                        m_screenshotRequested = false;
    bool                        m_rawScreenshotRequested = false;
    int                         m_recordLeft = 0, m_recordTotal = 0;    // developer recording (F9)
    bool                        m_recordImages = true;      // false: frame times only
    std::string                 m_recordLog;
    std::string                 m_lastScreenshot;
    bool                        m_fullscreenPending = false;
    bool                        m_exitRequested = false;
    std::vector<Toast>          m_toasts;
    float                       m_time = 0;
    float                       m_dt = 0;
    float                       m_smoothDt = 0;             // running average of the frame time (SmoothFrameTime)
    float                       m_rawDt = 0;                // the frame time as measured
    float                       m_recordDt = -1;            // developer recordings: fixed step (MRTX_RECORD_DT, ms), 0 = off
    int                         m_frame = 0;
    float                       m_dpi = 1.0f;
    int                         m_hoverPin = -1;

    // lighting and atmosphere
    Lighting                    m_light;                    // what is on screen
    Lighting                    m_from, m_to;               // the running time-lapse
    float                       m_transT = 1.0f, m_transDuration = 1.0f, m_transHours = 0.0f;
    bool                        m_lightSnap = true;         // next update jumps to the target (new scene)
    dm::float3                  m_sunDir = dm::float3(0, 1, 0);
    int                         m_dayOfYear = 207;          // the model's date (26 July)
    float                       m_latitude = 53.479f, m_longitude = -2.245f, m_utcOffset = 1.0f;   // Manchester, BST
    double                      m_cloudsTime = 0.0;
    bool                        m_atmosphereCut = true;
    std::optional<dm::float3>   m_atmospherePrevCamera;     // camera position at the previous atmosphere pass
    int                         m_adaptFrames = 0;          // frames the auto exposure snaps instead of easing (scene start)
    uint32_t                    m_atmosphereDebug = 0;      // F7 cycles the atmosphere's developer views
    std::unique_ptr<ManchesterAtmosphere> m_atmosphere;

    // liquid glass
    GlassFrame                  m_glass;            // last frame's shapes, drawn by the UI layer
    GlassFrame                  m_glassBuild;       // being collected while the UI is built
    std::unordered_map<std::string, Spring> m_springs;
    std::unordered_map<std::string, float> m_anims;         // hover highlights (Hover)
    std::string                 m_tip, m_tipShown;          // tooltip asked for this frame, and the one on screen
    ImVec2                      m_tipAnchor = ImVec2(0, 0);
    bool                        m_tipAbove = false;
    float                       m_tipTime = 0.0f, m_tipAlpha = 0.0f;
};
