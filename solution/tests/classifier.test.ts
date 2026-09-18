import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyVertex,
  classifyVertices,
  triangleZone,
  partitionTriangles,
  zoneCoverage,
  ZONE_MESH_MAP,
  meshNamesForZone,
  WHEEL_BOXES,
  DEFAULT_REGION_RULES,
} from '../../track-b/frontend/src/sections/car-viewer/zone-classifier.ts';

/** Build a synthetic non-indexed box-car: positions (x,y,z) triplets. */
function boxCar(): Float32Array {
  const tris: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    tris.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  const L = 2.0; // half length (x: -2..2, front +x)
  const H = 1.5; // height
  const W = 1.0; // half width (z)
  const p = (x: number, y: number, z: number) => [x, y, z];
  // front face
  quad(p(L, 0, -W), p(L, H, -W), p(L, H, W), p(L, 0, W));
  // rear face
  quad(p(-L, 0, W), p(-L, H, W), p(-L, H, -W), p(-L, 0, -W));
  // left side (+z)
  quad(p(-L, 0, W), p(L, 0, W), p(L, H, W), p(-L, H, W));
  // right side (-z)
  quad(p(L, 0, -W), p(-L, 0, -W), p(-L, H, -W), p(L, H, -W));
  // top
  quad(p(-L, H, -W), p(-L, H, W), p(L, H, W), p(L, H, -W));
  return new Float32Array(tris);
}

const normalsFor = (positions: Float32Array): Float32Array => {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < positions.length / 9; t++) {
    const i0 = t * 9;
    const ax = positions[i0 + 3] - positions[i0];
    const ay = positions[i0 + 4] - positions[i0 + 1];
    const az = positions[i0 + 5] - positions[i0 + 2];
    const bx = positions[i0 + 6] - positions[i0];
    const by = positions[i0 + 7] - positions[i0 + 1];
    const bz = positions[i0 + 8] - positions[i0 + 2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let k = 0; k < 3; k++) {
      n[i0 + k * 3] = nx; n[i0 + k * 3 + 1] = ny; n[i0 + k * 3 + 2] = nz;
    }
  }
  return n;
};

test('classifyVertex: front bumper band', () => {
  // low front center -> full bumper
  assert.equal(classifyVertex(1.9, 0.3, 0, 0, 0, 1), 'BUMPER_FRONT_FULL');
  // low front left -> bumper front left
  assert.equal(classifyVertex(1.9, 0.3, 0.8, 0, 0, 1), 'BUMPER_FRONT_LEFT');
  assert.equal(classifyVertex(1.9, 0.3, -0.8, 0, 0, 1), 'BUMPER_FRONT_RIGHT');
  // rear
  assert.equal(classifyVertex(-1.9, 0.3, 0.8, 0, 0, 1), 'BUMPER_REAR_LEFT');
  assert.equal(classifyVertex(-1.9, 0.5, 0, 0, 0, 1), 'BUMPER_REAR_FULL');
});

test('classifyVertex: hood requires upward normal', () => {
  // hood region position but downward-facing normal -> not hood (e.g. wheel arch inner)
  assert.equal(classifyVertex(1.3, 0.9, 0, 0, -1, 0), null);
  assert.equal(classifyVertex(1.3, 0.9, 0, 0, 1, 0), 'HOOD');
});

test('classifyVertex: windshield high front band', () => {
  assert.equal(classifyVertex(0.8, 1.25, 0, 0, 1, 0), 'WINDSHIELD');
  assert.equal(classifyVertex(0.8, 1.25, 0.3, 0, 1, 0), 'WINDSHIELD');
});

test('classifyVertex: side windows (glass) never map to body zones', () => {
  // left side glass above the beltline, away from the mirror pod
  assert.equal(classifyVertex(0.2, 1.1, 0.9, 0, 0, 1), null);
  assert.equal(classifyVertex(-0.4, 1.05, 0.95, 0, 0, 1), null);
  // right side glass
  assert.equal(classifyVertex(0.2, 1.15, -0.9, 0, 0, -1), null);
  // mirrors are carved out of the glass band and still resolve
  assert.equal(classifyVertex(0.6, 1.0, 0.9, 1, 0, 0), 'MIRROR_LEFT');
});

test('classifyVertex: doors vs sills vs fenders on left side', () => {
  assert.equal(classifyVertex(0.5, 0.8, 0.9, 0, 0, 1), 'DOOR_FRONT_LEFT');
  assert.equal(classifyVertex(-0.5, 0.8, 0.9, 0, 0, 1), 'DOOR_REAR_LEFT');
  assert.equal(classifyVertex(0.2, 0.95, 0.9, 0, 0, 1), 'DOOR_FRONT_LEFT');
  assert.equal(classifyVertex(0.2, 0.2, 0.9, 0, 0, 1), 'SILL_LEFT');
  assert.equal(classifyVertex(1.5, 0.9, 0.9, 0, 0, 1), 'FENDER_FRONT_LEFT');
  assert.equal(classifyVertex(-1.5, 0.9, 0.9, 0, 0, 1), 'FENDER_REAR_LEFT');
});

test('classifyVertex: wheel boxes are excluded', () => {
  assert.equal(classifyVertex(1.4, 0.3, 0.7, 0, 0, 1), null); // inside front-left wheel box
  assert.equal(classifyVertex(1.9, 0.3, 0.7, 0, 0, 1), 'BUMPER_FRONT_LEFT'); // just ahead
});

test('classifyVertex: mirrors', () => {
  assert.equal(classifyVertex(0.6, 1.0, 0.9, 1, 0, 0), 'MIRROR_LEFT');
  assert.equal(classifyVertex(0.6, 1.0, -0.9, 1, 0, 0), 'MIRROR_RIGHT');
});

