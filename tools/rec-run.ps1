# Start the engine directly (no launcher) and record its opening glide with a fixed frame step, so runs with different
# settings show exactly the same camera path frame for frame:
#   tools\rec-run.ps1 -Name base [-Frames 48] [-Step 21.7] [-EngineArgs "--NEEType 1"]
# Frames land in captures\rec-<Name>\rec-NN.bmp with rec.csv.
param([string]$Name = 'run', [int]$Frames = 48, [double]$Step = 21.7, [string]$EngineArgs = '')
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root 'renderer\bin'
Get-Process Rtxpt -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 800
Get-ChildItem (Join-Path $root 'captures') -Filter 'rec-*.bmp' | Remove-Item
Remove-Item (Join-Path $root 'captures\rec.csv') -ErrorAction SilentlyContinue
$env:MRTX_RECORD_STARTUP = "$Frames"; $env:MRTX_RECORD_DT = "$Step"
$p = Start-Process -FilePath (Join-Path $bin 'Rtxpt.exe') -ArgumentList "--app $EngineArgs" -WorkingDirectory $bin -PassThru
Remove-Item Env:MRTX_RECORD_STARTUP, Env:MRTX_RECORD_DT
$t = Get-Date
while (-not (Test-Path (Join-Path $root 'captures\rec.csv')) -and ((Get-Date) - $t).TotalSeconds -lt 180) { Start-Sleep -Seconds 1 }
Start-Sleep -Seconds 2
$out = Join-Path $root "captures\rec-$Name"
New-Item -ItemType Directory -Force $out | Out-Null
Get-ChildItem (Join-Path $root 'captures') -Filter 'rec-*.bmp' | Move-Item -Destination $out -Force
Move-Item (Join-Path $root 'captures\rec.csv') $out -Force
"recorded $((Get-ChildItem $out -Filter 'rec-*.bmp').Count) frames into $out"
