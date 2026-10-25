// ManchesterRTX.exe - the double-click entry point.
// Shows a splash while the path tracer (renderer\bin\Rtxpt.exe --app) loads the city, then fades out once the engine signals
// that its first frames are on screen. A second launch brings the running window to the front instead of starting another engine.
// Build: launcher\build.ps1

#ifndef UNICODE
#define UNICODE
#define _UNICODE
#endif
#define NOMINMAX
#include <windows.h>
#include <shlwapi.h>
#include <objidl.h>
#include <gdiplus.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>

namespace
{
    const wchar_t* const kEngineTitle = L"Manchester RTX";
    const wchar_t* const kReadyEvent  = L"Local\\ManchesterRTX.Ready";
    const wchar_t* const kWindowClass = L"ManchesterRTXSplash";
    constexpr int        kSplashResource = 101, kSplashResourceEn = 102;     // the splash with its text in Chinese / English
    constexpr UINT_PTR   kTimer = 1;

    // the GUI's language, as the engine keeps it in renderer\bin\ManchesterRTX.ini (language=zh|en|auto; auto follows
    // Windows' display language), so the splash speaks the same language as the app it opens
    bool g_english = false;
    const wchar_t* L(const wchar_t* zh, const wchar_t* en) { return g_english ? en : zh; }
    bool ReadEnglish(const std::wstring& ini)
    {
        wchar_t value[16] = {};
        if (HANDLE f = CreateFileW(ini.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, 0, nullptr); f != INVALID_HANDLE_VALUE)
        {
            char buf[2048] = {};
            DWORD read = 0;
            ReadFile(f, buf, sizeof(buf) - 1, &read, nullptr);
            CloseHandle(f);
            if (const char* p = strstr(buf, "\nlanguage=")) MultiByteToWideChar(CP_UTF8, 0, p + 10, 2, value, 15);
        }
        if (wcsncmp(value, L"en", 2) == 0) return true;
        if (wcsncmp(value, L"zh", 2) == 0) return false;
        return PRIMARYLANGID(GetUserDefaultUILanguage()) != LANG_CHINESE;
    }

    struct State
    {
        HWND                hwnd = nullptr;
        int                 x = 0, y = 0, w = 0, h = 0;
        Gdiplus::Bitmap*    image = nullptr;        // splash scaled to the window
        HDC                 dc = nullptr;
        HBITMAP             dib = nullptr;
        void*               bits = nullptr;
        Gdiplus::Bitmap*    canvas = nullptr;       // premultiplied ARGB view of the DIB
        PROCESS_INFORMATION engine = {};
        HANDLE              ready = nullptr;
        DWORD               start = 0, engineShown = 0, fadeStart = 0;
        bool                fadingOut = false;
    } g;

    std::wstring ExeDir()
    {
        wchar_t buf[MAX_PATH];
        GetModuleFileNameW(nullptr, buf, MAX_PATH);
        std::wstring p(buf);
        return p.substr(0, p.find_last_of(L"\\/"));
    }

    Gdiplus::Bitmap* LoadPng(int id)
    {
        HRSRC res = FindResourceW(nullptr, MAKEINTRESOURCEW(id), RT_RCDATA);
        if (!res) return nullptr;
        const void* data = LockResource(LoadResource(nullptr, res));
        IStream* stream = SHCreateMemStream(static_cast<const BYTE*>(data), SizeofResource(nullptr, res));
        if (!stream) return nullptr;
        Gdiplus::Bitmap* bmp = Gdiplus::Bitmap::FromStream(stream);
        stream->Release();
        return bmp;
    }

