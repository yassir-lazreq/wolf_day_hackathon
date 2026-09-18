/**
 * Deterministic geometric zone segmentation for the 3D vehicle model.
 *
 * The provided GLB (Tripo export) is a single merged mesh: no part names,
 * no material zones, no hierarchy. Zones are therefore computed from the
 * geometry itself — vertex classification against normalized car
 * coordinates, never from the LLM and never guessed per case.
 *
 * Coordinate convention (matches reference-demo normalization):
 *   +X = front of car, -X = rear, +Y = up, +Z = left side
 *   length ~4.3 units (-2.185..+2.185), height ~1.66 (0..1.66), width ~±1.10
 *
 * Pure module: no three.js imports, no React. Unit-testable in Node.
 */

export interface RegionRule {
  zoneId: string;
  /** inclusive boxes + optional normal filter; first match wins (specific first) */
  min: [number, number, number];
  max: [number, number, number];
  /** optional: require normal (unit) dot axis >= minDot to accept */
  normalMinDot?: { axis: 0 | 1 | 2; dot: number };
}

/** Wheel volumes are excluded so wheels never count as sills/fenders. */
export const WHEEL_BOXES: ReadonlyArray<{ min: [number, number, number]; max: [number, number, number] }> = [
  { min: [1.05, 0, 0.4], max: [1.85, 0.62, 1.15] }, // front left
  { min: [1.05, 0, -1.15], max: [1.85, 0.62, -0.4] }, // front right
  { min: [-1.85, 0, 0.4], max: [-1.05, 0.62, 1.15] }, // rear left
  { min: [-1.85, 0, -1.15], max: [-1.05, 0.62, -0.4] }, // rear right
];

/**
 * Side-glass volumes: the door/side windows. Vertices here must NEVER be
 * mapped to body damage zones. Mirrors are carved out (they sit inside
 * this band physically but are their own zones).
 */
export const SIDE_GLASS_BOXES: ReadonlyArray<{ min: [number, number, number]; max: [number, number, number] }> = [
  { min: [-1.05, 0.98, 0.5], max: [1.05, 1.45, 1.2] }, // left windows
  { min: [-1.05, 0.98, -1.2], max: [1.05, 1.45, -0.5] }, // right windows
];

/** Mirror region (union of the two MIRROR rule boxes) — carve-out for glass. */
const MIRROR_REGION: ReadonlyArray<{ min: [number, number, number]; max: [number, number, number] }> = [
  { min: [0.5, 0.9, 0.75], max: [0.78, 1.3, 1.0] },
  { min: [0.5, 0.9, -1.0], max: [0.78, 1.3, -0.75] },
];

/**
 * Default region rules in normalized car space, ordered most-specific first.
 * Thresholds are tuned against the actual model and validated by
 * classifier coverage tests + in-viewer diagnostics.
 */
