// OSM buildings → voxel buildings (0.6 m) in each building's own frame.
// Heights come from height / building:levels or a default by type and district; the facade style comes from tags, type and
// district. Facades are cut into the voxels: recessed windows with stone sills and lintels, shopfronts with fascias on
// street-facing ground floors, curtain walls with mullions and spandrels, concrete ribbon windows, warehouse taking-in
// doors, balconies. Roofs: flat with parapets and plant, or pitched/hipped/mansard/dome/skillion from a distance field
// over the footprint, with gables, eaves and chimneys. Party walls stay blank and terraces share one continuous roof.
import { fillRings, strokePolyline, rot, hash, polygonArea, dominantAngle, project, pointInPolygon } from './geo.mjs';
import { parseHeight } from './osm.mjs';
import { Grid, meshGrid } from './vox.mjs';

export const VS = 0.6;
const M = 3;   // grid margin in voxels around the footprint (cornices, balconies, eaves)

/* ---------------- districts ---------------- */
const DISTRICTS = [
  ['core', 53.4800, -2.2430, 420, 'core'], ['spinningfields', 53.4805, -2.2520, 260, 'core'], ['piccadilly', 53.4775, -2.2330, 300, 'core'],
  ['oxfordRoad', 53.4730, -2.2400, 260, 'core'], ['deansgateS', 53.4735, -2.2490, 260, 'core'], ['greenQuarter', 53.4890, -2.2400, 320, 'core'],
  ['northern', 53.4835, -2.2345, 280, 'heritage'], ['ancoats', 53.4840, -2.2255, 360, 'heritage'], ['castlefield', 53.4745, -2.2575, 320, 'heritage'],
  ['uni', 53.4660, -2.2335, 450, 'campus'], ['hulme', 53.4660, -2.2500, 520, 'suburb'], ['ardwick', 53.4700, -2.2220, 520, 'suburb'],
  ['salford', 53.4840, -2.2620, 420, 'suburb'], ['southPark', 53.4615, -2.2300, 400, 'suburb'],
].map(([name, lat, lon, r, zone]) => ({ name, p: project(lat, lon), r, zone }));
export function districtAt(x, z) {
  let best = null, bd = Infinity;
  for (const d of DISTRICTS) { const q = Math.hypot(x - d.p[0], z - d.p[1]) / d.r; if (q < bd) { bd = q; best = d; } }
  return bd > 1.6 ? { name: 'outer', zone: 'suburb' } : best;
}

/* ---------------- classification ---------------- */
const HOUSE = new Set(['house', 'semidetached_house', 'detached', 'terrace', 'bungalow']);
const SMALL = new Set(['garage', 'garages', 'shed', 'service', 'kiosk', 'hut', 'cabin', 'toilets', 'carport', 'guardhouse', 'transformer_tower', 'substation', 'container', 'greenhouse']);
const RESI = new Set(['apartments', 'residential', 'dormitory', 'flats']);
const INST = new Set(['school', 'college', 'hospital', 'public', 'civic', 'fire_station', 'police', 'government', 'kindergarten', 'sports_centre', 'sports_hall', 'community_centre', 'library']);
const SKIP = new Set(['bridge', 'ruins', 'no', 'collapsed', 'demolished', 'stadium', 'grandstand', 'construction']);
const pickH = (arr, h) => arr[Math.min(arr.length - 1, Math.floor(h * arr.length))];

