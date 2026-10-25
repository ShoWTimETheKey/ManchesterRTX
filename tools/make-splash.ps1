# Compose the launcher splash (1600x900) from a path-traced capture: darkened towards the lower left, wordmark and subtitle baked in.
# The launcher draws the live status line and progress shimmer on top at runtime.
#   tools\make-splash.ps1 [-Source captures\manchester-dusk-deansgate-v8.png] [-Lang en]    (en: launcher\splash-en.png)
param([string]$Source = '', [string]$Lang = 'zh')
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
if (-not $Source) { $Source = "$root\captures\manchester-dusk-deansgate-v8.png" }
$W = 1600; $H = 900
$src = [Drawing.Image]::FromFile($Source)
$bmp = New-Object Drawing.Bitmap $W, $H
$g = [Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
# the left two thirds: keeps the Deansgate towers and leaves out the HDR map's seaside promenade on the right edge
$crop = New-Object Drawing.Rectangle 0, 60, ([int]($src.Width * 0.68)), ([int]($src.Width * 0.68 * 9 / 16))
$g.DrawImage($src, (New-Object Drawing.Rectangle 0, 0, $W, $H), $crop, [Drawing.GraphicsUnit]::Pixel); $src.Dispose()

# legibility: a soft dark wash from the bottom and from the left
$bottom = New-Object Drawing.Drawing2D.LinearGradientBrush ([Drawing.Point]::new(0, 300)), ([Drawing.Point]::new(0, $H)), ([Drawing.Color]::FromArgb(0, 8, 10, 14)), ([Drawing.Color]::FromArgb(235, 8, 10, 14))
$g.FillRectangle($bottom, 0, 300, $W, $H - 300)
$left = New-Object Drawing.Drawing2D.LinearGradientBrush ([Drawing.Point]::new(0, 0)), ([Drawing.Point]::new(1100, 0)), ([Drawing.Color]::FromArgb(150, 8, 10, 14)), ([Drawing.Color]::FromArgb(0, 8, 10, 14))
$g.FillRectangle($left, 0, 0, 1100, $H)

# wordmark, tracked out, with the green RTX badge
$white = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(255, 240, 242, 246))
$brand = New-Object Drawing.Font 'Bahnschrift', 64, ([Drawing.FontStyle]::Regular), ([Drawing.GraphicsUnit]::Pixel)
$fmt = [Drawing.StringFormat]::GenericTypographic
$x = 84.0; $y = 590.0
foreach ($ch in 'MANCHESTER'.ToCharArray()) {
    $g.DrawString([string]$ch, $brand, $white, $x, $y, $fmt)
    $x += $g.MeasureString([string]$ch, $brand, 1000, $fmt).Width + 7
}
$badgeFont = New-Object Drawing.Font 'Microsoft YaHei', 24, ([Drawing.FontStyle]::Bold), ([Drawing.GraphicsUnit]::Pixel)
$bw = $g.MeasureString('RTX', $badgeFont, 1000, $fmt).Width + 22
$path = New-Object Drawing.Drawing2D.GraphicsPath
$bx = $x + 10; $by = $y + 14; $bh = 40; $r = 9
$path.AddArc($bx, $by, 2 * $r, 2 * $r, 180, 90); $path.AddArc($bx + $bw - 2 * $r, $by, 2 * $r, 2 * $r, 270, 90)
$path.AddArc($bx + $bw - 2 * $r, $by + $bh - 2 * $r, 2 * $r, 2 * $r, 0, 90); $path.AddArc($bx, $by + $bh - 2 * $r, 2 * $r, 2 * $r, 90, 90); $path.CloseFigure()
$g.FillPath((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(255, 118, 185, 0))), $path)
$g.DrawString('RTX', $badgeFont, (New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(255, 10, 14, 6))), $bx + 11, $by + 5, $fmt)

$en = $Lang -eq 'en'
$sub = New-Object Drawing.Font ($(if ($en) { 'Segoe UI Light' } else { 'Microsoft YaHei Light' })), 30, ([Drawing.FontStyle]::Regular), ([Drawing.GraphicsUnit]::Pixel)
$g.DrawString($(if ($en) { 'A real-time path-traced model of the city' } else { '曼彻斯特  ·  实时路径追踪城市模型' }), $sub, $white, 88, 686, $fmt)
$small = New-Object Drawing.Font ($(if ($en) { 'Segoe UI' } else { 'Microsoft YaHei' })), 19, ([Drawing.FontStyle]::Regular), ([Drawing.GraphicsUnit]::Pixel)
$muted = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(200, 170, 178, 190))
$g.DrawString($(if ($en) { 'NVIDIA RTX Path Tracing 1.8.1   ·   DLSS 4  Ray Reconstruction · Super Resolution · Multi Frame Generation' }
                else { 'NVIDIA RTX Path Tracing 1.8.1   ·   DLSS 4  光线重建 · 超分辨率 · 多帧生成' }), $small, $muted, 90, 738, $fmt)
$g.Dispose()
$out = "$root\launcher\$(if ($en) { 'splash-en.png' } else { 'splash.png' })"
$bmp.Save($out, [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
"splash: $out"
