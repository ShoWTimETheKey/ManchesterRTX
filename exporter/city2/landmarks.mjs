// Landmarks drawn by dedicated builders instead of the generic OSM building generator, and style overrides for
// buildings whose generic look is wrong. Footprints (and, where mapped, 3D parts) come from OpenStreetMap; towers,
// heights and details follow the real buildings.
import { buildGothic } from './gothic.mjs';
import { buildRotunda } from './classical.mjs';
import { buildTowers } from './towers.mjs';
import { dominantAngle, rot, unrot, centroid } from './geo.mjs';
import { parseHeight } from './osm.mjs';
import { addMaterials } from './mat.mjs';

addMaterials({
  redSandG: { p: 'ashlar', hex: '#8a4b41', t: 1.2, tex: 1024, soot: .45, joint: .012 },
  redSandD: { p: 'ashlar', hex: '#6c3a33', t: 1.2, soot: .5 },
  redSandT: { p: 'ashlar', hex: '#a35f53', t: 1.2, soot: .3 },
  cathStone: { p: 'ashlar', hex: '#7b6151', t: 1.2, tex: 1024, soot: .55, joint: .012 },
  cathDark: { p: 'ashlar', hex: '#5d493d', t: 1.2, soot: .6 },
  cathTrim: { p: 'ashlar', hex: '#937867', t: 1.2, soot: .4 },
  terraBrown: { p: 'terracotta', hex: '#8f4b34', t: 1.2, tex: 1024 },
  terraPink: { p: 'terracotta', hex: '#b0644b', t: 1.2 },
  midBrick: { p: 'brick', hex: '#8e4532', t: .9, tex: 1024 },
});

const UOM = { wall: 'uomStone', dark: 'uomDark', trim: 'uomTrim', roof: 'slateG' };
const TH = { wall: 'thStone', dark: 'thDark', trim: 'thTrim', roof: 'slateG' };

// University of Manchester, Old Quadrangle (Alfred Waterhouse and Paul Waterhouse, 1870-1902)
const OLD_QUAD = [
  { id: 79714496, name: 'John Owens Building', eaves: 14.2, slope: 1.45,
    towers: [{ x: 638.6, z: 1033.2, w: 8.6, d: 8.6, h: 31, spire: 17, clock: true, kind: 'spire' }] },
  { id: 217171535, name: 'Beyer Building', eaves: 13.4, slope: 1.4 },
  // Whitworth Building and Hall (Paul Waterhouse, 1895-1902): red clay roofs laid in fish-scale bands, finer voxels; the
  // gateway between them on Oxford Road carries the university's name over the arch, and the hall's south front is
  // flanked by two corner towers with belfry stages and short spires
  { id: 217170609, name: 'Whitworth Building', eaves: 14.2, slope: 1.45, roof: 'tileFish', V: .16 },
  { id: 1064044304, name: "The Queen's Arch", V: .16, roof: 'tileFish',
    tower: { h: 27, spire: 13, kind: 'spire', arch: { w: 4.4, h: 7.2, axis: 'z' }, lettering: { mask: 'uom-lettering', toward: [722, 1020], cap: .42 } } },
  { id: 217170181, name: 'Whitworth Hall', eaves: 16.8, slope: 1.55, hall: true, roof: 'tileFish', V: .16, southTowers: true },
  { id: 217170046, name: 'Christie Building', eaves: 12.2, slope: 1.4 },
];
// the Manchester Museum's Oxford Road range (parts of the museum outline) and its tower
const MUSEUM = { outline: 79819877, parts: [637894274, 637899377, 637894676, 637899374, 637899376], tower: 637899380 };
// city-centre landmarks built from their OSM parts or outlines
const TOWN_HALL = 5409378, ALBERT = 570278857, RYLANDS = 29460499, CATHEDRAL = 130040953, MIDLAND = 13431629, REFUGE = 114603870, CENTRAL_LIB = 570282715, HOLY_NAME = 79713960;

export const LANDMARK_IDS = new Set([...OLD_QUAD.map(b => b.id), TOWN_HALL, ALBERT, RYLANDS, CATHEDRAL, MIDLAND, REFUGE, CENTRAL_LIB, HOLY_NAME, 682060630, 1217569813]);
export const LANDMARK_PARTS = new Set([...MUSEUM.parts, MUSEUM.tower]);

