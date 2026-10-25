# Capture a window (GUI included) to PNG with PrintWindow(PW_RENDERFULLCONTENT), even when it is behind other windows,
# and optionally send it keys or clicks first. Used to check the app-mode GUI without touching the desktop.
#   tools\snap-window.ps1 -Out captures\gui.png [-Keys F1,H,D1] [-Click "1920,2000;400,300"] [-Title "Manchester RTX"]
#   (with powershell -File, lists arrive as one string: keys are split on commas, clicks on semicolons)
param([string]$Out, [string[]]$Keys = @(), [string[]]$Click = @(), [string]$Title = 'Manchester RTX', [int]$Wait = 1200, [string]$Move = '')   # -Move "x,y": hover only (tooltips)
$Keys = @($Keys | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$Click = @($Click | ForEach-Object { $_ -split ';' } | Where-Object { $_ })
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class SnapNative {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint type);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
[void][SnapNative]::SetProcessDPIAware()   # physical pixels, not the 175% virtualised client size
$proc = Get-Process | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1
if ($null -eq $proc) { throw "window '$Title' not found" }
$h = $proc.MainWindowHandle
$vk = @{ F1 = 0x70; F2 = 0x71; F7 = 0x76; F8 = 0x77; F9 = 0x78; F10 = 0x79; F11 = 0x7A; F12 = 0x7B; H = 0x48; P = 0x50; T = 0x54; R = 0x52; ESC = 0x1B; ENTER = 0x0D; D1 = 0x31; D2 = 0x32; D3 = 0x33; D4 = 0x34; D5 = 0x35; D6 = 0x36; D7 = 0x37; D8 = 0x38 }
foreach ($k in $Keys) {
    $code = $vk[$k]; $scan = [SnapNative]::MapVirtualKey($code, 0)
    [void][SnapNative]::PostMessage($h, 0x0100, [IntPtr]$code, [IntPtr](1 -bor ($scan -shl 16)))                 # WM_KEYDOWN
    Start-Sleep -Milliseconds 60
    [void][SnapNative]::PostMessage($h, 0x0101, [IntPtr]$code, [IntPtr](1 -bor ($scan -shl 16) -bor (3 -shl 30)))  # WM_KEYUP
    Start-Sleep -Milliseconds 300
}
foreach ($c in $Click) {
    $xy = $c.Split(','); $l = [IntPtr](([int]$xy[1] -shl 16) -bor ([int]$xy[0] -band 0xFFFF))
    [void][SnapNative]::PostMessage($h, 0x0200, [IntPtr]0, $l); Start-Sleep -Milliseconds 250    # WM_MOUSEMOVE
    [void][SnapNative]::PostMessage($h, 0x0201, [IntPtr]1, $l); Start-Sleep -Milliseconds 80     # WM_LBUTTONDOWN
    [void][SnapNative]::PostMessage($h, 0x0202, [IntPtr]0, $l); Start-Sleep -Milliseconds 300    # WM_LBUTTONUP
}
if ($Move) {
    $xy = $Move.Split(','); $l = [IntPtr](([int]$xy[1] -shl 16) -bor ([int]$xy[0] -band 0xFFFF))
    for ($i = 0; $i -lt 3; $i++) { [void][SnapNative]::PostMessage($h, 0x0200, [IntPtr]0, $l); Start-Sleep -Milliseconds 120 }
}
Start-Sleep -Milliseconds $Wait
$r = New-Object SnapNative+RECT; [void][SnapNative]::GetClientRect($h, [ref]$r)
$bmp = New-Object Drawing.Bitmap ($r.Right - $r.Left), ($r.Bottom - $r.Top)
$g = [Drawing.Graphics]::FromImage($bmp); $hdc = $g.GetHdc()
[void][SnapNative]::PrintWindow($h, $hdc, 3)   # PW_CLIENTONLY | PW_RENDERFULLCONTENT
$g.ReleaseHdc($hdc); $g.Dispose()
$bmp.Save($Out, [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
"$Out $($r.Right)x$($r.Bottom)"
