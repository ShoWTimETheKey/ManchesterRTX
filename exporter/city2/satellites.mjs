// The two football grounds, too far out for the city plinth, stand on their own round plinths at the table's edge in
// their true directions, with the distance compressed: the Etihad Stadium to the east and Old Trafford to the west.
// Built from their OSM outlines at 0.6 m: raked stands with blue or red seats rising from the pitch, a concourse wall,
// the roof with a ring of floodlights under its inner edge; the Etihad's eight spiral ramp towers and twelve cable
// masts, Old Trafford's cantilever trusses; a striped pitch with its markings.
import { fillRings, rot, hash, dominantAngle, centroid } from './geo.mjs';
import { Grid, meshGrid } from './vox.mjs';
import { addMaterials } from './mat.mjs';
import { obox } from './props.mjs';
import { SLAB } from './ground.mjs';

addMaterials({
  cityBlue: { p: 'plain', hex: '#6cabdd', r: .45 }, cityBlue2: { p: 'plain', hex: '#5f9ccd', r: .45 },
  utdRed: { p: 'plain', hex: '#c3212b', r: .45 }, utdRed2: { p: 'plain', hex: '#ad1d26', r: .45 },
  seatGrey: { p: 'plain', hex: '#cfd3d6', r: .5 },
  roofPoly: { p: 'plain', hex: '#e3e8ea', r: .35 },
  floodLamp: { p: 'plain', hex: '#cfd5da', r: .3, em: 'floods', night: '#f4f8ff' },
  cable: { p: 'plain', hex: '#d8dcdf', r: .3, m: 1 },
});
const V = .6;

const STADIUMS = [
  { id: 26329734, name: 'Etihad Stadium', at: [1580, -934], along: 'x', seat: ['cityBlue', 'cityBlue2'], roof: 'roofPoly', roofOuter: 'cladL', wall: 'cladL', H: 46, etihad: true },
  { id: 99403577, name: 'Old Trafford', at: [-1580, 1289], along: 'z', seat: ['utdRed', 'utdRed2'], roof: 'metal', roofOuter: 'metal', wall: 'cladG', H: 46, trusses: true },
];

