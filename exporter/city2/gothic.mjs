// Fine-voxel (0.2 m) Gothic Revival builder for Alfred Waterhouse's buildings: the University of Manchester's Old Quad
// and Manchester Town Hall. Works from OSM footprints in the building's own frame and adds, at 20 cm resolution:
// a projecting plinth, string courses and a corbel table under the eaves, quoins, buttresses between bays, two- and
// three-light pointed windows with mullions, transoms and an oculus, recessed 40 cm behind the wall face with hood
// moulds over them, cross gables with finials rising from the facades, dormers, steep slate roofs with stone-coped
// gable ends, ridge cresting and chimney stacks, towers with belfry louvres, clock faces, crenellated parapets, corner
// pinnacles and steep spires with lucarnes, and pointed archways through the range.
import { fillRings, strokePolyline, rot, hash, dominantAngle, centroid, polygonArea, pointInPolygon } from './geo.mjs';
import { Grid, meshGrid } from './vox.mjs';
import { addMaterials } from './mat.mjs';
import { addClock } from './clocks.mjs';
import { addLettering, loadMask } from './lettering.mjs';

addMaterials({
  uomStone: { p: 'ashlar', hex: '#a59a84', t: 1.2, tex: 1024, soot: .3, joint: .012 },
  uomDark: { p: 'ashlar', hex: '#7f7562', t: 1.2, soot: .42 },
  uomTrim: { p: 'ashlar', hex: '#c2b8a2', t: 1.2, soot: .16 },
  thStone: { p: 'ashlar', hex: '#b39b75', t: 1.2, tex: 1024, soot: .3, joint: .012 },
  thDark: { p: 'ashlar', hex: '#8a7559', t: 1.2, soot: .42 },
  thTrim: { p: 'ashlar', hex: '#cdb995', t: 1.2, soot: .16 },
  slateG: { p: 'slate', hex: '#4b5552', t: .8, tex: 1024 },
  tileFish: { p: 'fishscale', hex: '#8e4433', t: 1.2, tex: 1024 },
  letterBand: { p: 'ashlar', hex: '#6f6656', t: 1.2, soot: .5 },
  leadD: { p: 'panel', hex: '#5e6468', t: 1.2, metal: .9, rough: .5 },
  clock: { p: 'plain', hex: '#efe6cf', r: .45, em: 'clocks', night: '#fff2cf' },
  hand: { p: 'plain', hex: '#1d1d1d', r: .5, m: .6 },
  gilt: { p: 'plain', hex: '#d9a93c', r: .25, m: 1 },
  leaded: { glass: 1, hex: '#262e35', refl: '#4f585f', m: .4 },
  leadedLit: { glass: 1, hex: '#283038', refl: '#4f585f', m: .4, em: 'windows', night: '#ffcd80' },
  louvre: { p: 'plain', hex: '#2a2e31', r: .55, m: .3 },
});

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/* spec: {
     id, polys: [{ outers, inners, eaves, base?, roof: 'gabled'|'hipped'|'flat', slope?, hall? }] (world, metres),
     angle?, V?, mats: { wall, dark, trim, roof }, floors: [ground, upper] (m), bay (m), lights (2|3),
     towers: [{ x, z, w, d, h, spire, clock, kind: 'spire'|'pyramid'|'parapet' , arch?: {w,h,axis} }],
     arches: [{ a:[x,z], b:[x,z], w, h }], doors: [[x,z]], gables, dormers, buttresses, chimneys, neighbours: [polygons]
   } */
