// Clock dials and hands for the clock towers. A dial is true geometry rather than voxels: a disc of glass that glows at
// night ('clock', driven by the GUI's emissive levels), a gilded bezel and chapter ring, twelve gilded hour batons (the
// quarters doubled) and sixty minute dots. The hands are instanced nodes named clockhand:<tower>:<face>:hour|minute with
// their pivot at the dial's centre (local +y points at twelve, +z out of the dial), so the app can turn them to the time
// of day; a gilded boss covers the arbor.
import { addMaterials } from './mat.mjs';

addMaterials({
  clockRing: { p: 'plain', hex: '#c99a3a', r: .3, m: 1 },
  clockMark: { p: 'plain', hex: '#2a2622', r: .45, m: .2 },
});

const handMeshes = new Map();   // dial radius (cm) -> { hour, minute } instanced meshes

function instMesh(store, name) { const m = { name, prims: new Map(), nodes: [] }; store.inst.push(m); return m; }

// a convex polygon (counter-clockwise seen from +z) as a plate between depths z0 and z1, in a hand's local frame
function plate(p, pts, z0, z1) {
  const n = pts.length;
  for (let i = 1; i < n - 1; i++) {
    const a = pts[0], b = pts[i], c = pts[i + 1];
    p.tri([a[0], a[1], z1], [b[0], b[1], z1], [c[0], c[1], z1], [0, 0, 1], a, b, c);
    p.tri([a[0], a[1], z0], [c[0], c[1], z0], [b[0], b[1], z0], [0, 0, -1], a, c, b);
  }
  for (let i = 0; i < n; i++) {   // edges
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n], ex = bx - ax, ey = by - ay, l = Math.hypot(ex, ey) || 1;
    p.quad(ax, ay, z0, ex, ey, 0, 0, 0, z1 - z0, ey / l, -ex / l, 0, 0, 0, l, 0, 0, z1 - z0);
  }
}

function handsFor(store, r) {
  const key = Math.round(r * 100);
  if (handMeshes.has(key)) return handMeshes.get(key);
  const hour = instMesh(store, `clock_hour_${key}`), minute = instMesh(store, `clock_minute_${key}`);
  const H = store.prim(hour.prims, 'hand'), M = store.prim(minute.prims, 'hand'), G = store.prim(minute.prims, 'clockRing');
  // hour hand: a broad shaft, a spade near the tip and a short tail
  const hw = r * .05, hl = r * .56;
  plate(H, [[-hw, -r * .13], [hw, -r * .13], [hw * .7, hl * .8], [-hw * .7, hl * .8]], r * .02, r * .035);
  plate(H, [[0, hl * .64], [hw * 2.3, hl * .82], [0, hl], [-hw * 2.3, hl * .82]], r * .02, r * .035);
  plate(H, [[-hw * 1.7, -r * .2], [hw * 1.7, -r * .2], [hw * 1.7, -r * .12], [-hw * 1.7, -r * .12]], r * .02, r * .035);
  // minute hand: long and slender, a counterweight on the tail
  const mw = r * .032, ml = r * .86;
  plate(M, [[-mw, -r * .18], [mw, -r * .18], [mw * .7, ml * .92], [0, ml], [-mw * .7, ml * .92]], r * .04, r * .055);
  plate(M, [[-mw * 2.5, -r * .27], [mw * 2.5, -r * .27], [mw * 2.5, -r * .17], [-mw * 2.5, -r * .17]], r * .04, r * .055);
  // gilded boss over the arbor
  const boss = []; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; boss.push([Math.cos(a) * r * .055, Math.sin(a) * r * .055]); }
  plate(G, boss, r * .055, r * .075);
  const h = { hour, minute };
  handMeshes.set(key, h);
  return h;
}

