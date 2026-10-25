// Debug: top-down plan of the ground raster and building heights → PNG, plus building generation stats.
//   node test-plan.mjs [--build N]   (N: build the first N buildings to time the generator)
import { loadOSM } from './osm.mjs';
import { buildGround, GC } from './ground.mjs';
import { prepareBuildings, buildBuilding } from './buildings.mjs';
import { MeshStore } from './vox.mjs';
import { fillRings } from './geo.mjs';
import { writePNG } from '../textures.mjs';

const t0 = performance.now(), log = m => console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const F = loadOSM(new URL('../../downloads/osm/manchester-osm.json', import.meta.url));
const EXT = { X0: -1290, Z0: -1580, X1: 1290, Z1: 1580 };
const G = buildGround(F, EXT, log);
log('ground');
const B = prepareBuildings(F);
log(`buildings ${B.length}`);
const tally = {}; for (const b of B) tally[b.kind] = (tally[b.kind] || 0) + 1; console.log(tally);
// plan image at 1.2 m per pixel
const S = 2, W = Math.floor(G.nx / S), H = Math.floor(G.nz / S), px = new Uint8Array(W * H * 3);
const COL = { [GC.yard]: [150, 146, 138], [GC.road]: [70, 72, 76], [GC.pave]: [180, 176, 166], [GC.curb]: [210, 206, 196], [GC.plaza]: [205, 196, 175], [GC.sett]: [110, 106, 100],
  [GC.grass]: [110, 150, 74], [GC.garden]: [125, 162, 85], [GC.pitch]: [80, 152, 60], [GC.play]: [130, 80, 60], [GC.path]: [170, 160, 140], [GC.parking]: [90, 92, 96],
  [GC.soil]: [110, 92, 70], [GC.ballast]: [106, 99, 90], [GC.water]: [47, 95, 122], [GC.canal]: [61, 99, 93], [GC.river]: [40, 80, 110], [GC.wood]: [80, 120, 60], [GC.roadR]: [122, 62, 54] };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = COL[G.cls[(y * S) * G.nx + x * S]] || [255, 0, 255]; px.set(c, (y * W + x) * 3); }
for (const b of B) {
  const v = Math.min(1, b.H / 120), col = [230 - 150 * v, 120 + 60 * (1 - v), 90 + 140 * v].map(Math.round);
  for (const it of b.items) fillRings([...it.f.outers, ...it.f.inners], EXT.X0, EXT.Z0, 0.6 * S, W, H, (i, k) => px.set(col, (k * W + i) * 3));
}
writePNG(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'plan.png', W, H, px, 3);
log('plan.png');
const n = process.argv.includes('--build') ? +process.argv[process.argv.indexOf('--build') + 1] : 0;
if (n) {
  const store = new MeshStore();
  const ctx = { streetAt: (x, z) => G.isStreet(x, z) };
  let q = 0; const t1 = performance.now(), worst = [];
  const sel = B.slice().sort((a, b) => Math.hypot(...a.c) - Math.hypot(...b.c)).slice(0, n);
  for (const b of sel) { const s = performance.now(); const qq = buildBuilding(b, store, ctx); q += qq; worst.push([performance.now() - s, b.id, b.kind, qq, b.H.toFixed(0)]); }
  worst.sort((a, b) => b[0] - a[0]);
  log(`${sel.length} buildings: ${q} quads, ${((performance.now() - t1) / 1000).toFixed(1)} s`);
  console.log(worst.slice(0, 8).map(w => w.map(v => typeof v === 'number' ? +v.toFixed(0) : v).join(' ')).join('\n'));
  console.log(store.stats());
}
