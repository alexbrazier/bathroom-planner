// three.js 3D view of the design.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { store, select, itemById, emit, commit, modelOf, sizeOf } from './state.js';
import { wallsOf, outerPts, polyBounds, toWorld, distToSeg } from './geom.js';
import { buildItem, boxGeo, mat, MATS, tileTexture, hasTapOn } from './models3d.js';
import { placeItem, ridersOf, applyRiders } from './place.js';

const MM = 0.001;
export const v3 = { ready: false };

export function init3d(container, { onDropModel }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dfe3e8');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3;

  const camera = new THREE.PerspectiveCamera(50, 1, 0.02, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.addEventListener('change', () => { updateCutaway(); requestRender(); });

  const hemi = new THREE.HemisphereLight('#ffffff', '#8f877b', 0.55); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4e6', 1.9);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun); scene.add(sun.target);
  const ceilingLight = new THREE.PointLight('#fff3e0', 3, 8, 1.6); scene.add(ceilingLight);

  const roomGroup = new THREE.Group(); scene.add(roomGroup);
  const itemGroup = new THREE.Group(); scene.add(itemGroup);
  const selBox = new THREE.Box3Helper(new THREE.Box3(), 0x2f5d8a); selBox.visible = false; scene.add(selBox);

  Object.assign(v3, { renderer, scene, camera, controls, roomGroup, itemGroup, selBox, sun, ceilingLight, container, ready: true, walls: [], cutaway: true, ceiling: false, onDropModel });

  new ResizeObserver(() => resize()).observe(container);
  resize();
  resetCamera();
  rebuildRoom(); rebuildItems();

  // picking & dragging
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const pick = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  const floorPoint = (e, y = 0) => {
    pick(e); floorPlane.constant = -y;
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(floorPlane, p) ? { x: p.x / MM, y: p.z / MM } : null;
  };
  let drag = null, downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    downAt = { x: e.clientX, y: e.clientY };
    pick(e);
    const hits = ray.intersectObjects(itemGroup.children, true);
    if (hits.length) {
      const id = hits[0].object.userData.itemId;
      const it = itemById(id);
      if (it && !store.readOnly && store.sel?.type === 'item' && store.sel.id === id) {
        const plane = it.elev * MM;
        const fp = floorPoint(e, plane);
        if (fp) {
          drag = { it, start: JSON.stringify(store.d), off: { x: fp.x - it.x, y: fp.y - it.y }, plane, riders: ridersOf(it), moved: false };
          controls.enabled = false;
          renderer.domElement.setPointerCapture(e.pointerId);
        }
      }
    }
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const fp = floorPoint(e, drag.plane);
    if (!fp) return;
    drag.moved = true;
    placeItem(drag.it, { x: fp.x - drag.off.x, y: fp.y - drag.off.y }, { free: e.altKey, tol: 40 });
    applyRiders(drag.it, drag.riders);
    emit('live');
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (drag) {
      controls.enabled = true;
      if (drag.moved) { store.undo.push(drag.start); store.redo.length = 0; commit('items'); }
      drag = null; return;
    }
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 4) {
      pick(e);
      const hits = ray.intersectObjects(itemGroup.children, true);
      select(hits.length ? { type: 'item', id: hits[0].object.userData.itemId } : null);
    }
    downAt = null;
  });
  renderer.domElement.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  renderer.domElement.addEventListener('drop', (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/x-model');
    const fp = floorPoint(e, 0);
    if (id && fp) onDropModel(id, fp, e.altKey);
  });

  const loop = () => {
    requestAnimationFrame(loop);
    if (!container.offsetParent) return;
    if (controls.update() || v3.dirty) { v3.dirty = false; renderer.render(scene, camera); }
  };
  loop();
}

export function requestRender() { v3.dirty = true; }

function resize() {
  const { container, renderer, camera } = v3;
  const r = container.getBoundingClientRect();
  if (!r.width || !r.height) return;
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
  requestRender();
}
export function onShow() { resize(); updateCutaway(); requestRender(); }