export const DEFAULT_REGION_RULES: readonly RegionRule[] = [
  // bumpers: frontmost/rearmost low band; lateral split
  { zoneId: 'BUMPER_FRONT_LEFT', min: [1.75, 0, 0.35], max: [2.3, 0.85, 1.2] },
  { zoneId: 'BUMPER_FRONT_RIGHT', min: [1.75, 0, -1.2], max: [2.3, 0.85, -0.35] },
  { zoneId: 'BUMPER_FRONT_FULL', min: [1.75, 0, -0.35], max: [2.3, 0.85, 0.35] },
  { zoneId: 'BUMPER_REAR_LEFT', min: [-2.3, 0, 0.35], max: [-1.75, 0.95, 1.2] },
  { zoneId: 'BUMPER_REAR_RIGHT', min: [-2.3, 0, -1.2], max: [-1.75, 0.95, -0.35] },
  { zoneId: 'BUMPER_REAR_FULL', min: [-2.3, 0, -0.35], max: [-1.75, 0.95, 0.35] },
  // mirrors: small pods high at the A-pillar
  { zoneId: 'MIRROR_LEFT', min: [0.5, 0.9, 0.75], max: [0.78, 1.3, 1.0] },
  { zoneId: 'MIRROR_RIGHT', min: [0.5, 0.9, -1.0], max: [0.78, 1.3, -0.75] },
  // roof: topmost flat band
  { zoneId: 'ROOF', min: [-0.75, 1.4, -0.85], max: [0.6, 1.7, 0.85], normalMinDot: { axis: 1, dot: 0.6 } },
  // windshield: high, front-sloped
  { zoneId: 'WINDSHIELD', min: [0.5, 1.02, -0.85], max: [1.05, 1.5, 0.85] },
  // hood: front-top, roughly horizontal
  { zoneId: 'HOOD', min: [0.95, 0.72, -0.95], max: [1.85, 1.35, 0.95], normalMinDot: { axis: 1, dot: 0.35 } },
  // tailgate: rear, tall band, center only (corners belong to rear fenders)
  { zoneId: 'TAILGATE', min: [-1.9, 0.7, -0.6], max: [-1.1, 1.62, 0.6] },
  // fenders: side panels above the wheels
  { zoneId: 'FENDER_FRONT_LEFT', min: [0.95, 0.5, 0.55], max: [1.8, 1.35, 1.15] },
  { zoneId: 'FENDER_FRONT_RIGHT', min: [0.95, 0.5, -1.15], max: [1.8, 1.35, -0.55] },
  { zoneId: 'FENDER_REAR_LEFT', min: [-1.8, 0.5, 0.55], max: [-0.95, 1.35, 1.15] },
  { zoneId: 'FENDER_REAR_RIGHT', min: [-1.8, 0.5, -1.15], max: [-0.95, 1.35, -0.55] },
  // doors: side mid band between wheels
  { zoneId: 'DOOR_FRONT_LEFT', min: [0.1, 0.35, 0.55], max: [1.05, 1.25, 1.15] },
  { zoneId: 'DOOR_FRONT_RIGHT', min: [0.1, 0.35, -1.15], max: [1.05, 1.25, -0.55] },
  { zoneId: 'DOOR_REAR_LEFT', min: [-0.95, 0.35, 0.55], max: [0.1, 1.25, 1.15] },
  { zoneId: 'DOOR_REAR_RIGHT', min: [-0.95, 0.35, -1.15], max: [0.1, 1.25, -0.55] },
  // sills: lowest side strip below the doors
  { zoneId: 'SILL_LEFT', min: [-1.6, 0, 0.5], max: [1.6, 0.4, 1.15] },
  { zoneId: 'SILL_RIGHT', min: [-1.6, 0, -1.15], max: [1.6, 0.4, -0.5] },
];

function inBox(p: [number, number, number], min: number[], max: number[]): boolean {
  return p[0] >= min[0] && p[0] <= max[0] && p[1] >= min[1] && p[1] <= max[1] && p[2] >= min[2] && p[2] <= max[2];
}

function inWheelBox(p: [number, number, number]): boolean {
  return WHEEL_BOXES.some((w) => inBox(p, w.min, w.max));
}

function inSideGlass(p: [number, number, number]): boolean {
  return SIDE_GLASS_BOXES.some((g) => inBox(p, g.min, g.max));
}

function inMirrorRegion(p: [number, number, number]): boolean {
  return MIRROR_REGION.some((g) => inBox(p, g.min, g.max));
}

/** Classify one vertex. Returns null when the vertex belongs to no zone. */
export function classifyVertex(
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  rules: readonly RegionRule[] = DEFAULT_REGION_RULES,
): string | null {
  const p: [number, number, number] = [x, y, z];
  if (inWheelBox(p)) return null;
  // windows are glass, never body zones; mirrors are carved out
  if (inSideGlass(p) && !inMirrorRegion(p)) return null;
  for (const r of rules) {
    if (!inBox(p, r.min, r.max)) continue;
    if (r.normalMinDot) {
      const n = [nx, ny, nz][r.normalMinDot.axis];
      if (n < r.normalMinDot.dot) continue;
    }
    return r.zoneId;
  }
  return null;
}

