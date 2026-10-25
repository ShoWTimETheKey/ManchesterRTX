// The two featured towers, at 0.3 m from their OSM footprints:
//  River Street Tower (Canvas Manchester, River Street; SimpsonHaugh): a 32-storey tower with 10- and
//    5-storey blocks; outer elevations of weathering-steel (Cor-ten) panels rusted to a patchwork of browns, pierced by
//    a regular grid of narrow, deep-set windows; the elevations over the low podium are dark blue glass and metal.
//  Acer (Square Gardens, Willmott Street): blocks around the Square Gardens courtyard stepping from 10 to 26
//    storeys towards the Mancunian Way; grey-green unitised glazing with a light frit band at every floor, recessed
//    dark joints between blocks and a dark green base.
import { fillRings, strokePolyline, rot, hash, dominantAngle, centroid } from './geo.mjs';
import { Grid, meshGrid } from './vox.mjs';
import { addMaterials } from './mat.mjs';
import { parseHeight } from './osm.mjs';

addMaterials({
  cortenA: { p: 'corten', hex: '#4f2414', t: 1.2, tex: 1024 }, cortenB: { p: 'corten', hex: '#68321b', t: 1.2 },
  cortenC: { p: 'corten', hex: '#7a4126', t: 1.2 }, cortenD: { p: 'corten', hex: '#3f1e10', t: 1.2 },
  glassNavy: { glass: 1, hex: '#1d2a45', refl: '#40507a', m: .82 }, glassNavyLit: { glass: 1, hex: '#1d2a45', refl: '#40507a', m: .82, em: 'windows', night: '#ffd49a' },
  navyMetal: { p: 'panel', hex: '#222c40', t: 1.2, metal: .7, rough: .35 },
  glassAcer: { glass: 1, hex: '#56706b', refl: '#86a39b', m: .82 }, acerLit: { glass: 1, hex: '#58726d', refl: '#86a39b', m: .82, em: 'windows', night: '#ffd49a' },
  acerFrit: { glass: 1, hex: '#98aaa5', refl: '#a8b8b3', m: .25, r: .18 }, acerMull: { p: 'plain', hex: '#7a8f8a', r: .28, m: 1 },
  sgGreen: { p: 'panel', hex: '#22382e', t: 1.2, metal: .3, rough: .45 },
});
const V = .3, FL = 10;   // voxel size, storey height in voxels (3.0 m)
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function frame(ring, items) {
  const ang = dominantAngle(ring), [cx, cz] = centroid(ring), cs = Math.cos(ang), sn = Math.sin(ang);
  const toL = (x, z) => rot(x - cx, z - cz, ang);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const r of items) for (const [x, z] of r) { const [u, v] = toL(x, z); x0 = Math.min(x0, u); x1 = Math.max(x1, u); z0 = Math.min(z0, v); z1 = Math.max(z1, v); }
  const M = 4, ix0 = Math.floor(x0 / V) - M, iz0 = Math.floor(z0 / V) - M;
  return { ang, cx, cz, cs, sn, toL, nx: Math.ceil(x1 / V) + M - ix0 + 1, nz: Math.ceil(z1 / V) + M - iz0 + 1, gx0: ix0 * V, gz0: iz0 * V };
}
function raster(fr, rings) { const m = new Uint8Array(fr.nx * fr.nz); fillRings(rings.map(r => r.map(([x, z]) => fr.toL(x, z))), fr.gx0, fr.gz0, V, fr.nx, fr.nz, (i, k) => { m[k * fr.nx + i] = 1; }); return m; }

// facade pass shared by both: fn(i, y, k, d, a, L, outsideTop) → material id or -1 to keep; recess handled by the caller
function facades(g, top, nx, nz, maxY, fn) {
  const exp = new Uint8Array(nx * nz), ops = [];
  for (let y = 0; y < maxY; y++) {
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const c = k * nx + i; exp[c] = 0; if (y >= top[c] || !g.data[(y * nz + k) * nx + i]) continue;
      let e = 0; for (let d = 0; d < 4; d++) { const ii = i + DIRS[d][0], kk = k + DIRS[d][1]; if (ii < 0 || kk < 0 || ii >= nx || kk >= nz || !g.data[(y * nz + kk) * nx + ii]) e |= 1 << d; }
      exp[c] = e;
    }
    ops.length = 0;
    for (let d = 0; d < 4; d++) {
      const along = DIRS[d][0] ? 1 : 0, lines = along ? nx : nz, len = along ? nz : nx;
      for (let line = 0; line < lines; line++) for (let s = 0; s < len;) {
        const at = q => along ? q * nx + line : line * nx + q;
        if (!(exp[at(s)] & (1 << d))) { s++; continue; }
        let e = s; while (e + 1 < len && (exp[at(e + 1)] & (1 << d))) e++;
        for (let q = s; q <= e; q++) { const i = along ? line : q, k = along ? q : line, c = k * nx + i; fn(ops, i, y, k, d, q - s, e - s + 1, (exp[c] & (DIRS[d][0] ? 12 : 3)) !== 0); }
        s = e + 1;
      }
    }
    for (const [i, yy, k, v] of ops) g.set(i, yy, k, v);
  }
}

