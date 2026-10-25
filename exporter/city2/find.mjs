// Find OSM elements by name or tag pattern: node find.mjs <regex> [radius-metres x z]
import fs from 'fs';
import { project } from './geo.mjs';
const osm = JSON.parse(fs.readFileSync(new URL('../../downloads/osm/manchester-osm.json', import.meta.url)));
const re = new RegExp(process.argv[2] || '.', 'i');
const [r, cx, cz] = process.argv.slice(3).map(Number);
for (const e of osm.elements) {
  const t = e.tags || {};
  const hay = Object.entries(t).map(([k, v]) => `${k}=${v}`).join(' ');
  if (!re.test(hay)) continue;
  let c = null;
  if (e.lat != null) c = project(e.lat, e.lon);
  else if (e.bounds) c = project((e.bounds.minlat + e.bounds.maxlat) / 2, (e.bounds.minlon + e.bounds.maxlon) / 2);
  if (r && c && Math.hypot(c[0] - cx, c[1] - cz) > r) continue;
  console.log(`${e.type}/${e.id}`, c ? c.map(v => v.toFixed(0)).join(',') : '', hay.slice(0, 220));
}
