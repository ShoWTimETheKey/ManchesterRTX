// Sanity check of the OSM loader: counts, extents, tag distributions that drive the generator.
import { loadOSM } from './osm.mjs';
const t0 = performance.now();
const F = loadOSM(new URL('../../downloads/osm/manchester-osm.json', import.meta.url));
console.log('load', ((performance.now() - t0) / 1000).toFixed(1), 's');
for (const [k, v] of Object.entries(F)) console.log(k, v.length);
const tally = (list, f, n = 30) => { const t = {}; for (const e of list) { const v = f(e); if (v != null) t[v] = (t[v] || 0) + 1; } return Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => `${k}:${c}`).join(' '); };
let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
for (const b of F.buildings) { x0 = Math.min(x0, b.bb[0]); z0 = Math.min(z0, b.bb[1]); x1 = Math.max(x1, b.bb[2]); z1 = Math.max(z1, b.bb[3]); }
console.log('building extent', x0.toFixed(0), z0.toFixed(0), x1.toFixed(0), z1.toFixed(0));
console.log('building types:', tally(F.buildings, b => b.tags.building));
console.log('with parts:', F.buildings.filter(b => b.parts.length).length, 'orphan parts:', F.parts.filter(p => !p.parent).length);
console.log('roof shapes (parts):', tally(F.parts, p => p.tags['roof:shape']));
console.log('min_height parts:', F.parts.filter(p => p.tags.min_height || p.tags['building:min_level']).length);
console.log('rail bridge:', tally(F.rails, r => `${r.tags.railway}/${r.tags.bridge || '-'}/${r.tags.layer || '-'}/${r.tags.tunnel || '-'}/${r.tags.embankment || '-'}`));
console.log('road classes:', tally(F.roads, r => r.tags.highway, 40));
console.log('road bridges:', tally(F.roads.filter(r => r.tags.bridge), r => `${r.tags.highway}/${r.tags.bridge}/${r.tags.layer || '-'}`));
console.log('road tunnels:', tally(F.roads.filter(r => r.tags.tunnel), r => `${r.tags.highway}/${r.tags.tunnel}/${r.tags.layer || '-'}`));
console.log('lanes:', tally(F.roads, r => r.tags.lanes), 'width tagged', F.roads.filter(r => r.tags.width).length);
console.log('sidewalk tags:', tally(F.roads, r => r.tags.sidewalk));
console.log('land kinds:', tally(F.land, l => l.kind, 40));
console.log('water:', tally(F.water, w => w.tags.water || w.tags.natural || w.tags.waterway));
console.log('waterways:', tally(F.waterways, w => `${w.tags.waterway}/${w.tags.tunnel || '-'}/${w.tags.name || ''}`, 40));
console.log('area highways:', tally(F.areasHighway, a => a.tags['area:highway'] || a.tags.highway));
console.log('surfaces:', tally(F.roads, r => r.tags.surface));
console.log('materials:', tally(F.buildings, b => b.tags['building:material']));
console.log('colours:', tally(F.buildings, b => b.tags['building:colour']));
const names = ['Manchester Museum', 'Deansgate Square', 'Holy Name', 'Royal Northern', 'Contact', 'Aquatics', 'Ellen Wilkinson', 'Samuel Alexander', 'Oxford Road', 'Deansgate', 'Victoria', 'Urbis', 'Royal Exchange', 'Printworks', 'Hilton', 'Axis', 'Owen Street', 'Crown', 'Three Towers', 'Spinningfields', 'Hallé', 'Home', 'First Street', 'Mancunian Way'];
const all = [...F.buildings, ...F.parts];
for (const n of names) {
  const hits = all.filter(b => b.tags.name && b.tags.name.includes(n)).slice(0, 6);
  for (const b of hits) console.log(`  [${n}] ${b.kind}/${b.id}`, JSON.stringify(b.tags.name), b.tags.building || b.tags['building:part'], 'h=' + (b.tags.height || ''), 'lv=' + (b.tags['building:levels'] || ''), 'c=' + b.c.map(v => v.toFixed(0)), 'parts=' + (b.parts ? b.parts.length : '-'));
}
