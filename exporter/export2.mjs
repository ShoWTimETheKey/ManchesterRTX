// Manchester from OpenStreetMap → glTF 2.0 (.glb) + RTXPT scene files + the GUI's manchester.app.json.
//   node export2.mjs              full export
//   node export2.mjs --no-tex     reuse the textures on disk
//   node export2.mjs --radius 500 only buildings within 500 m of the centre (quick look)
// Map data © OpenStreetMap contributors, ODbL (downloads/osm/manchester-osm.json).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from './textures.mjs';
import { MAT, EMISSIVE_LEVELS } from './city2/mat.mjs';
import { loadOSM } from './city2/osm.mjs';
import { MeshStore, Prim } from './city2/vox.mjs';
import { buildGround, meshGround, SLAB } from './city2/ground.mjs';
import { prepareBuildings, buildBuilding } from './city2/buildings.mjs';
import { prepareInfra, buildInfra } from './city2/infra.mjs';
import { buildingMask, simplifyUnderBuildings, buildTracks, buildMarkings, buildLamps, buildTrees, buildOHLE, buildSites } from './city2/props.mjs';
import { buildLandmarks, LANDMARK_IDS, LANDMARK_PARTS, STYLE_OVERRIDES } from './city2/landmarks.mjs';
import { buildSatellites } from './city2/satellites.mjs';
import { writeGLB } from './city2/glb.mjs';
import { guiText } from './gui-text.mjs';
import { project } from './city2/geo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(HERE, '..', 'renderer', 'Assets'), OUT = path.join(ASSETS, 'Models', 'Manchester'), TEX = path.join(OUT, 'textures');
const argv = process.argv.slice(2), ARGS = new Set(argv), argVal = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? +argv[i + 1] : d; };
const t0 = performance.now(), log = m => console.log(`[${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${m}`);
fs.mkdirSync(TEX, { recursive: true });

/* ---------------- 1. data ---------------- */
// the OSM extract the model is built from: the copy kept with the sources (data/osm, ODbL), or a fresh download
const OSM_FILE = [path.resolve(HERE, '..', 'data', 'osm', 'manchester-osm.json'), path.resolve(HERE, '..', 'downloads', 'osm', 'manchester-osm.json')].find(f => fs.existsSync(f));
if (!OSM_FILE) throw new Error('OpenStreetMap extract missing: data/osm/manchester-osm.json (tools\\fetch-osm.ps1 downloads a fresh one)');
const F = loadOSM(OSM_FILE);
export const EXT = { X0: -1290, Z0: -1580, X1: 1290, Z1: 1580 };
log(`OSM: ${F.buildings.length} buildings, ${F.roads.length} roads`);
const store = new MeshStore(192);

/* ---------------- 2. ground ---------------- */
prepareInfra(F);
const G = buildGround(F, EXT, log);
const B = prepareBuildings(F, { skip: LANDMARK_IDS, skipParts: LANDMARK_PARTS, overrides: STYLE_OVERRIDES });
// --focus x,z,r: only the area around a point (quick previews of a landmark)
const FOCUS = (() => { const i = argv.indexOf('--focus'); if (i < 0) return null; const [x, z, r] = argv[i + 1].split(',').map(Number); return { x, z, r }; })();
const nearFocus = (x, z, pad = 0) => !FOCUS || Math.hypot(x - FOCUS.x, z - FOCUS.z) <= FOCUS.r + pad;
const BM = buildingMask(G, B);
log(`ground: ${simplifyUnderBuildings(G, BM).toLocaleString('en-US')} cells under buildings merged`);
log(`ground: ${meshGround(G, store).toLocaleString('en-US')} quads`);

/* ---------------- 3. buildings ---------------- */
const radius = argVal('--radius', Infinity);
{ const ctx = { streetAt: (x, z) => G.isStreet(x, z) }; let q = 0, n = 0;
  for (const b of B) {
    if (b.landmark || b.c[0] < EXT.X0 || b.c[0] > EXT.X1 || b.c[1] < EXT.Z0 || b.c[1] > EXT.Z1) continue;
    if (Math.hypot(b.c[0], b.c[1]) > radius || !nearFocus(b.c[0], b.c[1])) continue;
    q += buildBuilding(b, store, ctx); n++;
  }
  log(`buildings: ${n}, ${q.toLocaleString('en-US')} quads`); }