// facade styles (voxel units): gH ground storey, fH upper storeys, bay/win/sill/winH window grid within a storey
function makeStyle(kind, b, h, zone) {
  const r = (k) => hash(b.id, k);
  const S = { kind, wall: 'brick', trim: null, base: null, gH: 6, fH: 5, bay: 4, win: 2, sill: 1, winH: 3, recess: true,
    glass: 'res', litP: .35, shop: false, door: true, cornice: false, band: false, lintel: false, parapet: 'wall',
    roof: 'flat', roofMat: 'roofFlat', slope: 1, balcony: 0, plant: false, tank: false, loading: false, mull: 3, chimney: false };
  switch (kind) {
    case 'house':
      Object.assign(S, { wall: pickH(['brick', 'brick', 'brick2', 'brickD', 'brickY', 'brickO'], r(1)), trim: r(2) < .5 ? 'trim' : null, gH: 5, fH: 5, bay: 4, win: 2, sill: 2, winH: 2,
        roof: (b.tags.building === 'terrace' || r(3) < .55) ? 'gabled' : 'hipped', roofMat: r(4) < .62 ? 'slate' : 'tile', chimney: true, parapet: null, litP: .4 });
      break;
    case 'aptBrick':
      Object.assign(S, { wall: pickH(['brick', 'brickD', 'brickY', 'brickO', 'brickG', 'brickW', 'brick2'], r(1)), trim: r(2) < .5 ? 'frame' : 'concL', gH: 6, fH: 5, bay: r(3) < .5 ? 4 : 5, win: 2, sill: 1, winH: 3,
        balcony: r(4) < .45 ? .35 : 0, shop: zone !== 'suburb' && r(5) < .5, roofMat: r(6) < .2 ? 'greenRoof' : 'roofG', plant: true, litP: .42 });
      break;
    case 'aptClad':
      Object.assign(S, { wall: pickH(['render', 'renderG', 'cladL', 'cladG', 'cladT', 'clad', 'renderC'], r(1)), trim: 'frame', gH: 6, fH: 5, bay: 4, win: 3, sill: 1, winH: 3,
        balcony: r(4) < .6 ? .45 : 0, shop: zone !== 'suburb' && r(5) < .5, roofMat: 'roofFlat', plant: true, litP: .45 });
      break;
    case 'curtain': {
      const g = pickH(['glassB', 'glassD', 'glassT', 'glassG', 'glassS', 'glassK'], r(1));
      Object.assign(S, { wall: g, trim: r(2) < .5 ? 'mullion' : 'frame', gH: 7, fH: 6, mull: r(3) < .5 ? 3 : 2, recess: false, glass: g, litP: .36, shop: zone !== 'suburb',
        parapet: 'trim', roofMat: 'roofFlat', plant: true });
      if (RESI.has(b.tags.building)) Object.assign(S, { fH: 5, balcony: r(4) < .4 ? .3 : 0, litP: .42 });
      break; }
    case 'office':
      Object.assign(S, { wall: pickH(['portland', 'buff', 'concL', 'renderG', 'cladG', 'brickG', 'sand'], r(1)), trim: 'frame', gH: 7, fH: 6, bay: 4, win: 3, sill: 1, winH: 4,
        glass: pickH(['glassD', 'glassB', 'glassK', 'glassS'], r(2)), litP: .5, shop: zone !== 'suburb', roofMat: 'roofFlat', plant: true });
      break;
    case 'stone':
      Object.assign(S, { wall: pickH(['sand', 'buff', 'portland', 'redSand', 'sand'], r(1)), trim: r(2) < .5 ? 'trim' : 'trimD', base: 'trimD', gH: 8, fH: 7, bay: 4, win: 2, sill: 2, winH: 4,
        band: true, cornice: true, lintel: true, shop: true, litP: .45, glass: 'off', roof: r(3) < .45 ? 'mansard' : 'flat', roofMat: r(3) < .45 ? 'slate' : 'roofFlat', parapet: 'trim' });
      break;
    case 'warehouse':
      Object.assign(S, { wall: pickH(['brick', 'brickD', 'brick2', 'brick', 'brickY'], r(1)), trim: r(2) < .7 ? 'trim' : 'trimD', gH: 7, fH: 7, bay: 4, win: 2, sill: 2, winH: 4,
        cornice: r(3) < .7, lintel: true, shop: zone !== 'suburb' && r(4) < .6, loading: r(5) < .55, tank: r(6) < .3, glass: 'mix', litP: .4,
        roof: r(7) < .35 ? 'hipped' : 'flat', roofMat: r(7) < .35 ? 'slate' : 'roofFlat', slope: .8, parapet: 'wall' });
      break;
    case 'uniBrick':
      Object.assign(S, { wall: pickH(['brick', 'brickD', 'brick2'], r(1)), trim: r(2) < .6 ? 'terraBuff' : 'trim', gH: 7, fH: 7, bay: 3, win: 2, sill: 2, winH: 4,
        cornice: true, band: r(3) < .5, lintel: true, roof: r(4) < .5 ? 'gabled' : 'flat', roofMat: r(4) < .5 ? 'slate' : 'roofFlat', slope: 1.3, glass: 'off', litP: .4 });
      break;
    case 'concrete':
      Object.assign(S, { wall: pickH(['conc', 'concD', 'concL', 'conc'], r(1)), trim: 'frame', gH: 7, fH: 6, sill: 2, winH: 3, kind: 'ribbon', mull: 3,
        glass: pickH(['win', 'glassD', 'glassK'], r(2)), litP: .45, shop: zone === 'core' && r(3) < .5, roofMat: 'roofG', plant: true });
      break;
    case 'inst':
      Object.assign(S, { wall: pickH(['brick', 'brickY', 'brickD', 'brickG'], r(1)), trim: r(2) < .5 ? 'concL' : 'trim', gH: 6, fH: 6, bay: 4, win: 3, sill: 1, winH: 3,
        roofMat: 'roofFlat', plant: true, glass: 'off', litP: .3 });
      break;
    case 'industrial':
      Object.assign(S, { wall: pickH(['cladG', 'clad', 'cladL', 'metal', 'brickG'], r(1)), trim: 'metalD', kind: 'shed', recess: false, roofMat: 'metal', litP: .2 });
      break;
    case 'shed':
      Object.assign(S, { wall: pickH(['brick', 'render', 'cladG', 'brickD', 'conc'], r(1)), kind: 'shed', recess: false, door: true, roofMat: r(2) < .5 ? 'roofFlat' : 'metal', parapet: null, litP: .1 });
      break;
    case 'carpark':
      Object.assign(S, { wall: 'conc', trim: 'concD', gH: 5, fH: 5, recess: true, roofMat: 'roadW', parapet: 'wall', litP: 0 });
      break;
    case 'church':
      Object.assign(S, { wall: pickH(['sand', 'redSand', 'buff', 'brick'], r(1)), trim: 'trimD', gH: 99, fH: 99, bay: 4, win: 2, sill: 4, winH: 9, kind: 'church',
        roof: 'gabled', roofMat: 'slate', slope: 1.6, parapet: null, glass: 'res', litP: .5, door: true });
      break;
    case 'canopy':
      Object.assign(S, { wall: 'metalD', roofMat: b.tags.building === 'train_station' ? 'glassRoof' : r(1) < .5 ? 'metalD' : 'roofFlat', parapet: null });
      break;
  }
  return S;
}

function styleKind(b, h, zone) {
  const t = b.tags, type = t.building || t['building:part'] || 'yes', mat = t['building:material'], col = (t['building:colour'] || '').toLowerCase(), r = hash(b.id, 99);
  if (type === 'roof' || type === 'carport' || (type === 'train_station' && b.area > 1500)) return 'canopy';
  if (HOUSE.has(type) || (type === 'residential' && b.area < 140 && h < 10)) return 'house';
  if (SMALL.has(type) || b.area < 25) return 'shed';
  if (type === 'parking') return 'carpark';
  if (type === 'church' || type === 'cathedral' || type === 'chapel' || t.amenity === 'place_of_worship') return 'church';
  if (type === 'industrial' || type === 'warehouse') return zone === 'heritage' || (zone === 'core' && h > 12) ? 'warehouse' : 'industrial';
  if (mat === 'glass' || (h > 50 && r < .7)) return 'curtain';
  if (mat === 'brick' || col === 'red' || col === 'brown') return RESI.has(type) ? 'aptBrick' : (zone === 'campus' ? 'uniBrick' : 'warehouse');
  if (mat === 'stone' || mat === 'sandstone') return 'stone';
  if (mat === 'concrete') return 'concrete';
  if (mat === 'metal') return h > 15 ? 'aptClad' : 'industrial';
  if (mat === 'plaster' || col === 'white') return 'aptClad';
  if (RESI.has(type) || type === 'hotel') {
    if (h > 40) return r < .55 ? 'curtain' : 'aptClad';
    if (zone === 'heritage') return r < .6 ? 'warehouse' : 'aptBrick';
    return r < .55 ? 'aptBrick' : 'aptClad';
  }
  if (type === 'university') return r < .42 ? 'uniBrick' : r < .78 ? 'concrete' : 'office';
  if (INST.has(type)) return r < .65 ? 'inst' : 'concrete';
  if (type === 'retail' && b.area > 1500 && zone === 'suburb') return 'industrial';
  if (zone === 'heritage') return r < .72 ? 'warehouse' : r < .85 ? 'stone' : 'aptBrick';
  if (zone === 'core') { if (h > 32) return r < .6 ? 'curtain' : 'office'; return r < .34 ? 'stone' : r < .56 ? 'warehouse' : r < .82 ? 'office' : 'concrete'; }
  if (zone === 'campus') return r < .4 ? 'uniBrick' : r < .75 ? 'concrete' : 'office';
  return r < .4 ? 'inst' : r < .7 ? 'office' : 'industrial';
}

