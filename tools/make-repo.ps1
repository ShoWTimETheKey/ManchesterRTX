# Assemble the public repository in dist\repo from this working copy: the sources, the docs, the OSM extract, the
# Manchester module (from renderer\Rtxpt\Manchester), patches against RTXPT and Donut (regenerated from renderer\'s git),
# and the app data with its public text (exporter\data\personal.json is never used). Refuses to finish if anything
# personal is found in the result. dist\repo keeps its own .git, so running this again stages the next commit.
#   tools\make-repo.ps1 [-Owner github-login]       (-Owner fills in the repository links)
param([string]$Owner = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'dist\repo'
$vs = $null
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) { $vs = & $vswhere -latest -products * -property installationPath }
$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $git) { $git = "$vs\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\Git\cmd\git.exe" }
$env:PATH = (Join-Path $root 'tools\git-lfs') + ';' + $env:PATH     # RTXPT's Assets submodule needs git-lfs for status
$node = Join-Path $root 'tools\node\node.exe'

# start from an empty tree (keeping the repository's history)
New-Item -ItemType Directory -Force $out | Out-Null
Get-ChildItem $out -Force | Where-Object { $_.Name -ne '.git' } | Remove-Item -Recurse -Force

function Put([string]$rel, [string]$dest = $rel) {
    $src = Join-Path $root $rel; $dst = Join-Path $out $dest
    New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
    Copy-Item $src $dst -Recurse -Force
}
# top level, docs and data
foreach ($f in 'README.md', 'README.zh-CN.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'setup.ps1', '.gitignore', '.gitattributes') { Put $f }
Put 'docs'
foreach ($f in 'manchester-osm.json', 'query.overpassql', 'README.md') { Put "data\osm\$f" }
# the city generator (the current pipeline only)
foreach ($f in 'export2.mjs', 'gui-text.mjs', 'app-text.mjs', 'textures.mjs') { Put "exporter\$f" }
Get-ChildItem (Join-Path $root 'exporter\city2') -Filter *.mjs | ForEach-Object { Put "exporter\city2\$($_.Name)" }
Put 'exporter\data\uom-lettering.json'
# launcher and tools
foreach ($f in 'ManchesterRTX.cpp', 'ManchesterRTX.rc', 'ManchesterRTX.manifest', 'ManchesterRTX.ico', 'icon-256.png', 'splash.png', 'splash-en.png', 'build.ps1') { Put "launcher\$f" }
Get-ChildItem (Join-Path $root 'tools') -File | Where-Object { $_.Extension -in '.ps1', '.mjs' } | ForEach-Object { Put "tools\$($_.Name)" }
# the Manchester module and the app data (public text)
Put 'renderer\Rtxpt\Manchester' 'rtxpt\Manchester'
New-Item -ItemType Directory -Force (Join-Path $out 'rtxpt\assets'), (Join-Path $out 'rtxpt\patches') | Out-Null
Get-ChildItem (Join-Path $root 'renderer\Assets') -Filter 'manchester*.scene.json' | ForEach-Object { Copy-Item $_.FullName (Join-Path $out "rtxpt\assets\$($_.Name)") }
& $node (Join-Path $root 'exporter\app-text.mjs') --public --out (Join-Path $out 'rtxpt\assets\manchester.app.json') | Out-Null
# patches: the tracked changes in RTXPT and Donut, in repository form (LF), written by git itself (piping them through
# PowerShell would re-encode them with the console's code page)
$patchRtxpt = Join-Path $out 'rtxpt\patches\rtxpt.patch'; $patchDonut = Join-Path $out 'rtxpt\patches\donut.patch'
& $git -C (Join-Path $root 'renderer') diff HEAD --ignore-submodules=all --no-color "--output=$patchRtxpt"
& $git -C (Join-Path $root 'renderer\External\Donut') diff HEAD --no-color "--output=$patchDonut"
if (-not (Test-Path $patchRtxpt) -or -not (Test-Path $patchDonut)) { throw 'patches not written' }

# repository links
if ($Owner) {
    Get-ChildItem $out -Recurse -File -Include *.md, *.ps1, LICENSE | ForEach-Object {
        $t = [IO.File]::ReadAllText($_.FullName)
        $n = $t.Replace('github.com/ShoWTimETheKey/', "github.com/$Owner/").Replace('Copyright (c) 2026 ShoWTimETheKey', "Copyright (c) 2026 $Owner")
        if ($n -ne $t) {
            $bom = [IO.File]::ReadAllBytes($_.FullName)[0] -eq 0xEF
            [IO.File]::WriteAllText($_.FullName, $n, (New-Object Text.UTF8Encoding $bom))
        }
    }
}

# nothing personal may leave this machine: every text in exporter\data\personal.json (and each part of an address, split at the middle dots) is
# looked for in the result. The OSM extract is left out - it is public map data with the address of every building
$personalFile = Join-Path $root 'exporter\data\personal.json'
if (Test-Path $personalFile) {
    $terms = New-Object System.Collections.Generic.List[string]
    $collect = { param($v) if ($v -is [string]) { $terms.Add($v); $v -split [string][char]0x00B7 | ForEach-Object { $terms.Add($_.Trim()) } }
                 elseif ($v -is [array]) { $v | ForEach-Object { & $collect $_ } }
                 elseif ($v) { $v.PSObject.Properties | ForEach-Object { & $collect $_.Value } } }
    & $collect ([IO.File]::ReadAllText($personalFile, [Text.Encoding]::UTF8) | ConvertFrom-Json)
    $public = (& $node -e "import('./exporter/gui-text.mjs').then(m => console.log(JSON.stringify(m.guiText({ personal: false }))))" | Out-String)
    $terms = $terms | Where-Object { $_.Length -ge 4 -or $_ -match '[^\x00-\x7F]' } | Where-Object { -not $public.Contains($_) } | Sort-Object -Unique
    $hits = Get-ChildItem $out -Recurse -File | Where-Object { $_.FullName -notmatch '\\\.git\\|\\data\\osm\\' -and $_.Extension -notin '.png', '.jpg', '.ico' } |
        Select-String -SimpleMatch -Pattern $terms
    if ($hits) { $hits | ForEach-Object { Write-Warning "$($_.Path):$($_.LineNumber)" }; throw 'personal text found in dist\repo' }
    "privacy check: $($terms.Count) personal terms, none found"
}

$files = Get-ChildItem $out -Recurse -File | Where-Object { $_.FullName -notmatch '\\\.git\\' }
"{0} files, {1:F1} MB in {2}" -f $files.Count, (($files | Measure-Object Length -Sum).Sum / 1MB), $out
