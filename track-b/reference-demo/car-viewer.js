import * as THREE from 'three';

// Render at the display's real pixel density. The old cap of 1.25 meant a Retina
// screen (DPR 2) was rendered at 62% of native and upscaled by drawImage, which is
// what made the car look pixelated. 2 is the ceiling: phones report 3, and the
// fragment cost of the third step buys nothing visible.
const DPR = Math.min(window.devicePixelRatio || 1, 2);
// Self-hosted + optimised. The original was 58.5 MB (1.9M tris, 3x 4096 textures).
// Two-stage load: car-lite (0.57 MB) paints almost immediately, then car.glb
// (6.8 MB) is fetched and swapped in behind it. The stages are sequential on
// purpose so the big file never competes with the first paint for bandwidth.
// Textures are 2048, not their native 4096: three 4096 maps are ~268 MB of VRAM
// and 50 megapixels of main-thread JPEG decode, which stalled the first frame
// for a very long time. At 2048 that is 67 MB and 12.5 MP, and the model still
// looks sharp because rendering happens at the display's real pixel density.
// Pano: 6336px PNG -> 1800px JPEG -> 0.3 MB.
const PANO_URL = 'assets/pano.jpg';
let LITE_URL = 'assets/car-lite.glb';
let GLB_URL = 'assets/car.glb';
let renderer = null, bufW = 0, bufH = 0;
const instances = [];
const scenes = {};

let webglDead = false;

function getRenderer(w, h) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      // One offscreen WebGL canvas is rendered and then blitted into each
      // instance's 2D canvas with drawImage. The spec clears the drawing
      // buffer once it has been presented, so reading it back is only
      // guaranteed with preserveDrawingBuffer. Chrome happens to allow it
      // without; Safari is the one that punishes the assumption.
      preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    // iOS Safari drops the GL context when a tab is backgrounded or memory
    // gets tight. Without this the car silently disappears for good.
    const el = renderer.domElement;
    el.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      webglDead = true;
    }, false);
    el.addEventListener('webglcontextrestored', () => {
      webglDead = false;
      bufW = 0; bufH = 0;
      for (const k of Object.keys(scenes)) delete scenes[k];
      instances.forEach(v => { v._dirty = true; });
    }, false);
  }
  if (w > bufW || h > bufH) {
    bufW = Math.max(bufW, w); bufH = Math.max(bufH, h);
    renderer.setSize(bufW, bufH, false);
  }
  return renderer;
}

/* Probe WebGL once so a browser without it gets an honest message instead of
   a blank stage with a loading line that never stops. */
function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) { return false; }
}

function makeEnv(dark) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 512);
  if (dark) {
    g.addColorStop(0, '#46464e'); g.addColorStop(0.48, '#17171a');
    g.addColorStop(0.55, '#0d0d10'); g.addColorStop(1, '#08080a');
  } else {
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.48, '#e2e0dc');
    g.addColorStop(0.55, '#c9c6c0'); g.addColorStop(1, '#b2afaa');
  }
  x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
  x.filter = 'blur(16px)';
  x.fillStyle = dark ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.95)';
  x.fillRect(120, 70, 260, 64); x.fillRect(540, 55, 320, 74); x.fillRect(880, 110, 130, 42);
  x.filter = 'none';
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeShadowTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 64, 8, 128, 64, 120);
  g.addColorStop(0, 'rgba(0,0,0,0.42)'); g.addColorStop(0.55, 'rgba(0,0,0,0.20)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.save(); x.translate(128, 64); x.scale(1, 0.5); x.translate(-128, -64);
  x.fillStyle = g; x.fillRect(0, 0, 256, 128); x.restore();
  return new THREE.CanvasTexture(c);
}