export function resetCamera() {
  const b = polyBounds(store.d.room.pts);
  const cx = b.cx * MM, cz = b.cy * MM, size = Math.max(b.w, b.h) * MM;
  v3.controls.target.set(cx, 0.9, cz);
  v3.camera.position.set(cx + size * 0.55, size * 1.25 + 1.2, cz + size * 1.15 + 0.8);
  v3.camera.fov = 50; v3.camera.updateProjectionMatrix();
  v3.controls.update(); updateCutaway(); requestRender();
}
export function eyeLevel() {
  const b = polyBounds(store.d.room.pts);
  const walls = wallsOf(store.d.room.pts);
  // stand near the door if there is one, else near the "front" wall, looking across the room
  const door = store.d.openings.find((o) => o.type === 'door');
  let px = b.cx, py = b.y1 - 300;
  if (door && walls[door.wall]) { const w = walls[door.wall]; const t = door.offset + door.width / 2; px = w.a.x + w.ux * t + w.nx * 250; py = w.a.y + w.uy * t + w.ny * 250; }
  v3.camera.position.set(px * MM, 1.6, py * MM);
  v3.controls.target.set(b.cx * MM, 1.2, b.cy * MM);
  v3.camera.fov = 70; v3.camera.updateProjectionMatrix();
  v3.controls.update(); updateCutaway(); requestRender();
}

// ------------------------------------------------------------------ room
function disposeGroup(g) {
  while (g.children.length) {
    const o = g.children.pop();
    o.traverse((c) => { if (c.geometry) c.geometry.dispose(); });
  }
}

export function rebuildRoom() {
  if (!v3.ready) return;
  const { roomGroup } = v3;
  disposeGroup(roomGroup);
  const room = store.d.room;
  const pts = room.pts;
  const H = room.height * MM, T = room.thickness * MM;
  const walls = wallsOf(pts);
  const outer = outerPts(pts, room.thickness);

  // floor
  const fs = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x * MM, -p.y * MM)));
  const fg = new THREE.ShapeGeometry(fs); fg.rotateX(-Math.PI / 2);
  const ftex = tileTexture(room.floor.color, room.floor.grout, room.floor.tw, room.floor.th);
  // ShapeGeometry uvs are the shape coordinates (metres) → repeat gives exact tile size
  const floor = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ map: ftex, roughness: 0.55 }));
  floor.receiveShadow = true; roomGroup.add(floor);
  const base = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x * MM, -p.y * MM)))).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#8d9096' }));
  base.position.y = -0.002; roomGroup.add(base);

  const paint = new THREE.MeshStandardMaterial({ color: room.wallColor, roughness: 0.92 });
  const wt = room.wallTile;
  const tileMat = wt.enabled ? new THREE.MeshStandardMaterial({ map: tileTexture(wt.color, wt.grout, wt.tw, wt.th), roughness: 0.3 }) : null;
  const shell = new THREE.MeshStandardMaterial({ color: '#d8d6d1', roughness: 0.95 });
  const topMat = new THREE.MeshStandardMaterial({ color: '#4a4f57', roughness: 0.9 });

  v3.walls = [];
  const n = pts.length;
  for (const w of walls) {
    const g = new THREE.Group();
    const ops = store.d.openings.filter((o) => o.wall === w.i).sort((a, b) => a.offset - b.offset);
    // intervals along the wall
    const cuts = [];
    let t = 0;
    for (const o of ops) {
      const a = Math.max(0, o.offset), b = Math.min(w.len, o.offset + o.width);
      if (a > t) cuts.push({ t0: t, t1: a, y0: 0, y1: room.height });
      cuts.push({ t0: a, t1: b, y0: 0, y1: o.sill, op: o });
      cuts.push({ t0: a, t1: b, y0: Math.min(room.height, o.sill + o.height), y1: room.height, op: o });
      t = b;
    }
    if (t < w.len) cuts.push({ t0: t, t1: w.len, y0: 0, y1: room.height });
    const qa = outer[w.i], qb = outer[(w.i + 1) % n];
    const innerAt = (tt) => ({ x: w.a.x + w.ux * tt, y: w.a.y + w.uy * tt });
    const outerAt = (tt) => tt <= 0 ? qa : tt >= w.len ? qb : { x: w.a.x + w.ux * tt - w.nx * room.thickness, y: w.a.y + w.uy * tt - w.ny * room.thickness };
    for (const c of cuts) {
      if (c.y1 - c.y0 < 0.5 || c.t1 - c.t0 < 0.5) continue;
      const quad = [innerAt(c.t0), innerAt(c.t1), outerAt(c.t1), outerAt(c.t0)];
      const sh = new THREE.Shape(quad.map((p) => new THREE.Vector2(p.x * MM, p.y * MM)));
      const geo = new THREE.ExtrudeGeometry(sh, { depth: (c.y1 - c.y0) * MM, bevelEnabled: false });
      geo.rotateX(Math.PI / 2); geo.translate(0, c.y1 * MM, 0);
      const mesh = new THREE.Mesh(geo, [topMat, shell]); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
      // inner face overlay (paint / tiles) with real-world UVs
      const bands = [];
      const tileH = wt.enabled ? wt.height : 0;
      if (tileH > c.y0) bands.push([c.y0, Math.min(c.y1, tileH), tileMat]);
      if (c.y1 > Math.max(c.y0, tileH)) bands.push([Math.max(c.y0, tileH), c.y1, paint]);
      for (const [y0, y1, m] of bands) {
        const L = (c.t1 - c.t0) * MM, h = (y1 - y0) * MM;
        const pg = new THREE.PlaneGeometry(L, h);
        const uv = pg.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, c.t0 * MM + uv.getX(i) * L, y0 * MM + uv.getY(i) * h);
        const pm = new THREE.Mesh(pg, m);
        const mid = innerAt((c.t0 + c.t1) / 2);
        pm.position.set(mid.x * MM + w.nx * 0.0008, (y0 + y1) / 2 * MM, mid.y * MM + w.ny * 0.0008);
        pm.rotation.y = Math.atan2(w.nx, w.ny);
        pm.receiveShadow = true;
        g.add(pm);
      }
    }
    // opening reveals, door leaves and windows
    for (const o of ops) addOpening(g, w, o, room);
    g.userData = { wall: w };
    roomGroup.add(g);
    v3.walls.push(g);
  }

  // ceiling
  const cg = new THREE.ShapeGeometry(new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x * MM, -p.y * MM)))); cg.rotateX(Math.PI / 2);
  const ceil = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ color: '#f6f5f2', side: THREE.DoubleSide }));
  ceil.position.y = H; ceil.visible = v3.ceiling; ceil.userData.ceiling = true; v3.ceilingMesh = ceil; roomGroup.add(ceil);
  // flip ceiling shape orientation (rotateX(+90) maps -y→-z; use positive y)
  cg.scale(1, 1, -1);

  const b = polyBounds(pts);
  v3.sun.position.set(b.cx * MM + 2.5, 5, b.cy * MM + 3.5);
  v3.sun.target.position.set(b.cx * MM, 0, b.cy * MM);
  const ext = Math.max(b.w, b.h) * MM;
  Object.assign(v3.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 0.5, far: 15 });
  v3.sun.shadow.camera.updateProjectionMatrix();
  v3.ceilingLight.position.set(b.cx * MM, H - 0.1, b.cy * MM);
  updateCutaway();
  requestRender();
}

