// Street furniture and greenery: rails and sleepers on every line (on viaducts at deck height), road markings and
// crossings, instanced street lamps (modern columns, heritage lanterns in the old quarters), voxel trees of several
// species, Metrolink overhead-line masts, and construction sites with hoardings, concrete cores and tower cranes.
import { hash, samplePolyline, fillRings, dominantAngle, rot, polygonArea } from './geo.mjs';
import { Grid, Prim, meshGrid } from './vox.mjs';
import { CS, GC, GDEF, roadHalf, isElevatedWay } from './ground.mjs';
import { districtAt } from './buildings.mjs';

/* ---------------- primitive helpers (world space) ---------------- */
// box with its base centred at (x, y0, z), length along direction (ux, uz), width across, height up; no bottom face
export function obox(p, x, y0, z, ux, uz, len, wid, hgt, t = 1, bottom = false) {
  const vx = -uz, vz = ux, hl = len / 2, hw = wid / 2;
  const cx = x - ux * hl - vx * hw, cz = z - uz * hl - vz * hw;   // corner
  // top
  p.quad(cx, y0 + hgt, cz, ux * len, 0, uz * len, vx * wid, 0, vz * wid, 0, 1, 0, 0, 0, len / t, 0, 0, wid / t);
  if (bottom) p.quad(cx, y0, cz, ux * len, 0, uz * len, vx * wid, 0, vz * wid, 0, -1, 0, 0, 0, len / t, 0, 0, wid / t);
  // sides along the length
  p.quad(cx, y0, cz, ux * len, 0, uz * len, 0, hgt, 0, -vx, 0, -vz, 0, 0, len / t, 0, 0, -hgt / t);
  p.quad(cx + vx * wid, y0, cz + vz * wid, ux * len, 0, uz * len, 0, hgt, 0, vx, 0, vz, 0, 0, len / t, 0, 0, -hgt / t);
  // ends
  p.quad(cx, y0, cz, vx * wid, 0, vz * wid, 0, hgt, 0, -ux, 0, -uz, 0, 0, wid / t, 0, 0, -hgt / t);
  p.quad(cx + ux * len, y0, cz + uz * len, vx * wid, 0, vz * wid, 0, hgt, 0, ux, 0, uz, 0, 0, wid / t, 0, 0, -hgt / t);
}
// flat stripe on a surface between a and b, offset sideways
function stripe(p, ax, az, bx, bz, off, wid, y) {
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 1e-3) return;
  const ux = dx / L, uz = dz / L, vx = -uz, vz = ux, ox = ax + vx * (off - wid / 2), oz = az + vz * (off - wid / 2);
  p.quad(ox, y, oz, dx, 0, dz, vx * wid, 0, vz * wid, 0, 1, 0, 0, 0, L, 0, 0, wid);
}

/* ---------------- building mask ---------------- */
export function buildingMask(G, B) {
  const m = new Uint8Array(G.nx * G.nz);
  for (const b of B) for (const it of b.items) fillRings([...it.f.outers, ...it.f.inners], G.X0, G.Z0, CS, G.nx, G.nz, (i, k) => { m[k * G.nx + i] = 1; });
  return m;
}
// ground cells hidden under buildings copy their left neighbour so the ground mesh merges into fewer, larger quads
export function simplifyUnderBuildings(G, bm) {
  const { nx, nz, cls } = G; let n = 0;
  for (let k = 1; k < nz - 1; k++) for (let i = 1; i < nx - 1; i++) {
    const c = k * nx + i;
    if (bm[c] && bm[c - 1] && bm[c + 1] && bm[c - nx] && bm[c + nx] && bm[c - nx - 1] && bm[c - nx + 1] && bm[c + nx - 1] && bm[c + nx + 1]) { cls[c] = cls[c - 1]; n++; }
  }
  return n;
}