// generic style overrides (OSM id → facade kind and tweaks)
export const STYLE_OVERRIDES = new Map([
  [135909529, { kind: 'uniBrick', trim: 'terraBuff', roof: 'mansard', roofMat: 'slate' }],   // Sackville Street Building (brick and terracotta)
  [79713962, { kind: 'uniBrick', trim: 'terraBuff' }],                                   // The Whitworth
  [334619210, { kind: 'curtain', glass: 'glassS' }],                                     // Alan Turing Building
  [75361245, { kind: 'concrete' }], [79819294, { kind: 'concrete' }], [79707646, { kind: 'concrete' }],   // Kilburn, Schuster, Renold
  [354359689, { kind: 'curtain', glass: 'glassB' }],                                     // University Place
  [1839028, { kind: 'stone', wall: 'portland' }],                                        // Main Library
  [216684105, { kind: 'curtain', glass: 'glassG' }],                                     // Alan Gilbert Learning Commons
  [1839023, { kind: 'concrete' }], [79819871, { kind: 'concrete' }],                    // Stopford, Ellen Wilkinson
  [79819292, { kind: 'uniBrick' }], [1452192047, { kind: 'uniBrick' }],                 // Williamson Building
  [14249231, { kind: 'stone', wall: 'portland' }],                                       // Samuel Alexander Building
  [31178728, { kind: 'stone', wall: 'terra', trim: 'terraBuff', roof: 'flat', roofMat: 'roofFlat' }],   // Palace Theatre
  [4947738, { kind: 'stone', wall: 'sand', trim: 'trim', roof: 'mansard', roofMat: 'slate' }],          // Corn Exchange
  [29461262, { kind: 'curtain', glass: 'glassS' }],                                      // Beetham Tower
  [605806360, { kind: 'curtain', glass: 'glassK' }], [647012954, { kind: 'curtain', glass: 'glassK' }], [647012955, { kind: 'curtain', glass: 'glassK' }],   // Deansgate Square
  [751368109, { kind: 'curtain', glass: 'glassK' }],                                     // Elizabeth Tower
  [143947389, { kind: 'curtain', glass: 'glassS' }],                                     // One Angel Square
  [96396472, { kind: 'curtain', glass: 'glassG' }],                                      // Urbis / National Football Museum
  [353071410, { kind: 'curtain', glass: 'glassD' }],                                     // CIS Tower
  [28039097, { kind: 'stone', wall: 'buff', trim: 'trim', roof: 'gabled', roofMat: 'slateG' }],         // Town Hall Extension
  [29450342, { kind: 'stone', wall: 'sand' }], [136038229, { kind: 'stone', wall: 'sand', roofMat: 'slate' }],   // Free Trade Hall, Royal Exchange
  [35277100, { kind: 'stone', wall: 'sand' }], [29460210, { kind: 'stone', wall: 'portland' }],         // Lloyd's House, Kendals
  [27930372, { kind: 'warehouse' }], [114467021, { kind: 'warehouse' }], [117741295, { kind: 'warehouse' }],   // Liverpool Road station, India House, Asia House
  [114604597, { kind: 'stone', wall: 'terra', trim: 'terraBuff' }],                     // Canada House
  [353267814, { kind: 'concrete', wall: 'concD' }], [79819312, { kind: 'concrete' }],  // Arndale House, RNCM
]);

const polyOf = (f, extra) => ({ outers: f.outers, inners: f.inners || [], ...extra });
function orientedSize(ring, ang = dominantAngle(ring)) {
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (const [x, z] of ring) { const [u, v] = rot(x, z, ang); a = Math.min(a, u); b = Math.max(b, u); c = Math.min(c, v); d = Math.max(d, v); }
  return { ang, w: b - a, d: d - c, u0: a, u1: b, v0: c, v1: d };
}
// a point of the footprint's oriented box: fu, fv in [0, 1] across its width and depth, inset by 'ins' metres
function boxPoint(ring, ang, fu, fv, ins = 0) {
  const s = orientedSize(ring, ang), u = s.u0 + ins + (s.w - 2 * ins) * fu, v = s.v0 + ins + (s.d - 2 * ins) * fv;
  return unrot(u, v, ang);
}