function addOpening(g, w, o, room) {
  const T = room.thickness * MM;
  const t0 = o.offset, t1 = o.offset + o.width;
  const frameM = mat('#f4f4f2', { roughness: 0.5 });
  const along = (tt, n) => ({ x: (w.a.x + w.ux * tt) * MM - w.nx * n, z: (w.a.y + w.uy * tt) * MM - w.ny * n });
  const rotY = Math.atan2(w.nx, w.ny);
  const W = o.width * MM, H = o.height * MM, sill = o.sill * MM;
  const mid = along((t0 + t1) / 2, T / 2);
  const fr = new THREE.Group();
  fr.position.set(mid.x, 0, mid.z); fr.rotation.y = rotY;
  // in the frame group: x along wall, z = toward room (inward normal), wall spans z ∈ [−T/2, T/2]
  const ft = 0.04;
  const mk = (bw, bh, bd, x, y, z, m) => { const ms = new THREE.Mesh(boxGeo(bw, bh, bd), m); ms.position.set(x, y, z); ms.castShadow = true; fr.add(ms); };
  mk(ft, H, T + 0.01, -W / 2 + ft / 2, sill + H / 2, 0, frameM);
  mk(ft, H, T + 0.01, W / 2 - ft / 2, sill + H / 2, 0, frameM);
  mk(W, ft, T + 0.01, 0, sill + H - ft / 2, 0, frameM);
  if (o.type === 'window') {
    mk(W, ft, T + 0.05, 0, sill + ft / 2, 0.02, frameM);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(W - 2 * ft, H - 2 * ft), MATS.glass);
    gl.position.set(0, sill + H / 2, 0); fr.add(gl);
    mk(0.03, H - 2 * ft, 0.05, 0, sill + H / 2, 0, frameM);
  } else {
    const leafW = W - 2 * ft, leafH = H - ft;
    const leaf = new THREE.Group();
    const hingeStart = o.hinge !== 'right';
    const inward = o.swing !== 'out';
    const hx = hingeStart ? -W / 2 + ft : W / 2 - ft;
    leaf.position.set(hx, 0, inward ? T / 2 : -T / 2);
    const lm = new THREE.Mesh(boxGeo(leafW, leafH, 0.04), mat('#d9d4cc', { roughness: 0.5 }));
    lm.position.set(hingeStart ? leafW / 2 : -leafW / 2, leafH / 2, 0); lm.castShadow = true; leaf.add(lm);
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.02), MATS.chrome);
    knob.position.set(hingeStart ? leafW - 0.08 : -leafW + 0.08, 1.0, inward ? 0.035 : -0.035); leaf.add(knob);
    // open ~ 25°
    const a = 0.45 * (hingeStart ? 1 : -1) * (inward ? -1 : 1);
    leaf.rotation.y = a;
    fr.add(leaf);
  }
  g.add(fr);
}