/* ---------------- rails ---------------- */
export function buildTracks(F, G, store) {
  let n = 0;
  for (const w of F.infra.rails) {
    if (w.tunnel || !w.hv) continue;
    for (let s = 0; s + 1 < w.pts.length; s++) {
      const [ax, az] = w.pts[s], [bx, bz] = w.pts[s + 1], L = Math.hypot(bx - ax, bz - az); if (L < .05) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, vx = -uz, vz = ux;
      const grp = store.group(store.key((ax + bx) / 2, (az + bz) / 2));
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, ha = w.hv[s], hb = w.hv[s + 1];
      if (G.cell(ax, az) < 0 || G.cell(bx, bz) < 0) continue;   // off the model
      const elevated = Math.max(ha, hb) >= .6;
      const surf = G.at(mx, mz);
      const street = !elevated && (surf === GC.road || surf === GC.plaza || surf === GC.pave || surf === GC.curb || surf === GC.sett);
      if (street) {   // grooved rails flush with the road or square
        const y = GDEF[surf].h + .006;
        for (const o of [-.75, .75]) stripe(store.prim(grp, 'rail'), ax, az, bx, bz, o, .09, y);
        n += 2; continue;
      }
      // deck tops are voxel aligned: the ballast surface is the rounded deck height
      const base = elevated ? Math.round(Math.max(ha, hb) / .6) * .6 : GDEF[GC.ballast].h;
      if (elevated && Math.abs(ha - hb) > .3) continue;   // ramps are stepped; tracks on them would float
      const sl = store.prim(grp, 'sleeper'), rl = store.prim(grp, 'rail');
      for (let d = .3; d < L; d += .62) { obox(sl, ax + ux * d, base, az + uz * d, vx, vz, 2.5, .26, .14, 1); n++; }
      for (const o of [-.72, .72]) { obox(rl, mx + vx * o, base + .14, mz + vz * o, ux, uz, L, .08, .16, 1); n++; }
    }
  }
  return n * 5;
}