// height (m) for an outline or part without height tags
function defaultHeight(b, type, zone) {
  const r = hash(b.id, 7), r2 = hash(b.id, 8);
  if (HOUSE.has(type)) return type === 'bungalow' ? 3.2 : 5.6 + (r < .15 ? 2.8 : 0);
  if (SMALL.has(type) || b.area < 25) return 3 + r;
  if (type === 'parking') return 3 * (3 + Math.floor(r * 4));
  if (type === 'church' || type === 'chapel') return 12 + 4 * r;
  if (type === 'roof') return 4.5;
  if (type === 'train_station') return 14;
  if (type === 'industrial' || type === 'warehouse') return zone === 'suburb' ? 7 + 4 * r : 4.2 * (4 + Math.floor(r * 3));
  const big = b.area > 2500 ? 1 : b.area > 900 ? .6 : b.area > 300 ? .3 : 0;
  if (RESI.has(type) || type === 'hotel') {
    if (zone === 'core') return 3 * (6 + Math.floor((r + big) * 5));
    if (zone === 'heritage') return 3 * (5 + Math.floor(r * 3));
    if (zone === 'campus') return 3 * (4 + Math.floor((r + big) * 3));
    return 3 * (3 + Math.floor(r * 2 + big * 2));
  }
  if (type === 'university') return 3.8 * (3 + Math.floor((r + big) * 3));
  if (INST.has(type)) return 3.6 * (2 + Math.floor(r * 2 + big));
  if (zone === 'core') return 3.8 * (4 + Math.floor((r + big) * 4) + (r2 < .1 ? 4 : 0));
  if (zone === 'heritage') return 4 * (3 + Math.floor(r * 4));
  if (zone === 'campus') return 3.8 * (2 + Math.floor((r + big) * 4));
  return 3.5 * (1 + Math.floor(r * 2 + big * 2));
}

function storeyHeight(kind) { return { house: 2.9, aptBrick: 3, aptClad: 3, curtain: 3.6, office: 3.6, stone: 4.2, warehouse: 4.2, uniBrick: 4.2, concrete: 3.6, inst: 3.6, carpark: 3 }[kind] || 3.4; }

// heights of a building or one of its parts (metres): wall top, base and roof shape/height
function partHeights(f, owner, kind, zone) {
  const t = f.tags, type = owner.tags.building || 'yes';
  const sh = storeyHeight(kind);
  let H = parseHeight(t.height);
  const lv = parseFloat(t['building:levels']), rlv = parseFloat(t['roof:levels']);
  let roofH = parseHeight(t['roof:height']);
  if (roofH == null && isFinite(rlv)) roofH = rlv * 2.6;
  if (H == null && isFinite(lv)) H = lv * sh + (roofH || 0) + (kind === 'house' ? 0 : .6);
  if (H == null) H = defaultHeight(f.area ? f : owner, type, zone) + (roofH || 0);
  let base = parseHeight(t.min_height);
  const mlv = parseFloat(t['building:min_level']);
  if (base == null && isFinite(mlv)) base = mlv * sh;
  return { H, base: base || 0, roofH, shape: t['roof:shape'] || null, hTag: parseHeight(t.height) != null };
}

/* ---------------- preparation: every building gets its frame, heights and style ---------------- */
export function prepareBuildings(F, { skip = new Set(), skipParts = new Set(), overrides = new Map() } = {}) {
  const list = [];
  for (const b of F.buildings) {
    const type = b.tags.building;
    if (SKIP.has(type)) continue;
    const d = districtAt(b.c[0], b.c[1]);
    const ring = b.outers[0];
    b.zone = d.zone; b.district = d.name;
    b.angle = dominantAngle(ring);
    const outline = partHeights(b, b, 'aptBrick', d.zone);
    const ov = overrides.get(b.id);
    b.kind = ov?.kind || styleKind(b, outline.H, d.zone);
    const own = partHeights(b, b, b.kind, d.zone);
    b.H = own.H;
    const parts = b.parts.filter(p => !skipParts.has(p.id));
    b.skippedParts = b.parts.filter(p => skipParts.has(p.id));
    b.items = (b.parts.length ? parts : [b]).map(p => ({ f: p, ...partHeights(p, b, b.kind, d.zone) }));
    b.outlineItem = b.parts.length ? { f: b, ...own } : null;   // drawn where the parts leave the outline uncovered
    if (!b.items.length && !b.outlineItem) continue;
    if (b.items.length && b.parts.length) b.H = Math.max(...b.items.map(i => i.H));
    b.style = makeStyle(b.kind, b, b.H, d.zone);
    if (ov) for (const k of ['wall', 'trim', 'roof', 'roofMat', 'glass']) if (ov[k]) b.style[k] = ov[k];
    b.pitched = b.style.roof !== 'flat' || b.items.some(i => i.shape && i.shape !== 'flat');
    b.landmark = skip.has(b.id);
    list.push(b);
  }
  // spatial index for neighbour lookups
  const CELL = 40, idx = new Map();
  for (const b of list) {
    const [x0, z0, x1, z1] = b.bb;
    for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) {
      const k = gx * 100003 + gz; let a = idx.get(k); if (!a) idx.set(k, a = []); a.push(b);
    }
  }
  for (const b of list) {
    const [x0, z0, x1, z1] = b.bb, s = new Set();
    for (let gz = Math.floor((z0 - 2) / CELL); gz <= Math.floor((z1 + 2) / CELL); gz++) for (let gx = Math.floor((x0 - 2) / CELL); gx <= Math.floor((x1 + 2) / CELL); gx++)
      for (const o of idx.get(gx * 100003 + gz) || []) if (o !== b && o.bb[0] <= x1 + 2 && o.bb[2] >= x0 - 2 && o.bb[1] <= z1 + 2 && o.bb[3] >= z0 - 2) s.add(o);
    b.neighbours = [...s];
  }
  return list;
}

/* ---------------- geometry helpers ---------------- */
function distToRing(x, z, ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], az = ring[j][1], dx = ring[i][0] - ax, dz = ring[i][1] - az, L2 = dx * dx + dz * dz || 1e-9;
    let t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - ax - t * dx, z - az - t * dz); if (d < best) best = d;
  }
  return best;
}
const insideF = (x, z, f) => { if (!f.outers.some(r => pointInPolygon(x, z, r))) return false; return !f.inners.some(r => pointInPolygon(x, z, r)); };