export function buildGothic(spec, store) {
  const V = spec.V || .2, mats = spec.mats;
  if (!spec.polys.length && !(spec.towers || []).length) return 0;
  const main = spec.polys.length ? spec.polys.reduce((a, p) => Math.abs(polygonArea(p.outers[0])) > Math.abs(polygonArea(a.outers[0])) ? p : a) : null;
  const ang = spec.angle ?? dominantAngle(main.outers[0]), cs = Math.cos(ang), sn = Math.sin(ang);
  const [cx, cz] = main ? centroid(main.outers[0]) : [spec.towers[0].x, spec.towers[0].z];
  const toL = (x, z) => rot(x - cx, z - cz, ang);
  const polys = spec.polys.map(p => ({ ...p, lo: p.outers.map(r => r.map(([x, z]) => toL(x, z))), li: (p.inners || []).map(r => r.map(([x, z]) => toL(x, z))) }));
  const towers = (spec.towers || []).map(t => { const [lx, lz] = toL(t.x, t.z); return { ...t, lx, lz }; });
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const ext = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
  for (const p of polys) for (const r of p.lo) for (const [x, z] of r) ext(x, z);
  for (const t of towers) { ext(t.lx - t.w / 2 - 1, t.lz - t.d / 2 - 1); ext(t.lx + t.w / 2 + 1, t.lz + t.d / 2 + 1); }
  const M = 10, ix0 = Math.floor(x0 / V) - M, iz0 = Math.floor(z0 / V) - M;
  const nx = Math.ceil(x1 / V) + M - ix0 + 1, nz = Math.ceil(z1 / V) + M - iz0 + 1, NC = nx * nz;
  const gx0 = ix0 * V, gz0 = iz0 * V;
  const lc = (lx, lz) => [Math.floor((lx - gx0) / V), Math.floor((lz - gz0) / V)];
  // columns: owning poly, eaves and base (voxels), tower id
  const own = new Int16Array(NC), eav = new Int16Array(NC), bas = new Int16Array(NC), twr = new Int16Array(NC);
  polys.forEach((p, n) => {
    const e = Math.round(p.eaves / V), b = Math.round((p.base || 0) / V);
    const put = (i, k) => { const c = k * nx + i; if (!own[c] || e > eav[c]) { own[c] = n + 1; eav[c] = e; bas[c] = b; } };
    fillRings([...p.lo, ...p.li], gx0, gz0, V, nx, nz, put);
    for (const r of p.lo) strokePolyline([...r, r[0]], .12, gx0, gz0, V, nx, nz, put);
  });
  // footprints drawn by another frame of the same building are cut out (only the parts of this frame remain)
  for (const ex of spec.exclude || []) {
    const lo = ex.map(([x, z]) => toL(x, z));
    fillRings([lo], gx0, gz0, V, nx, nz, (i, k) => { const c = k * nx + i; own[c] = 0; eav[c] = 0; });
  }
  towers.forEach((t, n) => {
    const [a0, b0] = lc(t.lx - t.w / 2, t.lz - t.d / 2), [a1, b1] = lc(t.lx + t.w / 2, t.lz + t.d / 2);
    t.i0 = a0; t.k0 = b0; t.i1 = a1 - 1; t.k1 = b1 - 1; t.top = Math.round(t.h / V);
    for (let k = b0; k < b1; k++) for (let i = a0; i < a1; i++) { const c = k * nx + i; twr[c] = n + 1; if (!own[c]) { own[c] = 1; bas[c] = 0; } eav[c] = Math.max(eav[c], t.top); }
  });
  // an inscription over an archway goes on the arch face that looks towards t.lettering.toward (world [x, z]); the band
  // it stands on is kept clear of windows
  for (const t of towers) {
    const lt = t.lettering; if (!lt || !t.arch) continue;
    let best = -Infinity;
    for (const d of t.arch.axis === 'x' ? [0, 1] : [2, 3]) {
      const [dx, dz] = DIRS[d], wn = [dx * cs - dz * sn, dx * sn + dz * cs];
      const lx = (dx > 0 ? t.i1 + 1 : dx < 0 ? t.i0 : (t.i0 + t.i1 + 1) / 2) * V + gx0, lz = (dz > 0 ? t.k1 + 1 : dz < 0 ? t.k0 : (t.k0 + t.k1 + 1) / 2) * V + gz0;
      const w = [cx + lx * cs - lz * sn, cz + lx * sn + lz * cs], s = wn[0] * (lt.toward[0] - w[0]) + wn[1] * (lt.toward[1] - w[1]);
      if (s > best) { best = s; t.letterFace = d; t.letterL = (dx ? t.k1 - t.k0 + 1 : t.i1 - t.i0 + 1) * V; }
    }
    const m = loadMask(lt.mask);
    t.letterCap = Math.min(lt.cap || .42, (t.letterL - 1.6) / (m.width / m.height));
    const yc = t.arch.h + .55 + t.letterCap / 2 + .25, half = t.letterCap / 2 + .22;
    t.letterY0 = Math.floor((yc - half) / V); t.letterY1 = Math.ceil((yc + half) / V);
  }
  // party walls: cells inside (or within 0.3 m of) neighbouring buildings
  const party = new Uint8Array(NC);
  const nbs = (spec.neighbours || []).map(r => r.map(([x, z]) => toL(x, z)));
  if (nbs.length) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const c = k * nx + i; if (own[c]) continue;
    let near = false; for (let dk = -2; dk <= 2 && !near; dk++) for (let di = -2; di <= 2; di++) { const ii = i + di, kk = k + dk; if (ii >= 0 && kk >= 0 && ii < nx && kk < nz && own[kk * nx + ii]) { near = true; break; } }
    if (!near) continue;
    const px = gx0 + (i + .5) * V, pz = gz0 + (k + .5) * V;
    for (const r of nbs) if (pointInPolygon(px, pz, r) || distSeg(px, pz, r) < .3) { party[c] = 1; break; }
  }
  // grid height
  let maxY = 0;
  for (let c = 0; c < NC; c++) if (own[c]) maxY = Math.max(maxY, eav[c]);
  const roofRise = Math.max(0, ...polys.map(p => (p.slope || 1.4) * 40));
  for (const t of towers) maxY = Math.max(maxY, t.top + Math.round(((t.spire || 0) + 6) / V));
  const ny = Math.min(maxY + Math.round(Math.min(roofRise, 120)) + 40, 900);
  const g = new Grid(nx, ny, nz);
  const W = g.m(mats.wall), D = g.m(mats.dark), T = g.m(mats.trim), R = g.m(mats.roof), GL = g.m('leaded'), GLL = g.m('leadedLit');
  const LD = g.m('leadD'), DOOR = g.m('door'), CLK = g.m('clock'), HND = g.m('hand'), GILT = g.m('gilt'), LOUV = g.m('louvre'), POT = g.m('terra');
  const idx = (i, y, k) => (y * nz + k) * nx + i;
  const get = (i, y, k) => g.get(i, y, k), set = (i, y, k, v) => g.set(i, y, k, v);
  const free = (i, k) => i >= 0 && k >= 0 && i < nx && k < nz && !own[k * nx + i] && !party[k * nx + i];
  // walls
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const c = k * nx + i; if (own[c]) for (let y = bas[c]; y < eav[c]; y++) g.data[idx(i, y, k)] = W; }

  /* ---------- roofs ---------- */
  const span = new Uint8Array(NC), ridgeTop = new Int16Array(NC), LDr = g.m('leadD');
  polys.forEach((p, n) => {
    if (p.roof === 'flat') return;
    const inside = new Uint8Array(NC); for (let c = 0; c < NC; c++) if (own[c] === n + 1 && !twr[c]) inside[c] = 1;
    const Dg = p.roof === 'hipped' ? chamfer(inside, nx, nz) : gableField(inside, nx, nz, span);
    const slope = p.slope || 1.4, cap = Math.round((p.ridgeCap || (p.hall ? 11 : 9)) / V);
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const c = k * nx + i; if (!inside[c]) continue;
      if (p.roof === 'hipped') span[c] = spanAxis(inside, nx, nz, i, k);
      const raw = Math.max(1, Math.round(Dg[c] * slope)), h = Math.min(raw, cap), e = eav[c];
      for (let y = e; y < e + h && y < ny; y++) g.data[idx(i, y, k)] = R;
      if (raw > cap) g.data[idx(i, e + h - 1, k)] = LDr;   // lead flat over the widest spans
      ridgeTop[c] = e + h;
    }
  });
  // gable ends: roof voxels exposed along the ridge become coped stone
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const c = k * nx + i; if (!ridgeTop[c]) continue;
    const p = polys[own[c] - 1]; if (p.roof === 'hipped') continue;
    const [dx, dz] = span[c] === 0 ? [0, 1] : [1, 0];
    // only true end walls: the cell beyond is outside the building (not a lower roof of another range)
    const outside = (ii, kk) => !inGrid(ii, kk) || (!own[kk * nx + ii] && !party[kk * nx + ii]);
    if (!outside(i + dx, k + dz) && !outside(i - dx, k - dz)) continue;
    for (let y = eav[c]; y < ridgeTop[c]; y++) {
      const out1 = outside(i + dx, k + dz) && !get(i + dx, y, k + dz), out2 = outside(i - dx, k - dz) && !get(i - dx, y, k - dz);
      if (out1 || out2) g.data[idx(i, y, k)] = (y >= ridgeTop[c] - 2 || !get(i, y + 1, k)) ? T : W;
    }
  }
  function inGrid(i, k) { return i >= 0 && k >= 0 && i < nx && k < nz; }
  // flat roofs: lead covering and a parapet (battlements with corner pinnacles, a balustrade, or a plain coped wall)
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const c = k * nx + i; if (!own[c] || twr[c]) continue;
    const p = polys[own[c] - 1]; if (p.roof !== 'flat') continue;
    const e = eav[c]; let edges = 0;
    for (const [dx, dz] of DIRS) { const ii = i + dx, kk = k + dz; if (!inGrid(ii, kk) || ((!own[kk * nx + ii] || eav[kk * nx + ii] < e) && !party[kk * nx + ii])) edges++; }
    if (!edges) { if (e > 0) g.data[idx(i, e - 1, k)] = LDr; continue; }
    const style = p.parapet || spec.parapet || 'battlement';
    for (let y = e; y < e + 5 && y < ny; y++) {
      let v = T;
      if (style === 'battlement') v = y < e + 3 || ((i + k) >> 1) & 1 ? T : 0;
      else if (style === 'balustrade') v = y === e || y === e + 4 || ((i + k) & 1) ? T : 0;
      else if (y > e + 2) v = 0;
      if (v) g.data[idx(i, y, k)] = v;
    }
    if (edges >= 2 && style === 'battlement') { for (let y = e; y < e + 12 && y < ny; y++) g.data[idx(i, y, k)] = W; if (e + 12 < ny) g.data[idx(i, e + 12, k)] = LD; }
  }

  /* ---------- facades ---------- */
  const gF = Math.round(spec.floors[0] / V), uF = Math.round(spec.floors[1] / V), BAY = Math.round(spec.bay / V);
  const plinth = 4, lights = spec.lights || 2;
  const ops = [];
  const exp = new Uint8Array(NC);
  const glassFor = id => hash(spec.id, id, 5) < .3 ? GLL : GL;
  let maxWall = 0; for (let c = 0; c < NC; c++) if (own[c] && !twr[c]) maxWall = Math.max(maxWall, eav[c]);
  for (const t of towers) maxWall = Math.max(maxWall, t.top);
  const gableBays = [];   // collected at the top storey for the gable pass
  for (let y = 0; y < maxWall; y++) {
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const c = k * nx + i; exp[c] = 0;
      if (!own[c] || g.data[idx(i, y, k)] !== W) continue;
      let e = 0; for (let d = 0; d < 4; d++) { const ii = i + DIRS[d][0], kk = k + DIRS[d][1]; if (!inGrid(ii, kk) || !g.data[idx(ii, y, kk)]) e |= 1 << d; }
      exp[c] = e;
    }
    ops.length = 0;
    for (let d = 0; d < 4; d++) {
      const [dx, dz] = DIRS[d], along = dx ? 1 : 0, lines = along ? nx : nz, len = along ? nz : nx;
      for (let line = 0; line < lines; line++) for (let s = 0; s < len;) {
        const at = q => along ? q * nx + line : line * nx + q;
        if (!(exp[at(s)] & (1 << d))) { s++; continue; }
        let e = s; while (e + 1 < len && (exp[at(e + 1)] & (1 << d))) e++;
        for (let q = s; q <= e; q++) facade(along ? line : q, y, along ? q : line, d, q - s, e - s + 1, line, s);
        s = e + 1;
      }
    }
    for (const [i, yy, k, v] of ops) set(i, yy, k, v);
  }
  function facade(i, y, k, d, a, L, line, runStart) {
    const [dx, dz] = DIRS[d], c = k * nx + i, oi = i + dx, ok = k + dz;
    const isParty = inGrid(oi, ok) && party[ok * nx + oi];
    if (isParty) return;
    const corner = (exp[c] & (dx ? 12 : 3)) !== 0;
    // the plain band an inscription stands on (over an archway)
    if (!corner) for (const t2 of towers)
      if (t2.letterFace === d && y >= t2.letterY0 - 2 && y <= t2.letterY1 + 2 && i >= t2.i0 - 3 && i <= t2.i1 + 3 && k >= t2.k0 - 3 && k <= t2.k1 + 3) { ops.push([i, y, k, W]); return; }
    const e = eav[c], tw = twr[c] ? towers[twr[c] - 1] : null;
    const out = v => { if (free(oi, ok) && !get(oi, y, ok)) ops.push([oi, y, ok, v]); };
    const put = v => ops.push([i, y, k, v]);
    const recess = (depth, v, frame) => {   // carve 'depth' voxels back and place v behind (frame: the voxels in between)
      for (let s = 0; s < depth; s++) if (!solidBehind(i - dx * (s + 1), y, k - dz * (s + 1))) { put(v); return; }
      ops.push([i, y, k, frame ?? 0]); for (let s = 1; s < depth; s++) ops.push([i - dx * s, y, k - dz * s, 0]); ops.push([i - dx * depth, y, k - dz * depth, v]);
    };
    // quoins at corners
    if (corner || a === 0 || a === L - 1) { if (y < plinth) put(D); else if (((y >> 1) & 1) && y < e - 2) put(T); return; }
    if ((a === 1 || a === L - 2) && ((y >> 1) & 1) === 0 && y >= plinth && y < e - 2) { put(T); return; }
    // plinth, string courses, corbel table under the eaves
    if (y < plinth) { put(D); if (y < plinth - 1) out(D); return; }
    if (y === plinth) { put(T); return; }
    if (y === e - 1) { put(T); out(T); if (spec.cornice) { const i2 = oi + dx, k2 = ok + dz; if (free(oi, ok) && free(i2, k2)) ops.push([i2, y, k2, T]); } return; }
    if (y === e - 2) { put(T); if (a % 3 === 0 || spec.cornice) out(T); return; }
    const floorLine = y === gF || (y > gF && (y - gF) % uF === 0 && y < e - uF / 2);
    if (floorLine && !tw) { put(T); out(T); return; }
    // towers have their own treatment
    if (tw) { towerFace(tw, i, y, k, d, a, L, put, out, recess); return; }
    const p = polys[own[c] - 1], hall = p.hall;
    // bays
    const B = hall ? Math.round(BAY * 1.4) : BAY, nb = Math.max(1, Math.floor((L - 4) / B)), off = Math.floor((L - nb * B) / 2), la = a - off;
    if (la < 0 || la >= nb * B) return;
    const bi = Math.floor(la / B), pb = la % B, mid = B / 2;
    // buttresses at bay boundaries
    if (spec.buttresses !== false && (pb <= 1 || pb >= B - 1) && L > B * 2) {
      const top = e - 3, step = Math.round(plinth + (top - plinth) * .55);
      const out2 = v => { const i2 = oi + dx, k2 = ok + dz; if (free(oi, ok) && free(i2, k2) && !get(i2, y, k2)) ops.push([i2, y, k2, v]); };
      if (y < top) out(y === step || y === top - 1 ? T : W);
      if (y < step) out2(y === step - 1 ? T : W);
      return;
    }
    // door?
    if (spec.doorsAt && y < gF - 2) for (const dd of spec.doorsAt) if (dd.d === d && dd.line === line && Math.abs(a - dd.a) <= 4) {
      const u = (a - dd.a) / 4.5, top = 16 + Math.round(2 * (1 - Math.abs(u)));
      if (y < top) { if (Math.abs(u) <= .8) recess(3, DOOR); else put(T); return; }
      if (y === top || y === top + 1) { put(T); out(T); return; }
    }
    // windows
    const fl = y < gF ? 0 : Math.floor((y - gF) / uF) + 1, f0 = fl === 0 ? 0 : gF + (fl - 1) * uF, fh = fl === 0 ? gF : uF;
    const r = y - f0;
    let sill, H;
    if (hall) { sill = 6; H = Math.min(e - 8, 46) - sill; }
    else { sill = fl === 0 ? 5 : 3; H = fh - sill - 4; }
    if (fl > 0 && f0 + fh > e - 2) H = Math.min(H, e - 3 - f0 - sill);
    const nL = hall ? 3 : lights, lw = spec.lw || 4, ww = nL * lw + (nL - 1), w0 = Math.round(mid - ww / 2), wa = pb - w0;
    const wid = (spec.id * 31 + d * 7 + line * 131 + bi * 17 + fl * 1009) | 0;
    if (H < 6 || wa < -1 || wa > ww) return;
    // hood mould above, label stops
    if (r === sill + H && wa >= -1 && wa <= ww) { put(T); out(T); return; }
    if ((wa === -1 || wa === ww) && r >= sill + H - 3 && r < sill + H) { put(T); out(T); return; }
    if (wa < 0 || wa >= ww) return;
    if (r === sill - 1) { put(T); out(T); return; }   // sill
    if (r < sill || r >= sill + H) return;
    const rr = r - sill, li = Math.floor(wa / (lw + 1)), lp = wa % (lw + 1);
    const transom = H >= 14 && (rr === Math.round(H * .58) || (hall && rr === Math.round(H * .3)));
    // pointed heads: the top rows of each light narrow; an oculus sits above the mullions
    const fromTop = H - 1 - rr;
    if (lp === lw) {   // mullion
      if (fromTop <= 2) { recess(1, T); return; }
      recess(1, T); return;
    }
    if (spec.head === 'round') { if (fromTop <= (lw >= 5 ? 1 : 0) && (lp === 0 || lp === lw - 1)) return; if (fromTop === 0 && lw >= 5 && (lp === 1 || lp === lw - 2)) return; }
    else if (spec.head !== 'flat' && fromTop === 0 && (lp === 0 || lp === lw - 1)) return;   // pointed: arch shoulders stay stone
    if (transom) { recess(1, T); return; }
    recess(2, glassFor(wid));
  }
  function solidBehind(i, y, k) { const v = get(i, y, k); return v === W || v === T || v === D; }

  /* ---------- towers ---------- */
  // clock dial on a tower face of L voxels: radius ~2.7 m (smaller on narrow towers), centred low enough for its hood
  function clockOf(t, L) { const rad = Math.max(4, Math.min(Math.round(2.7 / V), Math.floor(L / 2) - 4)); return { rad, cy: t.top - 2 * rad - 10 }; }
  function towerFace(t, i, y, k, d, a, L, put, out, recess) {
    const top = t.top, mid = (L - 1) / 2, u = a - mid;
    // corner buttresses run up the angles
    if (a <= 2 || a >= L - 3) { if (y < top - 12) { if (a <= 1 || a >= L - 2) out(W); } if (y < plinth) put(D); else if (((y >> 1) & 1)) put(T); return; }
    if (y < plinth) { put(D); out(D); return; }
    // archway through the base
    if (t.arch && (t.arch.axis === 'both' || d >> 1 === (t.arch.axis === 'x' ? 0 : 1))) {
      const hw = t.arch.w / V / 2, ah = t.arch.h / V;
      const prof = ah - (hw * .55) * (1 - Math.sqrt(Math.max(0, 1 - (u / hw) ** 2)));
      if (Math.abs(u) <= hw && y < prof) return;        // the passage itself is carved later
      if (Math.abs(u) <= hw + 2 && y < prof + 2) { put(T); out(T); return; }
    }
    if (t.letterFace === d && y >= t.letterY0 - 2 && y <= t.letterY1 + 2) { put(W); return; }   // the inscription's plain band
    // clock faces: a round seat one voxel deep framed by a projecting moulded ring, under a small gabled hood with a
    // finial; the dial itself (glass, gilded ring and batons, moving hands) is real geometry added after meshing
    if (t.clock) {
      const [dx, dz] = DIRS[d], oi = i + dx, ok = k + dz;
      const { cy, rad } = clockOf(t, L), dd = Math.hypot(u, y - cy);
      if (dd <= rad + 1.8) {
        if (dd > rad + .4) { put(T); out(T); if (dd > rad + 1.1 && y < cy) { const i2 = oi + dx, k2 = ok + dz; if (free(oi, ok) && free(i2, k2)) ops.push([i2, y, k2, T]); } return; }
        recess(1, D); return;
      }
      const g0 = cy + rad + 2, gh = rad + 3;
      if (y >= g0 && y < g0 + gh && Math.abs(u) <= rad + 2 - (y - g0)) {
        put(T); out(T);
        if (Math.abs(u) > rad + 1 - (y - g0)) { const i2 = oi + dx, k2 = ok + dz; if (free(oi, ok) && free(i2, k2)) ops.push([i2, y, k2, T]); }
        return;
      }
      if (y >= g0 + gh && y < g0 + gh + 5 && Math.abs(u) < 1) { put(T); out(T); return; }
    }
    // belfry louvres in the top storey (on clock towers the dial and its hood take that storey)
    const bel0 = top - Math.round(5 / V);
    if (y >= bel0 && y < top - 3 && !t.clock) {
      const lw = Math.max(3, Math.floor((L - 10) / 5)), c1 = Math.round(mid - lw - 1), c2 = Math.round(mid + 2);
      if ((a >= c1 && a < c1 + lw) || (a >= c2 && a < c2 + lw)) { if (y >= top - 5) return put(T); recess(1, ((y & 1) ? LOUV : 0), 0); return; }
    }
    if (y === top - 1 || y === top - 2) { put(T); out(T); return; }
    // lancet windows on the tower storeys
    const fl = Math.floor((y - gF) / uF), r = y - gF - fl * uF;
    if (y > gF && Math.abs(u) <= 2 && r >= 4 && r < uF - 4 && y < bel0 - 6 && !(t.clock && Math.abs(y - clockOf(t, L).cy) < clockOf(t, L).rad * 2 + 8)) {
      if (r === uF - 5 && Math.abs(u) === 2) return put(W);
      recess(2, glassFor(fl * 7 + d)); return;
    }
    if (y > gF && (y - gF) % uF === 0) { put(T); out(T); }
  }
  // tower tops: parapet, pinnacles, an optional belfry stage, then a spire, a pyramid or a dome
  function parapet(i0, i1, k0, k1, top, pinnacles) {
    for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) {
      const edge = i === i0 || i === i1 || k === k0 || k === k1; if (!edge) { set(i, top - 1, k, LD); continue; }
      const along = (i === i0 || i === i1) ? k - k0 : i - i0;
      for (let y = top; y < top + 5; y++) set(i, y, k, (y >= top + 3 && (along >> 1) % 2) ? 0 : T);
    }
    if (pinnacles) for (const [pi, pk] of [[i0, k0], [i1 - 2, k0], [i0, k1 - 2], [i1 - 2, k1 - 2]]) {
      g.box(pi - 1, top, pk - 1, pi + 3, top + 13, pk + 3, W);
      g.box(pi - 1, top + 13, pk - 1, pi + 3, top + 13, pk + 3, T);
      for (let s = 0; s < 3; s++) g.box(pi - 1 + s, top + 14 + s * 2, pk - 1 + s, pi + 3 - s, top + 15 + s * 2, pk + 3 - s, s === 2 ? LD : W);
      g.box(pi + 1, top + 20, pk + 1, pi + 1, top + 21, pk + 1, GILT);
    }
  }
  for (const t of towers) {
    let top = t.top, i0 = t.i0, i1 = t.i1, k0 = t.k0, k1 = t.k1;
    parapet(i0, i1, k0, k1, top, t.pinnacles !== false);
    if (t.stage) {   // a narrower belfry stage with tall louvred openings, its own parapet and pinnacles
      const sw = Math.round(t.stage.w / V), sh2 = Math.round(t.stage.h / V), ci = (i0 + i1) / 2, ck = (k0 + k1) / 2;
      const s0 = Math.round(ci - sw / 2), s1 = s0 + sw - 1, q0 = Math.round(ck - sw / 2), q1 = q0 + sw - 1;
      g.box(s0, top, q0, s1, top + sh2 - 1, q1, W);
      for (let y = top; y < top + sh2; y++) for (let s = s0; s <= s1; s++) for (const [ii, kk, di, dk] of [[s, q0, 0, 1], [s, q1, 0, -1], [s0, s - s0 + q0, 1, 0], [s1, s - s0 + q0, -1, 0]]) {
        const a = di ? kk - q0 : ii - s0, u = a - (sw - 1) / 2, yy = y - top;
        if (yy === 2 || yy === sh2 - 3) { set(ii, y, kk, T); set(ii - di, y, kk - dk, get(ii - di, y, kk - dk) ? get(ii - di, y, kk - dk) : (free(ii - di, kk - dk) ? T : 0)); continue; }
        const lw = Math.max(2, Math.floor((sw - 8) / 4)), inL = (u > 1 && u <= 1 + lw) || (u < -1 && u >= -1 - lw);
        const headRow = sh2 - 5 - yy;
        if (inL && yy > 4 && yy < sh2 - 4 && !(headRow === 0 && (Math.abs(u) === 2 || Math.abs(u) === 1 + lw))) { set(ii, y, kk, 0); set(ii + di, y, kk + dk, (yy & 1) ? LOUV : 0); set(ii + 2 * di, y, kk + 2 * dk, LOUV); }
        else if (((y >> 1) & 1) && (a <= 1 || a >= sw - 2)) set(ii, y, kk, T);
      }
      top += sh2; i0 = s0; i1 = s1; k0 = q0; k1 = q1;
      parapet(i0, i1, k0, k1, top, true);
    }
    // dome (Edwardian towers) on a short drum, with a lantern
    if (t.kind === 'dome') {
      const ci = (i0 + i1) / 2, ck = (k0 + k1) / 2, R = Math.min(i1 - i0, k1 - k0) / 2 - 1.5, hs = (t.spire ? t.spire / V : R) / R;
      const CU = g.m(t.domeMat || 'copper');
      for (let y = 0; y < 6; y++) for (let i = Math.floor(ci - R); i <= Math.ceil(ci + R); i++) for (let k = Math.floor(ck - R); k <= Math.ceil(ck + R); k++) {
        const r = Math.hypot(i - ci, k - ck); if (r <= R + .3) set(i, top + y, k, r > R - 1 ? (y === 0 || y === 5 ? T : (Math.atan2(k - ck, i - ci) * 8 / Math.PI | 0) % 2 ? W : 0) : W);
      }
      const d0 = top + 6;
      for (let y = 0; y <= R * hs; y++) { const r = R * Math.sqrt(Math.max(0, 1 - (y / (R * hs)) ** 2));
        for (let i = Math.floor(ci - r); i <= Math.ceil(ci + r); i++) for (let k = Math.floor(ck - r); k <= Math.ceil(ck + r); k++) if (Math.hypot(i - ci, k - ck) <= r + .3) set(i, d0 + y, k, CU); }
      const lt = d0 + Math.round(R * hs);
      g.box(Math.round(ci) - 2, lt, Math.round(ck) - 2, Math.round(ci) + 2, lt + 7, Math.round(ck) + 2, W);
      for (const [a, b] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) g.box(Math.round(ci) + a, lt + 2, Math.round(ck) + b, Math.round(ci) + a, lt + 5, Math.round(ck) + b, 0);
      g.box(Math.round(ci) - 3, lt + 8, Math.round(ck) - 3, Math.round(ci) + 3, lt + 8, Math.round(ck) + 3, T);
      g.box(Math.round(ci) - 1, lt + 9, Math.round(ck) - 1, Math.round(ci) + 1, lt + 11, Math.round(ck) + 1, CU);
      g.box(Math.round(ci), lt + 12, Math.round(ck), Math.round(ci), lt + 16, Math.round(ck), GILT);
    }
    // spire
    const sh = t.kind === 'dome' ? 0 : Math.round((t.spire || 0) / V);
    if (sh > 0) {
      const si0 = i0 + 3, si1 = i1 - 3, sk0 = k0 + 3, sk1 = k1 - 3, hw = Math.min(si1 - si0, sk1 - sk0) / 2;
      const cxs = (si0 + si1) / 2, czs = (sk0 + sk1) / 2;
      for (let y = 0; y < sh; y++) {
        const f = 1 - y / sh, rx = (si1 - si0) / 2 * f, rz = (sk1 - sk0) / 2 * f;
        const yy = top + 1 + y;
        for (let i = Math.floor(cxs - rx); i <= Math.ceil(cxs + rx); i++) for (let k = Math.floor(czs - rz); k <= Math.ceil(czs + rz); k++) {
          const hip = Math.abs(Math.abs(i - cxs) / Math.max(rx, .5) - Math.abs(k - czs) / Math.max(rz, .5)) < .12;
          set(i, yy, k, hip ? LD : (t.kind === 'pyramid' && y % 9 === 0 ? LD : g.m(mats.roof)));
        }
        // lucarnes on each face a quarter of the way up
        if (y === Math.round(sh * .18)) for (const [di, dk] of DIRS) {
          const fi = Math.round(cxs + di * (rx + 1)), fk = Math.round(czs + dk * (rz + 1));
          for (let s = -2; s <= 2; s++) for (let q = 0; q < 9; q++) {
            const ii = fi + (dk ? s : 0) - (di ? di * 2 : 0), kk = fk + (di ? s : 0) - (dk ? dk * 2 : 0);
            const v = q < 6 && Math.abs(s) <= 1 && q > 0 ? 0 : (q >= 6 ? (Math.abs(s) <= 8 - q ? LD : 0) : W);
            if (v) set(ii, yy + q, kk, v);
            if (!v && q < 6 && q > 0) { set(ii, yy + q, kk, 0); set(ii - di, yy + q, kk - dk, LOUV); }
          }
        }
      }
      const ft = top + 1 + sh;
      g.box(Math.round(cxs), ft, Math.round(czs), Math.round(cxs), ft + 9, Math.round(czs), LD);
      g.box(Math.round(cxs) - 1, ft + 6, Math.round(czs) - 1, Math.round(cxs) + 1, ft + 7, Math.round(czs) + 1, GILT);
      g.box(Math.round(cxs), ft + 10, Math.round(czs) - 2, Math.round(cxs), ft + 11, Math.round(czs) + 2, GILT);
    }
    // archway through the base
    if (t.arch) {   // passage through the base: along one axis, or open on all four sides (a canopy)
      const hw = t.arch.w / V / 2, ah = t.arch.h / V, ci = (t.i0 + t.i1) / 2, ck = (t.k0 + t.k1) / 2;
      const axes = t.arch.axis === 'both' ? ['x', 'z'] : [t.arch.axis];
      for (const ax of axes) for (let i = t.i0 - 2; i <= t.i1 + 2; i++) for (let k = t.k0 - 2; k <= t.k1 + 2; k++) {
        const uu = ax === 'x' ? k - ck : i - ci;
        const prof = ah - (hw * .55) * (1 - Math.sqrt(Math.max(0, 1 - (uu / hw) ** 2)));
        if (Math.abs(uu) <= hw) for (let y = 0; y < prof; y++) set(i, y, k, 0);
      }
    }
  }
  /* ---------- cross gables and dormers along the top of the facades ---------- */
  if (spec.gables !== false || spec.dormers !== false) {
    const done = new Set();
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const c = k * nx + i; if (!own[c] || twr[c] || !ridgeTop[c]) continue;
      const e = eav[c];
      for (let d = 0; d < 4; d++) {
        const [dx, dz] = DIRS[d]; if (!inGrid(i + dx, k + dz) || own[(k + dz) * nx + i + dx] || party[(k + dz) * nx + i + dx]) continue;
        // only along the eaves (the slope falls towards this face)
        if ((span[c] === 0) !== (dx !== 0)) continue;
        const along = dx ? 1 : 0, line = along ? i : k;
        // the run of this facade at eaves level
        let s = along ? k : i, e0 = s, e1 = s;
        const okc = q => { const ii = along ? i : q, kk = along ? q : k; return inGrid(ii, kk) && own[kk * nx + ii] && !twr[kk * nx + ii] && eav[kk * nx + ii] === e && inGrid(ii + dx, kk + dz) && !own[(kk + dz) * nx + ii + dx]; };
        while (okc(e0 - 1)) e0--; while (okc(e1 + 1)) e1++;
        const key = `${d},${line},${e0}`; if (done.has(key)) continue; done.add(key);
        const L = e1 - e0 + 1, B = BAY, nb = Math.floor((L - 4) / B); if (nb < 3) continue;
        const off = e0 + Math.floor((L - nb * B) / 2);
        for (let b = 0; b < nb; b++) {
          const q0 = off + b * B, gab = spec.gables !== false && (b % 3 === 1 || (nb <= 4 && b === Math.floor(nb / 2))) && b > 0 && b < nb - 1;
          if (gab) crossGable(along, line, q0, B, d, e);
          else if (spec.dormers !== false && b % 3 !== 1 && b > 0 && b < nb - 1) dormer(along, line, q0, B, d, e);
        }
      }
    }
  }
  function crossGable(along, line, q0, B, d, e) {
    const [dx, dz] = DIRS[d], half = (B + 2) / 2, mid = q0 + B / 2 - .5;
    for (let q = q0 - 1; q <= q0 + B; q++) {
      const hgt = Math.round((half - Math.abs(q - mid)) * 1.6);
      for (let depth = 0; depth < 4; depth++) {
        const i = along ? line - dx * depth : q, k = along ? q : line - dz * depth;
        for (let y = e; y < e + hgt; y++) {
          const u = q - mid, yy = y - e, win = Math.abs(u) <= 2.5 && yy >= 3 && yy < hgt - 5 && Math.abs(u) < half - 3;
          if (win && depth === 0) set(i, y, k, 0);
          else if (win && depth === 1) set(i, y, k, glassFor(Math.round(q) * 3 + y));
          else set(i, y, k, (y >= e + hgt - 2 && depth === 0) || (win && depth === 0) ? T : W);
        }
      }
    }
    // finial on the apex
    const ai = along ? line : Math.round(mid), ak = along ? Math.round(mid) : line, ay = e + Math.round(half * 1.6);
    g.box(ai, ay - 1, ak, ai, ay + 6, ak, T); set(ai, ay + 7, ak, LD);
  }
  function dormer(along, line, q0, B, d, e) {
    const [dx, dz] = DIRS[d], mid = q0 + B / 2 - .5;
    // a stone-fronted gabled dormer two voxels back from the eaves; its ridge runs into the main roof
    const RF = g.m(mats.roof);
    for (let q = Math.round(mid - 3); q <= Math.round(mid + 3); q++) for (let depth = 2; depth < 12; depth++) {
      const i = along ? line - dx * depth : q, k = along ? q : line - dz * depth, u = Math.abs(q - mid), front = depth === 2;
      for (let y = e + 4; y < e + 18; y++) {
        const yy = y - e - 4;
        if (yy >= 9) { const w = 4 - (yy - 9) * 1.3; if (u <= w) set(i, y, k, front ? T : u > w - 1.3 ? RF : W); continue; }
        if (front && u <= 1.5 && yy >= 2 && yy < 8) { set(i, y, k, 0); continue; }
        if (depth === 3 && u <= 1.5 && yy >= 2 && yy < 8) { set(i, y, k, glassFor(q + y)); continue; }
        set(i, y, k, front ? T : u >= 2.5 ? W : W);
      }
    }
  }
  /* ---------- ridge cresting and chimneys ---------- */
  const ridgeCells = [];
  for (let k = 1; k < nz - 1; k++) for (let i = 1; i < nx - 1; i++) {
    const c = k * nx + i; if (!ridgeTop[c] || twr[c]) continue;
    const [dx, dz] = span[c] === 0 ? [1, 0] : [0, 1];
    if (ridgeTop[c] >= (ridgeTop[c + dx + dz * nx] || 0) && ridgeTop[c] >= (ridgeTop[c - dx - dz * nx] || 0) && get(i, ridgeTop[c] - 1, k) === R) ridgeCells.push(c);
  }
  for (const c of ridgeCells) {
    const i = c % nx, k = (c / nx) | 0, y = ridgeTop[c], along = span[c] === 0 ? k : i;
    const [dx, dz] = span[c] === 0 ? [1, 0] : [0, 1], n1 = ridgeTop[c + dx + dz * nx] || 0, n2 = ridgeTop[c - dx - dz * nx] || 0;
    if (Math.min(n1, n2) >= y) continue;   // inside a lead flat: cresting only along its edges
    if (along % 3 === 0) { set(i, y, k, LD); if (along % 12 === 0) { set(i, y + 1, k, LD); set(i, y + 2, k, GILT); } }
  }
  /* ---------- great windows in the gable ends ---------- */
  { const runs = new Map();
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const c = k * nx + i; if (!ridgeTop[c] || twr[c] || polys[own[c] - 1].roof === 'hipped') continue;
      const ridgeX = span[c] === 1;   // ridge along x when the span is along z
      for (const s of [1, -1]) {
        const oi = ridgeX ? i + s : i, ok = ridgeX ? k : k + s;
        if (!inGrid(oi, ok) || own[ok * nx + oi] || party[ok * nx + oi]) continue;
        const key = `${ridgeX ? 'x' : 'z'}${s},${ridgeX ? i : k},${eav[c]}`;
        let r = runs.get(key); if (!r) runs.set(key, r = { ridgeX, s, line: ridgeX ? i : k, e: eav[c], cells: [] });
        r.cells.push(ridgeX ? k : i);
      }
    }
    for (const r of runs.values()) {
      r.cells.sort((a, b) => a - b);
      // split into contiguous stretches
      let st = 0;
      for (let q = 1; q <= r.cells.length; q++) if (q === r.cells.length || r.cells[q] !== r.cells[q - 1] + 1) { gableWindow(r, r.cells[st], r.cells[q - 1]); st = q; }
    }
  }
  function gableWindow(r, a0, a1) {
    const L = a1 - a0 + 1; if (L < 22) return;
    const mid = (a0 + a1) / 2, cell = (a) => r.ridgeX ? (Math.round(a) * nx + r.line) : (r.line * nx + Math.round(a));
    const apex = ridgeTop[cell(mid)] || 0, rise = apex - r.e; if (rise < 18) return;
    const hall = polys[own[cell(mid)] - 1].hall;
    const half = Math.min(Math.round(L * (hall ? .28 : .2)), hall ? 16 : 9), y0 = r.e + 3, y1 = r.e + Math.round(rise * (hall ? .7 : .6)), head = Math.round((y1 - y0) * .32);
    const wid = (spec.id * 13 + r.line * 7 + a0) | 0;
    for (let a = Math.round(mid - half - 1); a <= Math.round(mid + half + 1); a++) for (let y = y0 - 1; y <= y1 + 1; y++) {
      const u = a - mid, t = y > y1 - head ? (y - (y1 - head)) / head : 0, lim = half * (1 - Math.pow(Math.max(0, t), 1.6));
      const i = r.ridgeX ? r.line : a, k = r.ridgeX ? a : r.line, di = r.ridgeX ? -r.s : 0, dk = r.ridgeX ? 0 : -r.s;
      if (!get(i, y, k)) continue;
      const inside = Math.abs(u) <= lim && y >= y0 && y <= y1;
      if (!inside) { if (Math.abs(u) <= lim + 1.2 && y >= y0 - 1 && y <= y1 + 1) { set(i, y, k, T); const oi = i - di, ok = k - dk; if (free(oi, ok) && !get(oi, y, ok)) set(oi, y, ok, T); } continue; }
      const mull = Math.round(u + half) % 4 === 0 && Math.abs(u) < half - .5, trans = y === Math.round(y0 + (y1 - y0) * .45);
      set(i, y, k, 0);
      set(i + di, y, k + dk, mull || trans ? T : 0);
      set(i + 2 * di, y, k + 2 * dk, glassFor(wid + (mull ? 0 : Math.floor((u + half) / 4))));
    }
  }
  if (spec.chimneys !== false) for (const c of ridgeCells) {
    const i = c % nx, k = (c / nx) | 0, along = span[c] === 0 ? k : i;
    if (along % 110 !== 55 || hash(spec.id, i, k) < .2) continue;
    const y0 = ridgeTop[c] - 14, y1 = ridgeTop[c] + 11, wx = span[c] === 0 ? 2 : 4, wz = span[c] === 0 ? 4 : 2;
    g.box(i - wx, y0, k - wz, i + wx, y1, k + wz, W);
    g.box(i - wx - 1, y1 - 2, k - wz - 1, i + wx + 1, y1 - 1, k + wz + 1, T);
    for (const s of [-2, 2]) g.box(i + (span[c] === 0 ? 0 : s), y1 + 1, k + (span[c] === 0 ? s : 0), i + (span[c] === 0 ? 0 : s), y1 + 3, k + (span[c] === 0 ? s : 0), POT);
  }
  /* ---------- archways through the range ---------- */
  for (const ar of spec.arches || []) {
    const [ax, az] = toL(...ar.a), [bx, bz] = toL(...ar.b), hw = ar.w / 2, h = ar.h;
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const px = gx0 + (i + .5) * V, pz = gz0 + (k + .5) * V;
      let t = ((px - ax) * dx + (pz - az) * dz) / L2; if (t < -.02 || t > 1.02) continue;
      const u = Math.abs((px - ax) * dz - (pz - az) * dx) / Math.sqrt(L2); if (u > hw + .8) continue;
      const prof = h - hw * .55 * (1 - Math.sqrt(Math.max(0, 1 - (u / hw) ** 2)));
      for (let y = 0; y < Math.round((prof + .6) / V) && y < ny; y++) {
        const v = get(i, y, k); if (!v) continue;
        if (u <= hw && y * V < prof) set(i, y, k, 0); else if (v === W) set(i, y, k, T);
      }
    }
  }
  // clock dials (glass, gilded ring and batons) and their moving hands, set into the seats carved on each tower face
  towers.forEach((t, ti) => {
    if (!t.clock) return;
    for (let d = 0; d < 4; d++) {
      const [dx, dz] = DIRS[d], L = dx ? t.k1 - t.k0 + 1 : t.i1 - t.i0 + 1, { cy, rad } = clockOf(t, L);
      const lx = dx > 0 ? t.i1 * V + gx0 + .015 : dx < 0 ? (t.i0 + 1) * V + gx0 - .015 : (t.i0 + t.i1 + 1) / 2 * V + gx0;
      const lz = dz > 0 ? t.k1 * V + gz0 + .015 : dz < 0 ? (t.k0 + 1) * V + gz0 - .015 : (t.k0 + t.k1 + 1) / 2 * V + gz0;
      addClock(store, `${spec.id}:${ti}:${d}`, [cx + lx * cs - lz * sn, (cy + .5) * V, cz + lx * sn + lz * cs], [dx * cs - dz * sn, dx * sn + dz * cs], (rad + .3) * V);
    }
  });
  // the inscription over the archway (its face and height were chosen before the facades were built): found on the
  // wall's actual surface at that height, a little to the side of the centre line where the wall is solid
  towers.forEach(t => {
    const lt = t.lettering; if (!lt || t.letterFace == null) return;
    const d = t.letterFace, [dx, dz] = DIRS[d], m = loadMask(lt.mask);
    const y = Math.round((t.letterY0 + t.letterY1) / 2);
    const ci = Math.round((t.i0 + t.i1) / 2 + (dz ? (t.i1 - t.i0) * .3 : 0)), ck = Math.round((t.k0 + t.k1) / 2 + (dx ? (t.k1 - t.k0) * .3 : 0));
    let i = ci, k = ck, n = 0;
    while (n++ < nx + nz && inGrid(i + dx, k + dz) && get(i + dx, y, k + dz)) { i += dx; k += dz; }
    const lx = dx > 0 ? (i + 1) * V + gx0 : dx < 0 ? i * V + gx0 : (t.i0 + t.i1 + 1) / 2 * V + gx0;
    const lz = dz > 0 ? (k + 1) * V + gz0 : dz < 0 ? k * V + gz0 : (t.k0 + t.k1 + 1) / 2 * V + gz0;
    const wn = [dx * cs - dz * sn, dx * sn + dz * cs], w = [cx + lx * cs - lz * sn, cz + lx * sn + lz * cs];
    const r = addLettering(store, lt.mask, [w[0] + wn[0] * .005, (t.letterY0 + t.letterY1 + 1) / 2 * V, w[1] + wn[1] * .005], wn, t.letterCap);
    console.log(`    inscription "${m.text}": ${r.width.toFixed(1)} x ${r.height.toFixed(2)} m, ${r.boxes} pieces`);
  });
  return meshGrid(g, store, store.key(cx, cz), { cx, cz, oy: 0, cos: cs, sin: sn, x0: gx0, z0: gz0, vs: V, uo: hash(spec.id, 1) * 5, vo: hash(spec.id, 2) * 5 });
}

