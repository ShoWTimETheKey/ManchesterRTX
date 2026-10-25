# Package the ready-to-run Windows release: dist\ManchesterRTX-v<Version>-win64.zip with the launcher, the renderer's
# runtime files (no debug symbols, no local settings), the few RTXPT assets the app loads, the city model, the app data
# with its public text, the docs and every licence the package needs.
#   tools\make-release.ps1 [-Version 1.0.0] [-Owner github-login] [-NoZip]
param([string]$Version = '1.0.0', [string]$Owner = '', [switch]$NoZip)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root 'dist\release\ManchesterRTX'
$bin = Join-Path $root 'renderer\bin'
$assets = Join-Path $root 'renderer\Assets'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null
function Put([string]$src, [string]$rel) {
    $dst = Join-Path $stage $rel
    New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
    Copy-Item $src $dst -Recurse -Force
}

# launcher and docs
Put (Join-Path $root 'ManchesterRTX.exe') 'ManchesterRTX.exe'
foreach ($f in 'README.md', 'README.zh-CN.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md') { Put (Join-Path $root $f) $f }
Put (Join-Path $root 'docs\images') 'docs\images'

# renderer runtime: executables, DLLs, Streamline manifests, the Agility SDK and the shaders
Get-ChildItem $bin -File | Where-Object { $_.Extension -in '.exe', '.dll' -or $_.Name -like 'sl.*.json' } | ForEach-Object { Put $_.FullName "renderer\bin\$($_.Name)" }
foreach ($d in 'D3D12', 'ShaderPrecompiled', 'ShaderDynamic') { Put (Join-Path $bin $d) "renderer\bin\$d" }
# no debug symbols (they carry this machine's source paths and are not needed to run)
Get-ChildItem (Join-Path $stage 'renderer\bin') -Recurse -File -Filter *.pdb | Remove-Item
# executables name their symbol files by full path: blank out the user name in it (same length, so nothing moves)
$userDir = '\Users\' + (Split-Path $env:USERPROFILE -Leaf) + '\'
$from8 = [Text.Encoding]::ASCII.GetBytes($userDir); $to8 = [Text.Encoding]::ASCII.GetBytes('\Users\' + ('x' * ($userDir.Length - 8)) + '\')
foreach ($f in Get-ChildItem $stage -Recurse -File | Where-Object { $_.Extension -in '.exe', '.dll' }) {
    $b = [IO.File]::ReadAllBytes($f.FullName); $changed = $false
    for ($i = [Array]::IndexOf($b, $from8[0]); $i -ge 0 -and $i -le $b.Length - $from8.Length; $i = [Array]::IndexOf($b, $from8[0], $i + 1)) {
        $match = $true
        for ($k = 1; $k -lt $from8.Length; $k++) { if ($b[$i + $k] -ne $from8[$k]) { $match = $false; break } }
        if ($match) { [Array]::Copy($to8, 0, $b, $i, $to8.Length); $changed = $true }
    }
    if ($changed) { [IO.File]::WriteAllBytes($f.FullName, $b) }
}

# assets: the app scene and data (public text), the model, the physical sky's tables, the developer panel's font
Put (Join-Path $assets 'manchester.scene.json') 'renderer\Assets\manchester.scene.json'
& (Join-Path $root 'tools\node\node.exe') (Join-Path $root 'exporter\app-text.mjs') --public --out (Join-Path $stage 'renderer\Assets\manchester.app.json') | Out-Null
Put (Join-Path $assets 'Models\Manchester\manchester.glb') 'renderer\Assets\Models\Manchester\manchester.glb'
Put (Join-Path $assets 'Models\Manchester\textures') 'renderer\Assets\Models\Manchester\textures'     # baked by the exporter
foreach ($f in 'transmittance_earth.dds', 'inscatter_earth.dds', 'irradiance_earth.dds', 'clouds.dds') { Put (Join-Path $assets "StandaloneTextures\q2rtx_env\$f") "renderer\Assets\StandaloneTextures\q2rtx_env\$f" }
Put (Join-Path $assets 'StandaloneTextures\RGBANoiseMedium.png') 'renderer\Assets\StandaloneTextures\RGBANoiseMedium.png'
Put (Join-Path $assets 'Fonts\DroidSans') 'renderer\Assets\Fonts\DroidSans'
New-Item -ItemType Directory -Force (Join-Path $stage 'renderer\Assets\EnvironmentMaps') | Out-Null

# licences of what the package redistributes
$lic = @{
    'NVIDIA-RTX-SDKs-License.txt'   = 'renderer\LICENSE.txt'
    'Donut-LICENSE.txt'             = 'renderer\External\Donut\LICENSE.txt'
    'Streamline-license.txt'        = 'renderer\External\Streamline\license.txt'
    'Streamline-3rd-party-licenses.md' = 'renderer\External\Streamline\3rd-party-licenses.md'
    'NRD-LICENSE.txt'               = 'renderer\External\Nrd\LICENSE.txt'
    'OMM-LICENSE.txt'               = 'renderer\External\Omm\LICENSE.txt'
    'RTXDI-LICENSE.txt'             = 'renderer\External\Rtxdi\LICENSE.txt'
    'NVAPI-License.txt'             = 'renderer\External\NVAPI\License.txt'
    'DXC-LICENSE-LLVM.txt'          = 'renderer\External\dxc\LICENSE-LLVM.txt'
    'DXC-LICENSE-MS.txt'            = 'renderer\External\dxc\LICENSE-MS.txt'
}
foreach ($k in $lic.Keys) {
    $src = Join-Path $root $lic[$k]
    if (Test-Path $src) { Put $src "licenses\$k" } else { Write-Warning "licence not found: $($lic[$k])" }
}
Put (Join-Path $assets 'Fonts\DroidSans\Apache License.txt') 'licenses\DroidSans-Apache-License.txt'
Put (Join-Path $root 'data\osm\README.md') 'licenses\OpenStreetMap-ODbL.md'

# repository links in the docs
if ($Owner) {
    Get-ChildItem $stage -File -Include *.md, LICENSE -Recurse | ForEach-Object {
        $t = [IO.File]::ReadAllText($_.FullName)
        $n = $t.Replace('github.com/ShoWTimETheKey/', "github.com/$Owner/").Replace('Copyright (c) 2026 ShoWTimETheKey', "Copyright (c) 2026 $Owner")
        if ($n -ne $t) { [IO.File]::WriteAllText($_.FullName, $n, (New-Object Text.UTF8Encoding $false)) }
    }
}
$size = (Get-ChildItem $stage -Recurse -File | Measure-Object Length -Sum).Sum / 1GB
"staged {0:F2} GB in {1}" -f $size, $stage

# nothing from this machine's file system may be inside: look for the user profile path in every file (ASCII and UTF-16).
# Compiled shaders are the exception - their DXIL debug info names the source files, and editing them would break the
# containers' signatures
$profile8 = [Text.Encoding]::ASCII.GetBytes($env:USERPROFILE); $profile16 = [Text.Encoding]::Unicode.GetBytes($env:USERPROFILE)
$found = foreach ($f in Get-ChildItem $stage -Recurse -File | Where-Object { $_.Length -lt 200MB -and $_.FullName -notmatch '\\Shader(Precompiled|Dynamic)\\.*\.bin$' }) {
    $b = [IO.File]::ReadAllBytes($f.FullName)
    foreach ($needle in $profile8, $profile16) {
        $first = [Array]::IndexOf($b, $needle[0])
        while ($first -ge 0 -and $first -le $b.Length - $needle.Length) {
            $match = $true
            for ($i = 1; $i -lt $needle.Length; $i++) { if ($b[$first + $i] -ne $needle[$i]) { $match = $false; break } }
            if ($match) { $f.FullName; break }
            $first = [Array]::IndexOf($b, $needle[0], $first + 1)
        }
    }
}
if ($found) { $found | Sort-Object -Unique | ForEach-Object { Write-Warning "local path inside: $_" }; throw 'the package contains local paths' }
'path check: no local paths in the package'
if (-not $NoZip) {
    $zip = Join-Path $root "dist\ManchesterRTX-v$Version-win64.zip"
    if (Test-Path $zip) { Remove-Item $zip }
    & tar.exe -a -c -f $zip -C (Split-Path $stage) 'ManchesterRTX'
    if ($LASTEXITCODE) { throw 'zip failed' }
    "{0}: {1:F2} GB" -f $zip, ((Get-Item $zip).Length / 1GB)
}