const byId = new Map(B.map(b => [b.id, b]));
const LM = buildLandmarks(F, byId, store, log);
log(`landmarks: ${LM.quads.toLocaleString('en-US')} quads`);
const SAT = buildSatellites(F, store, log);
log(`stadiums: ${SAT.quads.toLocaleString('en-US')} quads`);

/* ---------------- 3b. viaducts, rails, streets, greenery ---------------- */
buildInfra(F, G, store, log);
log(`tracks: ${buildTracks(F, G, store).toLocaleString('en-US')} quads`);
log(`markings: ${buildMarkings(F, G, store).toLocaleString('en-US')} stripes`);
log(`lamps: ${buildLamps(F, G, BM, store)}`);
log(`trees: ${buildTrees(F, G, BM, store, B)}`);
log(`overhead line masts: ${buildOHLE(F, G, store)}`);
{ const s = buildSites(F, G, store); log(`construction sites: ${s.cranes} cranes, ${s.quads.toLocaleString('en-US')} quads`); }
if (FOCUS) {   // drop everything away from the focus
  for (const k of [...store.groups.keys()]) { const m = k.match(/^(-?\d+)_(-?\d+)$/); if (m && !nearFocus((+m[1] + .5) * store.tile, (+m[2] + .5) * store.tile, store.tile)) store.groups.delete(k); }
  for (const m of store.inst) m.nodes = m.nodes.filter(n => nearFocus(n.translation[0], n.translation[2], 30));
  store.groups.delete('plinth');
}

/* ---------------- 4. plinth and table ---------------- */
const RIM = 12, PLINTH_BOT = SLAB - 36, TABLE = 6000;
{ const P = store.prim('plinth', 'plinth'), Q = store.prim('plinth', 'table');
  const X0 = EXT.X0 - RIM, X1 = EXT.X1 + RIM, Z0 = EXT.Z0 - RIM, Z1 = EXT.Z1 + RIM, Yt = SLAB, Yb = PLINTH_BOT;
  const box = (p, x0, x1, z0, z1, yt, yb, top = true) => {   // the sides and (optionally) the top of a box
    if (top) p.quad(x0, yt, z0, x1 - x0, 0, 0, 0, 0, z1 - z0, 0, 1, 0, x0 / 8, z0 / 8, (x1 - x0) / 8, 0, 0, (z1 - z0) / 8);
    p.quad(x0, yb, z1, x1 - x0, 0, 0, 0, yt - yb, 0, 0, 0, 1, x0 / 8, -yb / 8, (x1 - x0) / 8, 0, 0, -(yt - yb) / 8);
    p.quad(x0, yb, z0, x1 - x0, 0, 0, 0, yt - yb, 0, 0, 0, -1, -x0 / 8, -yb / 8, -(x1 - x0) / 8, 0, 0, -(yt - yb) / 8);
    p.quad(x1, yb, z0, 0, 0, z1 - z0, 0, yt - yb, 0, 1, 0, 0, -z0 / 8, -yb / 8, -(z1 - z0) / 8, 0, 0, -(yt - yb) / 8);
    p.quad(x0, yb, z0, 0, 0, z1 - z0, 0, yt - yb, 0, -1, 0, 0, z0 / 8, -yb / 8, (z1 - z0) / 8, 0, 0, -(yt - yb) / 8);
  };
  // rim: four strips around the ground slab, then the plinth's outer walls
  P.quad(X0, Yt, Z0, X1 - X0, 0, 0, 0, 0, RIM, 0, 1, 0, X0 / 8, Z0 / 8, (X1 - X0) / 8, 0, 0, RIM / 8);
  P.quad(X0, Yt, EXT.Z1, X1 - X0, 0, 0, 0, 0, RIM, 0, 1, 0, X0 / 8, EXT.Z1 / 8, (X1 - X0) / 8, 0, 0, RIM / 8);
  P.quad(X0, Yt, EXT.Z0, RIM, 0, 0, 0, 0, EXT.Z1 - EXT.Z0, 0, 1, 0, X0 / 8, EXT.Z0 / 8, RIM / 8, 0, 0, (EXT.Z1 - EXT.Z0) / 8);
  P.quad(EXT.X1, Yt, EXT.Z0, RIM, 0, 0, 0, 0, EXT.Z1 - EXT.Z0, 0, 1, 0, EXT.X1 / 8, EXT.Z0 / 8, RIM / 8, 0, 0, (EXT.Z1 - EXT.Z0) / 8);
  box(P, X0, X1, Z0, Z1, Yt, Yb, false);
  Q.quad(-TABLE, Yb, -TABLE, 2 * TABLE, 0, 0, 0, 0, 2 * TABLE, 0, 1, 0, 0, 0, 2 * TABLE / 50, 0, 0, 2 * TABLE / 50);
  store.box = box; }