function buildCar() {
  const grp = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0xc6c8ca, metalness: 0.85, roughness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x14171b, metalness: 0.9, roughness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0.3, roughness: 0.7 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xa7aaae, metalness: 0.9, roughness: 0.28 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x121214, metalness: 0, roughness: 0.92 });

  const yB = 0.22, cy = 0.35, r = 0.43, a = 0.307;
  const ca = r * Math.cos(a), FW = 1.34, RW = -1.28;
  const s = new THREE.Shape();
  s.moveTo(-1.93, yB);
  s.lineTo(RW - ca, yB);
  s.absarc(RW, cy, r, Math.PI + a, -a, true);
  s.lineTo(FW - ca, yB);
  s.absarc(FW, cy, r, Math.PI + a, -a, true);
  s.lineTo(2.08, yB);
  s.quadraticCurveTo(2.17, 0.26, 2.16, 0.44);
  s.lineTo(2.14, 0.62);
  s.quadraticCurveTo(2.13, 0.74, 1.92, 0.78);
  s.lineTo(0.92, 0.87);
  s.quadraticCurveTo(0.76, 0.89, 0.68, 0.96);
  s.lineTo(0.16, 1.35);
  s.quadraticCurveTo(0.04, 1.43, -0.18, 1.44);
  s.lineTo(-0.9, 1.42);
  s.quadraticCurveTo(-1.22, 1.4, -1.46, 1.2);
  s.lineTo(-1.72, 0.97);
  s.quadraticCurveTo(-1.95, 0.86, -2.0, 0.7);
  s.lineTo(-2.03, 0.4);
  s.quadraticCurveTo(-2.04, 0.26, -1.93, yB);
  const bodyGeo = new THREE.ExtrudeGeometry(s, { depth: 1.56, bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.09, bevelSegments: 5, curveSegments: 28 });
  bodyGeo.translate(0, 0, -0.78);
  const body = new THREE.Mesh(bodyGeo, paint); body.name = 'body'; grp.add(body);

  // side glass (both sides)
  const gs = new THREE.Shape();
  gs.moveTo(0.55, 0.97); gs.lineTo(0.1, 1.31); gs.lineTo(-1.0, 1.3);
  gs.quadraticCurveTo(-1.3, 1.28, -1.44, 1.06); gs.lineTo(-1.44, 0.98); gs.lineTo(0.55, 0.97);
  const gGeo = new THREE.ShapeGeometry(gs);
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(gGeo, glass); m.name = 'sideglass';
    m.position.z = side * 0.795; if (side < 0) m.rotation.y = Math.PI;
    grp.add(m);
  }
  // windshield
  const wsLen = Math.hypot(0.68 - 0.16, 1.35 - 0.96);
  const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.28, wsLen), glass); ws.name = 'windshield';
  ws.position.set(0.42, 1.155, 0);
  ws.lookAt(new THREE.Vector3(0.42 + 0.6, 1.155 + 0.8, 0));
  ws.translateZ(0.012);
  grp.add(ws);
  // rear glass
  const rg = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 0.36), glass); rg.name = 'rearglass';
  rg.position.set(-1.6, 1.085, 0);
  rg.lookAt(new THREE.Vector3(-1.6 - 0.66, 1.085 + 0.75, 0));
  rg.translateZ(0.012);
  grp.add(rg);
  // grille + lights
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 1.06), dark); grille.name = 'grille';
  grille.position.set(2.15, 0.5, 0); grp.add(grille);
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xdfe5ea, metalness: 0.6, roughness: 0.2, emissive: 0x88979f, emissiveIntensity: 0.35 });
  for (const side of [1, -1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.36), lightMat); h.name = 'headlight';
    h.position.set(2.06, 0.7, side * 0.6); h.rotation.y = -side * 0.22; grp.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.34), new THREE.MeshStandardMaterial({ color: 0x6e1014, roughness: 0.3, emissive: 0x40080a, emissiveIntensity: 0.5 }));
    t.name = 'taillight'; t.position.set(-2.0, 0.76, side * 0.55); t.rotation.y = side * 0.18; grp.add(t);
    const mir = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.15), paint); mir.name = 'mirror';
    mir.position.set(0.6, 1.02, side * 0.88); grp.add(mir);
  }
  // under tray
  const tray = new THREE.Mesh(new THREE.BoxGeometry(3.15, 0.14, 1.42), dark); tray.name = 'tray';
  tray.position.set(0.05, 0.18, 0); grp.add(tray);
  // wheels
  const tireGeo = new THREE.CylinderGeometry(0.335, 0.335, 0.24, 40);
  const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.25, 32);
  const hubGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.26, 16);
  const spokeGeo = new THREE.BoxGeometry(0.05, 0.2, 0.045);
  const rimDark = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, metalness: 0.6, roughness: 0.5 });
  for (const wx of [FW, RW]) for (const side of [1, -1]) {
    const w = new THREE.Group(); w.name = 'wheel';
    const t = new THREE.Mesh(tireGeo, tire); t.rotation.x = Math.PI / 2; w.add(t);
    const rb = new THREE.Mesh(rimGeo, rimDark); rb.rotation.x = Math.PI / 2; w.add(rb);
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Mesh(spokeGeo, rim);
      sp.position.set(0, 0.09, 0.105);
      const holder = new THREE.Group(); holder.add(sp);
      holder.rotation.z = (i / 5) * Math.PI * 2;
      w.add(holder);
    }
    const hub = new THREE.Mesh(hubGeo, rim); hub.rotation.x = Math.PI / 2; w.add(hub);
    w.position.set(wx, 0.335, side * 0.72);
    grp.add(w);
  }
  return grp;
}

