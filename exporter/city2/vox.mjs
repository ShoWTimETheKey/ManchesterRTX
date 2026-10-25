// Voxel grids in a building's own (rotated) frame, a greedy mesher that writes world-space quads, and the mesh store
// that the GLB writer reads. Quads carry position, normal and a texture coordinate in local metres / tile size;
// tangents are left to the renderer (Donut derives them from the UVs).
import { MAT } from './mat.mjs';

export const GHOST = 255;   // solid for neighbour tests, never drawn

export class Grid {
  constructor(nx, ny, nz) {
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.data = new Uint8Array(nx * ny * nz);
    this.pal = [null]; this.palIdx = new Map();
  }
  m(name) {   // palette index of a material name
    let i = this.palIdx.get(name);
    if (i === undefined) {
      if (!MAT[name]) throw new Error(`unknown material ${name}`);
      i = this.pal.length; if (i >= GHOST) throw new Error('grid palette full');
      this.pal.push(name); this.palIdx.set(name, i);
    }
    return i;
  }
  idx(x, y, z) { return (y * this.nz + z) * this.nx + x; }
  in(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz; }
  get(x, y, z) { return this.in(x, y, z) ? this.data[(y * this.nz + z) * this.nx + x] : 0; }
  set(x, y, z, v) { if (this.in(x, y, z)) this.data[(y * this.nz + z) * this.nx + x] = v; }
  setIfEmpty(x, y, z, v) { if (this.in(x, y, z)) { const i = (y * this.nz + z) * this.nx + x; if (!this.data[i]) this.data[i] = v; } }
  box(x0, y0, z0, x1, y1, z1, v) {   // inclusive, clipped
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); z0 = Math.max(0, z0);
    x1 = Math.min(this.nx - 1, x1); y1 = Math.min(this.ny - 1, y1); z1 = Math.min(this.nz - 1, z1);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) { const b = (y * this.nz + z) * this.nx; this.data.fill(v, b + x0, b + x1 + 1); }
  }
}

/* ---------------- mesh store ---------------- */
export class Prim {
  constructor(mat) {
    this.mat = mat; this.cap = 256; this.vc = 0; this.ic = 0;
    this.pos = new Float32Array(this.cap * 3); this.nrm = new Float32Array(this.cap * 3); this.uv = new Float32Array(this.cap * 2);
    this.idx = new Uint32Array(this.cap * 1.5);
  }
  grow(nv) {
    if (this.vc + nv <= this.cap) return;
    let cap = this.cap; while (cap < this.vc + nv) cap *= 2;
    const g = (a, k) => { const b = new a.constructor(cap * k); b.set(a); return b; };
    this.pos = g(this.pos, 3); this.nrm = g(this.nrm, 3); this.uv = g(this.uv, 2); this.idx = g(this.idx, 1.5); this.cap = cap;
  }
  // a parallelogram p, p+e1, p+e1+e2, p+e2 facing n; uv at p and its change along e1 and e2
  quad(px, py, pz, ax, ay, az, bx, by, bz, nx, ny, nz, u, v, au, av, bu, bv) {
    if ((ay * bz - az * by) * nx + (az * bx - ax * bz) * ny + (ax * by - ay * bx) * nz < 0) {   // keep counter-clockwise seen from outside
      let t = ax; ax = bx; bx = t; t = ay; ay = by; by = t; t = az; az = bz; bz = t; t = au; au = bu; bu = t; t = av; av = bv; bv = t;
    }
    this.grow(4);
    const P = this.pos, N = this.nrm, U = this.uv, o = this.vc;
    let i = o * 3, j = o * 2;
    P[i] = px; P[i + 1] = py; P[i + 2] = pz;
    P[i + 3] = px + ax; P[i + 4] = py + ay; P[i + 5] = pz + az;
    P[i + 6] = px + ax + bx; P[i + 7] = py + ay + by; P[i + 8] = pz + az + bz;
    P[i + 9] = px + bx; P[i + 10] = py + by; P[i + 11] = pz + bz;
    for (let k = 0; k < 4; k++) { N[i + 3 * k] = nx; N[i + 3 * k + 1] = ny; N[i + 3 * k + 2] = nz; }
    U[j] = u; U[j + 1] = v; U[j + 2] = u + au; U[j + 3] = v + av; U[j + 4] = u + au + bu; U[j + 5] = v + av + bv; U[j + 6] = u + bu; U[j + 7] = v + bv;
    const I = this.idx, c = this.ic;
    I[c] = o; I[c + 1] = o + 1; I[c + 2] = o + 2; I[c + 3] = o; I[c + 4] = o + 2; I[c + 5] = o + 3;
    this.vc += 4; this.ic += 6;
  }
  // a general triangle (used by props with sloped faces)
  tri(a, b, c, n, ua, ub, uc) {
    this.grow(3);
    const P = this.pos, N = this.nrm, U = this.uv, o = this.vc;
    P.set(a, o * 3); P.set(b, o * 3 + 3); P.set(c, o * 3 + 6);
    for (let k = 0; k < 3; k++) N.set(n, (o + k) * 3);
    U.set(ua, o * 2); U.set(ub, o * 2 + 2); U.set(uc, o * 2 + 4);
    // tri count may not be a multiple of the quad allocation; grow() sized idx at 1.5x vertices, enough for triangles too
    this.idx[this.ic] = o; this.idx[this.ic + 1] = o + 1; this.idx[this.ic + 2] = o + 2;
    this.vc += 3; this.ic += 3;
  }
  get quads() { return this.ic / 6; }
}