test('triangleZone majority vote with tie -> null', () => {
  assert.equal(triangleZone('A', 'A', 'B'), 'A');
  assert.equal(triangleZone('A', 'B', 'A'), 'A');
  assert.equal(triangleZone('A', 'B', 'C'), null);
  assert.equal(triangleZone(null, null, 'A'), null);
});

test('classifyVertices + zoneCoverage: targeted triangles land in the right zones', () => {
  // one triangle per known location, normals up (+y)
  const tri = (x: number, y: number, z: number): number[] => [x, y, z, x + 0.1, y, z, x, y, z + 0.1];
  const positions = new Float32Array([
    ...tri(1.9, 0.3, 0), // front bumper full
    ...tri(1.4, 0.9, 0), // hood (up normal)
    ...tri(-0.5, 0.8, 0.9), // door rear left
    ...tri(0.2, 0.2, 0.9), // sill left
    ...tri(0, 1.5, 0), // roof
  ]);
  const normals = new Float32Array(positions.length).fill(0);
  for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
  const zones = classifyVertices(positions, normals);
  const coverage = zoneCoverage(zones);
  assert.deepEqual(coverage, {
    BUMPER_FRONT_FULL: 3,
    HOOD: 3,
    DOOR_REAR_LEFT: 3,
    SILL_LEFT: 3,
    ROOF: 3,
  });
});

test('partitionTriangles: separates zone sets into distinct buckets (damaged vs linked)', () => {
  // indexed geometry: 5 vertices, 3 triangles
  const tri = (x: number, y: number, z: number): number[] => [x, y, z];
  const positions = new Float32Array([
    ...tri(1.9, 0.3, 0), // v0 bumper
    ...tri(1.95, 0.3, 0), // v1 bumper
    ...tri(1.9, 0.35, 0), // v2 bumper
    ...tri(1.4, 0.9, 0), // v3 hood
    ...tri(0, 0, 0), // v4 unused
  ]);
  const normals = new Float32Array(positions.length).fill(0);
  for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
  const vertexZones = classifyVertices(positions, normals);
  // triangles: (0,1,2)=bumper uniform, (1,2,3)=bumper/bumper/hood mixed,
  // (4,4,4)=unused -> null
  const indices = new Uint32Array([0, 1, 2, 1, 2, 3, 4, 4, 4]);
  const buckets = partitionTriangles(indices, vertexZones, { positions, normals, uvs: null });
  // bumper bucket: uniform triangle (9 floats) + mixed triangle subdivided
  const bumper = buckets.get('BUMPER_FRONT_FULL')!;
  assert.ok(bumper.positions.length >= 9, `bumper bucket should contain at least the uniform triangle, got ${bumper.positions.length / 3} verts`);
  assert.ok(Math.abs(bumper.positions[0] - 1.9) < 1e-4);
  const rest = buckets.get(null)!;
  assert.ok(rest.positions.length >= 9, 'unused triangle must land in the rest bucket');
  assert.equal(buckets.get('HOOD'), undefined);
});

test('partitionTriangles: deterministic — same input, identical buckets', () => {
  const positions = new Float32Array([
    1.9, 0.3, 0, 1.95, 0.3, 0, 1.9, 0.35, 0, 1.4, 0.9, 0, 0, 0, 0,
  ]);
  const normals = new Float32Array(positions.length).fill(0);
  for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
  const vertexZones = classifyVertices(positions, normals);
  const indices = new Uint32Array([0, 1, 2, 1, 2, 3, 4, 4, 4]);
  const a = partitionTriangles(indices, vertexZones, { positions, normals, uvs: null });
  const b = partitionTriangles(indices, vertexZones, { positions, normals, uvs: null });
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort());
  for (const k of a.keys()) assert.deepEqual([...a.get(k)!.positions], [...b.get(k)!.positions]);
});

test('partitionTriangles: side glass triangles land in the null (rest) bucket, never a zone', () => {
  // glass triangle: all three vertices in the side-glass band
  const positions = new Float32Array([
    0.2, 1.1, 0.9, 0.3, 1.1, 0.9, 0.2, 1.15, 0.9,
  ]);
  const normals = new Float32Array(positions.length).fill(0);
  for (let i = 0; i < normals.length; i += 3) normals[i + 2] = 1;
  const vertexZones = classifyVertices(positions, normals);
  assert.deepEqual(vertexZones, [null, null, null]);
  const buckets = partitionTriangles(new Uint32Array([0, 1, 2]), vertexZones, { positions, normals, uvs: null });
  assert.equal(buckets.get(null)!.positions.length, 9);
  for (const [z] of buckets) assert.equal(z, null);
});

test('wheel boxes cover all four corners', () => {
  assert.equal(WHEEL_BOXES.length, 4);
});

test('ZONE_MESH_MAP: derived from the rules, covers all 22 zones, deterministic names', () => {
  assert.equal(Object.keys(ZONE_MESH_MAP).length, 22);
  for (const r of DEFAULT_REGION_RULES) {
    assert.deepEqual(ZONE_MESH_MAP[r.zoneId], [`car-zone-${r.zoneId}`]);
  }
  // no fabricated names: every entry matches the viewer part-naming scheme
  for (const names of Object.values(ZONE_MESH_MAP)) {
    for (const n of names) assert.match(n, /^car-zone-[A-Z_]+$/);
  }
});

test('meshNamesForZone: unknown zones yield [] and are never fallback-mapped', () => {
  assert.deepEqual(meshNamesForZone('GRILLE'), []);
  assert.deepEqual(meshNamesForZone('DOOR_FRONT_LEFT'), ['car-zone-DOOR_FRONT_LEFT']);
});