/* ---------------- one building ---------------- */
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];   // +x, -x, +z, -z (local)

export function buildBuilding(b, store, ctx) {
  const S = b.style, a = b.angle, cs = Math.cos(a), sn = Math.sin(a), [cx, cz] = b.c;
  const toL = (x, z) => rot(x - cx, z - cz, a);
  const toW = (lx, lz) => [cx + lx * cs - lz * sn, cz + lx * sn + lz * cs];
  // local footprints of everything drawn (the outline, or its parts)
  const localF = f => ({ outers: f.outers.map(r => r.map(([x, z]) => toL(x, z))), inners: (f.inners || []).map(r => r.map(([x, z]) => toL(x, z))) });
  const items = b.items.map(it => ({ ...it, ...localF(it.f) }));
  const outlineIt = b.outlineItem ? { ...b.outlineItem, ...localF(b) } : null;
  let lx0 = Infinity, lz0 = Infinity, lx1 = -Infinity, lz1 = -Infinity;
  for (const it of outlineIt ? [...items, outlineIt] : items) for (const r of it.outers) for (const [x, z] of r) { if (x < lx0) lx0 = x; if (x > lx1) lx1 = x; if (z < lz0) lz0 = z; if (z > lz1) lz1 = z; }
  const ix0 = Math.floor(lx0 / VS) - M, iz0 = Math.floor(lz0 / VS) - M;
  const nx = Math.ceil(lx1 / VS) + M - ix0 + 1, nz = Math.ceil(lz1 / VS) + M - iz0 + 1;
  const gx0 = ix0 * VS, gz0 = iz0 * VS, NC = nx * nz;
  if (NC > 4e6) return 0;
  const rasterise = (it, dilate = .3) => {
    const mask = new Uint8Array(NC);
    const put = (i, k) => { mask[k * nx + i] = 1; };
    fillRings([...it.outers, ...it.inners], gx0, gz0, VS, nx, nz, put);
    if (dilate) for (const r of it.outers) strokePolyline([...r, r[0]], dilate, gx0, gz0, VS, nx, nz, put);   // close gaps to neighbours
    // keep courtyards open: the stroke must not refill a hole's interior
    for (const r of it.inners) fillRings([r], gx0, gz0, VS, nx, nz, (i, k) => { const c = k * nx + i; if (mask[c] && distToRing(gx0 + (i + .5) * VS, gz0 + (k + .5) * VS, r) > .3) mask[c] = 0; });
    return mask;
  };
  const cellsOf = mask => { const a = []; for (let c = 0; c < NC; c++) if (mask[c]) a.push(c); return a; };
  for (const it of items) { it.mask = rasterise(it); it.cells = cellsOf(it.mask); }
  // the outline where the mapped parts leave it uncovered (parts drawn by landmark builders count as covered)
  if (outlineIt) {
    const om = rasterise(outlineIt, 0), cov = new Uint8Array(NC); let total = 0, left = 0;
    for (const it of items) for (const c of it.cells) cov[c] = 1;
    for (const p of b.skippedParts) { const m = rasterise(localF(p)); for (let c = 0; c < NC; c++) if (m[c]) cov[c] = 1; }
    for (let c = 0; c < NC; c++) if (om[c]) { total++; if (!cov[c]) left++; else om[c] = 0; }
    if (left > 30 && (left > .15 * total || !items.length)) { outlineIt.mask = om; outlineIt.cells = cellsOf(om); items.push(outlineIt); }
  }
  if (!items.length) return 0;
  // a column belongs to its tallest part (whose roof it carries); walls come from every part
  const own = new Int16Array(NC);            // item index + 1 of the tallest part over the column
  const base = new Uint16Array(NC).fill(65535), top = new Uint16Array(NC);
  items.forEach((it, n) => { for (const c of it.cells) if (!own[c] || items[own[c] - 1].H < it.H) own[c] = n + 1; });
  // neighbours: party-wall mask (cells inside or within 0.45 m of another building), and similar pitched neighbours for roofs
  const party = new Uint8Array(NC), simNb = new Uint8Array(NC);
  const nbs = b.neighbours.map(o => ({ o, outers: o.outers.map(r => r.map(([x, z]) => toL(x, z))) }));
  if (nbs.length) {
    // only cells near our footprint matter
    const near = new Uint8Array(NC);
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if (own[k * nx + i]) for (let dk = -2; dk <= 2; dk++) for (let di = -2; di <= 2; di++) {
      const ii = i + di, kk = k + dk; if (ii >= 0 && kk >= 0 && ii < nx && kk < nz) near[kk * nx + ii] = 1; }
    const small = NC < 6000 && b.pitched;
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const c = k * nx + i; if (own[c] || !(near[c] || small)) continue;
      const px = gx0 + (i + .5) * VS, pz = gz0 + (k + .5) * VS;
      for (const { o, outers } of nbs) {
        if (outers.some(r => pointInPolygon(px, pz, r)) || (near[c] && outers.some(r => distToRing(px, pz, r) < .45))) {
          party[c] = 1;
          if (b.pitched && o.pitched && Math.abs(o.H - b.H) < 1.6) simNb[c] = 1;
          break;
        }
      }
    }
  }
  // roofs need a distance field over each pitched part's footprint (similar neighbours count as inside, so terraces share a roof)
  const roofOf = it => S.kind === 'canopy' ? 'flat' : it.shape || (S.roof === 'flat' ? 'flat' : S.roof);
  const span = new Uint8Array(NC);   // per column: 0 span along x (ridge along z), 1 span along z
  let maxY = 0;
  items.forEach((it, n) => {
    const shape = roofOf(it); it.shapeR = shape; it.rise = 0;
    if (shape !== 'flat') {
      const inside = new Uint8Array(NC); for (const c of it.cells) inside[c] = 1;
      if (items.length === 1) for (let c = 0; c < NC; c++) if (simNb[c]) inside[c] = 1;
      it.Dh = chamfer(inside, nx, nz); it.Dg = gableField(inside, nx, nz); it.inside = inside;
      let mh = 0, mg = 0; for (const c of it.cells) { mh = Math.max(mh, it.Dh[c]); mg = Math.max(mg, it.Dg[c]); }
      it.mh = mh; it.mg = mg;
      const md = (shape === 'gabled' || shape === 'round' || shape === 'skillion' || shape === 'pitched') ? mg : mh;
      it.rise = it.roofH != null ? it.roofH / VS : Math.min(md * S.slope, shape === 'mansard' ? 4 : 30);
      if (shape === 'dome' && it.roofH == null) it.rise = mh;
    }
    const sub = shape === 'flat' ? (it.roofH || 0) / VS : it.roofH != null ? it.roofH / VS : (b.parts.length || it.hTag) ? it.rise : 0;
    it.b0 = Math.max(0, Math.round(it.base / VS));
    it.wallTop = Math.max(it.b0 + 2, Math.round(it.H / VS - sub));
    maxY = Math.max(maxY, it.wallTop + Math.ceil(it.rise) + 8);
  });
  for (const it of items) for (const c of it.cells) { if (it.wallTop > top[c]) top[c] = it.wallTop; if (it.b0 < base[c]) base[c] = it.b0; }
  const partTop = items.map(it => it.wallTop);
  const ny = Math.min(maxY + 2, 700);
  const g = new Grid(nx, ny, nz);
  const W = g.m(S.wall), ROOF = g.m(S.roofMat);
  const TRIM = S.trim ? g.m(S.trim) : W, BASE = S.base ? g.m(S.base) : W;
  // walls (canopies: a thin roof on posts)
  if (S.kind === 'canopy') {
    for (const it of items) for (const c of it.cells) {
      const i = c % nx, k = (c / nx) | 0, t1 = it.wallTop - 1;
      g.data[(t1 * nz + k) * nx + i] = ROOF;
      let edge = false; for (const [dx, dz] of DIRS) if (!it.mask[(k + dz) * nx + i + dx]) edge = true;
      if (edge) { g.data[(t1 * nz + k) * nx + i] = W; if ((i + k) % 9 === 0) for (let y = 0; y < t1; y++) g.data[(y * nz + k) * nx + i] = W; }
    }
    return meshGrid(g, store, store.key(cx, cz), { cx, cz, oy: 0, cos: cs, sin: sn, x0: gx0, z0: gz0, vs: VS });
  }
  for (const it of items) for (const c of it.cells) {
    const i = c % nx, k = (c / nx) | 0;
    for (let y = it.b0; y < it.wallTop; y++) g.data[(y * nz + k) * nx + i] = W;
  }
  // roofs over each column's tallest part
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const c = k * nx + i; if (!own[c]) continue;
    const it = items[own[c] - 1], shape = it.shapeR, t0 = it.wallTop;
    if (shape === 'flat') continue;
    span[c] = spanAxis(it.inside, nx, nz, i, k);
    let h;
    const dg = it.Dg[c], dh = it.Dh[c];
    switch (shape) {
      case 'gabled': case 'pitched': h = Math.round(dg * S.slope); break;
      case 'hipped': case 'half-hipped': case 'side_hipped': case 'pyramidal': h = Math.round(dh * (shape === 'pyramidal' ? Math.max(S.slope, it.rise / Math.max(1, it.mh)) : S.slope)); break;
      case 'mansard': h = dh <= 2 ? Math.round(dh * 2) : 4; break;
      case 'dome': { const R = Math.max(1, it.mh), s = it.rise / R; h = Math.round(Math.sqrt(Math.max(0, R * R - (R - Math.min(dh, R)) ** 2)) * s); break; }
      case 'round': { const R = Math.max(1, it.mg); h = Math.round(Math.sqrt(Math.max(0, R * R - (R - dg) ** 2)) * Math.min(1.5, it.rise / R || 1)); break; }
      case 'skillion': h = Math.round(Math.min(it.rise, (span[c] ? (k - firstIn(it.mask, nx, nz, i, k, 0, -1)) : (i - firstIn(it.mask, nx, nz, i, k, -1, 0))) * .5)); break;
      default: h = Math.round(dh * S.slope);
    }
    h = Math.max(1, Math.min(h, Math.ceil(it.rise) || h));
    const mat = shape === 'dome' ? g.m(hash(b.id, 71) < .5 ? 'copper' : 'lead') : shape === 'round' && b.tags.building === 'train_station' ? g.m('glassRoof') : ROOF;
    for (let y = t0; y < t0 + h && y < ny; y++) g.data[(y * nz + k) * nx + i] = mat;
  }
  // facades, level by level
  const isStreet = (lx, lz) => { const [wx, wz] = toW(lx, lz); return ctx.streetAt(wx, wz); };
  const hb = (...v) => hash(b.id, ...v);
  const recessOK = (x, y, z) => { // the voxel behind can take the glass if it is not itself on another facade
    if (g.get(x, y, z) !== W && g.get(x, y, z) !== BASE && g.get(x, y, z) !== TRIM) return false;
    for (const [dx, dz] of DIRS) if (!g.get(x + dx, y, z + dz)) return false;
    return true;
  };
  const glassFor = (wid, office) => {
    const lit = hash(wid, 3) < S.litP;
    if (S.kind === 'curtain' || S.glass?.startsWith?.('glass')) { const gname = S.kind === 'curtain' ? S.glass : S.glass; return g.m(lit ? gname + 'Lit' : gname); }
    if (S.glass === 'off' || (S.glass === 'mix' && hash(wid, 4) < .4) || office) return g.m(lit ? 'glassDLit' : 'win');
    return g.m(lit ? (hash(wid, 5) < .55 ? 'winLit' : 'winLit2') : 'win');
  };
  const SHOP = g.m('shop'), FASCIA = g.m(hb(31) < .5 ? 'fascia' : S.trim || 'fascia'), DOOR = g.m(hb(32) < .6 ? 'door' : 'doorG');
  const MULL = g.m(S.kind === 'curtain' ? (S.trim || 'mullion') : 'frame'), SPAND = g.m(S.kind === 'curtain' ? 'spandrel' : S.wall);
  const DARK = g.m('carparkDark'), SLAB = g.m('conc'), BAL = g.m('glassBal');
  const ops = [];   // carving applied after each level so exposures stay those of the solid massing
  const maxTop = Math.max(...partTop);
  const exp = new Uint8Array(NC);   // per level: bit d set when the wall voxel is exposed towards DIRS[d]
  for (let y = 0; y < maxTop; y++) {
    let anyWall = false;
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const c = k * nx + i; exp[c] = 0;
      if (!own[c] || y < base[c] || y >= top[c] || g.data[(y * nz + k) * nx + i] !== W) continue;
      anyWall = true; let e = 0;
      for (let d = 0; d < 4; d++) { const ii = i + DIRS[d][0], kk = k + DIRS[d][1]; if (ii < 0 || kk < 0 || ii >= nx || kk >= nz || !g.data[(y * nz + kk) * nx + ii]) e |= 1 << d; }
      exp[c] = e;
    }
    if (!anyWall) continue;
    ops.length = 0;
    for (let d = 0; d < 4; d++) {
      const [dx, dz] = DIRS[d], along = dx ? 1 : 0;   // run direction: along z for ±x faces, along x for ±z faces
      const lines = along ? nx : nz, len = along ? nz : nx;
      for (let line = 0; line < lines; line++) {
        let s = 0;
        while (s < len) {
          const c0 = along ? s * nx + line : line * nx + s;
          if (!(exp[c0] & (1 << d))) { s++; continue; }
          let e = s; while (e + 1 < len && (exp[along ? (e + 1) * nx + line : line * nx + e + 1] & (1 << d))) e++;
          const L = e - s + 1;
          for (let q = s; q <= e; q++) {
            const i = along ? line : q, k = along ? q : line, c = k * nx + i;
            const corner = (exp[c] & (dx ? 12 : 3)) !== 0;
            const oi = i + dx, ok = k + dz, oc = (oi >= 0 && ok >= 0 && oi < nx && ok < nz) ? ok * nx + oi : -1;
            const isParty = oc >= 0 && party[oc];
            facadeVoxel(i, y, k, d, q - s, L, corner, isParty, top[c], base[c], line, oc);
          }
          s = e + 1;
        }
      }
    }
    for (const [x, yy, z, v] of ops) g.set(x, yy, z, v);
  }

  function facadeVoxel(i, y, k, d, a, L, corner, isParty, wallTop, wallBase, line, oc) {
    const [dx, dz] = DIRS[d], set = v => ops.push([i, y, k, v]);
    const carve = (v, deep = S.recess) => {   // recess one voxel when the wall behind is solid
      if (deep && recessOK(i - dx, y, k - dz)) { ops.push([i, y, k, 0]); ops.push([i - dx, y, k - dz, v]); } else set(v);
    };
    if (isParty) return;   // blank party wall
    const gH = S.gH, fH = S.fH, floor = y < gH ? 0 : 1 + Math.floor((y - gH) / fH), r = y < gH ? y : (y - gH) % fH;
    const fromTop = wallTop - 1 - y;
    // window bays centred on the run
    const bay = S.bay, nb = Math.max(1, Math.floor((L - 2) / bay)), off = Math.floor((L - nb * bay) / 2), la = a - off;
    const bayIdx = Math.floor(la / bay), pb = ((la % bay) + bay) % bay, p0 = Math.floor((bay - S.win) / 2);
    let winCol = la >= 0 && la < nb * bay && pb >= p0 && pb < p0 + S.win && L >= S.win + 2;
    if (L < bay + 2 && L >= S.win + 2) { const c0 = Math.floor((L - S.win) / 2); winCol = a >= c0 && a < c0 + S.win; }
    const wid = (b.id * 31 + d * 7 + line * 131 + bayIdx * 17 + floor * 1009) | 0;
    const street = floor === 0 && isStreet(gx0 + (i + .5 + dx * 2) * VS, gz0 + (k + .5 + dz * 2) * VS);
    // cornice under the parapet / eaves
    if (S.cornice && fromTop === 0 && !corner) { if (oc >= 0 && !party[oc]) ops.push([i + dx, y, k + dz, TRIM]); }
    if (corner && S.kind !== 'curtain') { if (y < gH && S.base) set(BASE); return; }
    switch (S.kind) {
      case 'curtain': {
        if (floor === 0) { if (street || L > 6) { if (r === gH - 1) set(SPAND); else if (a % (S.mull * 2) === 0) set(MULL); else carve(SHOP, true); } return; }
        if (r === 0) { set(SPAND); return; }
        if (a % S.mull === 0 || corner) { set(MULL); return; }
        if (S.balcony && hash(b.id, line, d, Math.floor(a / 6)) < S.balcony && r === 1 && oc >= 0 && !party[oc]) { ops.push([i + dx, y - 1, k + dz, SLAB]); ops.push([i + dx, y, k + dz, BAL]); }
        set(glassFor((b.id * 31 + d * 7 + line * 131 + Math.floor(a / (S.mull * 2)) * 17 + floor * 1009) | 0, true));
        return;
      }
      case 'ribbon': {
        if (floor === 0 && street && S.shop) { if (r === gH - 1) set(FASCIA); else if (a % 4 === 0) set(W); else carve(SHOP); return; }
        if (r >= S.sill && r < S.sill + S.winH && fromTop > 0) { if (a % S.mull === 0) carve(MULL); else carve(glassFor((wid & ~0xf) + Math.floor(a / 6), true)); return; }
        return;
      }
      case 'shed': {
        if (y === 0 || y === 1 || y === 2) { if (S.door && street && Math.abs(a - Math.floor(L / 2)) <= (L > 14 ? 3 : 0) && L > 4) set(L > 14 ? g.m('metalD') : DOOR); return; }
        if (fromTop >= 1 && fromTop <= 2 && L > 6 && a % 5 !== 0 && wallTop > 8) set(glassFor(wid, true));
        return;
      }
      case 'church': {
        if (y < 4 && street && Math.abs(a - Math.floor(L / 2)) <= 1 && L > 5) { carve(DOOR); return; }
        if (winCol && y >= S.sill && y < Math.min(S.sill + S.winH, wallTop - 2)) carve(glassFor(wid));
        return;
      }
    }
    if (S.kind === 'carpark') {
      if (r === 0 || r === 1 || a % 6 === 0 || fromTop === 0 || y < 2) return;
      carve(DARK, true); return;
    }
    // punched-window styles
    if (floor === 0) {
      if (S.shop && street && L >= 4) {
        if (r >= gH - 1) { set(FASCIA); return; }
        if (a % S.bay === 0 && a > 0) { set(BASE); return; }
        carve(SHOP); return;
      }
      if (S.door && street && bayIdx === Math.floor(nb / 2) && la >= 0 && la < nb * bay && pb >= p0 && pb < p0 + S.win) {
        if (r < Math.min(gH - 1, 4)) { carve(RESIDENTIAL(b) && S.kind !== 'house' ? SHOP : DOOR); return; }
      }
      if (S.loading && street && bayIdx === Math.floor(nb / 2) && winCol && r < gH - 1) { carve(DOOR); return; }
    }
    // taking-in doors of warehouses: a vertical stack in the middle bay
    if (S.loading && floor > 0 && winCol && bayIdx === Math.floor(nb / 2) && L > 10 && hash(b.id, d, line) < .7) {
      if (r >= 1 && r < fH - 1) { carve(DOOR); return; }
    }
    if (S.band && r === 0 && floor > 0) { set(TRIM); return; }
    if (winCol && r >= S.sill && r < S.sill + S.winH && fromTop > 0) {
      if (S.balcony && floor > 0 && hash(b.id, line, d, bayIdx) < S.balcony && oc >= 0 && !party[oc]) {
        // full-height balcony door with a slab and glass balustrade outside
        if (r === S.sill) { ops.push([i + dx, y - 1, k + dz, SLAB]); ops.push([i + dx, y, k + dz, BAL]); }
      }
      carve(glassFor(wid)); return;
    }
    if (winCol && S.trim && r === S.sill - 1 && fromTop > 0) { set(TRIM); return; }
    if (winCol && S.lintel && r === S.sill + S.winH && fromTop > 0) { set(TRIM); return; }
    if (y < gH && S.base) { set(BASE); return; }
  }

  // roof details over flat roofs: parapet, roof finish, plant, tanks, skylights
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const c = k * nx + i; if (!own[c]) continue;
    const it = items[own[c] - 1]; if (it.shapeR !== 'flat') continue;
    const t0 = top[c]; let edge = false;
    for (const [dx, dz] of DIRS) { const ii = i + dx, kk = k + dz; if (ii < 0 || kk < 0 || ii >= nx || kk >= nz || !own[kk * nx + ii] || top[kk * nx + ii] < t0) edge = true; }
    if (edge) { if (S.parapet && t0 < ny) { const pc = party[c] ? W : S.parapet === 'trim' ? TRIM : W; g.data[(t0 * nz + k) * nx + i] = S.kind === 'curtain' ? MULL : pc; } }
    else if (t0 > 0) g.data[((t0 - 1) * nz + k) * nx + i] = ROOF;
  }
  roofClutter(g, b, S, own, top, items, nx, nz, ny);
  // chimneys on houses: at the two ends of the ridge
  if (S.chimney) chimneys(g, b, S, own, top, span, nx, nz, ny, W);
  // eaves: pitched roofs overhang the long walls by one voxel
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const c = k * nx + i; if (!own[c] || items[own[c] - 1].shapeR === 'flat' || items[own[c] - 1].shapeR === 'dome') continue;
    const t0 = top[c], sp = span[c];
    const dirs = sp === 0 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
    for (const [dx, dz] of dirs) { const ii = i + dx, kk = k + dz; if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue; const oc = kk * nx + ii;
      if (!own[oc] && !party[oc] && !g.get(ii, t0, kk)) g.set(ii, t0, kk, g.get(i, t0, k) || ROOF); }
  }
  // gable ends: roof voxels exposed along the ridge become wall
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const c = k * nx + i; if (!own[c]) continue;
    const sh = items[own[c] - 1].shapeR; if (sh !== 'gabled' && sh !== 'pitched' && sh !== 'round') continue;
    const sp = span[c], [dx, dz] = sp === 0 ? [0, 1] : [1, 0];
    const pa = (ii, kk) => ii >= 0 && kk >= 0 && ii < nx && kk < nz && party[kk * nx + ii];
    for (let y = top[c]; y < ny; y++) {
      const v = g.data[(y * nz + k) * nx + i]; if (v !== ROOF) break;
      if ((!g.get(i + dx, y, k + dz) && !pa(i + dx, k + dz)) || (!g.get(i - dx, y, k - dz) && !pa(i - dx, k - dz))) g.data[(y * nz + k) * nx + i] = W;
    }
  }
  const [uo, vo] = [hb(51) * 7, hb(52) * 7];
  return meshGrid(g, store, store.key(cx, cz), { cx, cz, oy: 0, cos: cs, sin: sn, x0: gx0, z0: gz0, vs: VS, uo, vo });
}

