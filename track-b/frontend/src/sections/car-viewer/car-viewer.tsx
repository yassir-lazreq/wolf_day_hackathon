'use client';

/**
 * 3D damage viewer — mesh-based highlighting.
 *
 * The provided GLB is a single, unnamed, indexed mesh (verified by GLB
 * inspection: 1 node, 1 mesh, no part names). There are no part meshes to
 * map ZoneIds onto, so the viewer deterministically PARTITIONS the real
 * geometry once at load time into per-zone meshes:
 *
 *   ZoneId -> deterministic vertex classification (zone-classifier.ts)
 *          -> triangle partition via the mesh's index buffer
 *          -> one real THREE.Mesh per zone (+ one "rest" mesh for glass,
 *             wheels, trim and unclassified surface)
 *
 * Highlighting = material override on exactly those meshes (solid emissive
 * color). Raycasting = against the real meshes, reverse lookup via the
 * mesh registry. No overlay, no canvas, no decals, no brush.
 *
 * Visual states (solid, matching the UI legend):
 *  - damaged zones:          red/pink emissive
 *  - inferred replacement:   orange emissive
 *  - linked intact parts:    yellow emissive
 *  - everything else:        original textured material
 */

import type { CaseExtracted } from '../car-damage/types';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { useRef, useState, useEffect, type RefObject } from 'react';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import {
  ZONE_MESH_MAP,
  classifyVertices,
  partitionTriangles,
  DEFAULT_REGION_RULES,
} from './zone-classifier';

const DAMAGED_COLOR = 0xe11d48;
const REPLACEMENT_COLOR = 0xf97316;
const LINKED_COLOR = 0xeab308;

export interface CarViewerProps {
  caseData: CaseExtracted;
  zonesMeta: Array<{ id: string; germanLabel: string; replacementPart: string; linkedZones: string[] }>;
  onZoneSelect?: (zoneId: string | null) => void;
  height?: number;
}

interface ZonePart {
  mesh: THREE.Mesh;
  originalMaterial: THREE.Material;
  zoneId: string | null; // null = rest (glass/wheels/trim/unknown)
}

interface ViewerState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  parts: ZonePart[];
  partByZone: Map<string, ZonePart>;
  raycaster: THREE.Raycaster;
  coverage: Map<string, number> | null;
  stateMaterials: Map<string, THREE.MeshStandardMaterial>;
}

/** Replicate the reference demo's normalization: lay along x, scale, ground. */
function normalise(obj: THREE.Object3D): THREE.Group {
  let box = new THREE.Box3().setFromObject(obj);
  let size = box.getSize(new THREE.Vector3());
  const wrap = new THREE.Group();
  wrap.name = 'glbCar';
  wrap.add(obj);
  if (size.z > size.x) obj.rotation.y = Math.PI / 2;
  wrap.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(wrap);
  size = box.getSize(new THREE.Vector3());
  wrap.scale.setScalar(4.3 / Math.max(size.x, size.z));
  wrap.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(wrap);
  const ctr = box.getCenter(new THREE.Vector3());
  wrap.position.x -= ctr.x;
  wrap.position.z -= ctr.z;
  wrap.position.y -= box.min.y;
  return wrap;
}

/** Position the camera so the car fills ~70% of the viewport height. */
function fitCameraToBox(camera: THREE.PerspectiveCamera, controls: OrbitControls, box: THREE.Box3) {
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
  const fitFactor = 1.45;
  const distance = (radius * fitFactor) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
  const dir = new THREE.Vector3(1, 0.42, 1).normalize();
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.05, distance - radius * 2.5);
  camera.far = distance + radius * 2.5;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.minDistance = distance * 0.4;
  controls.maxDistance = distance * 3;
  controls.update();
}

interface ZoneState {
  damaged: Set<string>;
  replacement: Set<string>;
  linked: Set<string>;
}

function computeZoneState(caseData: CaseExtracted, zonesMeta: CarViewerProps['zonesMeta']): ZoneState {
  const damaged = new Set<string>();
  const replacement = new Set<string>();
  const linked = new Set<string>();
  const metaById = new Map(zonesMeta.map((z) => [z.id, z]));

  for (const d of caseData.damages) {
    damaged.add(d.zoneId);
    if (d.replacementPart && d.action === 'austauschen') replacement.add(d.replacementPart);
  }
  for (const zoneId of damaged) {
    const meta = metaById.get(zoneId);
    if (!meta) continue;
    for (const lz of meta.linkedZones) {
      if (!damaged.has(lz) && !replacement.has(lz)) linked.add(lz);
    }
  }
  return { damaged, replacement, linked };
}

