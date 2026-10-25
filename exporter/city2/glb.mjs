// Streaming glTF 2.0 binary writer: the JSON chunk is laid out first from the sizes, then every vertex array is written
// straight to disk, so a model of a gigabyte or more never needs one contiguous buffer.
import fs from 'node:fs';

// meshes: [{ name, prims: [Prim] }], nodes: [{ name, mesh, translation?, rotation?, scale? }], materials: [gltf material],
// matIndex: material name → index, images: [uri]
export function writeGLB(file, { meshes, nodes, materials, matIndex, textures, images, samplers }) {
  const gltf = { asset: { version: '2.0', generator: 'ManchesterRTX city2 exporter' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials,
    textures, images, samplers, accessors: [], bufferViews: [], buffers: [] };
  const chunks = []; let off = 0;
  const view = (arr, target) => { const len = arr.byteLength; gltf.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: len, target }); chunks.push(arr); off += len; return gltf.bufferViews.length - 1; };
  const acc = (v, type, ct, count, extra = {}) => { gltf.accessors.push({ bufferView: v, componentType: ct, count, type, ...extra }); return gltf.accessors.length - 1; };
  for (const m of meshes) {
    const mesh = { name: m.name, primitives: [] };
    for (const p of m.prims) {
      if (!p.vc) continue;
      const pos = p.pos.subarray(0, p.vc * 3), mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = pos[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
      const attributes = {
        POSITION: acc(view(pos, 34962), 'VEC3', 5126, p.vc, { min: mn, max: mx }),
        NORMAL: acc(view(p.nrm.subarray(0, p.vc * 3), 34962), 'VEC3', 5126, p.vc),
        TEXCOORD_0: acc(view(p.uv.subarray(0, p.vc * 2), 34962), 'VEC2', 5126, p.vc),
      };
      const indices = acc(view(p.idx.subarray(0, p.ic), 34963), 'SCALAR', 5125, p.ic);
      const mi = matIndex.get(p.mat); if (mi == null) throw new Error(`material ${p.mat} has no glTF entry`);
      mesh.primitives.push({ attributes, indices, material: mi });
    }
    m.index = mesh.primitives.length ? gltf.meshes.push(mesh) - 1 : -1;
  }
  for (const n of nodes) {
    const mesh = meshes[n.mesh]; if (!mesh || mesh.index < 0) continue;
    const node = { name: n.name, mesh: mesh.index };
    if (n.translation) node.translation = n.translation; if (n.rotation) node.rotation = n.rotation; if (n.scale) node.scale = n.scale;
    gltf.scenes[0].nodes.push(gltf.nodes.push(node) - 1);
  }
  gltf.buffers.push({ byteLength: off });
  let json = Buffer.from(JSON.stringify(gltf), 'utf8'); const jp = (4 - json.length % 4) % 4; json = Buffer.concat([json, Buffer.alloc(jp, 0x20)]);
  const binPad = (4 - off % 4) % 4, binLen = off + binPad;
  const total = 12 + 8 + json.length + 8 + binLen;
  if (total > 0xffffffff) throw new Error('GLB larger than 4 GB');
  const fd = fs.openSync(file, 'w');
  const hdr = Buffer.alloc(12); hdr.writeUInt32LE(0x46546C67, 0); hdr.writeUInt32LE(2, 4); hdr.writeUInt32LE(total, 8); fs.writeSync(fd, hdr);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4E4F534A, 4); fs.writeSync(fd, jh); fs.writeSync(fd, json);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binLen, 0); bh.writeUInt32LE(0x004E4942, 4); fs.writeSync(fd, bh);
  for (const a of chunks) fs.writeSync(fd, Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  if (binPad) fs.writeSync(fd, Buffer.alloc(binPad));
  fs.closeSync(fd);
  return { bytes: total, meshes: gltf.meshes.length, nodes: gltf.nodes.length, accessors: gltf.accessors.length };
}