const RESIDENTIAL = b => RESI.has(b.tags.building) || b.tags.building === 'hotel';

function firstIn(own, nx, nz, i, k, di, dk) { let ii = i, kk = k; while (ii + di >= 0 && kk + dk >= 0 && own[(kk + dk) * nx + ii + di]) { ii += di; kk += dk; } return di ? ii : kk; }

// chamfer distance (voxels) from every interior cell to the nearest exterior cell; cells beyond the grid count as interior
function chamfer(inside, nx, nz) {
  const D = new Float32Array(nx * nz), INF = 1e6;
  for (let c = 0; c < D.length; c++) D[c] = inside[c] ? INF : 0;
  const d1 = 1, d2 = 1.4142;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const c = k * nx + i; if (!D[c]) continue; let v = D[c];
    if (i > 0) v = Math.min(v, D[c - 1] + d1);
    if (k > 0) { v = Math.min(v, D[c - nx] + d1); if (i > 0) v = Math.min(v, D[c - nx - 1] + d2); if (i < nx - 1) v = Math.min(v, D[c - nx + 1] + d2); }
    D[c] = v;
  }
  for (let k = nz - 1; k >= 0; k--) for (let i = nx - 1; i >= 0; i--) {
    const c = k * nx + i; if (!D[c]) continue; let v = D[c];
    if (i < nx - 1) v = Math.min(v, D[c + 1] + d1);
    if (k < nz - 1) { v = Math.min(v, D[c + nx] + d1); if (i < nx - 1) v = Math.min(v, D[c + nx + 1] + d2); if (i > 0) v = Math.min(v, D[c + nx - 1] + d2); }
    D[c] = v;
  }
  for (let c = 0; c < D.length; c++) if (D[c] >= INF) D[c] = 60;
  return D;
}
// gabled roofs: distance to the nearer end of the run across the shorter span
function gableField(inside, nx, nz) {
  const D = new Float32Array(nx * nz);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const c = k * nx + i; if (!inside[c]) continue;
    const sp = spanAxis(inside, nx, nz, i, k);
    if (sp === 0) { let a = i, b = i; while (a > 0 && inside[c - (i - a) - 1]) a--; while (b < nx - 1 && inside[k * nx + b + 1]) b++; D[c] = Math.min(i - a, b - i) + 1; }
    else { let a = k, b = k; while (a > 0 && inside[(a - 1) * nx + i]) a--; while (b < nz - 1 && inside[(b + 1) * nx + i]) b++; D[c] = Math.min(k - a, b - k) + 1; }
  }
  return D;
}
// 0: the shorter run through (i,k) is along x, 1: along z (runs touching the grid edge continue beyond it)
function spanAxis(inside, nx, nz, i, k) {
  let a = i, b = i; while (a > 0 && inside[k * nx + a - 1]) a--; while (b < nx - 1 && inside[k * nx + b + 1]) b++;
  let c = k, d = k; while (c > 0 && inside[(c - 1) * nx + i]) c--; while (d < nz - 1 && inside[(d + 1) * nx + i]) d++;
  const Lx = (a === 0 || b === nx - 1) ? 1e5 : b - a + 1, Lz = (c === 0 || d === nz - 1) ? 1e5 : d - c + 1;
  return Lx <= Lz ? 0 : 1;
}

