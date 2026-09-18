/**
 * Full mesh-name dump of a GLB (as requested: every node name + type).
 * Read-only inspection — proves whether part meshes exist to map to.
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

console.log(`file: ${file}`);
console.log(`nodes: ${json.nodes?.length ?? 0}, meshes: ${json.meshes?.length ?? 0}, scenes: ${json.scenes?.length ?? 0}`);
console.log('--- nodes (name | type | mesh index) ---');
for (const [i, n] of (json.nodes ?? []).entries()) {
  console.log(`node[${i}] name="${n.name ?? '<unnamed>'}" meshIndex=${n.mesh ?? 'none'} children=${JSON.stringify(n.children ?? [])}`);
}
console.log('--- meshes ---');
for (const [i, m] of (json.meshes ?? []).entries()) {
  console.log(`mesh[${i}] name="${m.name ?? '<unnamed>'}" primitives=${m.primitives?.length ?? 0} hasIndices=${m.primitives?.[0]?.indices !== undefined}`);
}
console.log('--- materials ---');
for (const [i, m] of (json.materials ?? []).entries()) {
  console.log(`material[${i}] name="${m.name ?? '<unnamed>'}" textured=${Boolean(m.pbrMetallicRoughness?.baseColorTexture)}`);
}