// OSM building parts → gothic polys and towers: small pyramidal/dome parts become towers; a tower part standing on a
// flat shaft of the same footprint becomes that shaft's belfry stage
function fromParts(b, ang) {
  const polys = [], towers = [];
  for (const p of b.parts) {
    const t = p.tags, lv = parseFloat(t['building:levels']);
    const H = parseHeight(t.height) ?? (isFinite(lv) ? lv * 4.2 : 12), min = parseHeight(t.min_height) || 0;
    const shape = t['roof:shape'] || 'flat';
    let rh = parseHeight(t['roof:height']);
    const sz = orientedSize(p.outers[0], ang);
    if ((shape === 'pyramidal' || shape === 'dome') && p.area < 260) {
      if (rh == null) rh = shape === 'dome' ? Math.min(sz.w, sz.d) * .6 : Math.min(sz.w, sz.d) * 1.4;
      towers.push({ x: p.c[0], z: p.c[1], w: sz.w, d: sz.d, h: H - rh, spire: rh, min, kind: shape === 'dome' ? 'dome' : (rh > 8 ? 'spire' : 'pyramid'), pinnacles: shape !== 'dome' });
      continue;
    }
    const roof = shape === 'flat' || shape === 'dome' || shape === 'round' ? 'flat' : shape === 'hipped' || shape === 'pyramidal' ? 'hipped' : 'gabled';
    if (rh == null && roof !== 'flat') rh = Math.min(sz.w, sz.d) * .5;
    polys.push({ outers: p.outers, inners: p.inners || [], eaves: H - (roof === 'flat' ? 0 : rh), base: min, roof, ridgeCap: rh || undefined, slope: 1.4, c: p.c, w: sz.w, d: sz.d });
  }
  for (const t of towers) {
    if (t.min <= 0) continue;
    const shaft = polys.find(p => p.roof === 'flat' && Math.abs(p.eaves - t.min) < 1.5 && Math.hypot(p.c[0] - t.x, p.c[1] - t.z) < 2.5 && p.w < 25);
    if (shaft) { polys.splice(polys.indexOf(shaft), 1); t.stage = { w: Math.min(t.w, t.d), h: t.h - t.min }; t.w = shaft.w; t.d = shaft.d; t.h = t.min; t.clock = true; }
  }
  return { polys, towers };
}

// split a building's parts into groups of similar orientation (folded to 0-90°); the group with the largest area
// draws its footprints in full, the others are cut out of it
function groupParts(b) {
  const groups = [];
  for (const p of b.parts) {
    const a = dominantAngle(p.outers[0]);
    let g = groups.find(g => { const d = Math.abs(g.ang - a) % (Math.PI / 2); return Math.min(d, Math.PI / 2 - d) < .14; });
    if (!g) groups.push(g = { ang: a, parts: [], area: 0 });
    g.parts.push(p); g.area += p.area;
  }
  groups.sort((a, b2) => b2.area - a.area);
  return groups.map((g, n) => ({ ...g, n, others: groups.filter(o => o !== g).flatMap(o => o.parts), exclude: n === 0 }));
}