export function buildTowers(F, byId, store, log = () => {}) {
  const pins = {}; let q = 0;
  /* ---------- River Street Tower ---------- */
  const rst = byId.get(682060630);
  if (rst) {
    const parts = rst.parts.length ? rst.parts : [rst];
    const fr = frame(rst.outers[0], parts.map(p => p.outers[0]));
    const { nx, nz } = fr, NC = nx * nz, top = new Uint16Array(NC);
    for (const p of parts) {
      const H = parseHeight(p.tags.height) ?? (parseFloat(p.tags['building:levels']) || 1) * 3 + 1.5, m = raster(fr, [p.outers[0]]);
      for (let c = 0; c < NC; c++) if (m[c]) top[c] = Math.max(top[c], Math.round(H / V));
    }
    let maxT = 0; for (let c = 0; c < NC; c++) maxT = Math.max(maxT, top[c]);
    const g = new Grid(nx, maxT + 12, nz);
    const C = ['cortenA', 'cortenB', 'cortenC', 'cortenB', 'cortenA'].map(n => g.m(n)), CD = g.m('cortenD'), NG = g.m('glassNavy'), NGL = g.m('glassNavyLit'), NM = g.m('navyMetal');
    const W = g.m('win'), WL = g.m('winLit'), WL2 = g.m('winLit2'), SH = g.m('shop'), RF = g.m('roofFlat'), PL = g.m('plant');
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const t = top[k * nx + i]; for (let y = 0; y < t; y++) g.data[(y * nz + k) * nx + i] = C[0]; if (t) g.data[((t - 1) * nz + k) * nx + i] = RF; }
    const GF = 15;   // glazed ground floor, 4.5 m
    facades(g, top, nx, nz, maxT, (ops, i, y, k, d, a, L, corner) => {
      const [dx, dz] = DIRS[d], c = k * nx + i, t = top[c];
      const recess = (v, depth = 2) => { ops.push([i, y, k, 0]); for (let s = 1; s < depth; s++) ops.push([i - dx * s, y, k - dz * s, 0]); ops.push([i - dx * depth, y, k - dz * depth, v]); };
      // inner elevations: overlooking a lower roof of the same building
      const oi = i + dx, ok = k + dz, inner = oi >= 0 && ok >= 0 && oi < nx && ok < nz && top[ok * nx + oi] > 0 && y >= top[ok * nx + oi];
      const fl = Math.floor((y - GF) / FL), r = (y - GF) % FL;
      if (y === t - 1 || y === t - 2) return ops.push([i, y, k, inner ? NM : CD]);   // coping
      if (y < GF) { if (corner || a % 8 === 0) return ops.push([i, y, k, CD]); if (y < GF - 2) return recess(hash(682060630, a >> 3, d) < .6 ? SH : W, 1); return ops.push([i, y, k, CD]); }
      if (inner) {
        if (r === 0) return ops.push([i, y, k, NM]);
        if (a % 4 === 0 || corner) return ops.push([i, y, k, NM]);
        return ops.push([i, y, k, hash(fl, a >> 2, d * 7 + 1) < .42 ? NGL : NG]);
      }
      // Cor-ten: each 1.5 m x 3 m panel weathers to its own shade; narrow deep-set windows on a regular grid
      const bay = Math.floor(a / 5), pb = a % 5;
      if (!corner && pb >= 2 && pb <= 3 && r >= 3 && r < 9 && a > 1 && a < L - 2) {
        const lit = hash(bay, fl, d * 131 + i * 3 + k) < .4;
        return recess(lit ? (hash(bay, fl) < .55 ? WL : WL2) : W, 2);
      }
      ops.push([i, y, k, C[Math.floor(hash(bay, fl, d * 13 + (d < 2 ? i : k)) * C.length)]]);
    });
    // plant on the tower roof
    let tc = 0, ti = 0, tk = 0; for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if (top[k * nx + i] === maxT) { tc++; ti += i; tk += k; }
    if (tc) { ti = Math.round(ti / tc); tk = Math.round(tk / tc); g.box(ti - 5, maxT, tk - 4, ti + 5, maxT + 6, tk + 4, CD); g.box(ti - 4, maxT + 7, tk - 3, ti + 4, maxT + 7, tk + 3, PL); }
    q += meshGrid(g, store, store.key(fr.cx, fr.cz), { cx: fr.cx, cz: fr.cz, oy: 0, cos: fr.cs, sin: fr.sn, x0: fr.gx0, z0: fr.gz0, vs: V });
    // the pin floats above the tower
    const ci = ti, ck = tk, lx = fr.gx0 + (ci + .5) * V, lz = fr.gz0 + (ck + .5) * V;
    pins.rst = [+(fr.cx + lx * fr.cs - lz * fr.sn).toFixed(2), +(maxT * V + 11).toFixed(2), +(fr.cz + lx * fr.sn + lz * fr.cs).toFixed(2)];
    rst.H = maxT * V;
    log(`  River Street Tower: ${q.toLocaleString('en-US')} quads`);
  }
  /* ---------- Acer, Square Gardens ---------- */
  const acer = byId.get(1217569813);
  if (acer) {
    const fr = frame(acer.outers[0], acer.outers), { nx, nz } = fr, NC = nx * nz;
    const m = raster(fr, [...acer.outers, ...acer.inners]), top = new Uint16Array(NC);
    // storeys step up towards the Mancunian Way (south, +z in the world)
    let zmin = Infinity, zmax = -Infinity; const wz = (i, k) => { const lx = fr.gx0 + (i + .5) * V, lz = fr.gz0 + (k + .5) * V; return fr.cz + lx * fr.sn + lz * fr.cs; };
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if (m[k * nx + i]) { const z = wz(i, k); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
    const STEPS = [10, 14, 18, 22, 26], step = c => { const i = c % nx, k = (c / nx) | 0; return Math.min(4, Math.floor((wz(i, k) - zmin) / (zmax - zmin + 1e-6) * 5)); };
    for (let c = 0; c < NC; c++) if (m[c]) top[c] = STEPS[step(c)] * FL + 4;
    let maxT = 0; for (let c = 0; c < NC; c++) maxT = Math.max(maxT, top[c]);
    const g = new Grid(nx, maxT + 10, nz);
    const GA = g.m('glassAcer'), GL = g.m('acerLit'), FR = g.m('acerFrit'), MU = g.m('acerMull'), SG = g.m('sgGreen'), JD = g.m('glassD'), SH = g.m('shop'), RF = g.m('roofFlat'), PL = g.m('metal');
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const c = k * nx + i, t = top[c]; for (let y = 0; y < t; y++) g.data[(y * nz + k) * nx + i] = FR; if (t) g.data[((t - 1) * nz + k) * nx + i] = RF; }
    const GF = 14;
    facades(g, top, nx, nz, maxT, (ops, i, y, k, d, a, L, corner) => {
      const c = k * nx + i, fl = Math.floor((y - GF) / FL), r = (y - GF) % FL;
      // a recessed dark joint where one block meets the next
      const [dx, dz] = DIRS[d], ai = d < 2 ? 0 : 1, prev = ai ? c - 1 : c - nx, next = ai ? c + 1 : c + nx;
      const joint = (top[prev] && top[prev] !== top[c]) || (top[next] && top[next] !== top[c]);
      if (y < GF) { if (y < GF - 3 && a % 6 && !corner) return ops.push([i, y, k, hash(1217569813, a >> 3, d) < .6 ? SH : JD]); return ops.push([i, y, k, SG]); }
      if (y >= top[c] - 2) return ops.push([i, y, k, MU]);
      if (joint) return ops.push([i, y, k, JD]);
      if (r === 0) return ops.push([i, y, k, FR]);
      if (a % 4 === 0 || corner) return ops.push([i, y, k, MU]);
      ops.push([i, y, k, hash(fl, a >> 2, d * 17 + step(c)) < .45 ? GL : GA]);
    });
    // a small plant enclosure on each roof level
    const seen = new Set();
    for (let k = 3; k < nz - 3; k++) for (let i = 3; i < nx - 3; i++) {
      const c = k * nx + i, t = top[c], s = step(c); if (!t || seen.has(s)) continue;
      let ok = true; for (let dk = -3; dk <= 3 && ok; dk++) for (let di = -3; di <= 3; di++) if (top[(k + dk) * nx + i + di] !== t) { ok = false; break; }
      if (ok) { seen.add(s); g.box(i - 2, t, k - 2, i + 2, t + 3, k + 2, PL); }
    }
    const n = meshGrid(g, store, store.key(fr.cx, fr.cz), { cx: fr.cx, cz: fr.cz, oy: 0, cos: fr.cs, sin: fr.sn, x0: fr.gx0, z0: fr.gz0, vs: V });
    q += n;
    // pin over the tallest block
    let bx = 0, bz = 0, bn = 0; for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if (top[k * nx + i] === maxT) { const lx = fr.gx0 + (i + .5) * V, lz = fr.gz0 + (k + .5) * V; bx += fr.cx + lx * fr.cs - lz * fr.sn; bz += fr.cz + lx * fr.sn + lz * fr.cs; bn++; }
    pins.acer = [+(bx / bn).toFixed(2), +(maxT * V + 11).toFixed(2), +(bz / bn).toFixed(2)];
    acer.H = maxT * V;
    log(`  Acer: ${n.toLocaleString('en-US')} quads`);
  }
  return { quads: q, pins };
}
