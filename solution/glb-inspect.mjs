import { readFileSync } from 'node:fs';

function parseGlb(path) {
  const buf = readFileSync(path);
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error(`not a GLB: ${path}`);
  const version = buf.readUInt32LE(4);
  const length = buf.readUInt32LE(8);
  let off = 12;
  const chunks = [];
  while (off < length) {
    const chunkLength = buf.readUInt32LE(off);
    const chunkType = buf.readUInt32LE(off + 4);
    chunks.push({ type: chunkType, data: buf.subarray(off + 8, off + 8 + chunkLength) });
    off += 8 + chunkLength;
  }
  const jsonChunk = chunks.find((c) => c.type === 0x4e4f534a);
  if (!jsonChunk) throw new Error(`no JSON chunk in ${path}`);
  const json = JSON.parse(jsonChunk.data.toString('utf8'));
  const binChunk = chunks.find((c) => c.type === 0x004e4942);
  return { version, json, bin: binChunk ? binChunk.data : null };
}

function bboxOfAccessor(json, bin, accessorIndex) {
  const acc = json.accessors[accessorIndex];
  if (!acc) return null;
  if (acc.min && acc.max) return { min: acc.min, max: acc.max };
  const bv = json.bufferViews[acc.bufferView];
  const out = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const compType = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType];
  const stride = bv.byteStride ?? comps * compType;
  for (let i = 0; i < acc.count; i++) {
    const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0) + i * stride;
    for (let c = 0; c < comps; c++) {
      let v;
      const o = off + c * compType;
      if (acc.componentType === 5126) v = bin.readFloatLE(o);
      else if (acc.componentType === 5125) v = bin.readUInt32LE(o);
      else if (acc.componentType === 5123) v = bin.readUInt16LE(o);
      else v = bin.readUInt8(o);
      if (v < out.min[c]) out.min[c] = v;
      if (v > out.max[c]) out.max[c] = v;
    }
  }
  return out;
}

function meshBounds(json, bin, meshIndex) {
  const mesh = json.meshes[meshIndex];
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const prim of mesh.primitives) {
    if (prim.attributes.POSITION === undefined) continue;
    const b = bboxOfAccessor(json, bin, prim.attributes.POSITION);
    if (!b) continue;
    for (let c = 0; c < 3; c++) {
      if (b.min[c] < min[c]) min[c] = b.min[c];
      if (b.max[c] > max[c]) max[c] = b.max[c];
    }
  }
  return min[0] === Infinity ? null : { min, max };
}

function walk(json, bin, nodeIndex, indent, out, parentName) {
  const node = json.nodes[nodeIndex];
  const name = node.name ?? `node[${nodeIndex}]`;
  const line = {
    name,
    index: nodeIndex,
    parent: parentName,
    meshIndex: node.mesh,
    children: (node.children ?? []).map((i) => i),
    bbox: node.mesh !== undefined ? meshBounds(json, bin, node.mesh) : null,
  };
  out.push(line);
  for (const c of node.children ?? []) walk(json, bin, c, indent + 1, out, name);
}

const file = process.argv[2] ?? 'car.glb';
const { version, json, bin } = parseGlb(file);
console.log(`# ${file} — glTF ${version}, ${json.nodes.length} nodes, ${json.meshes.length} meshes, ${json.materials.length} materials`);
const lines = [];
for (const s of json.scenes) {
  for (const root of s.nodes) walk(json, bin, root, 0, lines, null);
}
for (const l of lines) {
  const b = l.bbox
    ? `bbox[min ${l.bbox.min.map((v) => v.toFixed(2)).join(',')} max ${l.bbox.max.map((v) => v.toFixed(2)).join(',')}]`
    : '';
  console.log(`${'  '.repeat(0)}${l.name}${l.meshIndex !== undefined ? ` [mesh ${l.meshIndex}]` : ''} ${b}`);
}
