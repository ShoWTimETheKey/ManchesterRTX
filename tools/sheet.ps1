# Combine screenshots into a labelled contact sheet: tools\sheet.ps1 -Out sheet.png -Files a.png,b.png,... [-Cols 2] [-W 960]
param([string]$Out,[string[]]$Files,[int]$Cols=2,[int]$W=960)
Add-Type -AssemblyName System.Drawing
$imgs=$Files | ForEach-Object { [System.Drawing.Image]::FromFile($_) }
$H=[int]($W*$imgs[0].Height/$imgs[0].Width); $rows=[math]::Ceiling($imgs.Count/$Cols)
$bmp=New-Object System.Drawing.Bitmap ($W*$Cols),($H*$rows); $g=[System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode='HighQualityBicubic'; $font=New-Object System.Drawing.Font 'Segoe UI',14,([System.Drawing.FontStyle]::Bold)
for($i=0;$i -lt $imgs.Count;$i++){ $x=($i%$Cols)*$W; $y=[math]::Floor($i/$Cols)*$H; $g.DrawImage($imgs[$i],$x,$y,$W,$H)
  $label=[System.IO.Path]::GetFileNameWithoutExtension($Files[$i]); $g.FillRectangle([System.Drawing.Brushes]::Black,$x,$y,($g.MeasureString($label,$font).Width+12),28); $g.DrawString($label,$font,[System.Drawing.Brushes]::White,($x+6),($y+3)) }
$bmp.Save($Out,[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose(); $imgs | ForEach-Object { $_.Dispose() }
Write-Output $Out
