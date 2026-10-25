# Per-frame mean brightness of one region in a recording (tools\rec-run.ps1), and how much it jumps from frame to frame:
#   tools\rec-region.ps1 -Dir captures\rec-base -Region "1700,1590,90,70"
# "jitter" is the mean |F(n+1) - 2F(n) + F(n-1)| of the region's mean: a steady drift scores 0, flicker does not.
param([string]$Dir, [string]$Region, [int]$From = 0, [int]$Count = 48)
$root = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.Drawing
$r = $Region.Split(',') | ForEach-Object { [int]$_ }
$means = @()
for ($i = $From; $i -lt $From + $Count; $i++) {
    $f = Join-Path (Join-Path $root $Dir) ("rec-{0:D2}.bmp" -f $i)
    if (-not (Test-Path $f)) { break }
    $b = New-Object Drawing.Bitmap $f
    $sum = 0.0
    for ($y = $r[1]; $y -lt $r[1] + $r[3]; $y += 2) { for ($x = $r[0]; $x -lt $r[0] + $r[2]; $x += 2) { $c = $b.GetPixel($x, $y); $sum += 0.2126 * $c.R + 0.7152 * $c.G + 0.0722 * $c.B } }
    $b.Dispose()
    $means += $sum / ([math]::Ceiling($r[2] / 2) * [math]::Ceiling($r[3] / 2))
}
$j = 0.0; for ($i = 1; $i -lt $means.Count - 1; $i++) { $j += [math]::Abs($means[$i + 1] - 2 * $means[$i] + $means[$i - 1]) }
"means: " + (($means | ForEach-Object { '{0:F1}' -f $_ }) -join ' ')
"jitter: {0:F2}" -f ($j / [math]::Max($means.Count - 2, 1))