/** Classify all vertices; returns one zone id per vertex (null => none). */
export function classifyVertices(
  positions: Float32Array,
  normals: Float32Array | null,
  rules: readonly RegionRule[] = DEFAULT_REGION_RULES,
): Array<string | null> {
  const out: Array<string | null> = new Array(positions.length / 3);
  for (let i = 0; i < out.length; i++) {
    out[i] = classifyVertex(
      positions[i * 3],
      positions[i * 3 + 1],
      positions[i * 3 + 2],
      normals ? normals[i * 3] : 0,
      normals ? normals[i * 3 + 1] : 1,
      normals ? normals[i * 3 + 2] : 0,
      rules,
    );
  }
  return out;
}

/** Majority vote over a triangle's vertices; ties resolve to null. */
export function triangleZone(va: string | null, vb: string | null, vc: string | null): string | null {
  if (va === vb) return va;
  if (va === vc) return va;
  if (vb === vc) return vb;
  return null;
}

export interface PartitionArrays {
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
}

type BucketAccum = { p: number[]; n: number[]; uv: number[]; hasN: boolean; hasUv: boolean };

/**
 * Partition the indexed triangle list into per-zone buckets of vertex data
 * (positions + normals + uvs, non-indexed). The `null` bucket holds
 * triangles that belong to no zone (glass, wheels, trim, underbody).
 *
 * Triangles whose corners span more than one zone are deterministically
 * subdivided (edge midpoints re-classified with the same rules) so that
 * small panels on coarse tessellation are still captured. Sub-triangles
 * that remain mixed after `maxDepth` levels go to the `null` bucket,
 * which naturally forms the panel seams.
 *
 * Deterministic: same geometry + same rules => identical buckets.
 */