/* ---------------- road markings and crossings ---------------- */
const MARK_RANK = { residential: 1, unclassified: 1, tertiary: 2, secondary: 3, primary: 3, trunk: 4, motorway: 4, tertiary_link: 2, secondary_link: 2, primary_link: 3, trunk_link: 3, motorway_link: 3, busway: 2 };
export function buildMarkings(F, G, store) {
  let n = 0;
  const onRoad = (x, z) => { const c = G.at(x, z); return c === GC.road || c === GC.roadR; };
  for (const r of F.roads) {
    const t = r.tags, rank = MARK_RANK[t.highway]; if (!rank) continue;
    if ((t.tunnel && t.tunnel !== 'no') || isElevatedWay(t)) continue;
    if (r.hv && Math.max(...r.hv) >= .6) continue;
    const half = roadHalf(t); if (!half) continue;
    const oneway = t.oneway === 'yes' || t.junction === 'roundabout' || t.highway === 'motorway';
    const lanes = parseInt(t.lanes) || (oneway ? (half > 4 ? 2 : 1) : 2);
    const core = districtAt(r.pts[0][0], r.pts[0][1]).zone !== 'suburb';
    for (let s = 0; s + 1 < r.pts.length; s++) {
      const [ax, az] = r.pts[s], [bx, bz] = r.pts[s + 1], L = Math.hypot(bx - ax, bz - az); if (L < 2) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, vx = -uz, vz = ux;
      const grp = store.group(store.key((ax + bx) / 2, (az + bz) / 2)), P = store.prim(grp, 'mark'), Y = store.prim(grp, 'markY');
      const lines = [];   // lateral offsets of dashed lane lines
      if (!oneway) { if (rank >= 1) lines.push(0); for (let l = 1; l < lanes / 2; l++) { lines.push(l * (2 * half) / lanes); lines.push(-l * (2 * half) / lanes); } }
      else for (let l = 1; l < lanes; l++) lines.push(-half + l * (2 * half) / lanes);
      const dash = rank >= 3 ? 4 : 3, gap = rank >= 3 ? 5 : 6;
      for (const off of lines) for (let d = 1.5; d + dash < L - 1.5; d += dash + gap) {
        const x0 = ax + ux * d + vx * off, z0 = az + uz * d + vz * off;
        if (!onRoad(x0, z0) || !onRoad(x0 + ux * dash, z0 + uz * dash)) continue;
        stripe(P, x0 - vx * off, z0 - vz * off, x0 - vx * off + ux * dash, z0 - vz * off + uz * dash, off, .12, .012); n++;
      }
      // edge lines on the big roads, double yellow lines along the kerbs in town
      if (rank >= 3 || core) for (const sd of [-1, 1]) {
        const off = sd * (half - .45);
        // walk the segment in pieces so lines stop where the carriageway does (junctions, bridges)
        let start = null;
        for (let d = 0; d <= L; d += 1.2) {
          const ok = d < L && onRoad(ax + ux * d + vx * off, az + uz * d + vz * off) && onRoad(ax + ux * d + vx * (off + sd * .5), az + uz * d + vz * (off + sd * .5));
          if (ok && start == null) start = d;
          if ((!ok || d + 1.2 > L) && start != null) {
            const e = ok ? Math.min(L, d + 1.2) : d;
            if (e - start > 1) {
              const sx = ax + ux * start, sz = az + uz * start, ex = ax + ux * e, ez = az + uz * e;
              if (rank >= 3 && !core) stripe(P, sx, sz, ex, ez, off, .15, .012);
              else { stripe(Y, sx, sz, ex, ez, off, .08, .012); stripe(Y, sx, sz, ex, ez, off - sd * .14, .08, .012); }
              n += 2;
            }
            start = null;
          }
        }
      }
    }
  }
  // crossings: zebra stripes, or the dotted edges of a signal-controlled crossing
  for (const r of F.roads) {
    const t = r.tags; if (!(t.footway === 'crossing' || t.highway === 'crossing' || t.path === 'crossing' || t.cycleway === 'crossing')) continue;
    const kind = t.crossing || '', mk = t['crossing:markings'] || '';
    if (kind === 'unmarked' || kind === 'informal' || mk === 'no') continue;
    const zebra = /zebra/.test(kind + mk) || (kind === 'marked' && !mk) || kind === 'uncontrolled';
    for (let s = 0; s + 1 < r.pts.length; s++) {
      const [ax, az] = r.pts[s], [bx, bz] = r.pts[s + 1], L = Math.hypot(bx - ax, bz - az); if (L < 1) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, vx = -uz, vz = ux, grp = store.group(store.key(ax, az)), P = store.prim(grp, 'mark');
      if (zebra) {
        for (let d = .3; d + .5 < L; d += 1) {
          const x = ax + ux * (d + .25), z = az + uz * (d + .25); if (!onRoad(x, z)) continue;
          stripe(P, x - vx * 1.25, z - vz * 1.25, x + vx * 1.25, z + vz * 1.25, 0, .5, .013); n++;
        }
      } else for (const o of [-1.3, 1.3]) for (let d = 0; d + .3 < L; d += .6) {
        const x = ax + ux * d + vx * o, z = az + uz * d + vz * o; if (!onRoad(x, z)) continue;
        stripe(P, x, z, x + ux * .3, z + uz * .3, 0, .2, .013); n++;
      }
    }
  }
  return n;
}

/* ---------------- instanced meshes ---------------- */
function instMesh(store, name) { const m = { name, prims: new Map(), nodes: [] }; store.inst.push(m); return m; }
const yawQuat = a => [0, +Math.sin(a / 2).toFixed(6), 0, +Math.cos(a / 2).toFixed(6)];

