// Debug: zoomed plan of OSM buildings and parts around a point → PNG, with a list of what is drawn.
//   node test-zoom.mjs <x> <z> <half-size m> <out.png> [m-per-px]
import { loadOSM } from './osm.mjs';
import { fillRings, strokePolyline } from './geo.mjs';
import { writePNG } from '../textures.mjs';
const [cx, cz, hs] = process.argv.slice(2, 5).map(Number), out = process.argv[5], mpp = +(process.argv[6] || .25);
const F = loadOSM(new URL('../../downloads/osm/manchester-osm.json', import.meta.url));
const N = Math.round(2 * hs / mpp), px = new Uint8Array(N * N * 3).fill(235), X0 = cx - hs, Z0 = cz - hs;
const plot = (rings, col, line) => {
  if (!line) fillRings(rings, X0, Z0, mpp, N, N, (i, k) => px.set(col, (k * N + i) * 3));
  else for (const r of rings) strokePolyline([...r, r[0]], line, X0, Z0, mpp, N, N, (i, k) => px.set(col, (k * N + i) * 3));
};
for (const r of F.roads) if (/footway|path|pedestrian|cycleway/.test(r.tags.highway)) strokePolyline(r.pts, .8, X0, Z0, mpp, N, N, (i, k) => px.set([200, 196, 186], (k * N + i) * 3));
  else strokePolyline(r.pts, 3, X0, Z0, mpp, N, N, (i, k) => px.set([150, 150, 155], (k * N + i) * 3));
for (const l of F.land) if (/grass|park|garden/.test(l.kind)) plot([...l.outers], [170, 205, 140]);
const inBox = f => f.bb[2] > X0 && f.bb[0] < X0 + 2 * hs && f.bb[3] > Z0 && f.bb[1] < Z0 + 2 * hs;
const list = [];
for (const b of F.buildings) if (inBox(b)) {
  const h = parseFloat(b.tags.height) || (parseFloat(b.tags['building:levels']) || 3) * 3.5;
  const v = Math.min(1, h / 60); plot([...b.outers, ...b.inners], [Math.round(240 - 120 * v), Math.round(200 - 100 * v), Math.round(150 + 60 * v)]);
  plot(b.outers, [60, 40, 30], .25);
  list.push(`B ${b.kind}/${b.id} c=${b.c.map(v => v.toFixed(0))} ${b.tags.name || ''} ${b.tags.building} h=${b.tags.height || ''} lv=${b.tags['building:levels'] || ''} roof=${b.tags['roof:shape'] || ''} parts=${b.parts.length}`);
}
for (const p of F.parts) if (inBox(p)) {
  plot(p.outers, [30, 60, 200], .15);
  list.push(`  P ${p.id} c=${p.c.map(v => v.toFixed(0))} parent=${p.parent ? p.parent.id : '-'} h=${p.tags.height || ''} min=${p.tags.min_height || ''} lv=${p.tags['building:levels'] || ''} minlv=${p.tags['building:min_level'] || ''} roof=${p.tags['roof:shape'] || ''} rh=${p.tags['roof:height'] || ''} ${p.tags.name || ''}`);
}
// 10 m grid ticks
for (let x = Math.ceil(X0 / 10) * 10; x < X0 + 2 * hs; x += 10) for (let k = 0; k < N; k += 4) { const i = Math.round((x - X0) / mpp); px.set(x % 50 === 0 ? [255, 0, 0] : [255, 150, 150], (k * N + i) * 3); }
for (let z = Math.ceil(Z0 / 10) * 10; z < Z0 + 2 * hs; z += 10) for (let i = 0; i < N; i += 4) { const k = Math.round((z - Z0) / mpp); px.set(z % 50 === 0 ? [255, 0, 0] : [255, 150, 150], (k * N + i) * 3); }
writePNG(out, N, N, px, 3);
console.log(`origin ${X0},${Z0}  ${mpp} m/px  red lines every 50 m (x=${Math.ceil(X0 / 50) * 50}.., z=${Math.ceil(Z0 / 50) * 50}..)`);
console.log(list.join('\n'));