    HWND FindEngineWindow(DWORD pid)
    {
        struct Search { DWORD pid; HWND found; } s = { pid, nullptr };
        EnumWindows([](HWND h, LPARAM p) -> BOOL
        {
            auto* s = reinterpret_cast<Search*>(p);
            DWORD owner = 0;
            GetWindowThreadProcessId(h, &owner);
            wchar_t title[64] = {};
            GetWindowTextW(h, title, 64);
            if ((s->pid == 0 || owner == s->pid) && IsWindowVisible(h) && wcscmp(title, kEngineTitle) == 0) { s->found = h; return FALSE; }
            return TRUE;
        }, reinterpret_cast<LPARAM>(&s));
        return s.found;
    }

    void RoundedRect(Gdiplus::GraphicsPath& path, float x, float y, float w, float h, float r)
    {
        path.AddArc(x, y, 2 * r, 2 * r, 180, 90);
        path.AddArc(x + w - 2 * r, y, 2 * r, 2 * r, 270, 90);
        path.AddArc(x + w - 2 * r, y + h - 2 * r, 2 * r, 2 * r, 0, 90);
        path.AddArc(x, y + h - 2 * r, 2 * r, 2 * r, 90, 90);
        path.CloseFigure();
    }

    const wchar_t* StatusText(DWORD ms)
    {
        if (g.engineShown && ms > 25000) return L(L"首次启动需要编译着色器，请稍候…", L"The first start compiles shaders, please wait…");
        if (g.engineShown)               return L(L"正在构建光线追踪加速结构，准备第一帧…", L"Building the ray tracing acceleration structures…");
        if (ms > 2500)                   return L(L"正在载入城市模型、材质与天空…", L"Loading the city model, materials and sky…");
        return L(L"正在启动 NVIDIA RTX 路径追踪引擎…", L"Starting the NVIDIA RTX path tracer…");
    }

    void Present(BYTE alpha)
    {
        using namespace Gdiplus;
        const float k = g.w / 1600.0f;
        const DWORD ms = GetTickCount() - g.start;
        Graphics gr(g.canvas);
        gr.SetSmoothingMode(SmoothingModeAntiAlias);
        gr.SetTextRenderingHint(TextRenderingHintAntiAlias);
        gr.Clear(Color(0, 0, 0, 0));

        GraphicsPath shape;
        RoundedRect(shape, 0.5f, 0.5f, g.w - 1.0f, g.h - 1.0f, 22 * k);
        gr.SetClip(&shape);
        if (g.image) gr.DrawImage(g.image, 0, 0, g.w, g.h);

        // status line and a soft progress shimmer along the bottom edge
        FontFamily family(g_english ? L"Segoe UI" : L"Microsoft YaHei");
        Font font(&family, 21 * k, FontStyleRegular, UnitPixel);
        SolidBrush text(Color(220, 236, 240, 246));
        gr.DrawString(StatusText(ms), -1, &font, PointF(90 * k, 812 * k), &text);
        const float barY = g.h - 5 * k, barH = 5 * k;
        SolidBrush track(Color(40, 255, 255, 255));
        gr.FillRectangle(&track, 0.0f, barY, float(g.w), barH);
        const float t = fmodf(ms / 1000.0f * 0.42f, 1.35f) - 0.35f;
        const float segX = t * g.w, segW = 0.35f * g.w;
        LinearGradientBrush shimmer(PointF(segX - 1, 0), PointF(segX + segW + 1, 0), Color(0, 236, 182, 84), Color(0, 236, 182, 84));
        Color stops[] = { Color(0, 236, 182, 84), Color(255, 236, 182, 84), Color(0, 236, 182, 84) };
        REAL pos[] = { 0.0f, 0.5f, 1.0f };
        shimmer.SetInterpolationColors(stops, pos, 3);
        gr.FillRectangle(&shimmer, segX, barY, segW, barH);
        gr.ResetClip();
        Pen edge(Color(40, 255, 255, 255), 1.0f);
        gr.DrawPath(&edge, &shape);
        gr.Flush(FlushIntentionSync);

        POINT dst = { g.x, g.y }, src = { 0, 0 };
        SIZE size = { g.w, g.h };
        BLENDFUNCTION blend = { AC_SRC_OVER, 0, alpha, AC_SRC_ALPHA };
        HDC screen = GetDC(nullptr);
        UpdateLayeredWindow(g.hwnd, screen, &dst, &size, g.dc, &src, 0, &blend, ULW_ALPHA);
        ReleaseDC(nullptr, screen);
    }

