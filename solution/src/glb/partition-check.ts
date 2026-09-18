/**
 * Partition check: runs the EXACT viewer pipeline (dequantize -> normalize
 * -> classify -> partitionTriangles over the real index buffer) against
 * car.glb, and verifies the zones used by case #898942.
 */

import { readFileSync } from 'node:fs';
import { classifyVertices, partitionTriangles, DEFAULT_REGION_RULES } from '../../../track-b/frontend/src/sections/car-viewer/zone-classifier.ts';

const file = process.argv[2];
const buf = readFileSync(file);
const len = buf.readUInt32LE(8);
let off = 12;
const chunks = [];
while (off < len) {
  const cl = buf.readUInt32LE(off);
  const ct = buf.readUInt32LE(off + 4);
  chunks.push({ type: ct, data: buf.subarray(off + 8, off + 8 + cl) });
  off += 8 + cl;
}
const json = JSON.parse(chunks.find((c) => c.type === 0x4e4f534a).data.toString('utf8'));
const bin = chunks.find((c) => c.type === 0x004e4942)?.data;
if (!bin) throw new Error('no BIN chunk');

const prim = json.meshes[0].primitives[0];
function readAttr(accIndex: number): Float32Array {
  const acc = json.accessors[accIndex];
  const bv = json.bufferViews[acc.bufferView];
  const out = new Float32Array(acc.count * 3);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < 3; c++) {
      const o = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0) + i * 6 + c * 2;
      let v = bin.readInt16LE(o);
      if (acc.normalized && acc.max) v = (v / 32767) * acc.max[c];
      out[i * 3 + c] = v;
    }
  }
  return out;
}
const pos = readAttr(prim.attributes.POSITION);
const nrm = readAttr(prim.attributes.NORMAL);

// indices (u32)
const idxAcc = json.accessors[prim.indices];
const idxBv = json.bufferViews[idxAcc.bufferView];
const indices = new Uint32Array(idxAcc.count);
for (let i = 0; i < idxAcc.count; i++) {
  indices[i] = bin.readUInt32LE((idxBv.byteOffset ?? 0) + (idxAcc.byteOffset ?? 0) + i * 4);
}

// normalize like the viewer
let min = [Infinity, Infinity, Infinity];
let max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < pos.length; i += 3) {
  for (let c = 0; c < 3; c++) {
    min[c] = Math.min(min[c], pos[i + c]);
    max[c] = Math.max(max[c], pos[i + c]);
  }
}
const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
const rotY90 = size[2] > size[0];
const scale = 4.3 / Math.max(size[0], size[2]);
const P = new Float32Array(pos.length);
const N = new Float32Array(nrm.length);
for (let i = 0; i < pos.length / 3; i++) {
  let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
  let nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
  if (rotY90) {
    const x2 = z, z2 = -x, nx2 = nz, nz2 = -nx;
    x = x2; z = z2; nx = nx2; nz = nz2;
  }
  P[i * 3] = x * scale; P[i * 3 + 1] = y * scale; P[i * 3 + 2] = z * scale;
  N[i * 3] = nx; N[i * 3 + 1] = ny; N[i * 3 + 2] = nz;
}
let zmin = Infinity, zmax = -Infinity, ymin = Infinity;
for (let i = 0; i < P.length; i += 3) {
  zmin = Math.min(zmin, P[i + 2]);
  zmax = Math.max(zmax, P[i + 2]);
  ymin = Math.min(ymin, P[i + 1]);
}
for (let i = 0; i < P.length; i += 3) {
  P[i + 2] -= (zmin + zmax) / 2;
  P[i + 1] -= ymin;
}

const vertexZones = classifyVertices(P, N, DEFAULT_REGION_RULES);
const buckets = partitionTriangles(indices, vertexZones, { positions: P, normals: N, uvs: null });

console.log(`vertices: ${P.length / 3}, indices: ${indices.length}, triangles: ${indices.length / 3}`);
console.log('per-zone triangle counts (after subdivision):');
const sorted = [...buckets.entries()].sort((a, b) => b[1].positions.length - a[1].positions.length);
for (const [z, arr] of sorted) console.log(`  ${z === null ? '(rest: glass/wheels/trim)' : z.padEnd(22)} ${Math.floor(arr.positions.length / 9)} tris`);

// case #898942 verification
const caseZones = ['DOOR_FRONT_LEFT', 'BUMPER_REAR_FULL', 'FENDER_FRONT_LEFT', 'DOOR_REAR_LEFT', 'SILL_LEFT', 'MIRROR_LEFT', 'FENDER_REAR_LEFT', 'FENDER_REAR_RIGHT', 'TAILGATE'];
console.log('\ncase #898942 zones:');
for (const z of caseZones) {
  const b = buckets.get(z);
  console.log(`  ${z.padEnd(22)} ${b ? `${Math.floor(b.positions.length / 9)} triangles` : 'NOT MAPPED (no geometry)'}`);
}
