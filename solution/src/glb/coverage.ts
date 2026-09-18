/**
 * Real-model segmentation validation (no browser needed).
 * Parses car.glb directly (KHR_mesh_quantization dequantized manually),
 * normalizes like the reference viewer, and reports zone coverage for the
 * DEFAULT_REGION_RULES — the same rules the browser viewer uses.
 */

import { readFileSync } from 'node:fs';
import { classifyVertices, zoneCoverage, DEFAULT_REGION_RULES } from '../../../track-b/frontend/src/sections/car-viewer/zone-classifier.ts';

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
const posAcc = json.accessors[prim.attributes.POSITION];
const nrmAcc = json.accessors[prim.attributes.NORMAL];

// dequantize: normalized int16 * max
function readAttr(acc) {
  const bv = json.bufferViews[acc.bufferView];
  const out = new Float32Array(acc.count * 3);
  const norm = acc.normalized === true;
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < 3; c++) {
      const o = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0) + i * 6 + c * 2;
      let v = bin.readInt16LE(o);
      if (norm && acc.max) v = (v / 32767) * acc.max[c];
      out[i * 3 + c] = v;
    }
  }
  return out;
}

const pos = readAttr(posAcc);
const nrm = readAttr(nrmAcc);

// reference-viewer normalization: rotate +90° y if size.z > size.x, scale 4.3/max
let min = [Infinity, Infinity, Infinity];
let max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < pos.length; i += 3) {
  for (let c = 0; c < 3; c++) {
    min[c] = Math.min(min[c], pos[i + c]);
    max[c] = Math.max(max[c], pos[i + c]);
  }
}
const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
console.log(`raw size: x=${size[0].toFixed(0)} y=${size[1].toFixed(0)} z=${size[2].toFixed(0)}`);

const rotY90 = size[2] > size[0];
const scale = 4.3 / Math.max(size[0], size[2]);
const posN = new Float32Array(pos.length);
const nrmN = new Float32Array(nrm.length);
for (let i = 0; i < pos.length / 3; i++) {
  let x = pos[i * 3];
  let y = pos[i * 3 + 1];
  let z = pos[i * 3 + 2];
  let nx = nrm[i * 3];
  let ny = nrm[i * 3 + 1];
  let nz = nrm[i * 3 + 2];
  if (rotY90) {
    // rotation.y = +PI/2: x' = z, z' = -x
    const x2 = z;
    const z2 = -x;
    const nx2 = nz;
    const nz2 = -nx;
    x = x2; z = z2; nx = nx2; nz = nz2;
  }
  posN[i * 3] = x * scale;
  posN[i * 3 + 1] = y * scale;
  posN[i * 3 + 2] = z * scale;
  nrmN[i * 3] = nx;
  nrmN[i * 3 + 1] = ny;
  nrmN[i * 3 + 2] = nz;
}

// center x/z and ground y (like the viewer)
let czmin = Infinity;
let czmax = -Infinity;
let my = Infinity;
for (let i = 0; i < posN.length; i += 3) {
  czmin = Math.min(czmin, posN[i + 2]);
  czmax = Math.max(czmax, posN[i + 2]);
  my = Math.min(my, posN[i + 1]);
}
const cz = (czmin + czmax) / 2;
for (let i = 0; i < posN.length; i += 3) {
  posN[i + 2] -= cz;
  posN[i + 1] -= my;
}

const zones = classifyVertices(posN, nrmN, DEFAULT_REGION_RULES);
const coverage = zoneCoverage(zones);
const total = zones.length;
const classified = zones.reduce((s, z) => s + (z ? 1 : 0), 0);
console.log(`normalized size: x=${(4.3).toFixed(2)} y=${(size[1] * scale).toFixed(2)} z=${(size[rotY90 ? 0 : 2] * scale).toFixed(2)} (front=+x)`);
console.log(`vertices: ${total}, classified: ${classified} (${((classified / total) * 100).toFixed(1)}%)`);
console.log('per-zone vertex counts:');
const sorted = Object.entries(coverage).sort((a, b) => b[1] - a[1]);
for (const [z, n] of sorted) console.log(`  ${z.padEnd(22)} ${n}`);
const missing = DEFAULT_REGION_RULES.filter((r) => !(r.zoneId in coverage)).map((r) => r.zoneId);
console.log(`zones with zero coverage: ${missing.join(', ') || 'none'}`);