export function partitionTriangles(
  indices: Uint32Array,
  vertexZones: Array<string | null>,
  arrays: PartitionArrays,
  maxDepth = 1,
  rules: readonly RegionRule[] = DEFAULT_REGION_RULES,
): Map<string | null, PartitionArrays> {
  const { positions, normals, uvs } = arrays;
  const buckets = new Map<string | null, BucketAccum>();
  const accum = (key: string | null): BucketAccum => {
    let b = buckets.get(key);
    if (!b) {
      b = { p: [], n: [], uv: [], hasN: normals !== null, hasUv: uvs !== null };
      buckets.set(key, b);
    }
    return b;
  };

  interface V { pos: [number, number, number]; nrm: [number, number, number]; uv: [number, number]; zone: string | null }
  const vertex = (i: number): V => ({
    pos: [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]],
    nrm: normals ? [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]] : [0, 1, 0],
    uv: uvs ? [uvs[i * 2], uvs[i * 2 + 1]] : [0, 0],
    zone: vertexZones[i] ?? null,
  });

  const emit = (key: string | null, a: V, b: V, c: V) => {
    const acc = accum(key);
    for (const v of [a, b, c]) {
      acc.p.push(v.pos[0], v.pos[1], v.pos[2]);
      if (acc.hasN) acc.n.push(v.nrm[0], v.nrm[1], v.nrm[2]);
      if (acc.hasUv) acc.uv.push(v.uv[0], v.uv[1]);
    }
  };

  const subdivide = (a: V, b: V, c: V, za: string | null, zb: string | null, zc: string | null, depth: number) => {
    const z = triangleZone(za, zb, zc);
    if (z !== null) {
      emit(z, a, b, c);
      return;
    }
    if (depth >= maxDepth) {
      emit(null, a, b, c);
      return;
    }
    const mab = midpointRef(a, b);
    const mbc = midpointRef(b, c);
    const mca = midpointRef(c, a);
    subdivide(a, mab, mca, za, mab.zone, mca.zone, depth + 1);
    subdivide(mab, b, mbc, mab.zone, zb, mbc.zone, depth + 1);
    subdivide(mca, mbc, c, mca.zone, mbc.zone, zc, depth + 1);
    subdivide(mab, mbc, mca, mab.zone, mbc.zone, mca.zone, depth + 1);
  };

  // midpoint of two vertices; the midpoint is re-classified with the same rules
  function midpointRef(a: V, b: V): V {
    const p: [number, number, number] = [
      (a.pos[0] + b.pos[0]) / 2,
      (a.pos[1] + b.pos[1]) / 2,
      (a.pos[2] + b.pos[2]) / 2,
    ];
    const n: [number, number, number] = (() => {
      const nx = a.nrm[0] + b.nrm[0];
      const ny = a.nrm[1] + b.nrm[1];
      const nz = a.nrm[2] + b.nrm[2];
      const l = Math.hypot(nx, ny, nz) || 1;
      return [nx / l, ny / l, nz / l];
    })();
    const uv: [number, number] = [(a.uv[0] + b.uv[0]) / 2, (a.uv[1] + b.uv[1]) / 2];
    const zone = classifyVertex(p[0], p[1], p[2], n[0], n[1], n[2], rules);
    return { pos: p, nrm: n, uv, zone };
  }

  const triCount = Math.floor(indices.length / 3);
  for (let t = 0; t < triCount; t++) {
    const ia = indices[t * 3];
    const ib = indices[t * 3 + 1];
    const ic = indices[t * 3 + 2];
    const za = vertexZones[ia];
    const zb = vertexZones[ib];
    const zc = vertexZones[ic];
    if (za === zb && zb === zc) {
      emit(za, vertex(ia), vertex(ib), vertex(ic));
    } else if (za === null && zb === null && zc === null) {
      emit(null, vertex(ia), vertex(ib), vertex(ic));
    } else {
      subdivide(vertex(ia), vertex(ib), vertex(ic), za, zb, zc, 0);
    }
  }

  const out = new Map<string | null, PartitionArrays>();
  for (const [key, acc] of buckets) {
    out.set(key, {
      positions: new Float32Array(acc.p),
      normals: acc.hasN ? new Float32Array(acc.n) : null,
      uvs: acc.hasUv ? new Float32Array(acc.uv) : null,
    });
  }
  return out;
}

/** Coverage report: how many vertices fall into each zone (diagnostics). */
export function zoneCoverage(vertexZones: Array<string | null>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const z of vertexZones) {
    if (z === null) continue;
    out[z] = (out[z] ?? 0) + 1;
  }
  return out;
}

/**
 * ZONE_MESH_MAP: deterministic mapping ZoneId -> names of the actual
 * mesh(es) representing that zone in the viewer scene.
 *
 * The provided GLB contains NO part meshes (verified by inspection: one
 * unnamed mesh), so the viewer partitions that single mesh into real
 * sub-meshes at load time, named `car-zone-<ZoneId>`. This map is DERIVED
 * from DEFAULT_REGION_RULES (the single source of the mapping) — never
 * fabricated, never fuzzily matched.
 */
export const ZONE_MESH_MAP: Record<string, string[]> = Object.fromEntries(
  DEFAULT_REGION_RULES.map((r) => [r.zoneId, [`car-zone-${r.zoneId}`]]),
);

/**
 * Mesh names for a zone. Unknown ZoneIds yield [] plus a console warning —
 * they are never fallback-highlighted.
 */
export function meshNamesForZone(zoneId: string): string[] {
  const names = ZONE_MESH_MAP[zoneId] ?? [];
  if (names.length === 0) {
    console.warn(`[zone-mesh-map] zone ${zoneId} is unmapped — no mesh to highlight`);
  }
  return names;
}
