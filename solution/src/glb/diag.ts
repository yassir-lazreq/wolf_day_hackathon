/**
 * Geometry diagnostic: histograms of key bands on the real car.glb,
 * used to tune the deterministic zone boxes (bumper lateral splits, side
 * glass vs doors). Read-only analysis.
 */

import { readFileSync } from 'node:fs';

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
function readAttr(acc) {
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
const pos = readAttr(json.accessors[prim.attributes.POSITION]);
const nrm = readAttr(json.accessors[prim.attributes.NORMAL]);

// normalize like the reference viewer
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
  let x = pos[i * 3];
  let y = pos[i * 3 + 1];
  let z = pos[i * 3 + 2];
  let nx = nrm[i * 3];
  let ny = nrm[i * 3 + 1];
  let nz = nrm[i * 3 + 2];
  if (rotY90) {
    const x2 = z;
    const z2 = -x;
    const nx2 = nz;
    const nz2 = -nx;
    x = x2; z = z2; nx = nx2; nz = nz2;
  }
  P[i * 3] = x * scale;
  P[i * 3 + 1] = y * scale;
  P[i * 3 + 2] = z * scale;
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

function hist(label: string, filter: (x: number, y: number, z: number) => boolean, buckets: number, zRange = 1.3) {
  const h = new Array(buckets).fill(0);
  let total = 0;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    if (!filter(x, y, z)) continue;
    total++;
    let b = Math.floor(((z + zRange) / (2 * zRange)) * buckets);
    b = Math.max(0, Math.min(buckets - 1, b));
    h[b]++;
  }
  console.log(`${label} (n=${total}): ${h.map((v) => v.toString().padStart(5)).join(' ')}`);
  return total;
}

console.log(`normalized: length 4.30, width z=${(-zmin + zmax) === 0 ? '?' : ((zmax - zmin) * scale).toFixed(2)}, height=${((max[1] - min[1]) * scale).toFixed(2)}`);

// rear bumper band lateral histogram
hist('rear bumper band (x<-1.7, y<0.9)', (x, y) => x < -1.7 && y < 0.9, 12);
// front bumper band
hist('front bumper band (x>1.7, y<0.85)', (x, y) => x > 1.7 && y < 0.85, 12);
// side band doors+sills
hist('left side band (x -1..1.05, y 0..1.3, z>0.4)', (x, y, z) => x > -1 && x < 1.05 && y < 1.3 && z > 0.4, 6, 1.4);
// side glass band (high on sides)
hist('left side high band (x -1..1.05, y 0.95..1.45, z>0.5)', (x, y, z) => x > -1 && x < 1.05 && y > 0.95 && y < 1.45 && z > 0.5, 6, 1.4);
// left door band vertical profile
hist('left door band y-profile (x 0.1..1.05, z>0.55)', (x, y, z) => x > 0.1 && x < 1.05 && z > 0.55, 6, 1.4);
