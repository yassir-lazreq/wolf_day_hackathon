import { readFileSync } from "node:fs";
const path = process.argv[2];
const buf = readFileSync(path);
let off = 12; const len = buf.readUInt32LE(8); const chunks = [];
while (off < len) { const cl = buf.readUInt32LE(off); const ct = buf.readUInt32LE(off+4); chunks.push({type: ct, data: buf.subarray(off+8, off+8+cl)}); off += 8+cl; }
const json = JSON.parse(chunks.find(c=>c.type===0x4e4f534a).data.toString("utf8"));
const bin = chunks.find(c=>c.type===0x004e4942)?.data;
console.log("materials:", JSON.stringify(json.materials, null, 1).slice(0, 1500));
console.log("meshes:", json.meshes.length, "nodes:", json.nodes.length, "scenes:", json.scenes.length);
const attrs = {};
for (const m of json.meshes) for (const p of m.primitives ?? []) for (const [k, ai] of Object.entries(p.attributes ?? {})) { const a = json.accessors[ai]; attrs[k] = {count: a.count, type: a.type, comp: a.componentType, min: a.min, max: a.max, normalized: a.normalized}; }
console.log("attributes:", JSON.stringify(attrs, null, 1));
console.log("extensions used:", JSON.stringify(json.extensionsUsed));
console.log("asset:", JSON.stringify(json.asset));
if (json.meshes[0]?.primitives?.[0]?.indices) console.log("index count:", json.accessors[json.meshes[0].primitives[0].indices].count);
