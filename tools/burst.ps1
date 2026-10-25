# Capture a burst of frames from the app window (GUI included), e.g. to watch a weather transition or the start-up:
#   tools\burst.ps1 -Prefix tr -Count 16 -Interval 250 [-Click "1931,2020"] [-Keys D4] [-Width 960]
# Frames are scaled to -Width and saved as captures\<Prefix>-NN.jpg; -Launch starts the launcher first and captures the
# whole primary screen instead (to see the splash and the engine window together).
param([string]$Prefix = 'burst', [int]$Count = 12, [int]$Interval = 250, [string[]]$Keys = @(), [string[]]$Click = @(),
      [int]$Width = 960, [string]$Title = 'Manchester RTX', [switch]$Launch, [int]$Delay = 0)
$Keys = @($Keys | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$Click = @($Click | ForEach-Object { $_ -split ';' } | Where-Object { $_ })
$root = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class BurstNative {
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint type);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
[void][BurstNative]::SetProcessDPIAware()
$codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object Drawing.Imaging.EncoderParameters 1; $ep.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), 88L
function Save-Scaled($bmp, $path) {
    $h = [int]($bmp.Height * $Width / $bmp.Width); $small = New-Object Drawing.Bitmap $Width, $h
    $g = [Drawing.Graphics]::FromImage($small); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($bmp, 0, 0, $Width, $h); $g.Dispose()
    $small.Save($path, $codec, $ep); $small.Dispose()
}
if ($Launch) {   # start through the launcher and record the engine window from the moment it appears (window content only)
    Start-Process -FilePath "$root\ManchesterRTX.exe" | Out-Null
    for ($i = 0; $i -lt 400; $i++) { Start-Sleep -Milliseconds 50; if (Get-Process | Where-Object { $_.MainWindowTitle -eq $Title }) { break } }
}
$proc = Get-Process | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1
if ($null -eq $proc) { throw "window '$Title' not found" }
$h = $proc.MainWindowHandle
$vk = @{ F1 = 0x70; F2 = 0x71; F7 = 0x76; F8 = 0x77; F9 = 0x78; F10 = 0x79; F11 = 0x7A; F12 = 0x7B; H = 0x48; P = 0x50; T = 0x54; R = 0x52; ESC = 0x1B; ENTER = 0x0D; D1 = 0x31; D2 = 0x32; D3 = 0x33; D4 = 0x34; D5 = 0x35; D6 = 0x36; D7 = 0x37; D8 = 0x38 }
foreach ($k in $Keys) {
    $code = $vk[$k]; $scan = [BurstNative]::MapVirtualKey($code, 0)
    [void][BurstNative]::PostMessage($h, 0x0100, [IntPtr]$code, [IntPtr](1 -bor ($scan -shl 16)))
    Start-Sleep -Milliseconds 60
    [void][BurstNative]::PostMessage($h, 0x0101, [IntPtr]$code, [IntPtr](1 -bor ($scan -shl 16) -bor (3 -shl 30)))
}
foreach ($c in $Click) {
    $xy = $c.Split(','); $l = [IntPtr](([int]$xy[1] -shl 16) -bor ([int]$xy[0] -band 0xFFFF))
    [void][BurstNative]::PostMessage($h, 0x0200, [IntPtr]0, $l); Start-Sleep -Milliseconds 60
    [void][BurstNative]::PostMessage($h, 0x0201, [IntPtr]1, $l); Start-Sleep -Milliseconds 40
    [void][BurstNative]::PostMessage($h, 0x0202, [IntPtr]0, $l)
}
if ($Delay) { Start-Sleep -Milliseconds $Delay }
$r = New-Object BurstNative+RECT; [void][BurstNative]::GetClientRect($h, [ref]$r)
for ($i = 0; $i -lt $Count; $i++) {
    $t0 = Get-Date
    $bmp = New-Object Drawing.Bitmap ($r.Right - $r.Left), ($r.Bottom - $r.Top)
    $g = [Drawing.Graphics]::FromImage($bmp); $hdc = $g.GetHdc()
    [void][BurstNative]::PrintWindow($h, $hdc, 3)
    $g.ReleaseHdc($hdc); $g.Dispose()
    Save-Scaled $bmp ("$root\captures\{0}-{1:D2}.jpg" -f $Prefix, $i); $bmp.Dispose()
    $left = $Interval - ((Get-Date) - $t0).TotalMilliseconds; if ($left -gt 0) { Start-Sleep -Milliseconds $left }
}
"captured $Count frames"