/* ---------------- 5. materials and textures ---------------- */
const used = new Set(); for (const g of store.groups.values()) for (const k of g.keys()) used.add(k); for (const m of store.inst) for (const k of m.prims.keys()) used.add(k);
const lin = h => T.hexLin(h);
const texOf = new Map();
if (!ARGS.has('--no-tex')) { T.bake(TEX, 'glass', 512, T.glass([.5, .5, .5]), { bump: .15 }); T.bake(TEX, 'water', 1024, T.water([.5, .5, .5]), { bump: 1.2 }); }
let baked = 0;
for (const name of [...used].sort()) {
  const d = MAT[name]; if (!d || d.glass || d.water || !d.p || d.p === 'plain') continue;
  const files = { albedo: `${name}_albedo.png`, normal: `${name}_normal.png`, orm: `${name}_orm.png` };
  if (!ARGS.has('--no-tex') || !fs.existsSync(path.join(TEX, files.albedo))) {
    const seed = [...name].reduce((s, c) => s * 31 + c.charCodeAt(0) | 0, 7) & 0xffff;
    T.bake(TEX, name, d.tex || 512, T[d.p](lin(d.hex), { seed, mortar: d.mortar, soot: d.soot, joint: d.joint, rough: d.rough, metal: d.metal, n: d.n }),
      { bump: d.p === 'grass' || d.p === 'foliage' ? 1.6 : 1 });
    baked++;
  }
  texOf.set(name, files);
}
log(`materials: ${used.size}, textures baked: ${baked}`);
const materials = [], matIndex = new Map(), images = [], textures = [], imgIndex = new Map();
const texIndex = uri => { if (!imgIndex.has(uri)) { images.push({ uri: 'textures/' + uri }); textures.push({ sampler: 0, source: images.length - 1 }); imgIndex.set(uri, textures.length - 1); } return imgIndex.get(uri); };
for (const name of [...used].sort()) {
  const d = MAT[name], base = lin(d.hex), tx = texOf.get(name), mat = { name, pbrMetallicRoughness: {} }, pbr = mat.pbrMetallicRoughness;
  if (d.glass) { pbr.baseColorFactor = [...(d.refl ? lin(d.refl) : base), 1]; pbr.metallicFactor = d.m ?? 0; pbr.roughnessFactor = d.r ?? .03; mat.normalTexture = { index: texIndex('glass_normal.png'), scale: 1 }; }
  else if (d.water) { pbr.baseColorFactor = [...base, 1]; pbr.metallicFactor = 0; pbr.roughnessFactor = .04; mat.normalTexture = { index: texIndex('water_normal.png'), scale: 1 }; }
  else if (tx) { pbr.baseColorTexture = { index: texIndex(tx.albedo) }; pbr.metallicRoughnessTexture = { index: texIndex(tx.orm) }; pbr.metallicFactor = 1; pbr.roughnessFactor = 1;
    mat.normalTexture = { index: texIndex(tx.normal), scale: 1 }; mat.occlusionTexture = { index: texIndex(tx.orm), strength: 1 }; }
  else { pbr.baseColorFactor = [...base, 1]; pbr.metallicFactor = d.m ?? 0; pbr.roughnessFactor = d.r ?? .6; }
  if (d.em) { const n = lin(d.night || d.hex), mx = Math.max(...n, 1e-4); mat.emissiveFactor = n.map(c => c / mx); }
  matIndex.set(name, materials.push(mat) - 1);
}

