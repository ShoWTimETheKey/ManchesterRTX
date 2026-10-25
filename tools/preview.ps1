# Start the engine in app mode (if it is not running), then capture the given viewpoints to captures\<Prefix>-<n>.png.
#   tools\preview.ps1 -Prefix oq -Views 1,2,3 [-Restart] [-LoadWait 25] [-Settle 6000]
param([string]$Prefix = 'pv', [string]$Views = '1', [switch]$Restart, [int]$LoadWait = 25, [int]$Settle = 6000, [string]$Extra = '')
$root = Split-Path -Parent $PSScriptRoot
$bin = "$root\renderer\bin"
if ($Restart) { Get-Process Rtxpt -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Seconds 1 }
if (-not (Get-Process Rtxpt -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath "$bin\Rtxpt.exe" -ArgumentList '--app' -WorkingDirectory $bin | Out-Null
    for ($i = 0; $i -lt 60; $i++) { Start-Sleep -Seconds 1; if (Get-Process | Where-Object { $_.MainWindowTitle -eq 'Manchester RTX' }) { break } }
    Start-Sleep -Seconds $LoadWait
}
foreach ($v in ($Views -split ',')) {
    $keys = "D$v"; if ($Extra) { $keys = "$Extra,$keys" }
    & powershell -ExecutionPolicy Bypass -File "$PSScriptRoot\snap-window.ps1" -Out "$root\captures\$Prefix-$v.png" -Keys $keys -Wait $Settle
    $Extra = ''
}