function updateCutaway() {
  if (!v3.ready) return;
  const cam = v3.camera.position;
  const H = store.d.room.height * MM;
  for (const g of v3.walls) {
    const w = g.userData.wall;
    // camera outside this wall's inner face (on the −normal side) → hide it
    const side = (cam.x / MM - w.a.x) * w.nx + (cam.z / MM - w.a.y) * w.ny;
    g.visible = !(v3.cutaway && side < -10 && cam.y < H * 4);
  }
  // Built-out walls / boxing hide together with the room wall they're built against.
  for (const it of store.d.items) {
    if (modelOf(it)?.kind !== 'falsewall') continue;
    const g = itemMeshes.get(it.id);
    if (g) g.visible = !builtOutHidden(it, cam, H);
  }
  if (v3.ceilingMesh) v3.ceilingMesh.visible = v3.ceiling && v3.camera.position.y < H;
}
function builtOutHidden(it, cam, H) {
  if (!v3.cutaway) return false;
  const s = sizeOf(it);
  const back = toWorld(it, 0, -s.d / 2);
  for (const g of v3.walls) {
    const w = g.userData.wall;
    if (distToSeg(back, w.a, w.b).d < 30) return !g.visible;
  }
  // free-standing: hide when the camera is behind its back face
  const r = it.rot * Math.PI / 180, nx = -Math.sin(r), ny = Math.cos(r); // local +y (front) in plan
  const side = (cam.x / MM - back.x) * nx + (cam.z / MM - back.y) * ny;
  return side < -10 && cam.y < H * 4;
}
export function setCutaway(on) { v3.cutaway = on; updateCutaway(); requestRender(); }
export function setCeiling(on) { v3.ceiling = on; updateCutaway(); requestRender(); }

// ------------------------------------------------------------------ items
const itemMeshes = new Map();
const boxingSig = () => store.d.items.filter((o) => /falsewall|boxing|generic-box/.test(o.model)).map((o) => [o.x, o.y, o.rot, o.elev, o.custom]);
const itemSig = new Map();
export function rebuildItems() {
  if (!v3.ready) return;
  const { itemGroup } = v3;
  const seen = new Set();
  for (const it of store.d.items) {
    seen.add(it.id);
    const sig = JSON.stringify([it.model, it.size, it.variant, it.custom, it.cfg, it.niche, it.bespoke, store.d.room.wallColor, store.d.room.wallTile, it.model.includes('toilet') ? [it.x, it.y, it.rot, it.elev, boxingSig()] : 0, /basin/.test(it.model) ? hasTapOn(it) : 0]);
    let g = itemMeshes.get(it.id);
    if (!g || itemSig.get(it.id) !== sig) {
      if (g) { itemGroup.remove(g); g.traverse((c) => c.geometry?.dispose()); }
      g = buildItem(it);
      if (!g) continue;
      itemMeshes.set(it.id, g); itemSig.set(it.id, sig);
      itemGroup.add(g);
    }
    g.position.set(it.x * MM, it.elev * MM, it.y * MM);
    g.rotation.y = -it.rot * Math.PI / 180;
  }
  for (const [id, g] of itemMeshes) if (!seen.has(id)) { itemGroup.remove(g); g.traverse((c) => c.geometry?.dispose()); itemMeshes.delete(id); itemSig.delete(id); }
  updateCutaway();
  updateSelection();
  requestRender();
}

export function updateSelection() {
  if (!v3.ready) return;
  const s = store.sel;
  const g = s?.type === 'item' ? itemMeshes.get(s.id) : null;
  if (g) { g.updateMatrixWorld(true); v3.selBox.box.setFromObject(g); v3.selBox.visible = true; }
  else v3.selBox.visible = false;
  requestRender();
}

export function screenshot() {
  v3.renderer.render(v3.scene, v3.camera);
  return v3.renderer.domElement.toDataURL('image/png');
}