function lampMeshes(store) {
  // modern column: tapered steel post, short arm, flat LED head
  const A = instMesh(store, 'lamp_modern'), pa = store.prim(A.prims, 'post'), la = store.prim(A.prims, 'lamp');
  obox(pa, 0, 0, 0, 1, 0, .34, .34, .5); obox(pa, 0, .5, 0, 1, 0, .16, .16, 7.4); obox(pa, .55, 7.6, 0, 1, 0, 1.3, .1, .1);
  obox(pa, 1.2, 7.55, 0, 1, 0, .7, .26, .1); obox(la, 1.2, 7.5, 0, 1, 0, .6, .2, .05, 1, true);
  // heritage lantern: fluted cast-iron column, lantern with a glowing body and a cap
  const B = instMesh(store, 'lamp_heritage'), pb = store.prim(B.prims, 'post'), lb = store.prim(B.prims, 'lamp');
  obox(pb, 0, 0, 0, 1, 0, .42, .42, .7); obox(pb, 0, .7, 0, 1, 0, .2, .2, 3.2); obox(pb, 0, 3.9, 0, 1, 0, .3, .3, .15);
  obox(lb, 0, 4.05, 0, 1, 0, .4, .4, .55); obox(pb, 0, 4.6, 0, 1, 0, .52, .52, .1); obox(pb, 0, 4.7, 0, 1, 0, .2, .2, .25);
  return { modern: A, heritage: B };
}
export function buildLamps(F, G, bm, store) {
  const L = lampMeshes(store); let n = 0;
  const okAt = (x, z) => { const c = G.cell(x, z); if (c < 0 || bm[c]) return false; const g = G.cls[c]; return g === GC.pave || g === GC.curb || g === GC.plaza || g === GC.grass || g === GC.yard; };
  const LIT = { residential: 34, unclassified: 34, tertiary: 30, secondary: 30, primary: 28, trunk: 32, pedestrian: 22, living_street: 30, primary_link: 30, trunk_link: 32, tertiary_link: 30, secondary_link: 30 };
  const placed = [];
  const far = (x, z) => { for (let i = Math.max(0, placed.length - 60); i < placed.length; i++) if (Math.hypot(placed[i][0] - x, placed[i][1] - z) < 12) return false; return true; };
  for (const r of F.roads) {
    const t = r.tags, step = LIT[t.highway]; if (!step) continue;
    if ((t.tunnel && t.tunnel !== 'no') || isElevatedWay(t) || (r.hv && Math.max(...r.hv) >= .6)) continue;
    const half = t.highway === 'pedestrian' ? 3.4 : (roadHalf(t) || 3) + .5;
    const zone = districtAt(r.pts[0][0], r.pts[0][1]).zone, heritage = zone === 'heritage' || (zone === 'core' && hash(r.id, 5) < .35) || t.highway === 'pedestrian';
    const both = half > 6 && t.highway !== 'pedestrian';
    let side = 1;
    for (const p of samplePolyline(r.pts, step, step * hash(r.id, 2))) {
      for (const sd of both ? [1, -1] : [side]) {
        const vx = -p.dz * sd, vz = p.dx * sd, x = p.x + vx * half, z = p.z + vz * half;
        if (!okAt(x, z) || !far(x, z)) continue;
        // the arm reaches over the road: local +x points back to the centre line
        const a = Math.atan2(-vz, -vx), m = heritage ? L.heritage : L.modern;
        m.nodes.push({ name: 'lamp', translation: [+x.toFixed(3), +G.height(x, z).toFixed(3), +z.toFixed(3)], rotation: yawQuat(-a) });
        placed.push([x, z]); n++;
      }
      side = -side;
    }
  }
  return n;
}