/* ---------------- 6. GLB ---------------- */
{ const meshes = [], nodes = [];
  for (const [name, g] of store.groups) { meshes.push({ name: `city_${name}`, prims: [...g.values()] }); nodes.push({ name: `city_${name}`, mesh: meshes.length - 1 }); }
  for (const m of store.inst) { meshes.push({ name: m.name, prims: [...m.prims.values()] }); for (const n of m.nodes) nodes.push({ ...n, mesh: meshes.length - 1 }); }
  const st = store.stats();
  log(`writing glb: ${st.quads.toLocaleString('en-US')} quads in ${st.prims} primitives, ${nodes.length} nodes`);
  const r = writeGLB(path.join(OUT, 'manchester.glb'), { meshes, nodes, materials, matIndex, textures, images, samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }] });
  log(`  manchester.glb ${(r.bytes / 1048576).toFixed(0)} MB, ${r.meshes} meshes, ${r.nodes} nodes`); }

/* ---------------- 7. scene files and the GUI's app file ---------------- */
function lookQuat(eye, at) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], norm = a => { const l = Math.hypot(...a); return a.map(c => c / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const f = norm(sub(at, eye)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f), z = f.map(c => -c);
  const m00 = r[0], m01 = u[0], m02 = z[0], m10 = r[1], m11 = u[1], m12 = z[1], m20 = r[2], m21 = u[2], m22 = z[2], tr = m00 + m11 + m22; let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]; }
  return q.map(v => +v.toFixed(6));
}
const at = (lat, lon, y = 0) => { const [x, z] = project(lat, lon); return [+x.toFixed(1), y, +z.toFixed(1)]; };
const roofOf = id => { const b = byId.get(id); return b ? b.H : 30; };
const centreOf = id => { const b = byId.get(id); return b ? b.c : [0, 0]; };
const towerRST = centreOf(682060630), towerAcer = centreOf(1217569813);
const towersMid = [(towerRST[0] + towerAcer[0]) / 2, 40, (towerRST[1] + towerAcer[1]) / 2];
const TH_C = centreOf(5409378), OQ_C = centreOf(217170181), OW_C = centreOf(79714496);
// camera name, eye, target, vertical fov, and the id of its GUI text in gui-text.mjs (or the text itself)
const VIEWS = [
  ['Overview', [420, 2550, 3650], [-20, -60, 60], .62, 'overview'],
  ['River Street & Acer towers', [towersMid[0] + 20, 150, towersMid[2] + 330], [towersMid[0], 45, towersMid[2]], .6, 'towers'],
  ['Town Hall & Albert Square', [TH_C[0] - 220, 80, TH_C[1] - 150], [TH_C[0] - 10, 35, TH_C[1] + 10], .6, 'townhall'],
  ['Deansgate skyline', [-120, 82, 360], [-536, 84, 120], .74, 'deansgate'],
  ['Castlefield viaducts', [-1015, 48, -235], [-835, 6, -30], .72, 'castlefield'],
  ['University Old Quad', [OQ_C[0] + 160, 70, OQ_C[1] + 120], [OW_C[0], 18, OW_C[1]], .62, 'university'],
  ['Street level, Oxford Road', [604, 1.75, 803], [690, 10, 965], 1.0, 'oxfordroad'],
  ['Etihad Stadium', [1290, 170, -690], [1580, 15, -934], .65, 'etihad'],
];
if (FOCUS) {   // preview cameras circling the focus point
  const { x, z, r } = FOCUS, d = r * .9, P = (dx, dy, dz) => [x + dx, dy, z + dz], A = [x, 12, z];
  const t = (zh, en) => ({ name: zh, desc: '预览', en: { name: en, desc: 'Preview' } });
  VIEWS.length = 0;
  VIEWS.push(['Preview NE', P(d, d * .7, -d), A, .6, t('东北', 'NE')], ['Preview SE', P(d, d * .5, d), A, .6, t('东南', 'SE')],
    ['Preview SW', P(-d, d * .45, d), A, .6, t('西南', 'SW')], ['Preview NW', P(-d, d * .6, -d), A, .6, t('西北', 'NW')],
    ['Preview top', P(1, r * 1.6, 2), [x, 0, z], .8, t('俯视', 'Top')], ['Preview low E', P(d * .55, 6, d * .15), [x, 14, z], .9, t('东侧低角度', 'Low E')],
    ['Preview low W', P(-d * .55, 6, -d * .15), [x, 14, z], .9, t('西侧低角度', 'Low W')]);
}
const SKIES = { day: ['==PROCEDURAL_SKY_MIDDAY==', 0], clear: ['EnvironmentMaps/kloofendal_43d_clear_puresky_4k_cube_bc6u.dds', 180],
  cloudy: ['EnvironmentMaps/kloofendal_48d_partly_cloudy_puresky_4k_cube_bc6u.dds', 90], dusk: ['EnvironmentMaps/the_sky_is_on_fire_4k_cube_bc6u.dds', 0],
  night: ['==PROCEDURAL_SKY_PITCHBLACK==', 0] };