function chimneys(g, b, S, own, top, span, nx, nz, ny, W) {
  // ridge cells: the highest roof voxel columns
  let best = 0; const hTop = new Int16Array(nx * nz);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const c = k * nx + i; if (!own[c]) continue; let y = top[c]; while (y < ny && g.data[(y * nz + k) * nx + i]) y++; hTop[c] = y; if (y > best) best = y;
  }
  const ridge = []; for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if (own[k * nx + i] && hTop[k * nx + i] === best) ridge.push([i, k]);
  if (ridge.length < 2 || best + 3 >= ny) return;
  const sp = span[ridge[0][1] * nx + ridge[0][0]], along = sp === 0 ? 1 : 0;   // ridge runs along z when the span is along x
  ridge.sort((p, q) => p[along] - q[along]);
  const pot = g.m(hash(b.id, 61) < .5 ? 'terra' : 'tile');
  for (const [i, k] of [ridge[0], ridge[ridge.length - 1]]) {
    if (hash(b.id, i, k) < .25) continue;
    const yb = hTop[k * nx + i] - 2;
    for (let y = yb; y < best + 2; y++) { g.set(i, y, k, W); if (along) g.set(i, y, k + (k > nz / 2 ? -1 : 1), W); else g.set(i + (i > nx / 2 ? -1 : 1), y, k, W); }
    g.set(i, best + 2, k, pot);
  }
}

