// Elevated infrastructure: Manchester's brick railway viaducts (with arches, girder spans over streets and water, and
// some arches filled in with shops and workshops), the Metrolink viaducts, and the elevated Mancunian Way on concrete
// columns. Heights are solved over the OSM line graph: bridge/viaduct ways sit at a deck height by layer, and connected
// ground ways ramp down to street level at a gradient, so embankments and approach ramps join the viaducts.
import { hash } from './geo.mjs';
import { Grid, GHOST, meshGrid } from './vox.mjs';
import { CS, GC, GDEF, isElevatedWay } from './ground.mjs';

const VS = 0.6;
const RAILS = new Set(['rail', 'light_rail', 'narrow_gauge']);
const ROADS = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);
const deckH = (t, fam) => { const l = Math.max(1, parseInt(t.layer) || 1); return fam === 'road' ? 8.4 : l >= 2 ? 12.6 : 8.4; };

// per-vertex heights: elevated ways fixed, the rest of the family ramps down from them
function solveHeights(ways, fam, grade) {
  const key = p => `${p[0]},${p[1]}`, nodes = new Map();
  const node = p => { const k = key(p); let n = nodes.get(k); if (!n) nodes.set(k, n = { p, h: 0, fixed: false, adj: [] }); return n; };
  for (const w of ways) {
    w.nodes = w.pts.map(node);
    for (let i = 1; i < w.nodes.length; i++) { const a = w.nodes[i - 1], b = w.nodes[i], L = Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]); a.adj.push([b, L, w]); b.adj.push([a, L, w]); }
    if (w.elevated) for (const n of w.nodes) { n.h = Math.max(n.h, w.deck); n.fixed = true; }
  }
  // Dijkstra-like relaxation: h(v) = max over fixed u of H(u) - grade * dist(u, v); only through ways that are not tunnels
  const queue = [...nodes.values()].filter(n => n.fixed).sort((a, b) => b.h - a.h);
  while (queue.length) {
    let bi = 0; for (let i = 1; i < queue.length; i++) if (queue[i].h > queue[bi].h) bi = i;
    const n = queue.splice(bi, 1)[0];
    for (const [m, L, w] of n.adj) {
      if (w.tunnel) continue;
      const h = n.h - grade * L;
      if (h > m.h + 1e-3 && !m.fixed) { m.h = h; queue.push(m); }
    }
  }
  for (const w of ways) w.hv = w.nodes.map(n => n.h);
}

// annotate the OSM rail and trunk-road ways with per-vertex heights (w.hv); runs before the ground is painted
export function prepareInfra(F) {
  const rails = F.rails.filter(r => RAILS.has(r.tags.railway));
  for (const r of rails) Object.assign(r, { fam: 'rail', elevated: isElevatedWay(r.tags) || (parseInt(r.tags.layer) || 0) >= 1,
    tunnel: !!(r.tags.tunnel && r.tags.tunnel !== 'no') || (parseInt(r.tags.layer) || 0) < 0, deck: deckH(r.tags, 'rail') });
  const roads = F.roads.filter(r => ROADS.has(r.tags.highway));
  for (const r of roads) Object.assign(r, { fam: 'road', elevated: isElevatedWay(r.tags),
    tunnel: !!(r.tags.tunnel && r.tags.tunnel !== 'no') || (parseInt(r.tags.layer) || 0) < 0 || r.tags.cutting === 'yes', deck: 8.4 });
  solveHeights(rails.filter(r => r.tags.railway !== 'light_rail'), 'rail', .025);
  solveHeights(rails.filter(r => r.tags.railway === 'light_rail'), 'rail', .05);
  solveHeights(roads, 'road', .05);
  F.infra = { rails, roads };
}