export function buildLandmarks(F, byId, store, log = () => {}) {
  let q = 0;
  const neighboursOf = b => (b.neighbours || []).map(o => o.outers[0]);
  const run = (name, spec) => { const n = buildGothic(spec, store); q += n; log(`  ${name}: ${n.toLocaleString('en-US')} quads`); };
  /* ---------- University of Manchester ---------- */
  for (const s of OLD_QUAD) {
    const b = byId.get(s.id); if (!b) { log(`  missing ${s.name}`); continue; }
    const spec = { id: s.id, mats: s.roof ? { ...UOM, roof: s.roof } : UOM, floors: [4.6, 4.2], bay: 3.6, lights: 2, neighbours: neighboursOf(b), V: s.V };
    if (s.tower) {   // a tower standing on the whole footprint (the gatehouse over the Queen's Arch)
      const { ang, w, d } = orientedSize(b.outers[0]);
      Object.assign(spec, { angle: ang, polys: [polyOf(b, { eaves: s.tower.h, roof: 'flat' })], towers: [{ x: b.c[0], z: b.c[1], w: w + .3, d: d + .3, ...s.tower }], buttresses: false });   // the tower's faces are the gatehouse's walls
    } else Object.assign(spec, { polys: [polyOf(b, { eaves: s.eaves, roof: 'gabled', slope: s.slope, hall: s.hall })], towers: [...(s.towers || [])] });
    if (s.southTowers) {   // the two corner towers that flank the hall's great south window
      const ring = b.outers[0], o = orientedSize(ring), long = o.w >= o.d;
      const ends = [0, 1].map(f => long ? [f, .5] : [.5, f]).map(([fu, fv]) => ({ fu, fv, p: boxPoint(ring, o.ang, fu, fv) }));
      const south = ends.sort((a2, b2) => b2.p[1] - a2.p[1])[0];
      for (const side of [0, 1]) {
        const [x, z] = boxPoint(ring, o.ang, long ? south.fu : side, long ? side : south.fv, 2.3);
        spec.towers.push({ x, z, w: 4.6, d: 4.6, h: 21, stage: { w: 3.4, h: 4.2 }, spire: 6.5, kind: 'spire' });
      }
    }
    run(s.name, spec);
  }
  { const parts = MUSEUM.parts.map(id => F.parts.find(p => p.id === id)).filter(Boolean), tw = F.parts.find(p => p.id === MUSEUM.tower);
    const outline = byId.get(MUSEUM.outline);
    if (parts.length) {
      const levels = p => parseFloat(p.tags['building:levels']) || 3;
      const spec = { id: MUSEUM.outline, mats: UOM, floors: [4.6, 4.2], bay: 3.6, lights: 2,
        polys: parts.map(p => polyOf(p, { eaves: Math.max(10, levels(p) * 4.1), roof: 'gabled', slope: 1.45 })), neighbours: outline ? neighboursOf(outline) : [] };
      if (tw) { const { ang, w, d } = orientedSize(tw.outers[0]); spec.angle = ang; spec.towers = [{ x: tw.c[0], z: tw.c[1], w: Math.max(6, w - .4), d: Math.max(6, d - .4), h: 30, spire: 13, kind: 'spire' }]; }
      run('Manchester Museum', spec);
    } }
  /* ---------- Manchester Town Hall (Waterhouse, 1877) and the Albert Memorial ---------- */
  { const b = byId.get(TOWN_HALL);
    if (b) {
      // the triangular plan has ranges in two orientations: each group of parts gets its own voxel frame
      for (const grp of groupParts(b)) {
        const { polys, towers } = fromParts({ ...b, parts: grp.parts }, grp.ang);
        const others = grp.others.map(p => p.outers[0]);
        run(`Town Hall (${(grp.ang * 180 / Math.PI).toFixed(0)}°)`, { id: TOWN_HALL + grp.n, angle: grp.ang, mats: TH, floors: [5.4, 5.0], bay: 4.2, lights: 2, polys, towers,
          neighbours: [...neighboursOf(b), ...others], exclude: grp.exclude ? others : [], parapet: 'battlement', V: .2 });
      } } }
  { const b = byId.get(ALBERT);
    if (b) { const { ang, w, d } = orientedSize(b.outers[0]);
      run('Albert Memorial', { id: ALBERT, angle: ang, mats: { wall: 'thTrim', dark: 'thDark', trim: 'uomTrim', roof: 'leadD' }, floors: [6, 6], bay: 4, lights: 1,
        polys: [polyOf(b, { eaves: 9.5, roof: 'flat' })], towers: [{ x: b.c[0], z: b.c[1], w: Math.max(5, w), d: Math.max(5, d), h: 10, spire: 11.5, kind: 'spire', arch: { w: 3.2, h: 6.6, axis: 'both' } }], buttresses: false, gables: false, dormers: false }); } }
  /* ---------- John Rylands Library (Basil Champneys, 1900): red Penrith sandstone ---------- */
  { const b = byId.get(RYLANDS);
    if (b) { const ang = dominantAngle(b.outers[0]), ring = b.outers[0], s = orientedSize(ring, ang);
      // two towers flank the entrance on the long side that faces Deansgate (east)
      const long = s.w >= s.d, sides = long ? [[.5, 0], [.5, 1]] : [[0, .5], [1, .5]];
      const east = sides.map(([fu, fv]) => [fu, fv, boxPoint(ring, ang, fu, fv)[0]]).sort((a, b2) => b2[2] - a[2])[0];
      const at = f => long ? [f, east[1]] : [east[0], f];
      const towers = [.36, .64].map(f => { const [x, z] = boxPoint(ring, ang, ...at(f), 3); return { x, z, w: 6, d: 6, h: 31, spire: 5, kind: 'pyramid' }; });
      run('John Rylands Library', { id: RYLANDS, angle: ang, mats: { wall: 'redSandG', dark: 'redSandD', trim: 'redSandT', roof: 'slateG' }, floors: [5.5, 6], bay: 3.6, lights: 3,
        polys: [polyOf(b, { eaves: 22, roof: 'flat', hall: true })], towers, neighbours: neighboursOf(b), parapet: 'battlement', gables: false, dormers: false }); } }
  /* ---------- Manchester Cathedral: Perpendicular Gothic, battlements, west tower ---------- */
  { const b = byId.get(CATHEDRAL);
    if (b) { const ang = dominantAngle(b.outers[0]), ring = b.outers[0], s = orientedSize(ring, ang);
      // the tower stands at the west end
      const ends = [boxPoint(ring, ang, 0, .5, 5.2), boxPoint(ring, ang, 1, .5, 5.2)], west = ends[0][0] < ends[1][0] ? ends[0] : ends[1];
      run('Manchester Cathedral', { id: CATHEDRAL, angle: ang, mats: { wall: 'cathStone', dark: 'cathDark', trim: 'cathTrim', roof: 'leadD' }, floors: [6, 6], bay: 4.2, lights: 3,
        polys: [polyOf(b, { eaves: 15.5, roof: 'flat', hall: true })], towers: [{ x: west[0], z: west[1], w: 9.4, d: 9.4, h: 42, spire: 0, kind: 'pyramid', clock: true }],
        neighbours: neighboursOf(b), parapet: 'battlement', gables: false, dormers: false }); } }
  /* ---------- Midland Hotel (Charles Trubshaw, 1903): red brick and brown Burmantofts terracotta ---------- */
  { const b = byId.get(MIDLAND);
    if (b) { const ang = dominantAngle(b.outers[0]), ring = b.outers[0];
      const towers = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([fu, fv]) => { const [x, z] = boxPoint(ring, ang, fu, fv, 3.6); return { x, z, w: 7, d: 7, h: 30, spire: 6, kind: 'dome', domeMat: 'copper', pinnacles: false }; });
      run('Midland Hotel', { id: MIDLAND, angle: ang, mats: { wall: 'midBrick', dark: 'terraBrown', trim: 'terraBrown', roof: 'slate' }, floors: [5.5, 3.8], bay: 3.4, lights: 1, lw: 5, head: 'round',
        polys: [polyOf(b, { eaves: 26, roof: 'gabled', slope: 1.6, ridgeCap: 5 })], towers, neighbours: neighboursOf(b), buttresses: false, gables: true, dormers: true, cornice: true }); } }
  /* ---------- Kimpton Clocktower (Refuge Assurance Building, 1895-1912): terracotta, 66 m clock tower ---------- */
  { const b = byId.get(REFUGE);
    if (b) { const ang = dominantAngle(b.outers[0]), { polys, towers } = b.parts.length ? fromParts(b, ang) : { polys: [polyOf(b, { eaves: 24, roof: 'gabled' })], towers: [] };
      for (const t of towers) { t.domeMat = 'terraPink'; if (t.stage) { t.stage.h = Math.max(t.stage.h, 4); } }
      run('Kimpton Clocktower', { id: REFUGE, angle: ang, mats: { wall: 'midBrick', dark: 'terraBrown', trim: 'terraPink', roof: 'slate' }, floors: [5.2, 3.9], bay: 3.4, lights: 1, lw: 5, head: 'round',
        polys, towers, neighbours: neighboursOf(b), buttresses: false, gables: true, dormers: true, cornice: true, parapet: 'balustrade' }); } }
  /* ---------- Church of the Holy Name (Joseph Hansom, 1871; lantern tower by Adrian Gilbert Scott, 1928) ---------- */
  { const b = byId.get(HOLY_NAME);
    if (b && b.parts.length) { const ang = dominantAngle(b.outers[0]), tw = b.parts.find(p => p.id === 1341138714);
      const { polys, towers } = fromParts({ ...b, parts: b.parts.filter(p => p !== tw) }, ang);
      for (const p of polys) Object.assign(p, { hall: true, slope: 1.7, roof: p.roof === 'flat' ? 'gabled' : p.roof });
      if (tw) { const s = orientedSize(tw.outers[0], ang); towers.push({ x: tw.c[0], z: tw.c[1], w: s.w, d: s.d, h: 44, stage: { w: Math.min(s.w, s.d) - 1.2, h: 8 }, spire: 4, kind: 'pyramid' }); }
      run('Holy Name Church', { id: HOLY_NAME, angle: ang, mats: UOM, floors: [6, 6], bay: 3.8, lights: 2, polys, towers, neighbours: neighboursOf(b), gables: false, dormers: false }); } }
  /* ---------- Central Library rotunda ---------- */
  { const b = byId.get(CENTRAL_LIB);
    if (b) { const portico = F.parts.find(p => p.id === 663162500);
      const n = buildRotunda({ id: CENTRAL_LIB, c: b.c, R: 31.7, portico: portico ? portico.c : [b.c[0] + 30, b.c[1]] }, store); q += n;
      log(`  Central Library: ${n.toLocaleString('en-US')} quads`); } }
  /* ---------- the two featured towers ---------- */
  const towers = buildTowers(F, byId, store, log); q += towers.quads;
  return { quads: q, pins: towers.pins };
}