function makeWordmark(dark) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 256;
  const x = c.getContext('2d');
  x.font = 'italic 900 148px Arial, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = dark ? '#2e2e33' : '#c2bfb9';
  x.fillText('DEMO DEALERSHIP', 1024, 138);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildScene(mode) {
  const dark = mode === 'dark';
  const sc = new THREE.Scene();
  const bg = new THREE.Color(dark ? 0x141416 : 0xf6f5f2);
  sc.background = bg;
  sc.fog = new THREE.Fog(bg, 11, 22);
  sc.environment = makeEnv(dark);
  sc.environmentIntensity = dark ? 1.0 : 1.0;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(15.05, 48),
    new THREE.MeshStandardMaterial({ color: dark ? 0x1c1c1f : 0xe9e7e2, roughness: 0.95, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2; floor.name = 'floor'; sc.add(floor);
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.0),
    new THREE.MeshBasicMaterial({ map: makeShadowTex(), transparent: true, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.01; sc.add(sh);
  const key = new THREE.DirectionalLight(0xffffff, dark ? 1.9 : 1.1);
  key.position.set(4, 7, 3); sc.add(key);
  const fill = new THREE.HemisphereLight(dark ? 0x33343a : 0xffffff, dark ? 0x0a0a0c : 0xb9b6b0, dark ? 0.5 : 0.55);
  sc.add(fill);
  if (dark) {
    const rimL = new THREE.DirectionalLight(0xbfc8d8, 1.6); rimL.position.set(-5, 3, -4); sc.add(rimL);
  } else if (PANO_URL) {
    new THREE.TextureLoader().setCrossOrigin('anonymous').load(PANO_URL, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = THREE.MirroredRepeatWrapping;
      t.repeat.x = 4;
      t.anisotropy = 8;
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(15.2, 15.2, 7.2, 96, 1, true),
        new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false })
      );
      cyl.position.y = 2.1;
      sc.add(cyl);
      instances.forEach(v => { v._dirty = true; });
    }, undefined, () => {});
  }
  // turntable rings + floor wordmark
  const ringMat = new THREE.MeshBasicMaterial({ color: dark ? 0x232326 : 0xd8d5cf });
  for (const [r0, r1] of [[2.9, 2.96], [3.3, 3.33]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 72), ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.012; sc.add(ring);
  }
  const wm = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 0.94),
    new THREE.MeshBasicMaterial({ map: makeWordmark(dark), transparent: true, depthWrite: false }));
  wm.rotation.x = -Math.PI / 2; wm.position.set(0, 0.015, 2.6); sc.add(wm);
  const carRoot = new THREE.Group(); carRoot.name = 'carRoot';
  // Only ever show the procedural stand-in if the real model actually failed —
  // never as a placeholder while it is still downloading.
  if (glbObj) carRoot.add(glbObj.clone(true));
  else if (glbFailed) carRoot.add(buildCar());
  sc.add(carRoot);
  return sc;
}