export function buildInfra(F, G, store, log = () => {}) {
  const { nx, nz, X0, Z0 } = G;
  const { rails, roads } = F.infra;
  // raster of deck heights (two levels where lines cross), the along-track coordinate and the distance from the centre line
  const N = nx * nz, hLo = new Float32Array(N), hHi = new Float32Array(N), sAl = new Float32Array(N), dC = new Float32Array(N).fill(99), fam = new Uint8Array(N);
  const halfOf = w => w.fam === 'rail' ? 2.4 : Math.max(4.2, (parseInt(w.tags.lanes) || 2) * 1.75 + .8);
  let cells = 0;
  for (const w of [...rails, ...roads]) {
    if (w.tunnel || !w.hv || Math.max(...w.hv) < .6) continue;
    const half = w.fam === 'rail' ? 2.4 : halfOf(w), F_ = w.fam === 'rail' ? 1 : 2;
    for (let s = 0; s + 1 < w.pts.length; s++) {
      const [ax, az] = w.pts[s], [bx, bz] = w.pts[s + 1], ha = w.hv[s], hb = w.hv[s + 1];
      if (Math.max(ha, hb) < .6) continue;
      let dx = bx - ax, dz = bz - az; const L = Math.hypot(dx, dz); if (L < 1e-3) continue;
      const ux = dx / L, uz = dz / L, sg = (ux > 0 || (ux === 0 && uz > 0)) ? 1 : -1;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - half - X0) / CS)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + half - X0) / CS));
      const k0 = Math.max(0, Math.floor((Math.min(az, bz) - half - Z0) / CS)), k1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz) + half - Z0) / CS));
      for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
        const px = X0 + (i + .5) * CS, pz = Z0 + (k + .5) * CS;
        let t = ((px - ax) * ux + (pz - az) * uz) / L; const tc = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - (ax + tc * dx), ez = pz - (az + tc * dz), d = Math.hypot(ex, ez);
        if (d > half) continue;
        const h = ha + (hb - ha) * tc; if (h < .6) continue;
        const c = k * nx + i;
        if (!hLo[c]) { hLo[c] = h; cells++; }
        else if (Math.abs(h - hLo[c]) < 2.5) hLo[c] = Math.max(hLo[c], h);
        else if (h > hLo[c]) hHi[c] = Math.max(hHi[c], h);
        else { hHi[c] = Math.max(hHi[c], hLo[c]); hLo[c] = h; }
        if (d < dC[c]) { dC[c] = d; sAl[c] = sg * (px * ux + pz * uz); fam[c] = F_; }
      }
    }
  }
  log(`  viaduct cells ${cells}`);
  // voxelise in world-aligned tiles with a ghost ring from the neighbouring tiles so seams are not meshed
  const TILE = 160; let quads = 0;
  const groundOpen = c => { const g = G.cls[c]; return g === GC.road || g === GC.roadR || g === GC.sett || g === GC.water || g === GC.canal || g === GC.river || g === GC.ballast; };
  for (let tk = 0; tk < nz; tk += TILE) for (let ti = 0; ti < nx; ti += TILE) {
    let any = false, maxH = 0;
    for (let k = tk; k < Math.min(nz, tk + TILE) && !any; k++) for (let i = ti; i < Math.min(nx, ti + TILE); i++) if (hLo[k * nx + i]) { any = true; break; }
    if (!any) continue;
    for (let k = Math.max(0, tk - 1); k < Math.min(nz, tk + TILE + 1); k++) for (let i = Math.max(0, ti - 1); i < Math.min(nx, ti + TILE + 1); i++) { const c = k * nx + i; maxH = Math.max(maxH, hLo[c], hHi[c]); }
    const gx = ti - 1, gz = tk - 1, W = TILE + 2, ny = Math.ceil(maxH / VS) + 4;
    const g = new Grid(W, ny, W);
    const M = { brick: g.m('brickD'), brickB: g.m('brickB'), coping: g.m('trim'), ballast: g.m('ballast'), girder: g.m('metalD'), conc: g.m('conc'), concD: g.m('concD'),
      road: g.m('road'), rail: g.m('metal'), shop: g.m('shop'), door: g.m('door'), win: g.m('win'), winLit: g.m('winLit') };
    for (let lk = 0; lk < W; lk++) for (let li = 0; li < W; li++) {
      const i = gx + li, k = gz + lk; if (i < 0 || k < 0 || i >= nx || k >= nz) continue;
      const c = k * nx + i; if (!hLo[c]) continue;
      const ghost = li === 0 || lk === 0 || li === W - 1 || lk === W - 1;
      for (const h of hHi[c] ? [hLo[c], hHi[c]] : [hLo[c]]) column(g, li, lk, c, i, k, h, h === hHi[c] && hHi[c] > 0, ghost, M);
    }
    quads += meshGrid(g, store, store.key(X0 + (ti + TILE / 2) * CS, Z0 + (tk + TILE / 2) * CS), { cx: X0 + gx * CS, cz: Z0 + gz * CS, oy: 0, cos: 1, sin: 0, x0: 0, z0: 0, vs: VS, skipBottom: true });
  }
  function column(g, li, lk, c, i, k, h, upper, ghost, M) {
    const top = Math.round(h / VS), isRail = fam[c] === 1, thick = isRail ? 2 : 3, deckBot = top - thick;
    const set = (y, v) => { if (y >= 0 && y < g.ny) { const id = (y * g.nz + lk) * g.nx + li; g.data[id] = ghost ? (v ? GHOST : 0) : v; } };
    // is this cell on the edge of the deck?
    let edge = false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + dx, kk = k + dz; if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) { edge = true; continue; }
      const o = kk * nx + ii, ho = Math.abs(hLo[o] - h) < 2.5 ? hLo[o] : Math.abs(hHi[o] - h) < 2.5 ? hHi[o] : 0; if (!ho || Math.abs(ho - h) > 1.2) edge = true; }
    const span = groundOpen(c) && !upper ? 'open' : upper ? 'open' : null;
    // deck
    for (let y = Math.max(0, deckBot); y < top; y++) set(y, isRail ? (y === top - 1 ? M.ballast : span ? M.girder : M.brick) : (y === top - 1 ? M.road : span ? M.concD : M.conc));
    if (edge) { if (isRail) { set(top, M.brick); set(top + 1, M.coping); } else { set(top, M.conc); set(top + 1, M.rail); } }
    if (deckBot <= 0) return;
    // supports
    if (span) {   // girder span: deeper beam along the edges
      if (edge) set(deckBot - 1, isRail ? M.girder : M.concD);
      return;
    }
    const s = sAl[c];
    if (isRail) {
      if (h < 3.6) { for (let y = 0; y < deckBot; y++) set(y, M.brick); return; }   // embankment wall
      const SPAN = 10.2, PIER = 2.4, p = ((s % SPAN) + SPAN) % SPAN;
      const archId = Math.floor(s / SPAN), half = (SPAN - PIER) / 2;
      if (p < PIER) { for (let y = 0; y < deckBot; y++) set(y, y < 2 ? M.brickB : M.brick); return; }
      const u = (p - PIER - half) / half, crown = deckBot * VS - .6, rise = Math.min(half, crown - 2.4);
      const open = crown - rise + rise * Math.sqrt(Math.max(0, 1 - u * u));   // top of the opening (m)
      for (let y = 0; y < deckBot; y++) if ((y + .5) * VS > open) set(y, M.brick);
      // arches filled in with shopfronts, workshops or brick on the outer faces
      if (edge) {
        const f = hash(archId, Math.round(c / 7919), 3), oy = Math.floor(open / VS);
        if (f < .22) { for (let y = 0; y < oy; y++) set(y, y < oy - 1 && Math.abs(u) < .8 ? M.shop : M.brick); }
        else if (f < .38) { for (let y = 0; y < oy; y++) set(y, Math.abs(u) < .3 && y < 4 ? M.door : (y === 5 || y === 6) && Math.abs(u) > .35 && Math.abs(u) < .75 ? (hash(archId, 9) < .4 ? M.winLit : M.win) : M.brick); }
      }
    } else {
      if (h < 2.4) { for (let y = 0; y < deckBot; y++) set(y, M.concD); return; }
      const p = ((s % 24) + 24) % 24;
      if (p < 1.8 && dC[c] < 1.5) for (let y = 0; y < deckBot; y++) set(y, M.concD);   // column under the carriageway
      else if (p < 2.4 && dC[c] < 2.4) set(deckBot - 1, M.concD);                        // crosshead
    }
  }
  log(`  viaducts ${quads.toLocaleString('en-US')} quads`);
  return { rails, roads, hLo, hHi, deckAt: (x, z) => { const c = G.cell(x, z); return c < 0 ? 0 : hLo[c]; } };
}
