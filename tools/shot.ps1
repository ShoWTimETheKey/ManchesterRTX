# One documentation screenshot from the running app, saved as docs\images\<Name>.jpg (1920x1080):
#   tools\shot.ps1 -Name hero              the window with its GUI (PrintWindow; run the app with hdr=0 for true colours)
#   tools\shot.ps1 -Name dusk -Frame       the frame without the GUI (the app's own F12 screenshot, SDR)
# A smaller preview is written to captures\shot-preview.png for checking.
param([Parameter(Mandatory)][string]$Name, [switch]$Frame)
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root 'docs\images'
New-Item -ItemType Directory -Force $dir | Out-Null
Add-Type -AssemblyName System.Drawing
$snap = Join-Path $PSScriptRoot 'snap-window.ps1'
$tmp = Join-Path $root 'captures\shot-window.png'
if ($Frame) {
    $before = Get-Date
    & powershell -NoProfile -File $snap -Out $tmp -Keys F12 -Wait 500 | Out-Null
    $src = $null
    for ($i = 0; $i -lt 40 -and -not $src; $i++) {
        Start-Sleep -Milliseconds 250
        $src = Get-ChildItem (Join-Path $root 'captures') -Filter 'ManchesterRTX-*.png' | Where-Object { $_.LastWriteTime -ge $before } | Select-Object -First 1
    }
    if (-not $src) { throw 'the app saved no screenshot' }
    Start-Sleep -Milliseconds 800     # let the PNG finish writing
    $src = $src.FullName
} else {
    & powershell -NoProfile -File $snap -Out $tmp -Wait 200 | Out-Null
    $src = $tmp
}
$img = [Drawing.Image]::FromFile($src)
$save = {
    param($w, $h, $path, $jpg)
    $bmp = New-Object Drawing.Bitmap $w, $h
    $g = [Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($img, 0, 0, $w, $h); $g.Dispose()
    if ($jpg) {
        $codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
        $ep = New-Object Drawing.Imaging.EncoderParameters 1; $ep.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), 90L
        $bmp.Save($path, $codec, $ep)
    } else { $bmp.Save($path) }
    $bmp.Dispose()
}
& $save 1920 1080 (Join-Path $dir "$Name.jpg") $true
& $save 960 540 (Join-Path $root 'captures\shot-preview.png') $false
$img.Dispose()
"docs\images\$Name.jpg"
