// Geometry helpers for the OSM-based city: projection, polygons, rasterisation, orientation.
// Local frame: metres, x east, z south (north is -z), y up. Origin at the centre of the modelled area.

export const ORIGIN = { lat: 53.47475, lon: -2.2440 };
const R_LAT = 111132.95, R_LON = 111319.49 * Math.cos(ORIGIN.lat * Math.PI / 180);
export const project = (lat, lon) => [(lon - ORIGIN.lon) * R_LON, (ORIGIN.lat - lat) * R_LAT];
export const unproject = (x, z) => [ORIGIN.lat - z / R_LAT, ORIGIN.lon + x / R_LON];

export function polygonArea(p) {        // signed, shoelace on [x,z] pairs
  let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1]);
  return a / 2;
}
export function centroid(p) {
  let cx = 0, cz = 0, a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const f = p[j][0] * p[i][1] - p[i][0] * p[j][1]; a += f; cx += (p[j][0] + p[i][0]) * f; cz += (p[j][1] + p[i][1]) * f;
  }
  if (Math.abs(a) < 1e-6) { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; }
  return [cx / (3 * a), cz / (3 * a)];
}
export function bbox(pts) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return [x0, z0, x1, z1];
}
export function pointInPolygon(x, z, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i][0], zi = p[i][1], xj = p[j][0], zj = p[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// even-odd scanline fill of rings (outer + holes) over a grid; cb(i, k) for each cell whose centre is inside.
// grid: origin (gx0, gz0) in metres, cell size cs, dimensions nx x nz
export function fillRings(rings, gx0, gz0, cs, nx, nz, cb) {
  let zmin = Infinity, zmax = -Infinity;
  for (const r of rings) for (const q of r) { if (q[1] < zmin) zmin = q[1]; if (q[1] > zmax) zmax = q[1]; }
  const k0 = Math.max(0, Math.floor((zmin - gz0) / cs)), k1 = Math.min(nz - 1, Math.ceil((zmax - gz0) / cs));
  const xs = [];
  for (let k = k0; k <= k1; k++) {
    const z = gz0 + (k + 0.5) * cs; xs.length = 0;
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const zi = r[i][1], zj = r[j][1];
      if ((zi > z) !== (zj > z)) xs.push(r[i][0] + (z - zi) * (r[j][0] - r[i][0]) / (zj - zi));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let n = 0; n + 1 < xs.length; n += 2) {
      const i0 = Math.max(0, Math.ceil((xs[n] - gx0) / cs - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[n + 1] - gx0) / cs - 0.5));
      for (let i = i0; i <= i1; i++) cb(i, k);
    }
  }
}
// cells within 'half' metres of a polyline (thick line with round joins); cb(i, k, t) with t = distance from the centre line
export function strokePolyline(pts, half, gx0, gz0, cs, nx, nz, cb) {
  for (let s = 0; s + 1 < pts.length; s++) {
    const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
    const minx = Math.min(ax, bx) - half, maxx = Math.max(ax, bx) + half, minz = Math.min(az, bz) - half, maxz = Math.max(az, bz) + half;
    const i0 = Math.max(0, Math.floor((minx - gx0) / cs)), i1 = Math.min(nx - 1, Math.ceil((maxx - gx0) / cs));
    const k0 = Math.max(0, Math.floor((minz - gz0) / cs)), k1 = Math.min(nz - 1, Math.ceil((maxz - gz0) / cs));
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const px = gx0 + (i + 0.5) * cs, pz = gz0 + (k + 0.5) * cs;
      let t = ((px - ax) * dx + (pz - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = px - (ax + t * dx), ez = pz - (az + t * dz), d = Math.sqrt(ex * ex + ez * ez);
      if (d <= half) cb(i, k, d);
    }
  }
}
// the building's dominant direction: the angle of the longest edges, weighted by length, folded into [0, 90)
export function dominantAngle(ring) {
  const bins = new Float64Array(180);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const dx = ring[i][0] - ring[j][0], dz = ring[i][1] - ring[j][1], L = Math.hypot(dx, dz);
    if (L < 0.5) continue;
    let a = Math.atan2(dz, dx) * 180 / Math.PI; a = ((a % 90) + 90) % 90;
    for (let d = -2; d <= 2; d++) bins[(Math.round(a * 2) + d + 180) % 180] += L * (1 - Math.abs(d) * 0.2);
  }
  let best = 0; for (let b = 1; b < 180; b++) if (bins[b] > bins[best]) best = b;
  return best / 2 * Math.PI / 180;
}
export const rot = (x, z, a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c + z * s, -x * s + z * c]; };   // world → local
export const unrot = (x, z, a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - z * s, x * s + z * c]; }; // local → world

export function hash(...v) {   // deterministic 0..1
  let h = 2166136261 >>> 0;
  for (const x of v) { h ^= (x | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2); h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; }
  return (h >>> 0) / 4294967296;
}
export function polylineLength(p) { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; }
// points every 'step' metres along a polyline, with the local direction
export function samplePolyline(p, step, offset = 0) {
  const out = []; let acc = offset;
  for (let i = 1; i < p.length; i++) {
    const ax = p[i - 1][0], az = p[i - 1][1], dx = p[i][0] - ax, dz = p[i][1] - az, L = Math.hypot(dx, dz);
    if (L < 1e-6) continue;
    while (acc <= L) { out.push({ x: ax + dx * acc / L, z: az + dz * acc / L, dx: dx / L, dz: dz / L }); acc += step; }
    acc -= L;
  }
  return out;
}