function roofClutter(g, b, S, own, top, items, nx, nz, ny) {
  const flatTop = new Int16Array(nx * nz).fill(-1);
  let n = 0, maxT = 0;
  for (let k = 1; k < nz - 1; k++) for (let i = 1; i < nx - 1; i++) {
    const c = k * nx + i; if (!own[c] || items[own[c] - 1].shapeR !== 'flat') continue;
    let ok = true; for (let dk = -2; dk <= 2 && ok; dk++) for (let di = -2; di <= 2; di++) { const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= nx || kk >= nz || !own[kk * nx + ii] || top[kk * nx + ii] !== top[c]) { ok = false; break; } }
    if (ok) { flatTop[c] = top[c]; n++; maxT = Math.max(maxT, top[c]); }
  }
  if (n < 12) return;
  const free = (i0, k0, w, d, t) => { for (let k = k0; k < k0 + d; k++) for (let i = i0; i < i0 + w; i++) { if (i < 0 || k < 0 || i >= nx || k >= nz || flatTop[k * nx + i] !== t) return false; } return true; };
  const occupy = (i0, k0, w, d) => { for (let k = k0; k < k0 + d; k++) for (let i = i0; i < i0 + w; i++) flatTop[k * nx + i] = -2; };
  const cells = []; for (let c = 0; c < nx * nz; c++) if (flatTop[c] >= 0) cells.push(c);
  const r = (...v) => hash(b.id, 77, ...v);
  // lift overrun on taller buildings
  if (maxT > 30) {
    for (let t = 0; t < 20; t++) { const c = cells[Math.floor(r(t) * cells.length)], i = c % nx, k = (c / nx) | 0, T = flatTop[c];
      if (T >= 0 && free(i, k, 4, 5, T)) { g.box(i, T, k, i + 3, Math.min(ny - 1, T + 4), k + 4, g.m(S.kind === 'curtain' ? 'metalD' : S.wall)); occupy(i, k, 4, 5); break; } }
  }
  // plant boxes
  const plants = S.plant ? Math.min(6, Math.floor(n / 90) + 1) : (S.tank ? 0 : (r(1) < .3 ? 1 : 0));
  for (let p = 0, t = 0; p < plants && t < 40; t++) {
    const c = cells[Math.floor(r(2, t) * cells.length)], i = c % nx, k = (c / nx) | 0, T = flatTop[c];
    const w = 2 + Math.floor(r(3, t) * 4), d = 2 + Math.floor(r(4, t) * 3), h = 1 + Math.floor(r(5, t) * 2);
    if (T < 0 || !free(i, k, w, d, T) || T + h >= ny) continue;
    g.box(i, T, k, i + w - 1, T + h - 1, k + d - 1, g.m('plant')); occupy(i, k, w, d); p++;
  }
  // water tanks on legs (warehouses)
  if (S.tank) for (let t = 0; t < 30; t++) {
    const c = cells[Math.floor(r(6, t) * cells.length)], i = c % nx, k = (c / nx) | 0, T = flatTop[c];
    if (T < 0 || !free(i, k, 4, 4, T) || T + 6 >= ny) continue;
    for (const [a, bb] of [[0, 0], [3, 0], [0, 3], [3, 3]]) g.box(i + a, T, k + bb, i + a, T + 1, k + bb, g.m('metalD'));
    g.box(i, T + 2, k, i + 3, T + 4, k + 3, g.m('tank')); occupy(i, k, 4, 4); break;
  }
  // skylights on big low roofs, solar on some
  if (n > 400 && (S.kind === 'shed' || S.kind === 'warehouse' || r(7) < .3)) {
    const GL = g.m('glassRoof');
    for (const c of cells) { const i = c % nx; if (flatTop[c] >= 0 && i % 9 < 2) g.data[((flatTop[c] - 1) * nz + ((c / nx) | 0)) * nx + i] = GL; }
  } else if (n > 120 && r(8) < .18) {
    const SO = g.m('solar');
    for (const c of cells) { const i = c % nx, k = (c / nx) | 0; if (flatTop[c] >= 0 && k % 3 < 2 && i % 8 < 6 && flatTop[c] < ny) g.data[(flatTop[c] * nz + k) * nx + i] = SO; }
  }
}
