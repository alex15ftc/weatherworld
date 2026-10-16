// A minimal glTF 2.0 binary (.glb) writer: one mesh of triangles with positions, normals and
// texture coordinates, as Roblox's importer takes it (UV 0,0 is the image's top-left corner).
export function glb({ positions, normals, uvs, indices }, name = 'mesh') {
  const count = positions.length / 3;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) { const v = positions[i * 3 + k]; min[k] = Math.min(min[k], v); max[k] = Math.max(max[k], v); }
  const parts = [new Float32Array(positions), new Float32Array(normals), new Float32Array(uvs), new Uint32Array(indices)];
  const views = [];
  let offset = 0;
  for (const p of parts) { views.push({ buffer: 0, byteOffset: offset, byteLength: p.byteLength }); offset += p.byteLength; }
  const bin = Buffer.alloc(Math.ceil(offset / 4) * 4);
  offset = 0;
  for (const p of parts) { Buffer.from(p.buffer).copy(bin, offset); offset += p.byteLength; }
  views[0].target = 34962; views[1].target = 34962; views[2].target = 34962; views[3].target = 34963;
  const json = {
    asset: { version: '2.0', generator: 'weatherworld bake' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3 }] }],
    buffers: [{ byteLength: bin.length }], bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count, type: 'VEC2' },
      { bufferView: 3, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
  };
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12), jsonHead = Buffer.alloc(8), binHead = Buffer.alloc(8);
  header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + text.length + 8 + bin.length, 8);
  jsonHead.writeUInt32LE(text.length, 0); jsonHead.write('JSON', 4);
  binHead.writeUInt32LE(bin.length, 0); binHead.write('BIN\0', 4);
  return Buffer.concat([header, jsonHead, text, binHead, bin]);
}