let glbObj = null;
let glbFailed = false;
let signalled = false;
let plateTex = null;

function signalReady(ok) {
  if (signalled) return;
  signalled = true;
  try {
    window.dispatchEvent(new CustomEvent('car-viewer-ready', { detail: { ok: ok } }));
  } catch (e) {}
}

function signalProgress(frac) {
  try {
    window.dispatchEvent(new CustomEvent('car-viewer-progress', { detail: { frac: frac } }));
  } catch (e) {}
}

function fallbackToProcedural() {
  if (glbObj || glbFailed) return;
  glbFailed = true;
  for (const sc of Object.values(scenes)) {
    const root = sc.getObjectByName('carRoot');
    if (root && root.children.length === 0) root.add(buildCar());
  }
  instances.forEach(v => { v._dirty = true; });
  signalReady(false);
}

/* Fit an arbitrary glTF scene to the 4.3-unit-long car the rest of this
   module assumes: lay it along x, scale it, sit it on the ground plane. */
function normalise(obj) {
  let box = new THREE.Box3().setFromObject(obj);
  let size = box.getSize(new THREE.Vector3());
  const wrap = new THREE.Group(); wrap.name = 'glbCar'; wrap.add(obj);
  if (size.z > size.x) { obj.rotation.y = Math.PI / 2; }
  wrap.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(wrap);
  size = box.getSize(new THREE.Vector3());
  wrap.scale.setScalar(4.3 / Math.max(size.x, size.z));
  wrap.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(wrap);
  const ctr = box.getCenter(new THREE.Vector3());
  wrap.position.x -= ctr.x; wrap.position.z -= ctr.z; wrap.position.y -= box.min.y;
  return wrap;
}

/* car body + the two license plates (D · AIL 26) */
function assemble(wrap, pt) {
  const asm = new THREE.Group(); asm.name = 'carAssembly';
  asm.add(wrap);
  if (pt) {
    const pm = new THREE.MeshBasicMaterial({ map: pt });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.14), pm);
    front.name = 'plateFront';
    front.position.set(2.185, 0.42, 0);
    front.rotation.y = Math.PI / 2;
    const rear = front.clone();
    rear.name = 'plateRear';
    rear.position.set(-2.185, 0.62, 0);
    rear.rotation.y = -Math.PI / 2;
    asm.add(front, rear);
  }
  return asm;
}

/* Free the stage-1 model once stage 2 has replaced it. The clones in the
   scenes share these buffers, so this only runs after they are detached.
   plateTex is shared with the new assembly and must survive. */
function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const mt of mats) {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
        if (mt[k] && mt[k] !== plateTex) mt[k].dispose();
      }
      mt.dispose();
    }
  });
}

function install(asm) {
  const prev = glbObj;
  glbObj = asm;
  for (const sc of Object.values(scenes)) {
    const root = sc.getObjectByName('carRoot');
    if (root) { root.clear(); root.add(glbObj.clone(true)); }
  }
  instances.forEach(v => { v._dirty = true; });
  if (prev) { try { disposeTree(prev); } catch (e) {} }
}

function loadPlate() {
  return new Promise((res) => {
    new THREE.TextureLoader().load('assets/plate-d-ail-26.png', (pt) => {
      pt.colorSpace = THREE.SRGBColorSpace;
      pt.anisotropy = 8;
      res(pt);
    }, undefined, () => res(null));
  });
}