// a dial at world point c = [x, y, z] (on its glass plane), facing the horizontal outward normal n = [nx, nz], radius r
export function addClock(store, tag, c, n, r) {
  const [x, y, z] = c, [nx, nz] = n, R = [nz, 0, -nx];      // R: right as seen from the front; (R, up, n) is right-handed
  const at = (rho, a, off = 0) => [x + R[0] * Math.sin(a) * rho + nx * off, y + Math.cos(a) * rho, z + R[2] * Math.sin(a) * rho + nz * off];
  const uv = P => [(P[0] - x) * R[0] + (P[2] - z) * R[2], y - P[1]];
  const g = store.group(store.key(x, z));
  const face = store.prim(g, 'clock'), ring = store.prim(g, 'clockRing'), mark = store.prim(g, 'clockMark');
  const N = [nx, 0, nz], S = 64;
  const tri = (p, a, b, cc) => p.tri(a, b, cc, N, uv(a), uv(b), uv(cc));     // counter-clockwise seen from the front
  for (let i = 0; i < S; i++) {
    const a0 = i / S * Math.PI * 2, a1 = (i + 1) / S * Math.PI * 2;
    // glass disc
    tri(face, at(0, 0), at(r * .97, a1), at(r * .97, a0));
    // bezel: a raised gilded ring with its outer edge
    const o0 = at(r, a0, .06), o1 = at(r, a1, .06), i0 = at(r * .95, a0, .06), i1 = at(r * .95, a1, .06);
    tri(ring, i0, i1, o1); tri(ring, i0, o1, o0);
    const b0 = at(r, a0, 0), b1 = at(r, a1, 0), mx = Math.sin((a0 + a1) / 2), my = Math.cos((a0 + a1) / 2);
    ring.quad(b0[0], b0[1], b0[2], b1[0] - b0[0], b1[1] - b0[1], b1[2] - b0[2], nx * .06, 0, nz * .06, R[0] * mx, my, R[2] * mx, 0, 0, r * .1, 0, 0, .06);
    // chapter ring: a thin gilded band inside the minute track
    const c0 = at(r * .8, a0, .012), c1 = at(r * .8, a1, .012), d0 = at(r * .82, a0, .012), d1 = at(r * .82, a1, .012);
    tri(ring, c0, c1, d1); tri(ring, c0, d1, d0);
  }
  // hour batons (the quarters doubled) and minute dots
  for (let m = 0; m < 60; m++) {
    const a = m / 60 * Math.PI * 2, hourMark = m % 5 === 0, quarter = m % 15 === 0;
    const r0 = hourMark ? r * .64 : r * .855, r1 = hourMark ? r * .78 : r * .885, w = hourMark ? r * (quarter ? .034 : .021) : r * .012;
    const p = hourMark ? ring : mark;
    const t = [Math.cos(a) * R[0], -Math.sin(a), Math.cos(a) * R[2]];   // clockwise tangent
    const base = at(r0, a, .02), tip = at(r1, a, .02);
    const q = [base[0] - t[0] * w, base[1] - t[1] * w, base[2] - t[2] * w];
    p.quad(q[0], q[1], q[2], tip[0] - base[0], tip[1] - base[1], tip[2] - base[2], t[0] * 2 * w, t[1] * 2 * w, t[2] * 2 * w, nx, 0, nz, 0, 0, r1 - r0, 0, 0, 2 * w);
  }
  // the hands: pivot on the dial's axis, a little in front of the glass
  const h = handsFor(store, r), yaw = Math.atan2(nx, nz), rot = [0, +Math.sin(yaw / 2).toFixed(6), 0, +Math.cos(yaw / 2).toFixed(6)];
  const pivot = [+(x + nx * .02).toFixed(3), +y.toFixed(3), +(z + nz * .02).toFixed(3)];
  h.hour.nodes.push({ name: `clockhand:${tag}:hour`, translation: pivot, rotation: rot });
  h.minute.nodes.push({ name: `clockhand:${tag}:minute`, translation: pivot, rotation: rot });
}