/* ---------------- trees ---------------- */
const TREE_KINDS = [
  { name: 'lime', h: 15, r: 4.4, cb: 5, leaf: ['leaf', 'leaf2'], blobs: 9 },
  { name: 'plane', h: 19, r: 6.2, cb: 6, leaf: ['leaf', 'leaf3'], blobs: 12 },
  { name: 'birch', h: 12, r: 2.8, cb: 3.5, leaf: ['leaf2'], blobs: 7, bark: 'birch' },
  { name: 'cherry', h: 7.5, r: 3.4, cb: 2.2, leaf: ['leaf2', 'leaf'], blobs: 7 },
  { name: 'oak', h: 16, r: 6.8, cb: 4, leaf: ['leaf3', 'leaf'], blobs: 13 },
  { name: 'poplar', h: 20, r: 2.4, cb: 3, leaf: ['leaf'], blobs: 8, column: true },
  { name: 'autumn', h: 13, r: 4.6, cb: 4, leaf: ['autumn', 'leaf2'], blobs: 9 },
  { name: 'pine', h: 14, r: 3.4, cb: 3, leaf: ['leaf3'], cone: true },
];
function treeMesh(store, kind, seed) {
  const V = .3, R = Math.ceil(kind.r / V) + 3, H = Math.ceil(kind.h / V) + 3, W = 2 * R + 1;
  const g = new Grid(W, H, W), T = g.m('trunk'), Ls = kind.leaf.map(n => g.m(n));
  const rnd = (...v) => hash(seed, ...v);
  const tr = kind.r > 5 ? 1 : 0;   // trunk half width in voxels (0: 1x1... 1: 3x3)
  const crownTop = Math.round(kind.h / V);
  const blobs = [];
  if (kind.cone) {
    for (let y = Math.round(kind.cb / V); y < crownTop; y++) {
      const f = 1 - (y - kind.cb / V) / (crownTop - kind.cb / V), rr = (kind.r / V) * f * (0.75 + .25 * Math.sin(y * 1.3));
      for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) if (x * x + z * z <= rr * rr && rnd(x, y, z) > .08) g.set(x + R, y, z + R, Ls[0]);
    }
  } else {
    const cy = (kind.cb + kind.h) / 2 / V, ry = (kind.h - kind.cb) / 2 / V, rr = kind.r / V;
    for (let b = 0; b < kind.blobs; b++) {
      const a = rnd(b, 1) * Math.PI * 2, d = Math.sqrt(rnd(b, 2)) * (kind.column ? .35 : .6);
      const bx = Math.cos(a) * d * rr, bz = Math.sin(a) * d * rr, by = cy + (rnd(b, 3) * 2 - 1) * ry * .45;
      const br = (kind.column ? .55 : .45 + .25 * rnd(b, 4)) * rr, bry = kind.column ? ry * .7 : br * (.75 + .3 * rnd(b, 5));
      blobs.push([bx, by, bz, br, bry, Ls[b % Ls.length]]);
    }
    for (const [bx, by, bz, br, bry, m] of blobs)
      for (let y = Math.max(0, Math.floor(by - bry)); y <= Math.min(H - 1, Math.ceil(by + bry)); y++)
        for (let z = Math.floor(bz - br); z <= Math.ceil(bz + br); z++) for (let x = Math.floor(bx - br); x <= Math.ceil(bx + br); x++) {
          const q = ((x - bx) / br) ** 2 + ((y - by) / bry) ** 2 + ((z - bz) / br) ** 2;
          if (q > 1) continue;
          if (q > .72 && rnd(x * 3, y * 5, z * 7) < .45) continue;   // ragged outline
          g.setIfEmpty(x + R, y, z + R, m);
        }
  }
  // trunk and limbs
  const trunkTop = Math.round((kind.cone ? kind.h * .8 : (kind.cb + kind.h) / 2) / V);
  for (let y = 0; y < trunkTop; y++) for (let dz = -tr; dz <= tr; dz++) for (let dx = -tr; dx <= tr; dx++) g.set(R + dx, y, R + dz, T);
  for (const [bx, by, bz] of blobs.slice(0, 5)) {
    const y0 = Math.round(kind.cb / V) + 1, steps = 24;
    for (let s = 0; s <= steps; s++) { const f = s / steps; g.set(Math.round(R + bx * f * .7), Math.round(y0 + (by - y0) * f * .8), Math.round(R + bz * f * .7), T); }
  }
  const m = instMesh(store, `tree_${kind.name}`);
  meshGrid(g, store, m.prims, { cx: -R * V - V / 2, cz: -R * V - V / 2, oy: 0, cos: 1, sin: 0, x0: 0, z0: 0, vs: V, skipBottom: true });
  return m;
}
export function buildTrees(F, G, bm, store, B) {
  const meshes = TREE_KINDS.map((k, i) => treeMesh(store, k, 9100 + i));
  const pick = (x, z, park) => {
    const r = hash(Math.round(x * 7), Math.round(z * 7), 11);
    if (park) return r < .22 ? 1 : r < .38 ? 4 : r < .5 ? 0 : r < .6 ? 2 : r < .7 ? 6 : r < .78 ? 5 : r < .86 ? 7 : 3;
    return r < .4 ? 0 : r < .62 ? 1 : r < .77 ? 3 : r < .88 ? 2 : 6;
  };
  const placed = new Set(); let n = 0;
  const free = (x, z, clear) => {
    const c = G.cell(x, z); if (c < 0) return false;
    const g = G.cls[c]; if (g === GC.road || g === GC.roadR || g === GC.water || g === GC.canal || g === GC.river || g === GC.ballast || g === GC.sett || g === GC.pitch) return false;
    const rr = Math.ceil(clear / CS);
    for (let dk = -rr; dk <= rr; dk++) for (let di = -rr; di <= rr; di++) { const cc = c + dk * G.nx + di; if (cc >= 0 && cc < bm.length && bm[cc]) return false; }
    const key = `${Math.round(x / 3)},${Math.round(z / 3)}`; if (placed.has(key)) return false; placed.add(key);
    return true;
  };
  const put = (x, z, kind, s = 1) => {
    const a = hash(Math.round(x * 13), Math.round(z * 13), 3) * Math.PI * 2, sc = s * (.8 + .4 * hash(Math.round(x * 5), Math.round(z * 5), 4));
    meshes[kind].nodes.push({ name: 'tree', translation: [+x.toFixed(3), +G.height(x, z).toFixed(3), +z.toFixed(3)], rotation: yawQuat(a), scale: [+sc.toFixed(3), +sc.toFixed(3), +sc.toFixed(3)] });
    n++;
  };
  // mapped trees and tree rows
  for (const t of F.trees) { const [x, z] = t.p; if (free(x, z, 1.2)) put(x, z, pick(x, z, false)); }
  for (const r of F.treeRows) for (const p of samplePolyline(r.pts, 8, 2)) if (free(p.x, p.z, 1.2)) put(p.x, p.z, pick(p.x, p.z, false));
  // parks, woods, green spaces and gardens
  for (const l of F.land) {
    const dens = { park: 160, wood: 45, forest: 45, scrub: 90, recreation_ground: 400, village_green: 250, cemetery: 200, churchyard: 120, garden: 260, grass: 380, common: 200 }[l.kind];
    if (!dens || l.area < 150) continue;
    const want = Math.floor(l.area / dens), ring = l.outers[0];
    let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity]; for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let i = 0, got = 0; i < want * 4 && got < want; i++) {
      const x = x0 + hash(l.id, i, 1) * (x1 - x0), z = z0 + hash(l.id, i, 2) * (z1 - z0);
      const c = G.at(x, z); if (c !== GC.grass && c !== GC.garden && c !== GC.wood) continue;
      if (!free(x, z, 2.4)) continue;
      put(x, z, pick(x, z, true), l.kind === 'garden' ? .8 : 1); got++;
    }
  }
  // street trees on residential roads in the suburbs where none are mapped
  for (const r of F.roads) {
    if (r.tags.highway !== 'residential' && r.tags.highway !== 'tertiary') continue;
    if (districtAt(r.pts[0][0], r.pts[0][1]).zone !== 'suburb' || hash(r.id, 1) < .45) continue;
    const half = (roadHalf(r.tags) || 4) + 1.6;
    for (const p of samplePolyline(r.pts, 13, 6 * hash(r.id, 2))) for (const sd of [1, -1]) {
      const x = p.x - p.dz * sd * half, z = p.z + p.dx * sd * half;
      if (hash(Math.round(x), Math.round(z), 8) < .35) continue;
      const c = G.at(x, z); if (c !== GC.pave && c !== GC.grass && c !== GC.garden && c !== GC.curb) continue;
      if (free(x, z, 2)) put(x, z, pick(x, z, false), .85);
    }
  }
  return n;
}