export function buildSatellites(F, store, log = () => {}) {
  let q = 0; const out = [];
  for (const S of STADIUMS) {
    const f = F.land.find(l => l.id === S.id) || F.buildings.find(b => b.id === S.id);
    if (!f) { log(`  missing ${S.name}`); continue; }
    const ring = f.outers[0], [ocx, ocz] = centroid(ring), ang = dominantAngle(ring), cs = Math.cos(ang), sn = Math.sin(ang);
    const loc = ring.map(([x, z]) => rot(x - ocx, z - ocz, ang));
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of loc) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const M = 20, ix0 = Math.floor(x0 / V) - M, iz0 = Math.floor(z0 / V) - M, nx = Math.ceil(x1 / V) + M - ix0, nz = Math.ceil(z1 / V) + M - iz0;
    const inside = new Uint8Array(nx * nz); fillRings([loc], ix0 * V, iz0 * V, V, nx, nz, (i, k) => { inside[k * nx + i] = 1; });
    // distance to the outline (cells inside), for the concourse wall
    const edge = new Float32Array(nx * nz).fill(1e3);
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if (inside[k * nx + i]) { let d = 1e3; for (let r = 1; r < 12 && d === 1e3; r++) for (const [di, dk] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) { const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= nx || kk >= nz || !inside[kk * nx + ii]) { d = Math.min(d, Math.hypot(di, dk) * V); } } edge[k * nx + i] = d; }
    // the bowl ends at the typical outline distance from the pitch; lobes beyond it (the Etihad's ramp towers) are not stands
    const PA = 55.5, PB = 37;   // pitch half-length and half-width with the run-off
    const dOf = (i, k) => { const u0 = (ix0 + i + .5) * V, v0 = (iz0 + k + .5) * V, [u, v] = S.along === 'x' ? [u0, v0] : [v0, u0]; return Math.hypot(Math.max(0, Math.abs(u) - PA), Math.max(0, Math.abs(v) - PB)); };
    const bd = []; for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if (inside[k * nx + i] && edge[k * nx + i] < .7) bd.push(dOf(i, k));
    bd.sort((a, b) => a - b); const dm = bd[Math.floor(bd.length * .35)] || 60;
    const lobes = [];
    { const seen = new Uint8Array(nx * nz);
      for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
        const c = k * nx + i; if (!inside[c] || seen[c] || dOf(i, k) <= dm + 2) continue;
        const st = [c], cells = []; seen[c] = 1;
        while (st.length) { const cc = st.pop(); cells.push(cc); const ii = cc % nx, kk = (cc / nx) | 0;
          for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = ii + di, b = kk + dk, n2 = b * nx + a; if (a >= 0 && b >= 0 && a < nx && b < nz && inside[n2] && !seen[n2] && dOf(a, b) > dm + 2) { seen[n2] = 1; st.push(n2); } } }
        if (cells.length * V * V > 40) { let si = 0, sk = 0; for (const cc of cells) { si += cc % nx; sk += (cc / nx) | 0; } lobes.push({ i: si / cells.length, k: sk / cells.length, r: Math.sqrt(cells.length * V * V / Math.PI) }); }
      } }
    for (let c = 0; c < nx * nz; c++) if (inside[c] && dOf(c % nx, (c / nx) | 0) > dm + 2) inside[c] = 0;
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if (inside[k * nx + i]) { let d = 1e3; for (let r = 1; r < 12 && d === 1e3; r++) for (const [di, dk] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) { const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= nx || kk >= nz || !inside[kk * nx + ii]) d = Math.min(d, Math.hypot(di, dk) * V); } edge[k * nx + i] = d; }
    const H = S.H, g = new Grid(nx, Math.round((S.etihad ? 74 : H + 8) / V), nz);
    const CO = g.m('conc'), CD = g.m('concD'), WA = g.m(S.wall), GL = g.m('glassD'), RF = g.m(S.roof), RO = g.m(S.roofOuter), FL = g.m('floodLamp');
    const SEATS = S.seat.map(n => g.m(n)), PITCH = [g.m('pitch'), g.m('grass')], MT = g.m('metalD'), SG = g.m('seatGrey'), PL = g.m('plaza');
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const c = k * nx + i, u0 = (ix0 + i + .5) * V, v0 = (iz0 + k + .5) * V;
      const [u, v] = S.along === 'x' ? [u0, v0] : [v0, u0];
      if (!inside[c]) continue;
      const du = Math.max(0, Math.abs(u) - PA), dv = Math.max(0, Math.abs(v) - PB), d = Math.hypot(du, dv), e = edge[c];
      const set = (y0, y1, m) => { for (let y = Math.round(y0 / V); y < Math.round(y1 / V); y++) g.set(i, y, k, m); };
      if (d <= 0) {   // the pitch: mown stripes
        set(0, .3, PITCH[Math.floor((u + PA) / 5.5) & 1]);
        continue;
      }
      if (e < 3.6) {   // concourse wall: cladding with glazed bands, open at the top under the roof
        set(0, H - 1.2, WA);
        for (const [a, b] of [[4, 5.8], [14, 15.8], [26, 27.8]]) if ((Math.atan2(v, u) * 60 | 0) % 3) set(a, b, GL);
        if (e < .7) set(H - 1.2, H, RO);
      } else if (d < 4) set(0, .9, CD);   // the low wall around the pitch
      else {
        // raked seating in two tiers with a gap (the upper tier overhangs a little)
        const t = d - 4, lower = Math.min(t, 24), hs = 1 + lower * .52 + (t > 26 ? 1.5 + (t - 26) * .62 : 0);
        const top = Math.min(hs, H - 3);
        set(0, top, CO);
        g.set(i, Math.round(top / V), k, (t > 24 && t < 26) ? CD : (hash(i >> 2, k >> 2) < .04 ? SG : SEATS[(Math.floor(top / V)) & 1]));
      }
      // the roof covers the stands; the Etihad's is a saddle, higher over the sides than over the ends
      if (d > 7) {
        const s = S.etihad ? (v / PB) ** 2 / ((u / PA) ** 2 + (v / PB) ** 2 + 1e-6) : 1, Hr = S.etihad ? H - 7 + 7 * s : H;
        set(Hr - .6, Hr, d < 15 ? RF : RO); if (d < 8.5) set(Hr - 1.2, Hr - .6, FL);
        if (e < 3.6) set(Math.min(H - 1.2, Hr - .6), Hr - .6, WA);
      }
    }
    // Etihad: spiral ramp towers in the outline's lobes and twelve masts carrying the roof on cables
    const CAB = [];
    if (S.etihad) {
      const rOut = Math.max(x1 - x0, z1 - z0) / 2;
      for (const lb of lobes) {
        const R = Math.min(9, Math.max(5.5, lb.r)), ci = Math.round(lb.i), ck = Math.round(lb.k);
        for (let y = 0; y < Math.round(38 / V); y++) for (let dk = -16; dk <= 16; dk++) for (let di = -16; di <= 16; di++) {
          const r = Math.hypot(di, dk) * V; if (r > R) continue;
          const th = Math.atan2(dk, di), ramp = ((y * V / 3.2 - th / (2 * Math.PI)) % 1 + 1) % 1;
          if (r > R - 1.3) g.set(ci + di, y, ck + dk, ramp < .25 ? CO : (ramp < .3 ? MT : 0));
          else if (r < 1.8) g.set(ci + di, y, ck + dk, CD);
        }
      }
      for (let n = 0; n < 12; n++) {
        const a = n * Math.PI / 6 + .13, tx = Math.cos(a) * (rOut + 14), tz = Math.sin(a) * (rOut + 14), ci = Math.round(tx / V) - ix0, ck = Math.round(tz / V) - iz0;
        g.box(ci - 1, 0, ck - 1, ci, Math.round(70 / V), ck, MT);
        CAB.push([tx, tz, a]);
      }
    }
    // Old Trafford: cantilever trusses standing over the roof
    if (S.trusses) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const c = k * nx + i; if (!inside[c]) continue;
      const u0 = (ix0 + i + .5) * V, v0 = (iz0 + k + .5) * V, [u, v] = S.along === 'x' ? [u0, v0] : [v0, u0];
      const d = Math.hypot(Math.max(0, Math.abs(u) - PA), Math.max(0, Math.abs(v) - PB)), along = Math.abs(u) > PA ? v : u;
      if (d > 8 && ((along % 12) + 12) % 12 < 1.2) { const hh = H + Math.min(6, (d - 8) * .25) * (1 - Math.max(0, d - 30) / 30); for (let y = Math.round(H / V); y < Math.round(Math.max(H, hh) / V); y++) g.set(i, y, k, MT); }
    }
    const [tx, tz] = S.at;
    q += meshGrid(g, store, store.key(tx, tz), { cx: tx, cz: tz, oy: 0, cos: cs, sin: sn, x0: ix0 * V, z0: iz0 * V, vs: V });
    // cables from the mast tops to the roof's inner edge, as thin rods
    const P = store.prim(store.group(store.key(tx, tz)), 'cable');
    const W = (lx, lz) => [tx + lx * cs - lz * sn, tz + lx * sn + lz * cs];
    for (const [mx, mz, a] of CAB) {
      const [ax, az] = W(mx, mz), ins = Math.max(x1 - x0, z1 - z0) / 2 - 22, [bx, bz] = W(Math.cos(a) * ins, Math.sin(a) * ins);
      for (const yb of [H, H - 3]) {
        const L = Math.hypot(bx - ax, 70 - yb, bz - az), steps = Math.ceil(L / 2);
        for (let s = 0; s < steps; s++) { const f0 = s / steps, f1 = (s + 1) / steps, x = ax + (bx - ax) * (f0 + f1) / 2, z = az + (bz - az) * (f0 + f1) / 2, y = 70 + (yb - 70) * f1;
          const hx = bx - ax, hz = bz - az, hl = Math.hypot(hx, hz); obox(P, x, y, z, hx / hl, hz / hl, hl / steps, .12, .12, 1); }
      }
    }
    // pitch markings
    const MK = store.prim(store.group(store.key(tx, tz)), 'pitchLine');
    const toW = (u, v) => S.along === 'x' ? W(u, v) : W(v, u);
    const line = (u0, v0, u1, v1) => { const [ax, az] = toW(u0, v0), [bx, bz] = toW(u1, v1), L = Math.hypot(bx - ax, bz - az); if (L < .01) return; obox(MK, (ax + bx) / 2, .3, (az + bz) / 2, (bx - ax) / L, (bz - az) / L, L, .12, .01, 1); };
    const a = 52.5, b = 34;
    line(-a, -b, a, -b); line(-a, b, a, b); line(-a, -b, -a, b); line(a, -b, a, b); line(0, -b, 0, b);
    for (let s = 0; s < 48; s++) { const t0 = s / 48 * 2 * Math.PI, t1 = (s + 1) / 48 * 2 * Math.PI; line(9.15 * Math.cos(t0), 9.15 * Math.sin(t0), 9.15 * Math.cos(t1), 9.15 * Math.sin(t1)); }
    for (const sg of [-1, 1]) { line(sg * a, -20.16, sg * (a - 16.5), -20.16); line(sg * a, 20.16, sg * (a - 16.5), 20.16); line(sg * (a - 16.5), -20.16, sg * (a - 16.5), 20.16);
      line(sg * a, -9.16, sg * (a - 5.5), -9.16); line(sg * a, 9.16, sg * (a - 5.5), 9.16); line(sg * (a - 5.5), -9.16, sg * (a - 5.5), 9.16); }
    // the round plinth: a paved forecourt and lawn, the slab's edge, the walnut plinth
    const R = Math.max(x1 - x0, z1 - z0) / 2 + 34;
    disc(store, tx, tz, R, .15, 'plaza', 'grass', R - 14);
    out.push({ name: S.name, x: tx, z: tz, R });
    log(`  ${S.name}: placed at ${tx}, ${tz}`);
  }
  return { quads: q, sats: out };
}

