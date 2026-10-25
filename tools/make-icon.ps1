# Draw the ManchesterRTX icon (sandstone skyline on a graphite tile, NVIDIA-green bar) and pack it as a multi-size .ico
#   tools\make-icon.ps1   -> renderer\Rtxpt\Manchester\ManchesterRTX.ico, launcher\ManchesterRTX.ico, launcher\icon-256.png
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot

function Draw-Icon([int]$n) {
    $bmp = New-Object Drawing.Bitmap $n, $n, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'; $g.Clear([Drawing.Color]::Transparent)
    $k = $n / 256.0
    # rounded tile
    $r = 58 * $k; $pad = 8 * $k; $w = $n - 2 * $pad
    $path = New-Object Drawing.Drawing2D.GraphicsPath
    $path.AddArc($pad, $pad, 2 * $r, 2 * $r, 180, 90); $path.AddArc($pad + $w - 2 * $r, $pad, 2 * $r, 2 * $r, 270, 90)
    $path.AddArc($pad + $w - 2 * $r, $pad + $w - 2 * $r, 2 * $r, 2 * $r, 0, 90); $path.AddArc($pad, $pad + $w - 2 * $r, 2 * $r, 2 * $r, 90, 90); $path.CloseFigure()
    $bg = New-Object Drawing.Drawing2D.LinearGradientBrush ([Drawing.PointF]::new(0, $pad)), ([Drawing.PointF]::new(0, $pad + $w)), ([Drawing.Color]::FromArgb(255, 34, 42, 58)), ([Drawing.Color]::FromArgb(255, 12, 15, 21))
    $g.FillPath($bg, $path)
    # a warm glow behind the towers
    $glow = New-Object Drawing.Drawing2D.GraphicsPath
    $glow.AddEllipse(40 * $k, 70 * $k, 176 * $k, 150 * $k)
    $pg = New-Object Drawing.Drawing2D.PathGradientBrush $glow
    $pg.CenterColor = [Drawing.Color]::FromArgb(70, 236, 182, 84); $pg.SurroundColors = @([Drawing.Color]::FromArgb(0, 236, 182, 84))
    $g.SetClip($path); $g.FillPath($pg, $glow); $g.ResetClip()
    # skyline: blocky towers standing on a common ground line
    $base = 192 * $k
    $towers = @(@(46, 128, 26), @(76, 96, 30), @(110, 54, 36), @(150, 84, 30), @(184, 116, 26))   # x, top, width
    foreach ($t in $towers) {
        $x = $t[0] * $k; $top = $t[1] * $k; $tw = $t[2] * $k
        $tb = New-Object Drawing.Drawing2D.LinearGradientBrush ([Drawing.PointF]::new(0, $top)), ([Drawing.PointF]::new(0, $base)), ([Drawing.Color]::FromArgb(255, 246, 206, 128)), ([Drawing.Color]::FromArgb(255, 214, 146, 56))
        $g.FillRectangle($tb, [float]$x, [float]$top, [float]$tw, [float]($base - $top))
        if ($n -ge 64) {   # window rows on the larger sizes
            $wb = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(150, 40, 30, 18))
            for ($y = $top + 10 * $k; $y -lt $base - 8 * $k; $y += 12 * $k) {
                for ($xx = $x + 5 * $k; $xx -lt $x + $tw - 6 * $k; $xx += 8 * $k) { $g.FillRectangle($wb, [float]$xx, [float]$y, [float](4 * $k), [float](5 * $k)) }
            }
        }
    }
    # NVIDIA-green bar under the skyline
    $green = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(255, 118, 185, 0))
    $g.FillRectangle($green, [float](46 * $k), [float](204 * $k), [float](164 * $k), [float]([math]::Max(2, 10 * $k)))
    $g.Dispose()
    return $bmp
}

$sizes = 256, 128, 64, 48, 40, 32, 24, 20, 16
$pngs = @()
foreach ($n in $sizes) {
    $bmp = Draw-Icon $n
    $ms = New-Object IO.MemoryStream
    $bmp.Save($ms, [Drawing.Imaging.ImageFormat]::Png)
    if ($n -eq 256) { New-Item -ItemType Directory -Force "$root\launcher" | Out-Null; $bmp.Save("$root\launcher\icon-256.png") }
    $bmp.Dispose()
    $pngs += , $ms.ToArray()
}
$out = New-Object IO.MemoryStream
$bw = New-Object IO.BinaryWriter $out
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $n = $sizes[$i]; $b = if ($n -ge 256) { 0 } else { $n }
    $bw.Write([byte]$b); $bw.Write([byte]$b); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]$pngs[$i].Length); $bw.Write([uint32]$offset)
    $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $bw.Write($p) }
$bw.Flush()
foreach ($dest in "$root\renderer\Rtxpt\Manchester\ManchesterRTX.ico", "$root\launcher\ManchesterRTX.ico") { [IO.File]::WriteAllBytes($dest, $out.ToArray()) }
"icon: $($sizes.Count) sizes, $($out.Length) bytes"