async function loadGLB() {
  if (!GLB_URL && !LITE_URL) { fallbackToProcedural(); return; }

  if (!webglAvailable()) {
    signalled = true;
    try {
      window.dispatchEvent(new CustomEvent('car-viewer-ready',
        { detail: { ok: false, webgl: false } }));
    } catch (e) {}
    return;
  }

  let mod;
  try {
    // GLTFLoader imports three by bare specifier, so this resolves through the
    // import map in index.html. That map must be declared before any module
    // starts loading or Firefox discards it and this throws.
    mod = await import('https://unpkg.com/three@0.184.0/examples/jsm/loaders/GLTFLoader.js');
  } catch (e) { fallbackToProcedural(); return; }

  const loader = new mod.GLTFLoader();
  loader.setCrossOrigin('anonymous');

  const load = (url, onProgress) => new Promise((res, rej) => {
    loader.load(url, (g) => res(g.scene), onProgress, rej);
  });

  const platePromise = loadPlate();
  let painted = false;

  // Stage 1 — small model, on screen as fast as possible.
  if (LITE_URL) {
    try {
      const scene = await load(LITE_URL, (e) => {
        if (e && e.lengthComputable) signalProgress(e.loaded / e.total * 0.5);
      });
      plateTex = await platePromise;
      install(assemble(normalise(scene), plateTex));
      painted = true;
      signalReady(true);
    } catch (e) { /* no first paint; stage 2 still has a chance */ }
  }

  // Stage 2 — full model, swapped in underneath the user.
  if (GLB_URL) {
    try {
      const scene = await load(GLB_URL, (e) => {
        if (e && e.lengthComputable) signalProgress(0.5 + e.loaded / e.total * 0.5);
      });
      if (!plateTex) plateTex = await platePromise;
      install(assemble(normalise(scene), plateTex));
      signalReady(true);
      return;
    } catch (e) { /* keep whatever stage 1 gave us */ }
  }

  if (!painted) fallbackToProcedural();
}
loadGLB();

let loopStarted = false, last = 0;
function ensureLoop() {
  if (loopStarted) return; loopStarted = true;
  const tick = (t) => {
    requestAnimationFrame(tick);
    if (t - last < 33) return; // ~30fps
    const dt = Math.min((t - last) / 1000, 0.1); last = t;
    for (const v of instances) v._tick(dt);
  };
  requestAnimationFrame(tick);
}