    void Fail(const wchar_t* message)
    {
        if (g.hwnd) ShowWindow(g.hwnd, SW_HIDE);
        MessageBoxW(nullptr, message, L"Manchester RTX", MB_ICONERROR | MB_OK);
        PostQuitMessage(1);
    }

    void Tick()
    {
        const DWORD now = GetTickCount(), ms = now - g.start;
        if (g.fadingOut)
        {
            const float f = std::clamp((now - g.fadeStart) / 380.0f, 0.0f, 1.0f);
            Present(BYTE(255 * (1.0f - f)));
            if (f >= 1.0f)
            {
                if (HWND engine = FindEngineWindow(g.engine.dwProcessId)) SetForegroundWindow(engine);
                DestroyWindow(g.hwnd);
            }
            return;
        }
        Present(BYTE(255 * std::clamp(ms / 280.0f, 0.0f, 1.0f)));

        DWORD exitCode = STILL_ACTIVE;
        if (GetExitCodeProcess(g.engine.hProcess, &exitCode) && exitCode != STILL_ACTIVE)
        {
            wchar_t msg[512];
            swprintf_s(msg, L(L"渲染引擎在启动时退出了（代码 0x%08X）。\n\n请确认显卡支持 DirectX 12 光线追踪，并已安装最新的 NVIDIA 驱动。\n日志位置：renderer\\bin",
                              L"The renderer quit while starting (code 0x%08X).\n\nPlease check that the GPU supports DirectX 12 ray tracing and that the latest NVIDIA driver is installed.\nLogs: renderer\\bin"), exitCode);
            KillTimer(g.hwnd, kTimer);
            Fail(msg);
            return;
        }
        if (!g.engineShown && FindEngineWindow(g.engine.dwProcessId)) g.engineShown = now;
        const bool signalled = g.ready && WaitForSingleObject(g.ready, 0) == WAIT_OBJECT_0;
        const bool fallback = g.engineShown && now - g.engineShown > 120000;   // an engine build without the ready signal
        if (signalled || fallback)
        {
            // hand the engine the focus at once (frame generation starts with it) while the splash fades over its curtain
            if (HWND engine = FindEngineWindow(g.engine.dwProcessId)) SetForegroundWindow(engine);
            g.fadingOut = true; g.fadeStart = now;
        }
    }

    LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
    {
        switch (msg)
        {
        case WM_TIMER:   Tick(); return 0;
        case WM_DESTROY: PostQuitMessage(0); return 0;
        case WM_NCHITTEST: return HTCAPTION;    // the splash can be dragged aside
        }
        return DefWindowProcW(hwnd, msg, wp, lp);
    }
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int)
{
    // already running: bring it forward
    if (HWND running = FindEngineWindow(0))
    {
        ShowWindow(running, SW_RESTORE);
        SetForegroundWindow(running);
        return 0;
    }
    HANDLE single = CreateMutexW(nullptr, TRUE, L"Local\\ManchesterRTX.Launcher");
    if (GetLastError() == ERROR_ALREADY_EXISTS) return 0;

    const std::wstring root = ExeDir(), bin = root + L"\\renderer\\bin", engine = bin + L"\\Rtxpt.exe";
    g_english = ReadEnglish(bin + L"\\ManchesterRTX.ini");
    if (GetFileAttributesW(engine.c_str()) == INVALID_FILE_ATTRIBUTES)
    {
        MessageBoxW(nullptr, (L(L"找不到渲染引擎：\n", L"The renderer is missing:\n") + engine + L(L"\n\n请先按 README.md 编译 renderer。", L"\n\nPlease build the renderer as described in README.md.")).c_str(),
            L"Manchester RTX", MB_ICONERROR | MB_OK);
        return 1;
    }

    Gdiplus::GdiplusStartupInput gdiplusInput;
    ULONG_PTR gdiplusToken = 0;
    Gdiplus::GdiplusStartup(&gdiplusToken, &gdiplusInput, nullptr);

    // splash: 46% of the primary monitor's width, 16:9, centred
    const int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
    g.w = std::max(960, int(sw * 0.46f));
    g.h = g.w * 9 / 16;
    g.x = (sw - g.w) / 2;
    g.y = (sh - g.h) / 2;
    if (Gdiplus::Bitmap* png = LoadPng(g_english ? kSplashResourceEn : kSplashResource))
    {
        g.image = new Gdiplus::Bitmap(g.w, g.h, PixelFormat32bppPARGB);
        Gdiplus::Graphics gr(g.image);
        gr.SetInterpolationMode(Gdiplus::InterpolationModeHighQualityBicubic);
        gr.DrawImage(png, 0, 0, g.w, g.h);
        delete png;
    }
    BITMAPINFO bi = {};
    bi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bi.bmiHeader.biWidth = g.w;
    bi.bmiHeader.biHeight = -g.h;
    bi.bmiHeader.biPlanes = 1;
    bi.bmiHeader.biBitCount = 32;
    g.dc = CreateCompatibleDC(nullptr);
    g.dib = CreateDIBSection(g.dc, &bi, DIB_RGB_COLORS, &g.bits, nullptr, 0);
    SelectObject(g.dc, g.dib);
    g.canvas = new Gdiplus::Bitmap(g.w, g.h, g.w * 4, PixelFormat32bppPARGB, static_cast<BYTE*>(g.bits));

    WNDCLASSEXW wc = { sizeof(wc) };
    wc.lpfnWndProc = WndProc;
    wc.hInstance = instance;
    wc.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(1));
    wc.hIconSm = wc.hIcon;
    wc.hCursor = LoadCursorW(nullptr, IDC_APPSTARTING);
    wc.lpszClassName = kWindowClass;
    RegisterClassExW(&wc);
    g.hwnd = CreateWindowExW(WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_APPWINDOW, kWindowClass, L(L"Manchester RTX - 正在启动", L"Manchester RTX - starting"), WS_POPUP,
        g.x, g.y, g.w, g.h, nullptr, nullptr, instance, nullptr);

    // the engine sets this event once its first frames are on screen
    g.ready = CreateEventW(nullptr, TRUE, FALSE, kReadyEvent);
    g.start = GetTickCount();
    Present(0);
    ShowWindow(g.hwnd, SW_SHOWNORMAL);

    std::wstring cmd = L"\"" + engine + L"\" --app";
    STARTUPINFOW si = { sizeof(si) };
    if (!CreateProcessW(engine.c_str(), cmd.data(), nullptr, nullptr, FALSE, 0, nullptr, bin.c_str(), &si, &g.engine))
    {
        Fail(L(L"无法启动渲染引擎 renderer\\bin\\Rtxpt.exe。", L"Could not start the renderer renderer\\bin\\Rtxpt.exe."));
    }
    else
    {
        AllowSetForegroundWindow(g.engine.dwProcessId);
        SetTimer(g.hwnd, kTimer, 16, nullptr);
    }

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0) > 0)
    {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    if (g.engine.hProcess) { CloseHandle(g.engine.hProcess); CloseHandle(g.engine.hThread); }
    if (g.ready) CloseHandle(g.ready);
    delete g.canvas;
    delete g.image;
    DeleteObject(g.dib);
    DeleteDC(g.dc);
    Gdiplus::GdiplusShutdown(gdiplusToken);
    if (single) CloseHandle(single);
    return int(msg.wParam);
}