const emissiveMats = [...used].filter(n => MAT[n].em);
function sceneFile(kind) {
  const L = EMISSIVE_LEVELS[kind], [sky, rot] = SKIES[kind];
  const lights = [{ name: 'Sky', type: 'EnvironmentLight', radianceScale: [1, 1, 1], textureIndex: 0, rotation: rot, path: sky }];
  if (kind === 'night') lights.push({ name: 'Moon', type: 'DirectionalLight', color: [.62, .72, 1], irradiance: .06, angularSize: .53, rotation: lookQuat([0, 0, 0], [-.4, -.75, .5]) });
  const cameras = VIEWS.map(([name, eye, a, fov]) => ({ name, type: 'PerspectiveCamera', translation: eye.map(v => +v.toFixed(2)), rotation: lookQuat(eye, a), verticalFov: fov, zNear: .25,
    enableAutoExposure: true, exposureCompensation: kind === 'night' || kind === 'dusk' ? .6 : 0, exposureValueMin: kind === 'night' ? -6 : -2, exposureValueMax: kind === 'night' ? 3 : 14 }));
  const channels = emissiveMats.map(n => ({ target: `material:${n}`, attribute: 'emissiveIntensity', mode: 'step', data: [{ time: 0, value: L[MAT[n].em] ?? 0 }, { time: 1, value: L[MAT[n].em] ?? 0 }] }));
  return { models: ['Models/Manchester/manchester.glb'],
    graph: [{ name: 'Manchester', model: 0 }, { name: 'Lights', children: lights }, { name: 'Cameras', children: cameras },
      { name: 'SampleSettings', type: 'SampleSettings', realtimeMode: true, enableAnimations: true, startingCamera: 0 }],
    animations: [{ name: `Lights-${kind}`, channels }] };
}
for (const kind of Object.keys(SKIES)) fs.writeFileSync(path.join(ASSETS, `manchester-${kind}.scene.json`), JSON.stringify(sceneFile(kind), null, 2));
{ const appScene = sceneFile('clear');
  delete appScene.animations;
  Object.assign(appScene.graph[1].children[0], { path: '==PROCEDURAL_SKY_MIDDAY==', rotation: 0 });   // the app drives the physical sky
  appScene.graph[1].children.push({ name: 'Moon', type: 'DirectionalLight', color: [.62, .72, 1], irradiance: 1e-4, angularSize: .53, rotation: lookQuat([0, 0, 0], [-.4, -.75, .5]) });
  appScene.graph[3] = { name: 'SampleSettings', type: 'SampleSettings', realtimeMode: true, enableAnimations: false };
  fs.writeFileSync(path.join(ASSETS, 'manchester.scene.json'), JSON.stringify(appScene, null, 2));
  const GT = guiText();    // names and captions (Chinese and English), see gui-text.mjs
  // how each weather lights the city in the GUI. Every weather is a clock time on the model's date (26 July, BST): the app
  // places the sun of the physical sky along Manchester's real path for that time, and runs a time-lapse between weathers.
  // sky: cloud density offset (0 overcast .. 1 clear), overcast (the sun hidden behind the deck), brightness, sun, and at
  // night the city's light pollution near the horizon, its glow on the clouds' undersides and the stars. haze: extinction
  // 1/m, scale height m, sun shafts, sky light, forward scattering, cloud shadows (glow: the city's light in the night haze).
  // grade: bloom, saturation, contrast, vignette, white point
  const LIGHT = {
    day: { time: 12, exposure: 0, sky: { clouds: .42, brightness: 1, sun: 5 },
      haze: { density: .00011, height: 480, shafts: 1.6, ambient: 1, g: .72, cloudShadow: .6 },
      grade: { bloom: .004, bloomRadius: 8, saturation: 1.08, contrast: 1.05, vignette: .14, whitePoint: 6850 } },
    clear: { time: 17.5, exposure: 0, sky: { clouds: .44, brightness: 1, sun: 5 },
      haze: { density: .00017, height: 340, shafts: 2.5, ambient: 1, g: .78, cloudShadow: .55 },
      grade: { bloom: .006, bloomRadius: 9, saturation: 1.1, contrast: 1.07, vignette: .18, whitePoint: 6800 } },
    cloudy: { time: 15, exposure: .2, sky: { clouds: .1, overcast: .9, brightness: 1, sun: 5 },
      haze: { density: .00028, height: 620, shafts: .4, ambient: .9, g: .5, cloudShadow: 0 },
      grade: { bloom: .003, bloomRadius: 8, saturation: .98, contrast: 1.05, vignette: .14, whitePoint: 6400 } },
    dusk: { time: 20 + 35 / 60, exposure: .3, sky: { clouds: .46, brightness: 1, sun: 5, nightGlow: .00015, underglow: .0002 },
      haze: { density: .00026, height: 280, shafts: 4, ambient: .9, g: .82, cloudShadow: .35 },
      grade: { bloom: .01, bloomRadius: 11, saturation: 1.14, contrast: 1.08, vignette: .22, whitePoint: 6700 } },
    night: { time: 23.5, exposure: .6, moon: .06, sky: { clouds: .4, brightness: 1, sun: 5, nightGlow: .0004, underglow: .0005, stars: .4 },
      haze: { density: .00022, height: 380, shafts: 0, ambient: 1, g: .5, cloudShadow: 0, glow: [.0042, .0038, .0036] },
      grade: { bloom: .02, bloomRadius: 13, saturation: 1.08, contrast: 1.06, vignette: .26, whitePoint: 6500 } },
  };  const emissive = kind => { const L = EMISSIVE_LEVELS[kind], o = {}; for (const n of emissiveMats) o[n] = L[MAT[n].em] ?? 0; return o; };
  const pin = (id, extra) => { const b = byId.get(id); return b ? [+b.c[0].toFixed(2), +(b.H + extra).toFixed(2), +b.c[1].toFixed(2)] : [0, 50, 0]; };
  const app = {
    date: { dayOfYear: 207, lat: 53.4794, lon: -2.2453, utcOffset: 1 },
    weathers: Object.entries(GT.weathers).map(([id, w]) => { const lt = LIGHT[id];
      return { id, name: w.name, desc: w.desc, en: w.en, icon: w.icon, time: +lt.time.toFixed(4), exposure: lt.exposure, exposureMin: id === 'night' ? -6 : -2, exposureMax: id === 'night' ? 3 : 14,
        moon: lt.moon || 0, sky: lt.sky, haze: lt.haze, grade: lt.grade, emissive: emissive(id) }; }),
    defaultWeather: 'clear',
    views: VIEWS.map(([key, eye, a, fov, text]) => { const t = typeof text === 'string' ? GT.views[text] : text;
      return { key, id: typeof text === 'string' ? text : undefined, name: t.name, desc: t.desc, en: t.en, eye, at: a, fov }; }),
    towersText: { title: GT.towers.title, pins: GT.towers.pins, en: GT.towers.en },
    towers: [{ n: 1, ...GT.towers.items[0], pos: LM.pins.rst || pin(682060630, 9), view: 1, side: -1 },
            { n: 2, ...GT.towers.items[1], pos: LM.pins.acer || pin(1217569813, 9), view: 1, side: 1 }],
    attribution: 'Map data © OpenStreetMap contributors (ODbL)',
  };
  fs.writeFileSync(path.join(ASSETS, 'manchester.app.json'), JSON.stringify(app, null, 2)); }
log('scene files + manchester.app.json');
log('done');