/* ---------------- Metrolink overhead line masts ---------------- */
export function buildOHLE(F, G, store) {
  const m = instMesh(store, 'ohle_mast'), p = store.prim(m.prims, 'ohle');
  obox(p, 0, 0, 0, 1, 0, .28, .28, 6.6); obox(p, 1.4, 6.0, 0, 1, 0, 2.9, .1, .12); obox(p, 1.4, 5.5, 0, 1, 0, 2.6, .06, .06);
  let n = 0;
  for (const w of F.infra.rails) {
    if (w.tags.railway !== 'light_rail' || w.tunnel || !w.hv) continue;
    for (const s of samplePolyline(w.pts, 42, 20 * hash(w.id, 1))) {
      if (G.cell(s.x, s.z) < 0) continue;
      // interpolate the deck height at the sample
      let best = 0, bd = Infinity; for (let i = 0; i < w.pts.length; i++) { const d = Math.hypot(w.pts[i][0] - s.x, w.pts[i][1] - s.z); if (d < bd) { bd = d; best = i; } }
      const h = w.hv[best], y = h >= .6 ? Math.round(h / .6) * .6 : G.height(s.x, s.z);
      const sd = hash(w.id, Math.round(s.x), 3) < .5 ? 1 : -1, vx = -s.dz * sd, vz = s.dx * sd, x = s.x + vx * 2.3, z = s.z + vz * 2.3;
      const a = Math.atan2(-vz, -vx);
      m.nodes.push({ name: 'mast', translation: [+x.toFixed(3), +y.toFixed(3), +z.toFixed(3)], rotation: yawQuat(-a) }); n++;
    }
  }
  return n;
}

