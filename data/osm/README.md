# OpenStreetMap extract

`manchester-osm.json` is the Overpass API answer to `query.overpassql` (central Manchester plus the Etihad Stadium and
Old Trafford), saved when the model was made. `exporter/export2.mjs` builds the city from it; keeping the exact
extract keeps the model reproducible, since landmark generators refer to OSM ids.

`tools\fetch-osm.ps1` downloads a fresh copy (OpenStreetMap changes daily, so a fresh city may differ in details).

Map data © OpenStreetMap contributors, available under the Open Database Licence (ODbL) 1.0:
https://www.openstreetmap.org/copyright
