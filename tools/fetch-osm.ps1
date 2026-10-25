# Download a fresh OpenStreetMap extract for the exporter from the Overpass API (data\osm\query.overpassql), into
# data\osm\manchester-osm.json. The repository already carries the extract the model was made from; landmark generators
# refer to OSM ids, so a fresh extract may need small fixes in exporter\city2\landmarks.mjs.
#   tools\fetch-osm.ps1 [-Endpoint https://overpass-api.de/api/interpreter]
param([string]$Endpoint = 'https://overpass-api.de/api/interpreter')
$root = Split-Path -Parent $PSScriptRoot
$query = Join-Path $root 'data\osm\query.overpassql'
$out = Join-Path $root 'data\osm\manchester-osm.json'
$tmp = "$out.download"
Write-Host "Querying $Endpoint (this can take a few minutes)..."
& curl.exe --fail --silent --show-error --max-time 900 --data-urlencode "data@$query" -o $tmp $Endpoint
if ($LASTEXITCODE -ne 0) { Remove-Item $tmp -ErrorAction SilentlyContinue; throw "Overpass request failed ($LASTEXITCODE)" }
Move-Item $tmp $out -Force
"{0}: {1:F1} MB" -f $out, ((Get-Item $out).Length / 1MB)
