// Ground: a 0.6 m world raster of surface classes painted from OSM (land use, water, rails, pedestrian areas, roads with
// pavements and granite kerbs), meshed as a stepped heightfield: carriageways at 0, pavements 15 cm up with kerb faces,
// lawns slightly raised, canals and rivers sunk between stone banks.
import { fillRings, strokePolyline, hash } from './geo.mjs';

export const CS = 0.6;
export const GC = { yard: 0, road: 1, pave: 2, curb: 3, plaza: 4, sett: 5, grass: 6, garden: 7, pitch: 8, play: 9, path: 10, parking: 11, soil: 12,
  ballast: 13, water: 14, canal: 15, river: 16, wood: 17, under: 18, roadR: 19 };
export const GDEF = [
  { mat: 'yard', h: .15, side: 'curb' }, { mat: 'road', h: 0, side: 'road' }, { mat: 'pave', h: .15, side: 'curb' }, { mat: 'curb', h: .15, side: 'curb' },
  { mat: 'plaza', h: .15, side: 'curb' }, { mat: 'sett', h: .03, side: 'curb' }, { mat: 'grass', h: .27, side: 'soil' }, { mat: 'garden', h: .27, side: 'soil' },
  { mat: 'pitch', h: .21, side: 'soil' }, { mat: 'play', h: .18, side: 'curb' }, { mat: 'path', h: .15, side: 'soil' }, { mat: 'roadW', h: .03, side: 'curb' },
  { mat: 'soil', h: .09, side: 'soil' }, { mat: 'ballast', h: .3, side: 'ballast' }, { mat: 'water', h: -1.2, side: 'bank' }, { mat: 'canal', h: -1.2, side: 'bank' },
  { mat: 'water', h: -2.4, side: 'bank' }, { mat: 'grassD', h: .3, side: 'soil' }, { mat: 'yard', h: .15, side: 'curb' }, { mat: 'roadR', h: 0, side: 'road' },
];
const STREETISH = new Uint8Array(32); for (const c of [GC.road, GC.pave, GC.curb, GC.plaza, GC.sett, GC.roadR, GC.parking]) STREETISH[c] = 1;
const ROADISH = new Uint8Array(32); for (const c of [GC.road, GC.roadR, GC.sett]) ROADISH[c] = 1;
const WATERISH = new Uint8Array(32); for (const c of [GC.water, GC.canal, GC.river]) WATERISH[c] = 1;
export const SLAB = -4;   // bottom of the ground slab (sides visible at the plinth edge)

// carriageway half-widths (m) by class when lanes/width are not tagged
const HALF = { motorway: 11, trunk: 8.5, primary: 7.5, secondary: 6.5, tertiary: 5.5, unclassified: 4.2, residential: 3.9, living_street: 3.2, service: 2.4,
  motorway_link: 3.8, trunk_link: 3.8, primary_link: 3.6, secondary_link: 3.4, tertiary_link: 3.4, busway: 3.4, road: 3.4, construction: 3 };
const RANK = { service: 1, living_street: 2, residential: 3, unclassified: 3, road: 3, construction: 3, busway: 4, tertiary_link: 4, secondary_link: 4, primary_link: 5,
  trunk_link: 5, motorway_link: 5, tertiary: 6, secondary: 7, primary: 8, trunk: 9, motorway: 10 };
const FOOT = { footway: 1.1, path: 1, cycleway: 1.25, steps: 1.2, pedestrian: 4, track: 1.6, bridleway: 1 };

