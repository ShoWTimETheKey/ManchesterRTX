# Set up and build Manchester RTX from source:
#   1. clone NVIDIA RTX Path Tracing 1.8.1 (with its submodules and sample assets) into renderer\
#   2. apply this project's patches (rtxpt\patches) and add the Manchester module and app data
#   3. configure and build the renderer with CMake (Streamline 2.14.16 is downloaded by CMake), then the launcher
#   4. make the city model: export it from data\osm (default), or take it from the latest release
#
#   .\setup.ps1 [-Model export|release|skip] [-NoBuild]
#
# Needs Visual Studio 2022 or later with "Desktop development with C++", Git with Git LFS, and Node.js 20+ (for -Model
# export). Run it again after pulling new changes: finished steps are skipped, the module and data are refreshed.
param([ValidateSet('export', 'release', 'skip')][string]$Model = 'export', [switch]$NoBuild,
      [string]$Repo = 'https://github.com/ShoWTimETheKey/ManchesterRTX')
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$renderer = Join-Path $root 'renderer'
$rtxptUrl = 'https://github.com/NVIDIA-RTX/RTXPT.git'
$rtxptCommit = 'f08d1c739071e0faad0c7c274d861124c511abab'     # RTXPT 1.8.1, the version this project was built on

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Find-Tool($name, [string[]]$candidates) {
    $c = Get-Command $name -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    foreach ($p in $candidates) { if ($p -and (Test-Path $p)) { return $p } }
    return $null
}
$vs = $null
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) { $vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath }
$git = Find-Tool git @("$vs\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\Git\cmd\git.exe")
$cmake = Find-Tool cmake @("$vs\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe")
$node = Find-Tool node @((Join-Path $root 'tools\node\node.exe'))
if (-not $git) { throw 'Git not found. Install Git for Windows (with Git LFS).' }
if (-not $cmake) { throw 'CMake not found. Install Visual Studio 2022+ with "Desktop development with C++".' }
& $git lfs version *> $null
if ($LASTEXITCODE -ne 0) { throw 'Git LFS not found (RTXPT''s sample assets use it): https://git-lfs.com' }

# 1. RTXPT at the pinned commit, with LF line endings so the patches apply whatever core.autocrlf says
if (-not (Test-Path (Join-Path $renderer '.git'))) {
    Step "Cloning RTXPT into renderer\ (several GB with the sample assets)"
    & $git -c core.autocrlf=false clone $rtxptUrl $renderer
    if ($LASTEXITCODE) { throw 'clone failed' }
    & $git -C $renderer -c core.autocrlf=false checkout --quiet $rtxptCommit
    if ($LASTEXITCODE) { throw 'checkout failed' }
    & $git -C $renderer config core.autocrlf false
    & $git -C $renderer -c core.autocrlf=false submodule update --init --recursive
    if ($LASTEXITCODE) { throw 'submodule update failed' }
}

# 2. patches (applied once; a second run sees them in place), then the module and the app data
Step 'Applying patches'
foreach ($p in @(@{ dir = $renderer; patch = 'rtxpt.patch' }, @{ dir = (Join-Path $renderer 'External\Donut'); patch = 'donut.patch' })) {
    $file = Join-Path $root "rtxpt\patches\$($p.patch)"
    & $git -C $p.dir apply --check --reverse $file 2>$null
    if ($LASTEXITCODE -eq 0) { Write-Host "  $($p.patch): already applied"; continue }
    & $git -C $p.dir apply --whitespace=nowarn $file
    if ($LASTEXITCODE) { throw "$($p.patch) does not apply - is renderer\ at RTXPT $rtxptCommit?" }
    Write-Host "  $($p.patch): applied"
}
Step 'Adding the Manchester module and app data'
$module = Join-Path $renderer 'Rtxpt\Manchester'
New-Item -ItemType Directory -Force $module | Out-Null
Copy-Item (Join-Path $root 'rtxpt\Manchester\*') $module -Recurse -Force
Copy-Item (Join-Path $root 'rtxpt\assets\*') (Join-Path $renderer 'Assets') -Recurse -Force

# 3. build
if (-not $NoBuild) {
    Step 'Configuring the renderer'
    & $cmake -S $renderer -B (Join-Path $renderer 'build') -A x64
    if ($LASTEXITCODE) { throw 'CMake configure failed' }
    Step 'Building the renderer (first build: 10-20 minutes)'
    & $cmake --build (Join-Path $renderer 'build') --config Release --target Rtxpt
    if ($LASTEXITCODE) { throw 'renderer build failed' }
    Step 'Building the launcher'
    & (Join-Path $root 'launcher\build.ps1')
}

# 4. the city model
$glb = Join-Path $renderer 'Assets\Models\Manchester\manchester.glb'
if ($Model -eq 'export') {
    if (-not $node) { throw 'Node.js not found (or use -Model release)' }
    Step 'Exporting the city from OpenStreetMap (about a minute, 1.4 GB)'
    & $node --max-old-space-size=16000 (Join-Path $root 'exporter\export2.mjs')
    if ($LASTEXITCODE) { throw 'export failed' }
} elseif ($Model -eq 'release') {
    Step 'Downloading the model from the latest release'
    $api = $Repo -replace '^https://github.com/', 'https://api.github.com/repos/'
    $asset = (Invoke-RestMethod "$api/releases/latest").assets | Where-Object { $_.name -like '*-win64.zip' } | Select-Object -First 1
    if (-not $asset) { throw 'no release package found' }
    $zip = Join-Path $env:TEMP $asset.name
    & curl.exe -L --fail -o $zip $asset.browser_download_url
    if ($LASTEXITCODE) { throw 'download failed' }
    $tmp = Join-Path $env:TEMP 'ManchesterRTX-model'
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force $tmp | Out-Null
    & tar.exe -x -f $zip -C $tmp '*/renderer/Assets/Models/Manchester/manchester.glb'
    New-Item -ItemType Directory -Force (Split-Path $glb) | Out-Null
    Move-Item (Get-ChildItem $tmp -Recurse -Filter manchester.glb | Select-Object -First 1).FullName $glb -Force
    Remove-Item $tmp, $zip -Recurse -Force
}

Step 'Done'
if (Test-Path $glb) { Write-Host 'Start the app with ManchesterRTX.exe' -ForegroundColor Green }
else { Write-Host 'The renderer is ready; make the city model with: node --max-old-space-size=16000 exporter\export2.mjs' -ForegroundColor Yellow }
