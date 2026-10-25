# Render a screenshot with RTXPT from one of the scene's named cameras and exit.
#   tools\capture.ps1 -Scene manchester-day -Camera 2 -Name townhall
# Cameras (see exporter/export.mjs VIEWS): 0 overview, 1 homes, 2 town hall, 3 Deansgate, 4 Castlefield, 5 Oxford Road street level
param([string]$Scene='manchester-day',[int]$Camera=0,[string]$Name='',[int]$Width=1920,[int]$Height=1080,[string[]]$Extra=@())
$root=Split-Path -Parent $PSScriptRoot
$assets="$root\renderer\Assets"
if(-not $Name){ $Name="cam$Camera" }
if(-not (Test-Path "$assets\$Scene.scene.json")){ throw "scene not found: $assets\$Scene.scene.json" }
$json=Get-Content "$assets\$Scene.scene.json" -Raw | ConvertFrom-Json
($json.graph | Where-Object { $_.type -eq 'SampleSettings' }).startingCamera=$Camera
$tmp="_capture.scene.json"
[System.IO.File]::WriteAllText("$assets\$tmp",($json | ConvertTo-Json -Depth 20),(New-Object System.Text.UTF8Encoding($false)))
$out="$root\captures\$Scene-$Name.png"
$a=@('--scene',$tmp,'--nonInteractive','--captureSimple','--capturePath',$out,'--width',$Width,'--height',$Height)+$Extra
Push-Location "$root\renderer\bin"
$p=Start-Process -FilePath .\Rtxpt.exe -ArgumentList $a -PassThru
if(-not $p.WaitForExit(600000)){ $p.Kill(); Write-Output "timeout" }
Pop-Location
Remove-Item "$assets\$tmp" -ErrorAction SilentlyContinue
Write-Output "$out exit=$($p.ExitCode)"
