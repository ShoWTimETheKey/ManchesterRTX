# Rasterise an inscription into a 1-bit mask the exporter turns into raised letters (exporter\data\<Name>.json):
# each row is a list of [start, length] runs of ink, top row first.
#   tools\lettering.ps1 -Text "UNIVERSITY OF MANCHESTER" -Name uom-lettering [-Font "Baskerville Old Face"] [-Cap 72] [-Tracking 0.12]
param([string]$Text = 'UNIVERSITY OF MANCHESTER', [string]$Name = 'uom-lettering', [string]$Font = 'Baskerville Old Face', [int]$Cap = 72, [double]$Tracking = 0.12)
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$em = [int]($Cap * 1.45)
$f = New-Object Drawing.Font($Font, $em, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$fmt = [Drawing.StringFormat]::GenericTypographic
$probe = New-Object Drawing.Bitmap 8, 8; $pg = [Drawing.Graphics]::FromImage($probe)
# lay the letters out one by one so they can be tracked out like carved capitals
$widths = @(); foreach ($ch in $Text.ToCharArray()) { $widths += $(if ($ch -eq ' ') { 0.62 * $Cap } else { $pg.MeasureString([string]$ch, $f, 10000, $fmt).Width }) }   # typographic spaces measure 0
$pg.Dispose(); $probe.Dispose()
$track = $Tracking * $Cap
$W = [int](($widths | Measure-Object -Sum).Sum + $track * $Text.Length + $Cap); $H = [int]($em * 1.6)
$bmp = New-Object Drawing.Bitmap $W, $H
$g = [Drawing.Graphics]::FromImage($bmp); $g.Clear([Drawing.Color]::Black); $g.TextRenderingHint = 'AntiAliasGridFit'
$x = [double]($Cap / 2); $i = 0
foreach ($ch in $Text.ToCharArray()) { $g.DrawString([string]$ch, $f, [Drawing.Brushes]::White, [float]$x, [float]($em * 0.2), $fmt); $x += $widths[$i] + $track; $i++ }
$g.Dispose()
# tight bounds, then runs of ink (threshold at half coverage)
$x0 = $W; $x1 = -1; $y0 = $H; $y1 = -1
for ($y = 0; $y -lt $H; $y++) { for ($xx = 0; $xx -lt $W; $xx++) { if ($bmp.GetPixel($xx, $y).R -ge 128) { if ($xx -lt $x0) { $x0 = $xx }; if ($xx -gt $x1) { $x1 = $xx }; if ($y -lt $y0) { $y0 = $y }; if ($y -gt $y1) { $y1 = $y } } } }
$rows = @()
for ($y = $y0; $y -le $y1; $y++) {
    $runs = @(); $s = -1
    for ($xx = $x0; $xx -le $x1 + 1; $xx++) {
        $on = ($xx -le $x1) -and ($bmp.GetPixel($xx, $y).R -ge 128)
        if ($on -and $s -lt 0) { $s = $xx } elseif (-not $on -and $s -ge 0) { $runs += , @(($s - $x0), ($xx - $s)); $s = -1 }
    }
    $rows += , $runs
}
$bmp.Dispose()
$out = [ordered]@{ text = $Text; font = $Font; width = $x1 - $x0 + 1; height = $y1 - $y0 + 1; rows = $rows }
New-Item -ItemType Directory -Force "$root\exporter\data" | Out-Null
($out | ConvertTo-Json -Depth 6 -Compress) | Set-Content -Encoding ascii "$root\exporter\data\$Name.json"
"$Name.json: $($out.width) x $($out.height) px"