const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
function distSeg(x, z, ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], az = ring[j][1], dx = ring[i][0] - ax, dz = ring[i][1] - az, L2 = dx * dx + dz * dz || 1e-9;
    let t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}
function chamfer(inside, nx, nz) {
  const D = new Float32Array(nx * nz), INF = 1e6;
  for (let c = 0; c < D.length; c++) D[c] = inside[c] ? INF : 0;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const c = k * nx + i; if (!D[c]) continue; let v = D[c];
    if (i > 0) v = Math.min(v, D[c - 1] + 1); if (k > 0) { v = Math.min(v, D[c - nx] + 1); if (i > 0) v = Math.min(v, D[c - nx - 1] + 1.4142); if (i < nx - 1) v = Math.min(v, D[c - nx + 1] + 1.4142); } D[c] = v; }
  for (let k = nz - 1; k >= 0; k--) for (let i = nx - 1; i >= 0; i--) { const c = k * nx + i; if (!D[c]) continue; let v = D[c];
    if (i < nx - 1) v = Math.min(v, D[c + 1] + 1); if (k < nz - 1) { v = Math.min(v, D[c + nx] + 1); if (i < nx - 1) v = Math.min(v, D[c + nx + 1] + 1.4142); if (i > 0) v = Math.min(v, D[c + nx - 1] + 1.4142); } D[c] = v; }
  return D;
}
function spanAxis(inside, nx, nz, i, k) {
  let a = i, b = i; while (a > 0 && inside[k * nx + a - 1]) a--; while (b < nx - 1 && inside[k * nx + b + 1]) b++;
  let c = k, d = k; while (c > 0 && inside[(c - 1) * nx + i]) c--; while (d < nz - 1 && inside[(d + 1) * nx + i]) d++;
  return (b - a) <= (d - c) ? 0 : 1;
}
// gabled roofs: distance to the nearer eaves across the shorter span; fills span[] per cell
function gableField(inside, nx, nz, span) {
  const D = new Float32Array(nx * nz);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const c = k * nx + i; if (!inside[c]) continue;
    const sp = spanAxis(inside, nx, nz, i, k); span[c] = sp;
    if (sp === 0) { let a = i, b = i; while (a > 0 && inside[k * nx + a - 1]) a--; while (b < nx - 1 && inside[k * nx + b + 1]) b++; D[c] = Math.min(i - a, b - i) + 1; }
    else { let a = k, b = k; while (a > 0 && inside[(a - 1) * nx + i]) a--; while (b < nz - 1 && inside[(b + 1) * nx + i]) b++; D[c] = Math.min(k - a, b - k) + 1; }
  }
  return D;
}
