// OpenStreetMap extract (Overpass "out geom") → features in local metres.
import fs from 'fs';
import { project, polygonArea, centroid, bbox, pointInPolygon } from './geo.mjs';

const toPts = geom => geom.filter(g => g).map(g => project(g.lat, g.lon));
const closed = p => p.length > 3 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.01;
const open = p => closed(p) ? p.slice(0, -1) : p;

// join multipolygon member ways into closed rings
function assembleRings(ways) {
  const rings = [], pool = ways.map(w => w.slice());
  while (pool.length) {
    let ring = pool.shift();
    let guard = 0;
    while (!closed(ring) && guard++ < 1000) {
      const end = ring[ring.length - 1];
      let found = -1, rev = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i];
        if (Math.hypot(w[0][0] - end[0], w[0][1] - end[1]) < 0.01) { found = i; break; }
        if (Math.hypot(w[w.length - 1][0] - end[0], w[w.length - 1][1] - end[1]) < 0.01) { found = i; rev = true; break; }
      }
      if (found < 0) break;
      const w = pool.splice(found, 1)[0];
      ring = ring.concat((rev ? w.slice().reverse() : w).slice(1));
    }
    if (ring.length >= 4) rings.push(open(ring));
  }
  return rings;
}

export function parseHeight(v) {
  if (v == null) return null;
  const m = String(v).match(/-?[\d.]+/); if (!m) return null;
  let h = parseFloat(m[0]);
  if (/ft|'/.test(v)) h *= 0.3048;
  return isFinite(h) ? h : null;
}

function areaFeature(e) {
  if (e.type === 'way' && e.geometry) {
    const p = toPts(e.geometry);
    if (!closed(p)) return null;
    return { outers: [open(p)], inners: [] };
  }
  if (e.type === 'relation' && e.members) {
    const outerWays = [], innerWays = [];
    for (const m of e.members) if (m.type === 'way' && m.geometry) (m.role === 'inner' ? innerWays : outerWays).push(toPts(m.geometry));
    const outers = assembleRings(outerWays), inners = assembleRings(innerWays);
    if (!outers.length) return null;
    return { outers, inners };
  }
  return null;
}

export function loadOSM(file) {
  const osm = JSON.parse(fs.readFileSync(file));
  const F = { buildings: [], parts: [], roads: [], areasHighway: [], rails: [], platforms: [], water: [], waterways: [], land: [], trees: [], treeRows: [] };
  for (const e of osm.elements) {
    const t = e.tags || {};
    if (e.type === 'node') { if (t.natural === 'tree') F.trees.push({ id: e.id, p: project(e.lat, e.lon), tags: t }); continue; }
    if (t.building || t['building:part']) {
      const a = areaFeature(e); if (!a) continue;
      const ring = a.outers[0], area = Math.abs(polygonArea(ring));
      if (area < 4) continue;
      const f = { id: e.id, kind: e.type, tags: t, ...a, area, c: centroid(ring), bb: bbox(a.outers.flat()) };
      (t['building:part'] && !t.building ? F.parts : F.buildings).push(f);
      continue;
    }
    if (t['area:highway'] || (t.highway && (t.area === 'yes' || t.highway === 'pedestrian' && e.type === 'relation'))) {
      const a = areaFeature(e); if (a) F.areasHighway.push({ id: e.id, tags: t, ...a });
      if (!(t.highway && t.area !== 'yes')) continue;
    }
    if (t.highway && e.type === 'way' && e.geometry) {
      const p = toPts(e.geometry);
      if (t.area === 'yes' && closed(p)) continue;
      F.roads.push({ id: e.id, tags: t, pts: p });
      continue;
    }
    if (t.railway && e.type === 'way' && e.geometry) {
      const p = toPts(e.geometry);
      if (t.railway === 'platform') { if (closed(p)) F.platforms.push({ id: e.id, tags: t, outers: [open(p)], inners: [] }); else F.platforms.push({ id: e.id, tags: t, line: p }); }
      else if (['rail', 'light_rail', 'tram', 'narrow_gauge'].includes(t.railway)) F.rails.push({ id: e.id, tags: t, pts: p });
      continue;
    }
    if (t.natural === 'water' || t.waterway === 'riverbank' || t.water) {
      const a = areaFeature(e); if (a) F.water.push({ id: e.id, tags: t, ...a });
      continue;
    }
    if (t.waterway && e.type === 'way' && e.geometry && ['river', 'canal', 'stream', 'drain'].includes(t.waterway)) {
      F.waterways.push({ id: e.id, tags: t, pts: toPts(e.geometry) });
      continue;
    }
    if (t.natural === 'tree_row' && e.geometry) { F.treeRows.push({ id: e.id, pts: toPts(e.geometry) }); continue; }
    const landKind = t.landuse || t.leisure || (t.natural && ['wood', 'grassland', 'scrub'].includes(t.natural) ? t.natural : null) || (t.amenity === 'parking' ? 'parking' : null) || (t.place === 'square' ? 'square' : null);
    if (landKind) {
      const a = areaFeature(e); if (a) F.land.push({ id: e.id, kind: landKind, tags: t, ...a, area: Math.abs(polygonArea(a.outers[0])) });
    }
  }

  // OSM 3D buildings: an outline whose parts are mapped is drawn through its parts
  const partIndex = F.parts.map(p => ({ p, c: p.c }));
  for (const b of F.buildings) {
    const [x0, z0, x1, z1] = b.bb;
    b.parts = partIndex.filter(({ c }) => c[0] >= x0 && c[0] <= x1 && c[1] >= z0 && c[1] <= z1 && pointInPolygon(c[0], c[1], b.outers[0])).map(q => q.p);
    for (const p of b.parts) p.parent = b;
  }
  return F;
}