export function roadHalf(t) {
  const w = parseFloat(t.width);
  if (isFinite(w) && w > 2 && w < 40) return w / 2;
  const lanes = parseInt(t.lanes);
  const base = HALF[t.highway];
  if (base == null) return null;
  if (isFinite(lanes) && lanes > 0) return Math.max(lanes * 1.65 + .4, base * .7);
  return base;
}
export const isElevatedWay = t => (t.bridge && t.bridge !== 'no') && (parseInt(t.layer) || 1) >= 1;
export const isTunnel = t => (t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage') || (parseInt(t.layer) || 0) < 0 && t.tunnel;

export class Ground {
  constructor(X0, Z0, X1, Z1) {
    this.X0 = X0; this.Z0 = Z0; this.nx = Math.round((X1 - X0) / CS); this.nz = Math.round((Z1 - Z0) / CS);
    this.X1 = X0 + this.nx * CS; this.Z1 = Z0 + this.nz * CS;
    this.cls = new Uint8Array(this.nx * this.nz);
  }
  cell(x, z) { const i = Math.floor((x - this.X0) / CS), k = Math.floor((z - this.Z0) / CS); return (i < 0 || k < 0 || i >= this.nx || k >= this.nz) ? -1 : k * this.nx + i; }
  at(x, z) { const c = this.cell(x, z); return c < 0 ? -1 : this.cls[c]; }
  isStreet(x, z) { const c = this.at(x, z); return c >= 0 && STREETISH[c] === 1; }
  isRoad(x, z) { const c = this.at(x, z); return c >= 0 && ROADISH[c] === 1; }
  isWater(x, z) { const c = this.at(x, z); return c >= 0 && WATERISH[c] === 1; }
  height(x, z) { const c = this.at(x, z); return c < 0 ? 0 : GDEF[c].h; }
  poly(f, v, keep) { const C = this.cls, nx = this.nx; fillRings([...f.outers, ...(f.inners || [])], this.X0, this.Z0, CS, nx, this.nz, (i, k) => { const c = k * nx + i; if (!keep || !keep(C[c])) C[c] = v; }); }
  stroke(pts, half, v, keep) { const C = this.cls, nx = this.nx; strokePolyline(pts, half, this.X0, this.Z0, CS, nx, this.nz, (i, k) => { const c = k * nx + i; if (!keep || !keep(C[c])) C[c] = v; }); }
}

// paint a way where it runs at street level (ramps that climb onto viaducts are drawn by the infrastructure module)
function atGrade(r, paint) {
  if (!r.hv) { paint(r.pts); return; }
  let run = null;
  for (let s = 0; s + 1 < r.pts.length; s++) {
    if (Math.min(r.hv[s], r.hv[s + 1]) < .6) { if (!run) run = [r.pts[s]]; run.push(r.pts[s + 1]); }
    else if (run) { paint(run); run = null; }
  }
  if (run) paint(run);
}

export function buildGround(F, ext, log = () => {}) {
  const G = new Ground(ext.X0, ext.Z0, ext.X1, ext.Z1);
  const keepWater = c => WATERISH[c] === 1;
  // land use and leisure
  const LAND = { grass: GC.grass, park: GC.grass, garden: GC.garden, recreation_ground: GC.grass, village_green: GC.grass, meadow: GC.grass, cemetery: GC.grass,
    churchyard: GC.grass, common: GC.grass, dog_park: GC.grass, flowerbed: GC.garden, allotments: GC.garden, orchard: GC.garden, pitch: GC.pitch, playground: GC.play,
    parking: GC.parking, construction: GC.soil, brownfield: GC.soil, greenfield: GC.grass, wood: GC.wood, forest: GC.wood, scrub: GC.wood, grassland: GC.grass,
    outdoor_seating: GC.plaza, square: GC.plaza, schoolyard: GC.yard, sports_centre: GC.yard, track: GC.play, swimming_pool: GC.water };
  const land = F.land.filter(l => LAND[l.kind] != null).sort((a, b) => b.area - a.area);   // small features over large ones
  for (const l of land) {
    if (l.kind === 'garden' && l.tags.garden && l.tags.garden !== 'residential' && l.area > 4000) G.poly(l, GC.grass);
    else if (l.kind === 'parking' && (l.tags.parking === 'multi-storey' || l.tags.parking === 'underground')) continue;
    else G.poly(l, LAND[l.kind]);
  }
  log(`  land ${land.length}`);
  // water: polygons, then centre lines of rivers and canals that are open to the sky
  for (const w of F.water) {
    const t = w.tags, kind = t.water === 'river' || t.waterway === 'riverbank' ? GC.river : (t.water === 'canal' || t.water === 'basin' || t.water === 'lock') ? GC.canal : GC.water;
    if (t.tunnel || t.covered === 'yes') continue;
    G.poly(w, kind);
  }
  for (const w of F.waterways) {
    const t = w.tags; if (t.tunnel && t.tunnel !== 'no') continue;
    if (t.covered === 'yes' || t.waterway === 'drain') continue;
    const name = t.name || '';
    const half = t.waterway === 'canal' ? 4.5 : t.waterway === 'river' ? (/Irwell/.test(name) ? 17 : /Irk/.test(name) ? 4 : 5) : 1.4;
    const kind = t.waterway === 'canal' ? GC.canal : t.waterway === 'river' ? GC.river : GC.water;
    G.stroke(w.pts, half, kind, c => WATERISH[c] === 1);
  }
  // railway ballast at ground level (elevated lines are built by the viaduct module; tunnels are skipped)
  for (const r of F.rails) {
    const t = r.tags; if (isElevatedWay(t) || isTunnel(t) || t.tunnel) continue;
    if (t.railway === 'tram') continue;
    if (!r.hv) { G.stroke(r.pts, 2.1, GC.ballast, keepWater); continue; }
    for (let s = 0; s + 1 < r.pts.length; s++) if (Math.max(r.hv[s], r.hv[s + 1]) < .6) G.stroke([r.pts[s], r.pts[s + 1]], 2.1, GC.ballast, keepWater);   // ramps rise onto embankments
  }
  for (const p of F.platforms) if (p.outers && !(parseInt(p.tags.layer) >= 1)) G.poly(p, GC.plaza);
  // pedestrian areas
  for (const a of F.areasHighway) {
    const k = a.tags['area:highway'] || a.tags.highway;
    if (a.tags.layer && parseInt(a.tags.layer) !== 0) continue;
    const v = k === 'pedestrian' || k === 'footway' || k === 'platform' ? GC.plaza : k === 'traffic_island' ? GC.pave : k === 'cycleway' ? GC.roadR : HALF[k] != null || k === 'crossing' ? GC.road : null;
    if (v != null) G.poly(a, v);
  }
  // footways and paths: paving in streets, gravel in parks
  const footish = F.roads.filter(r => FOOT[r.tags.highway] != null && r.tags.highway !== 'pedestrian' && !isElevatedWay(r.tags) && !(r.tags.tunnel && r.tags.tunnel !== 'building_passage') && r.tags.area !== 'yes' && r.tags.indoor !== 'yes' && r.tags.footway !== 'crossing');
  for (const r of footish) {
    const half = FOOT[r.tags.highway], surf = r.tags.surface || '';
    const parky = /gravel|dirt|compacted|ground|unpaved|grass/.test(surf);
    G.stroke(r.pts, half, parky ? GC.path : GC.pave, c => WATERISH[c] === 1);
  }
  // vehicular roads: pavements first (minor roads first), then carriageways
  const veh = F.roads.filter(r => HALF[r.tags.highway] != null && !isTunnel(r.tags) && !(r.tags.tunnel === 'yes') && r.tags.area !== 'yes')
    .sort((a, b) => (RANK[a.tags.highway] || 0) - (RANK[b.tags.highway] || 0));
  const elevatedRoad = t => isElevatedWay(t) && (RANK[t.highway] >= 9 || t.highway === 'motorway_link' || t.highway === 'trunk_link');
  for (const r of veh) {
    const t = r.tags; if (elevatedRoad(t)) continue;
    const h = roadHalf(t); if (h == null) continue;
    const side = t.highway === 'service' ? (t.service === 'alley' ? 0 : .6) : t.highway === 'motorway' || t.highway.endsWith('_link') ? .8 : (t.sidewalk === 'no' || t.sidewalk === 'none') ? .8 : 2.6;
    if (side > 0) atGrade(r, pts => G.stroke(pts, h + side, t.highway === 'motorway' || t.highway.endsWith('_link') ? GC.grass : GC.pave, c => WATERISH[c] === 1 && !t.bridge));
  }
  for (const r of veh) {
    const t = r.tags; if (elevatedRoad(t)) continue;
    const h = roadHalf(t); if (h == null) continue;
    const surf = t.surface || '';
    atGrade(r, pts => G.stroke(pts, h, /sett|cobble/.test(surf) ? GC.sett : GC.road, c => WATERISH[c] === 1 && !t.bridge));
  }
  // pedestrian streets (Market Street, King Street...)
  for (const r of F.roads) if (r.tags.highway === 'pedestrian' && r.tags.area !== 'yes' && !isElevatedWay(r.tags)) G.stroke(r.pts, 4, GC.plaza, c => c === GC.road);
  // granite kerbs where pavement meets carriageway
  const C = G.cls, nx = G.nx, nz = G.nz;
  for (let k = 1; k < nz - 1; k++) for (let i = 1; i < nx - 1; i++) {
    const c = k * nx + i, v = C[c];
    if (v !== GC.pave && v !== GC.plaza && v !== GC.yard) continue;
    if (ROADISH[C[c - 1]] || ROADISH[C[c + 1]] || ROADISH[C[c - nx]] || ROADISH[C[c + nx]]) C[c] = GC.curb;
  }
  log(`  ground raster ${nx}x${nz}`);
  return G;
}

/* ---------------- heightfield mesher ---------------- */
export function meshGround(G, store, TILE = 320) {
  const { nx, nz, cls: C, X0, Z0 } = G;
  const mask = new Uint8Array(TILE * TILE);
  let quads = 0;
  const tileT = name => ({ road: 4, roadW: 4, roadR: 4, pave: 1.2, plaza: 2.4, sett: .6, curb: 1.2, yard: 2.4, grass: 2, grassD: 2, garden: 2, pitch: 3, path: 1, soil: 1, ballast: 1, water: 8, canal: 8, play: 2, bank: 1.8, slabSide: 4 }[name] || 2);
  for (let tk = 0; tk < nz; tk += TILE) for (let ti = 0; ti < nx; ti += TILE) {
    const W = Math.min(TILE, nx - ti), H = Math.min(TILE, nz - tk);
    const grp = store.group(store.key(X0 + (ti + W / 2) * CS, Z0 + (tk + H / 2) * CS));
    // top faces
    for (let k = 0; k < H; k++) for (let i = 0; i < W; i++) mask[k * W + i] = C[(tk + k) * nx + ti + i] + 1;
    for (let k = 0; k < H; k++) for (let i = 0; i < W;) {
      const m = mask[k * W + i]; if (!m) { i++; continue; }
      let w = 1; while (i + w < W && mask[k * W + i + w] === m) w++;
      let h = 1; grow: while (k + h < H) { const r = (k + h) * W + i; for (let q = 0; q < w; q++) if (mask[r + q] !== m) break grow; h++; }
      for (let kk = 0; kk < h; kk++) mask.fill(0, (k + kk) * W + i, (k + kk) * W + i + w);
      const d = GDEF[m - 1], t = tileT(d.mat), x = X0 + (ti + i) * CS, z = Z0 + (tk + k) * CS, ww = w * CS, hh = h * CS;
      store.prim(grp, d.mat).quad(x, d.h, z, ww, 0, 0, 0, 0, hh, 0, 1, 0, x / t, z / t, ww / t, 0, 0, hh / t);
      quads++; i += w;
    }
    // side faces between cells of different height, merged along the edge
    const side = (hi, lo) => WATERISH[lo] ? 'bank' : GDEF[hi].side;
    // faces normal ±x (edges between columns i and i+1), runs along z
    for (let i = ti; i < ti + W; i++) {
      if (i + 1 >= nx) continue;
      let run = null;
      const flush = () => { if (!run) return; emitSide(run); run = null; };
      for (let k = tk; k <= tk + H; k++) {
        let key = null;
        if (k < tk + H) {
          const a = C[k * nx + i], b = C[k * nx + i + 1], ha = GDEF[a].h, hb = GDEF[b].h;
          if (ha !== hb) key = ha > hb ? { hi: a, lo: b, s: 1 } : { hi: b, lo: a, s: -1 };
        }
        if (run && key && key.hi === run.hi && key.lo === run.lo && key.s === run.s) { run.k1 = k; continue; }
        flush();
        if (key) run = { ...key, k0: k, k1: k, axis: 0, line: i + 1 };
      }
      flush();
    }
    // faces normal ±z (edges between rows k and k+1), runs along x
    for (let k = tk; k < tk + H; k++) {
      if (k + 1 >= nz) continue;
      let run = null;
      const flush = () => { if (!run) return; emitSide(run); run = null; };
      for (let i = ti; i <= ti + W; i++) {
        let key = null;
        if (i < ti + W) {
          const a = C[k * nx + i], b = C[(k + 1) * nx + i], ha = GDEF[a].h, hb = GDEF[b].h;
          if (ha !== hb) key = ha > hb ? { hi: a, lo: b, s: 1 } : { hi: b, lo: a, s: -1 };
        }
        if (run && key && key.hi === run.hi && key.lo === run.lo && key.s === run.s) { run.k1 = i; continue; }
        flush();
        if (key) run = { ...key, k0: i, k1: i, axis: 2, line: k + 1 };
      }
      flush();
    }
    function emitSide(r) {
      const yh = GDEF[r.hi].h, yl = GDEF[r.lo].h, mat = side(r.hi, r.lo), t = tileT(mat), L = (r.k1 - r.k0 + 1) * CS;
      if (r.axis === 0) { // plane x = X0 + line*CS; high side is column line-1 when s = 1 (face looks +x)
        const x = X0 + r.line * CS, z = Z0 + r.k0 * CS;
        store.prim(grp, mat).quad(x, yl, z, 0, 0, L, 0, yh - yl, 0, r.s, 0, 0, -z * r.s / t, -yl / t, -L * r.s / t, 0, 0, -(yh - yl) / t);
      } else {
        const z = Z0 + r.line * CS, x = X0 + r.k0 * CS;
        store.prim(grp, mat).quad(x, yl, z, L, 0, 0, 0, yh - yl, 0, 0, 0, r.s, x * r.s / t, -yl / t, L * r.s / t, 0, 0, -(yh - yl) / t);
      }
      quads++;
    }
  }
  // the slab's outer walls at the edge of the model, following the surface height
  const sides = [
    { n: [-1, 0], len: nz, cell: q => q * nx, at: q => [X0, Z0 + q * CS], dir: [0, 1] },
    { n: [1, 0], len: nz, cell: q => q * nx + nx - 1, at: q => [G.X1, Z0 + q * CS], dir: [0, 1] },
    { n: [0, -1], len: nx, cell: q => q, at: q => [X0 + q * CS, Z0], dir: [1, 0] },
    { n: [0, 1], len: nx, cell: q => (nz - 1) * nx + q, at: q => [X0 + q * CS, G.Z1], dir: [1, 0] },
  ];
  for (const s of sides) for (let q = 0; q < s.len;) {
    const h = GDEF[C[s.cell(q)]].h; let e = q + 1;
    while (e < s.len && GDEF[C[s.cell(e)]].h === h && (e % TILE) !== 0) e++;
    const [x, z] = s.at(q), L = (e - q) * CS;
    store.prim(store.group(store.key(x, z)), 'slabSide').quad(x, SLAB, z, s.dir[0] * L, 0, s.dir[1] * L, 0, h - SLAB, 0, s.n[0], 0, s.n[1],
      (x * s.dir[0] + z * s.dir[1]) / 4, -SLAB / 4, L / 4, 0, 0, -(h - SLAB) / 4);
    quads++; q = e;
  }
  return quads;
}
