import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const buf = readFileSync(file);
const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const loader = new GLTFLoader();
const gltf = await loader.parseAsync(arrayBuffer, '');

gltf.scene.updateMatrixWorld(true);
const box = new (await import('three')).Box3().setFromObject(gltf.scene);
const size = new (await import('three')).Vector3();
box.getSize(size);
const ctr = new (await import('three')).Vector3();
box.getCenter(ctr);

console.log(`scene bbox: min ${box.min.toArray().map((v) => v.toFixed(2))} max ${box.max.toArray().map((v) => v.toFixed(2))}`);
console.log(`size: x=${size.x.toFixed(2)} y=${size.y.toFixed(2)} z=${size.z.toFixed(2)}`);

let verts = 0;
const attribs = new Set();
const mats = new Set();
gltf.scene.traverse((o) => {
  if (o.isMesh) {
    const g = o.geometry;
    verts += g.attributes.position?.count ?? 0;
    if (g.attributes.position) attribs.add(`position(${g.attributes.position.count})`);
    for (const k of Object.keys(g.attributes)) attribs.add(`${k}(${g.attributes[k].count})`);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      mats.add(`${m.name} type=${m.type} map=${m.map ? 'yes' : 'no'} vertexColors=${m.vertexColors}`);
    }
  }
});
console.log(`total vertices: ${verts}`);
console.log(`attributes: ${[...attribs].join(', ')}`);
console.log(`materials: ${[...mats].join(' | ')}`);