/* ---------------- construction sites ---------------- */
function craneMesh(store, height, jib) {
  const V = .3, H = Math.round(height / V), J = Math.round(jib / V), C = Math.round(jib * .3 / V), W = J + C + 8, D = 9;
  const g = new Grid(W, H + 12, D), Y = g.m('craneY'), K = g.m('concD'), Wh = g.m('craneW'), cab = g.m('glassD');
  const mx = C + 2, mz = 2;   // mast corner
  for (let y = 0; y < H; y++) for (const [a, b] of [[0, 0], [5, 0], [0, 5], [5, 5]]) g.set(mx + a, y, mz + b, Y);   // mast legs (1.8 m square)
  for (let y = 0; y < H; y += 6) for (let s = 0; s < 6; s++) { g.set(mx + s, y + s, mz, Y); g.set(mx + s, y + s, mz + 5, Y); g.set(mx, y + s, mz + s, Y); g.set(mx + 5, y + s, mz + s, Y); }   // bracing
  const top = H;
  g.box(mx - 1, top, mz - 1, mx + 6, top + 2, mz + 6, Y);                 // slewing unit
  g.box(mx + 6, top + 1, mz + 1, mx + 8, top + 3, mz + 4, cab);              // cab
  for (let x = mx + 6; x < W; x++) { g.set(x, top + 2, mz + 1, Y); g.set(x, top + 2, mz + 4, Y); if (x % 4 === 0) { g.set(x, top + 3, mz + 2, Y); g.set(x, top + 4, mz + 2, Y); g.set(x, top + 2, mz + 2, Y); g.set(x, top + 2, mz + 3, Y); } g.set(x, top + 5, mz + 2, Y); }
  for (let x = 1; x < mx - 1; x++) { g.set(x, top + 2, mz + 1, Y); g.set(x, top + 2, mz + 4, Y); if (x % 4 === 0) g.box(x, top + 2, mz + 2, x, top + 2, mz + 3, Y); }
  g.box(1, top - 1, mz + 1, 6, top + 1, mz + 4, K);                          // counterweights
  g.box(mx + 1, top + 3, mz + 1, mx + 4, top + 11, mz + 4, Y);               // apex
  g.box(mx + 2, top + 9, mz + 2, mx + 3, top + 11, mz + 3, Wh);
  const m = instMesh(store, `crane_${height}`);
  meshGrid(g, store, m.prims, { cx: -(mx + 3) * V, cz: -(mz + 3) * V, oy: 0, cos: 1, sin: 0, x0: 0, z0: 0, vs: V });
  return m;
}
export function buildSites(F, G, store) {
  const cranes = [craneMesh(store, 48, 45), craneMesh(store, 72, 55), craneMesh(store, 96, 60)];
  const sites = [...F.land.filter(l => l.kind === 'construction'), ...F.buildings.filter(b => b.tags.building === 'construction')];
  let n = 0, q = 0;
  for (const s of sites) {
    const ring = s.outers[0], area = Math.abs(polygonArea(ring)); if (area < 200) continue;
    if (ring.some(([x, z]) => G.cell(x, z) < 0)) continue;
    const a = dominantAngle(ring), cs = Math.cos(a), sn = Math.sin(a), [cx, cz] = [ring.reduce((t, p) => t + p[0], 0) / ring.length, ring.reduce((t, p) => t + p[1], 0) / ring.length];
    const loc = ring.map(([x, z]) => rot(x - cx, z - cz, a));
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of loc) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const V = .6, ix0 = Math.floor(x0 / V) - 1, iz0 = Math.floor(z0 / V) - 1, nx = Math.ceil(x1 / V) - ix0 + 2, nz = Math.ceil(z1 / V) - iz0 + 2;
    if (nx * nz > 2e6) continue;
    const inside = new Uint8Array(nx * nz); fillRings([loc], ix0 * V, iz0 * V, V, nx, nz, (i, k) => { inside[k * nx + i] = 1; });
    const big = area > 1800, coreH = big ? 12 + Math.floor(hash(s.id, 1) * 5) * 8 : 0;
    const g = new Grid(nx, Math.round((coreH + 6) / V) + 2, nz), HO = g.m('hoard'), CO = g.m('conc'), CD = g.m('concD');
    // hoarding along the boundary
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      if (!inside[k * nx + i]) continue;
      const edge = !inside[k * nx + i - 1] || !inside[k * nx + i + 1] || !inside[(k - 1) * nx + i] || !inside[(k + 1) * nx + i];
      if (edge) g.box(i, 0, k, i, 3, k, HO);
    }
    // a rising concrete frame: core, columns and slabs of the floors cast so far
    if (big) {
      const ci = Math.floor(nx / 2), ck = Math.floor(nz / 2), cw = 5, cd = 7, floors = Math.floor(coreH / 3.6);
      let fx0 = nx, fx1 = 0, fz0 = nz, fz1 = 0;
      for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if (inside[k * nx + i]) { const ok = [[-6, 0], [6, 0], [0, -6], [0, 6]].every(([dx, dz]) => inside[(k + dz) * nx + i + dx]); if (ok) { fx0 = Math.min(fx0, i); fx1 = Math.max(fx1, i); fz0 = Math.min(fz0, k); fz1 = Math.max(fz1, k); } }
      if (fx1 > fx0 + 10 && fz1 > fz0 + 10) {
        const lim = (v, a, b) => Math.max(a, Math.min(b, v));
        const bx0 = lim(ci - 14, fx0, fx1), bx1 = lim(ci + 14, fx0, fx1), bz0 = lim(ck - 12, fz0, fz1), bz1 = lim(ck + 12, fz0, fz1);
        const done = Math.max(1, Math.floor(floors * (.4 + .5 * hash(s.id, 2))));
        for (let f = 1; f <= done; f++) { const y = f * 6 - 1; g.box(bx0, y, bz0, bx1, y, bz1, CO); }
        for (let i = bx0; i <= bx1; i += 8) for (let k = bz0; k <= bz1; k += 8) g.box(i, 0, k, i, done * 6 - 2, k, CD);
        g.box(ci - 2, 0, ck - 3, ci - 2 + cw - 1, Math.round(coreH / V), ck - 3 + cd - 1, CO);
        // the tower crane beside the core
        const ch = coreH + 30, mi = ch < 60 ? 0 : ch < 85 ? 1 : 2;
        const [lx, lz] = [((ci + 5) + ix0 + .5) * V, ((ck) + iz0 + .5) * V], wx = cx + lx * cs - lz * sn, wz = cz + lx * sn + lz * cs;
        cranes[mi].nodes.push({ name: 'crane', translation: [+wx.toFixed(2), 0, +wz.toFixed(2)], rotation: yawQuat(hash(s.id, 4) * Math.PI * 2) });
        n++;
      }
    }
    q += meshGrid(g, store, store.key(cx, cz), { cx, cz, oy: 0, cos: cs, sin: sn, x0: ix0 * V, z0: iz0 * V, vs: V });
  }
  return { cranes: n, quads: q };
}