class CarViewer extends HTMLElement {
  static get observedAttributes() { return ['auto', 'speed']; }
  connectedCallback() {
    if (this._init) { if (!instances.includes(this)) instances.push(this); return; }
    this._init = true;
    this.style.display = this.style.display || 'block';
    this.style.touchAction = 'pan-y';
    this.style.overflow = 'hidden';
    const cv = document.createElement('canvas');
    cv.style.cssText = 'width:100%;height:100%;display:block;cursor:grab;';
    this.appendChild(cv);
    this._cv = cv; this._ctx = cv.getContext('2d');
    this._az = parseFloat(this.getAttribute('azimuth') || '0.65');
    this._el = 0.2;
    this._mode = this.getAttribute('mode') || 'light';
    this._hover = false; this._drag = false; this._dirty = true; this._visible = true;
    this._cam = new THREE.PerspectiveCamera(30, 2, 0.1, 60);
    cv.addEventListener('pointerdown', (e) => {
      this._drag = true; this._px = e.clientX; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing';
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this._drag) return;
      this._az -= (e.clientX - this._px) * 0.007; this._px = e.clientX; this._dirty = true;
    });
    const up = () => { this._drag = false; cv.style.cursor = 'grab'; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    this.addEventListener('pointerenter', () => { this._hover = true; });
    this.addEventListener('pointerleave', () => { this._hover = false; this._drag = false; });
    this._ro = new ResizeObserver(() => { this._resize(); });
    this._ro.observe(this);
    this._io = new IntersectionObserver((e) => { this._visible = e[0].isIntersecting; });
    this._io.observe(this);
    this._resize();
    instances.push(this); ensureLoop();
  }
  _resize() {
    const w = Math.max(2, Math.round(this.clientWidth * DPR));
    const h = Math.max(2, Math.round(this.clientHeight * DPR));
    if (this._cv.width !== w || this._cv.height !== h) {
      this._cv.width = w; this._cv.height = h; this._dirty = true;
    }
  }
  _tick(dt) {
    if (!this._visible || !this.isConnected) return;
    const auto = this.getAttribute('auto') !== '0';
    const speed = parseFloat(this.getAttribute('speed') || '0.14');
    if (auto && !this._drag) { this._az += speed * dt; this._dirty = true; }
    if (!this._dirty) return;
    this._dirty = false;
    try { this._render(); } catch (e) { /* webgl unavailable */ }
  }
  _render() {
    if (!scenes[this._mode]) scenes[this._mode] = buildScene(this._mode);
    const sc = scenes[this._mode];
    const w = this._cv.width, h = this._cv.height;
    const rn = getRenderer(w, h);
    const dist = 7.9;
    this._cam.aspect = w / h; this._cam.updateProjectionMatrix();
    this._cam.position.set(Math.cos(this._az) * dist * Math.cos(this._el), 0.62 + Math.sin(this._el) * dist, Math.sin(this._az) * dist * Math.cos(this._el));
    this._cam.lookAt(0, 0.62, 0);
    rn.setViewport(0, 0, w, h);
    rn.setScissor(0, 0, w, h);
    rn.setScissorTest(true);
    rn.render(sc, this._cam);
    this._ctx.clearRect(0, 0, w, h);
    this._ctx.drawImage(rn.domElement, 0, rn.domElement.height - h, w, h, 0, 0, w, h);
    this._drawCallout(w, h);
  }
  _drawCallout(w, h) {
    const label = this.getAttribute('callout');
    if (!label) return;
    const at = (this.getAttribute('callout-at') || '2.1,0.55,0.4').split(',').map(Number);
    const v = new THREE.Vector3(at[0], at[1], at[2]).project(this._cam);
    if (v.z >= 1) return;
    const px = (v.x + 1) / 2 * w, py = (1 - v.y) / 2 * h;
    const ang = Math.atan2(at[2], at[0]);
    let dd = this._az - ang; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
    const facing = Math.cos(dd);
    const s = w / Math.max(1, this.clientWidth);
    const dark = this._mode === 'dark';
    const x = this._ctx, col = dark ? '#f1efec' : '#17181a';
    const fs = Math.round(13 * s);
    x.font = fs + "px 'Schibsted Grotesk', Helvetica, sans-serif";
    const tw = x.measureText(label).width;
    const lx = 26 * s, ly = h - 40 * s;
    x.strokeStyle = col; x.fillStyle = col; x.lineWidth = Math.max(1, s);
    if (facing > 0.12) {
      x.globalAlpha = Math.min(1, (facing - 0.12) / 0.35);
      x.beginPath(); x.arc(px, py, 3.5 * s, 0, 7); x.fill();
      x.beginPath(); x.moveTo(px, py); x.lineTo(lx + tw + 14 * s, ly); x.stroke();
      x.globalAlpha = 1;
    }
    x.beginPath(); x.moveTo(lx, ly); x.lineTo(lx + tw + 14 * s, ly); x.stroke();
    x.fillText(label, lx, ly - 10 * s);
  }
  disconnectedCallback() {
    const i = instances.indexOf(this); if (i >= 0) instances.splice(i, 1);
    if (this._ro) this._ro.disconnect(); if (this._io) this._io.disconnect();
  }
}
if (!customElements.get('car-viewer')) customElements.define('car-viewer', CarViewer);