// a round platform: top (paving within rIn, lawn outside), slab edge to SLAB, and the wooden plinth below with a rim
function disc(store, cx, cz, R, top, matIn, matOut, rIn) {
  const grp = store.group(store.key(cx, cz)), N = 96;
  const A = store.prim(grp, matIn), B = store.prim(grp, matOut), S = store.prim(grp, 'slabSide'), Pl = store.prim(grp, 'plinth');
  const pt = (r, n) => [cx + r * Math.cos(n / N * 2 * Math.PI), cz + r * Math.sin(n / N * 2 * Math.PI)];
  for (let n = 0; n < N; n++) {
    const [ax, az] = pt(rIn, n), [bx, bz] = pt(rIn, n + 1), [cx2, cz2] = pt(R, n), [dx, dz] = pt(R, n + 1);
    A.tri([cx, top, cz], [bx, top, bz], [ax, top, az], [0, 1, 0], [cx / 2.4, cz / 2.4], [bx / 2.4, bz / 2.4], [ax / 2.4, az / 2.4]);
    B.tri([ax, top, az], [bx, top, bz], [dx, top, dz], [0, 1, 0], [ax / 2, az / 2], [bx / 2, bz / 2], [dx / 2, dz / 2]);
    B.tri([ax, top, az], [dx, top, dz], [cx2, top, cz2], [0, 1, 0], [ax / 2, az / 2], [dx / 2, dz / 2], [cx2 / 2, cz2 / 2]);
    // edges
    const nmx = Math.cos((n + .5) / N * 2 * Math.PI), nmz = Math.sin((n + .5) / N * 2 * Math.PI), L = Math.hypot(dx - cx2, dz - cz2);
    S.quad(cx2, SLAB, cz2, dx - cx2, 0, dz - cz2, 0, top - SLAB, 0, nmx, 0, nmz, 0, 0, L / 4, 0, 0, (top - SLAB) / 4);
    const [ex, ez] = pt(R + 8, n), [fx, fz] = pt(R + 8, n + 1);
    Pl.quad(ex, SLAB - 36, ez, fx - ex, 0, fz - ez, 0, 36, 0, nmx, 0, nmz, 0, 0, L / 8, 0, 0, 36 / 8);
    Pl.tri([cx2, SLAB, cz2], [dx, SLAB, dz], [fx, SLAB, fz], [0, 1, 0], [cx2 / 8, cz2 / 8], [dx / 8, dz / 8], [fx / 8, fz / 8]);
    Pl.tri([cx2, SLAB, cz2], [fx, SLAB, fz], [ex, SLAB, ez], [0, 1, 0], [cx2 / 8, cz2 / 8], [fx / 8, fz / 8], [ex / 8, ez / 8]);
  }
}