export function CarViewer({ caseData, zonesMeta, onZoneSelect, height = 420 }: CarViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<{ map: Record<string, number>; total: number } | null>(null);
  const stateRef = useRef<ViewerState | null>(null);
  const zoneStateRef = useRef<ZoneState>({ damaged: new Set(), replacement: new Set(), linked: new Set() });

  // re-apply highlights when the case changes
  useEffect(() => {
    zoneStateRef.current = computeZoneState(caseData, zonesMeta);
    const st = stateRef.current;
    if (st) applyHighlights(st);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseData, zonesMeta]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let disposed = false;
    let onClick: ((e: MouseEvent) => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const state: ViewerState = {
      renderer: null as unknown as THREE.WebGLRenderer,
      scene: null as unknown as THREE.Scene,
      camera: null as unknown as THREE.PerspectiveCamera,
      controls: null as unknown as OrbitControls,
      parts: [],
      partByZone: new Map(),
      raycaster: null as unknown as THREE.Raycaster,
      coverage: null,
      stateMaterials: new Map(),
    };

    try {
      const width = mount.clientWidth || (mount.parentElement?.clientWidth ?? 800);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      renderer.setClearColor(0x0b1220, 1);
      mount.appendChild(renderer.domElement);
      state.renderer = renderer;

      const scene = new THREE.Scene();
      state.scene = scene;
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 50);
      state.camera = camera;

      const hemi = new THREE.HemisphereLight(0xe8f0ff, 0x3a3428, 1.6);
      scene.add(hemi);
      const key = new THREE.DirectionalLight(0xffffff, 2.4);
      key.position.set(6, 8, 4);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xbfc8d8, 1.4);
      rim.position.set(-5, 3, -4);
      scene.add(rim);
      scene.add(new THREE.AmbientLight(0xffffff, 0.35));

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0.62, 0);
      controls.enableDamping = true;
      controls.maxPolarAngle = Math.PI * 0.6;
      state.controls = controls;

      state.raycaster = new THREE.Raycaster();
      onClick = (e: MouseEvent) => {
        if (!onZoneSelect || state.parts.length === 0) return;
        const rect = renderer.domElement.getBoundingClientRect();
        if (rect.width === 0) return;
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        );
        state.raycaster.setFromCamera(ndc, camera);
        const hits = state.raycaster.intersectObjects(
          state.parts.map((p) => p.mesh),
          false,
        );
        if (hits.length === 0) {
          onZoneSelect(null);
          return;
        }
        const hit = hits[0].object;
        const part = state.parts.find((p) => p.mesh === hit);
        onZoneSelect(part?.zoneId ?? null);
      };
      renderer.domElement.addEventListener('click', onClick);

      const loader = new GLTFLoader();
      loader.load(
        '/assets/car/car.glb',
        (gltf) => {
          if (disposed) return;
          const wrap = normalise(gltf.scene);
          scene.add(wrap);

          gltf.scene.updateMatrixWorld(true);
          wrap.updateMatrixWorld(true);

          gltf.scene.traverse((o) => {
            if (!(o as THREE.Mesh).isMesh) return;
            const mesh = o as THREE.Mesh;
            const geo = mesh.geometry;
            const pos = geo.getAttribute('position') as THREE.BufferAttribute;
            const nrmAttr = geo.getAttribute('normal');
            const nrm = nrmAttr ? (nrmAttr as THREE.BufferAttribute) : null;
            const count = pos.count;

            // world-space (normalized car) vertex copy for classification
            const posArr = new Float32Array(count * 3);
            const nrmArr = nrm ? new Float32Array(count * 3) : null;
            const v = new THREE.Vector3();
            const n = new THREE.Vector3();
            for (let i = 0; i < count; i++) {
              v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
              posArr[i * 3] = v.x;
              posArr[i * 3 + 1] = v.y;
              posArr[i * 3 + 2] = v.z;
              if (nrmArr && nrm) {
                n.fromBufferAttribute(nrm, i).transformDirection(mesh.matrixWorld).normalize();
                nrmArr[i * 3] = n.x;
                nrmArr[i * 3 + 1] = n.y;
                nrmArr[i * 3 + 2] = n.z;
              }
            }

            const vertexZones = classifyVertices(posArr, nrmArr, DEFAULT_REGION_RULES);
            const coverageMap: Record<string, number> = {};
            for (const z of vertexZones) if (z) coverageMap[z] = (coverageMap[z] ?? 0) + 1;
            state.coverage = new Map(Object.entries(coverageMap));
            setCoverage({ map: coverageMap, total: vertexZones.length });

            // partition the REAL mesh into per-zone sub-meshes
            const indexAttr = geo.getIndex();
            if (!indexAttr) {
              throw new Error('GLB mesh has no index buffer — partition requires indexed geometry');
            }
            const indices = new Uint32Array(indexAttr.array as Uint32Array);
            const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute | null;
            const buckets = partitionTriangles(indices, vertexZones, {
              positions: posArr,
              normals: nrmArr,
              uvs: uvAttr ? new Float32Array(uvAttr.array as Float32Array) : null,
            });

            const originalMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;

            for (const [zoneKey, arrays] of buckets) {
              const sub = new THREE.BufferGeometry();
              sub.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
              if (arrays.normals) sub.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
              if (arrays.uvs) sub.setAttribute('uv', new THREE.BufferAttribute(arrays.uvs, 2));
              const partMesh = new THREE.Mesh(sub, originalMaterial.clone());
              partMesh.name = zoneKey === null ? 'car-rest' : (ZONE_MESH_MAP[zoneKey]?.[0] ?? `car-zone-${zoneKey}`);
              partMesh.renderOrder = 1;
              scene.add(partMesh);
              const part: ZonePart = { mesh: partMesh, originalMaterial: partMesh.material as THREE.Material, zoneId: zoneKey };
              state.parts.push(part);
              if (zoneKey !== null) state.partByZone.set(zoneKey, part);
            }

            // remove the original merged mesh and its (now empty) wrapper
            scene.remove(mesh);
            scene.remove(wrap);
            geo.dispose();

            // fit the camera to the actual parts bounding box
            const partsBox = new THREE.Box3();
            for (const p of state.parts) partsBox.expandByObject(p.mesh);
            fitCameraToBox(camera, controls, partsBox);
            setStatus('ready');
            applyHighlights(state);
          });
        },
        undefined,
        (err) => {
          if (disposed) return;
          console.error('GLB load error', err);
          setStatus('error');
          setError('3D model could not be loaded.');
        },
      );

      const loop = () => {
        if (disposed) return;
        controls.update();
        renderer.render(scene, camera);
        requestAnimationFrame(loop);
      };
      loop();

      stateRef.current = state;
      resizeObserver = new ResizeObserver(() => {
        const w = mount.clientWidth;
        if (w === 0 || disposed) return;
        renderer.setSize(w, height);
        camera.aspect = w / height;
        camera.updateProjectionMatrix();
      });
      resizeObserver.observe(mount);
    } catch (e) {
      setStatus('error');
      setError(`WebGL could not be initialized: ${e instanceof Error ? e.message : String(e)}`);
    }

    return () => {
      disposed = true;
      const st = stateRef.current;
      stateRef.current = null;
      if (st?.renderer) {
        if (onClick) st.renderer.domElement.removeEventListener('click', onClick);
        if (resizeObserver) resizeObserver.disconnect();
        for (const p of st.parts) {
          st.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
        }
        for (const m of st.stateMaterials.values()) m.dispose();
        st.renderer.dispose();
        st.renderer.domElement.remove();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Solid emissive material per state (cached, shared across zone meshes). */
  function stateMaterial(state: ViewerState, key: string, color: number): THREE.MeshStandardMaterial {
    let m = state.stateMaterials.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.8,
        roughness: 0.45,
        metalness: 0.05,
      });
      state.stateMaterials.set(key, m);
    }
    return m;
  }

  /**
   * Restore every part to its original material, then override ONLY the
   * meshes of the active zones (precedence: damaged > replacement > linked).
   */
  function applyHighlights(state: ViewerState) {
    for (const part of state.parts) {
      part.mesh.material = part.originalMaterial;
    }
    const zs = zoneStateRef.current;
    const order: Array<{ set: Set<string>; key: string; color: number }> = [
      { set: zs.damaged, key: 'damaged', color: DAMAGED_COLOR },
      { set: zs.replacement, key: 'replacement', color: REPLACEMENT_COLOR },
      { set: zs.linked, key: 'linked', color: LINKED_COLOR },
    ];
    const assigned = new Set<string>();
    for (const g of order) {
      for (const zoneId of g.set) {
        if (assigned.has(zoneId)) continue;
        assigned.add(zoneId);
        const part = state.partByZone.get(zoneId);
        if (!part) {
          console.warn(`[car-viewer] zone ${zoneId} has no geometry on the 3D model — not highlighted`);
          continue;
        }
        part.mesh.material = stateMaterial(state, g.key, g.color);
      }
    }
  }

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div ref={mountRef as RefObject<HTMLDivElement>} style={{ width: '100%', height, borderRadius: 8, overflow: 'hidden' }} />
      {status === 'loading' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
          Loading 3D model…
        </div>
      )}
      {status === 'error' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f87171', padding: 16, textAlign: 'center' }}>
          {error}
        </div>
      )}
      {status === 'ready' && coverage && (
        <div style={{ position: 'absolute', right: 8, bottom: 6, color: '#64748b', fontSize: 10 }}>
          Segmentation: {Object.keys(coverage.map).length}/22 zones · {Math.round((Object.values(coverage.map).reduce((a, b) => a + b, 0) / coverage.total) * 100)}% surface classified
        </div>
      )}
    </div>
  );
}
