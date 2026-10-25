// Raised lettering from a 1-bit mask (exporter/data/*.json, made by tools/lettering.ps1): gilded capitals standing
// proud of a dark stone band on a facade. Runs of ink are merged into rectangles and each becomes a small box, so the
// letters catch the light and cast their own shadows.
import fs from 'node:fs';
import { addMaterials } from './mat.mjs';

addMaterials({
  letterGilt: { p: 'plain', hex: '#d2a647', r: .28, m: 1 },
});

const cache = new Map();
export function loadMask(name) {
  if (!cache.has(name)) cache.set(name, JSON.parse(fs.readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8')));
  return cache.get(name);
}

// rectangles [x, y, w, h] covering the ink: horizontal runs, merged downwards while identical
function rectangles(mask) {
  const open = new Map(), out = [];
  mask.rows.forEach((runs, y) => {
    const seen = new Set();
    for (const [x, w] of runs) {
      const k = `${x},${w}`; seen.add(k);
      if (open.has(k)) open.get(k)[3]++; else open.set(k, [x, y, w, 1]);
    }
    for (const [k, r] of open) if (!seen.has(k)) { out.push(r); open.delete(k); }
  });
  for (const r of open.values()) out.push(r);
  return out;
}

// a box from origin o along a (width), b (height, downwards) and the outward normal n (depth d)
function box(p, o, a, b, n, d) {
  const add = (u, v, s) => [u[0] + v[0] * s, u[1] + v[1] * s, u[2] + v[2] * s];
  const len = v => Math.hypot(v[0], v[1], v[2]) || 1, unit = v => { const l = len(v); return [v[0] / l, v[1] / l, v[2] / l]; };
  const f = add(o, n, d), ua = unit(a), ub = unit(b), N = [n[0] * d, n[1] * d, n[2] * d];
  p.quad(...f, ...a, ...b, ...n, 0, 0, len(a), 0, 0, len(b));                                         // front
  p.quad(...o, ...b, ...N, -ua[0], -ua[1], -ua[2], 0, 0, len(b), 0, 0, d);                             // left
  p.quad(...add(o, a, 1), ...b, ...N, ...ua, 0, 0, len(b), 0, 0, d);                                   // right
  p.quad(...o, ...a, ...N, -ub[0], -ub[1], -ub[2], 0, 0, len(a), 0, 0, d);                             // top
  p.quad(...add(o, b, 1), ...a, ...N, ...ub, 0, 0, len(a), 0, 0, d);                                   // bottom
}

// c: centre of the inscription on the wall plane (world), n: outward horizontal normal [nx, nz], cap: letter height (m)
export function addLettering(store, maskName, c, n, cap, { band = 'letterBand', letters = 'letterGilt', margin = .22, bandDepth = .07, letterDepth = .035 } = {}) {
  const m = loadMask(maskName), px = cap / m.height, W = m.width * px, H = m.height * px;
  const [x, y, z] = c, [nx, nz] = n, R = [nz, 0, -nx], N = [nx, 0, nz], DOWN = [0, -1, 0];
  const g = store.group(store.key(x, z));
  // the stone band
  const b0 = [x - R[0] * (W / 2 + margin), y + H / 2 + margin, z - R[2] * (W / 2 + margin)];
  box(store.prim(g, band), b0, [R[0] * (W + 2 * margin), 0, R[2] * (W + 2 * margin)], [0, -(H + 2 * margin), 0], N, bandDepth);
  // the letters, standing on the band
  const L = store.prim(g, letters);
  const left = [x - R[0] * W / 2 + N[0] * bandDepth, y + H / 2, z - R[2] * W / 2 + N[2] * bandDepth];
  let n2 = 0;
  for (const [rx, ry, rw, rh] of rectangles(m)) {
    const o = [left[0] + R[0] * rx * px, left[1] - ry * px, left[2] + R[2] * rx * px];
    box(L, o, [R[0] * rw * px, 0, R[2] * rw * px], [0, -rh * px, 0], N, letterDepth); n2++;
  }
  return { width: W, height: H, boxes: n2 };
}