// meshes grouped into world tiles (one glTF mesh per tile), plus instanced meshes for repeated props
export class MeshStore {
  constructor(tile = 192) { this.tile = tile; this.groups = new Map(); this.inst = []; }
  key(x, z) { return `${Math.floor(x / this.tile)}_${Math.floor(z / this.tile)}`; }
  group(name) { let g = this.groups.get(name); if (!g) { g = new Map(); this.groups.set(name, g); } return g; }
  prim(group, mat) { const g = typeof group === 'string' ? this.group(group) : group; let p = g.get(mat); if (!p) { p = new Prim(mat); g.set(mat, p); } return p; }
  stats() { let q = 0, prims = 0; for (const g of this.groups.values()) for (const p of g.values()) { q += p.quads; prims++; } for (const m of this.inst) for (const p of m.prims.values()) { q += p.quads; prims++; } return { quads: q, prims, groups: this.groups.size }; }
}

/* ---------------- greedy mesher ---------------- */
// face frames: n normal axis/sign; u, v texture axes (local), as in the first exporter: v runs "down" on walls
const tileOf = name => { const d = MAT[name]; return d.water ? (d.t || 8) : d.glass ? 3 : (d.t || 2); };

// Mesh a grid. xf: { cx, cz, oy: world position of the local origin, cos, sin: rotation local→world about Y,
// x0, z0: local metres of voxel (0,0,0), vs: voxel size, uo, vo: texture offsets, skipBottom: drop downward faces of layer 0 }
export function meshGrid(g, store, group, xf) {
  const { nx, ny, nz, data } = g, SY = nx * nz, SZ = nx;
  const vs = xf.vs, cs = xf.cos, sn = xf.sin, gx = xf.x0, gz = xf.z0, cx = xf.cx, cz = xf.cz, oy = xf.oy, uo = xf.uo || 0, vo = xf.vo || 0;
  const G = typeof group === 'string' ? store.group(group) : group;
  const prims = g.pal.map(n => n ? store.prim(G, n) : null), tiles = g.pal.map(n => n ? tileOf(n) : 1);
  // occupied bounds
  let bx0 = nx, by0 = ny, bz0 = nz, bx1 = -1, by1 = -1, bz1 = -1;
  for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
    const b = y * SY + z * SZ;
    for (let x = 0; x < nx; x++) { const v = data[b + x]; if (v && v !== GHOST) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; if (z < bz0) bz0 = z; if (z > bz1) bz1 = z; } }
  }
  if (bx1 < 0) return 0;
  const W = Math.max(nx, ny, nz), mask = new Uint8Array(W * W);
  let quads = 0;
  // world transform of a local voxel-space point and direction
  const emit = (id, X, Y, Z, ax, ay, az, bx, by, bz, axis, sgn) => {
    const p = prims[id], t = tiles[id];
    const lx = X * vs + gx, ly = Y * vs, lz = Z * vs + gz;
    const Ax = ax * vs, Ay = ay * vs, Az = az * vs, Bx = bx * vs, By = by * vs, Bz = bz * vs;
    // local normal
    let lnx = 0, lny = 0, lnz = 0; if (axis === 0) lnx = sgn; else if (axis === 1) lny = sgn; else lnz = sgn;
    // texture axes in local space (T = u direction, B = v direction)
    let Tx, Ty, Tz, Bx_, By_, Bz_;
    if (axis === 0) { Tx = 0; Ty = 0; Tz = -sgn; Bx_ = 0; By_ = -1; Bz_ = 0; }
    else if (axis === 2) { Tx = sgn; Ty = 0; Tz = 0; Bx_ = 0; By_ = -1; Bz_ = 0; }
    else { Tx = 1; Ty = 0; Tz = 0; Bx_ = 0; By_ = 0; Bz_ = sgn; }
    const u = (lx * Tx + ly * Ty + lz * Tz) / t + uo, v = (lx * Bx_ + ly * By_ + lz * Bz_) / t + vo;
    const au = (Ax * Tx + Ay * Ty + Az * Tz) / t, av = (Ax * Bx_ + Ay * By_ + Az * Bz_) / t;
    const bu = (Bx * Tx + By * Ty + Bz * Tz) / t, bv = (Bx * Bx_ + By * By_ + Bz * Bz_) / t;
    p.quad(cx + lx * cs - lz * sn, oy + ly, cz + lx * sn + lz * cs,
      Ax * cs - Az * sn, Ay, Ax * sn + Az * cs, Bx * cs - Bz * sn, By, Bx * sn + Bz * cs,
      lnx * cs - lnz * sn, lny, lnx * sn + lnz * cs, u, v, au, av, bu, bv);
    quads++;
  };
  const greedy = (Wd, Hd, cb) => {
    for (let j = 0; j < Hd; j++) for (let i = 0; i < Wd;) {
      const m = mask[j * Wd + i]; if (!m) { i++; continue; }
      let w = 1; while (i + w < Wd && mask[j * Wd + i + w] === m) w++;
      let h = 1;
      grow: while (j + h < Hd) { const r = (j + h) * Wd + i; for (let k = 0; k < w; k++) if (mask[r + k] !== m) break grow; h++; }
      for (let jj = 0; jj < h; jj++) mask.fill(0, (j + jj) * Wd + i, (j + jj) * Wd + i + w);
      cb(i, j, w, h, m); i += w;
    }
  };
  const vis = id => id !== 0 && id !== GHOST;
  // ±X faces, mask over (z, y)
  { const Wd = bz1 - bz0 + 1, Hd = by1 - by0 + 1;
    for (let x = bx0; x <= bx1; x++) for (const s of [1, -1]) {
      const nbIn = x + s >= 0 && x + s < nx; let any = false;
      for (let y = by0; y <= by1; y++) for (let z = bz0; z <= bz1; z++) {
        const i = y * SY + z * SZ + x, id = data[i]; let m = 0;
        if (vis(id) && !(nbIn && data[i + s])) { m = id; any = true; }
        mask[(y - by0) * Wd + (z - bz0)] = m;
      }
      if (!any) continue;
      const X = s > 0 ? x + 1 : x;
      greedy(Wd, Hd, (i, j, w, h, m) => emit(m, X, by0 + j, bz0 + i, 0, 0, w, 0, h, 0, 0, s));
    } }
  // ±Z faces, mask over (x, y)
  { const Wd = bx1 - bx0 + 1, Hd = by1 - by0 + 1;
    for (let z = bz0; z <= bz1; z++) for (const s of [1, -1]) {
      const nbIn = z + s >= 0 && z + s < nz; let any = false;
      for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
        const i = y * SY + z * SZ + x, id = data[i]; let m = 0;
        if (vis(id) && !(nbIn && data[i + s * SZ])) { m = id; any = true; }
        mask[(y - by0) * Wd + (x - bx0)] = m;
      }
      if (!any) continue;
      const Z = s > 0 ? z + 1 : z;
      greedy(Wd, Hd, (i, j, w, h, m) => emit(m, bx0 + i, by0 + j, Z, w, 0, 0, 0, h, 0, 2, s));
    } }
  // ±Y faces, mask over (x, z)
  { const Wd = bx1 - bx0 + 1, Hd = bz1 - bz0 + 1;
    for (let y = by0; y <= by1; y++) for (const s of [1, -1]) {
      if (s < 0 && y === 0 && xf.skipBottom !== false) continue;
      const nbIn = y + s >= 0 && y + s < ny; let any = false;
      for (let z = bz0; z <= bz1; z++) for (let x = bx0; x <= bx1; x++) {
        const i = y * SY + z * SZ + x, id = data[i]; let m = 0;
        if (vis(id) && !(nbIn && data[i + s * SY])) { m = id; any = true; }
        mask[(z - bz0) * Wd + (x - bx0)] = m;
      }
      if (!any) continue;
      const Y = s > 0 ? y + 1 : y;
      greedy(Wd, Hd, (i, j, w, h, m) => emit(m, bx0 + i, Y, bz0 + j, w, 0, 0, 0, 0, h, 1, s));
    } }
  return quads;
}
