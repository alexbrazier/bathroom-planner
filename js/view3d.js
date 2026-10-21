// three.js 3D view of the design.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { store, select, itemById, emit, commit, modelOf, sizeOf } from './state.js';
import { wallsOf, outerPts, polyBounds, toWorld, distToSeg, slopeOf, ceilingAt, clipHalf, pointInPoly } from './geom.js';
import { buildItem, boxGeo, mat, MATS, tileTexture, hasTapOn } from './models3d.js';
import { placeItem, ridersOf, applyRiders } from './place.js';
import { initVR, vrTick } from './vr.js';
import { notesOf, noteAnchor, noteColor, noteView } from './notes.js';
import { addReflections, disposeGroup as disposeItem, reflectionsOn, setReflections as setRefl, showReflections } from './mirrors.js';

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

  // VR: walls and ceiling all on, no selection box while in the headset
  v3.setVrMode = (on) => {
    v3.vr = on;
    for (const g of v3.walls) g.visible = true;
    for (const g of itemMeshes.values()) g.visible = true;
    if (v3.ceilingMesh) v3.ceilingMesh.visible = on || v3.ceiling;
    if (on) selBox.visible = false;
    else { updateSelection(); resize(); updateCutaway(); requestRender(); }
    rebuildItems(); // mirrors use smaller reflection textures in the headset
  };
  initVR(v3, standSpot);

  new ResizeObserver(() => resize()).observe(container);
  resize();
  resetCamera();
  applySceneTheme();
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

  // WASD / QE walking: active while the pointer is over the 3D view, or the 3D view fills the screen.
  // Moves the camera and its orbit target together, level with the floor (Q/E go down/up); Shift = faster.
  const keys = new Set();
  const walkKeys = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, KeyQ: 1, KeyE: 1 };
  renderer.domElement.addEventListener('pointerenter', () => { v3.hover = true; });
  renderer.domElement.addEventListener('pointerleave', () => { v3.hover = false; });
  const walkActive = () => v3.hover || document.getElementById('layout')?.classList.contains('mode-3d');
  window.addEventListener('keydown', (e) => {
    if (!walkKeys[e.code] || e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, select, textarea') || !walkActive() || renderer.xr.isPresenting) return;
    keys.add(e.code); v3.walkFast = e.shiftKey;
    e.preventDefault(); e.stopImmediatePropagation(); // E would otherwise toggle Edit room
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); v3.walkFast = e.shiftKey; });
  window.addEventListener('blur', () => keys.clear());
  let lastT = performance.now();
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();
  const walk = (dt) => {
    const k = (c) => (keys.has(c) ? 1 : 0);
    const f = k('KeyW') - k('KeyS'), r = k('KeyD') - k('KeyA'), u = k('KeyE') - k('KeyQ');
    if (!f && !r && !u) return false;
    camera.getWorldDirection(fwd); fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); // looking straight down: walk "up" the screen
    fwd.normalize();
    right.crossVectors(fwd, camera.up).normalize();
    const speed = (v3.walkFast ? 3.5 : 1.4) * Math.min(dt, 0.1);
    move.set(0, 0, 0).addScaledVector(fwd, f * speed).addScaledVector(right, r * speed);
    move.y += u * speed * 0.8;
    camera.position.add(move); controls.target.add(move);
    return true;
  };

  renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = (now - lastT) / 1000; lastT = now;
    if (renderer.xr.isPresenting) { vrTick(); showReflections(true); showOutside(true); renderer.render(scene, camera); return; }
    if (!container.offsetParent) return;
    if (keys.size && walk(dt)) { controls.update(); updateCutaway(); v3.dirty = true; }
    if (controls.update() || v3.dirty) {
      v3.dirty = false;
      const c = camera.position, room = store.d.room;
      const inside = c.y > 0 && c.y * 1000 < ceilingAt(room, c.x * 1000, c.z * 1000) && pointInPoly({ x: c.x * 1000, y: c.z * 1000 }, room.pts);
      showReflections(inside);
      showOutside(inside);
      renderer.render(scene, camera);
    }
  });
}

export function requestRender() { v3.dirty = true; }
// Background follows the light/dark theme (CSS --view3d).
export function applySceneTheme() {
  if (!v3.ready) return;
  const c = getComputedStyle(document.documentElement).getPropertyValue('--view3d').trim() || '#dfe3e8';
  v3.scene.background = new THREE.Color(c);
  requestRender();
}

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
  // pull back on tall/narrow views (phones in portrait) so the whole room fits
  const k = Math.min(1.7, Math.max(1, 0.8 / (v3.camera.aspect || 1)));
  v3.camera.position.set(cx + size * 0.55 * k, 0.9 + (size * 1.25 + 0.3) * k, cz + (size * 1.15 + 0.8) * k);
  v3.camera.fov = 50; v3.camera.updateProjectionMatrix();
  v3.controls.update(); updateCutaway(); requestRender();
}
// Render a room at w × h px and return it as a JPEG data URL, leaving the live view as it was. The room on screen
// is shot from the current camera; any other design (e.g. another room in the project for a PDF) is swapped in
// only for the shot and gets the standard overview.
export function snapshot3D(design, w, h) {
  if (!v3.ready) return '';
  const { renderer, camera, controls, scene } = v3;
  const saved = { d: store.d, sel: store.sel, pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov, aspect: camera.aspect, pr: renderer.getPixelRatio(), size: renderer.getSize(new THREE.Vector2()), bg: scene.background };
  const other = design !== store.d;
  try {
    store.d = design; store.sel = null;
    if (other) { rebuildRoom(); rebuildItems(); }
    v3.selBox.visible = false;
    renderer.setPixelRatio(1); renderer.setSize(w, h, false);
    camera.aspect = w / h;
    if (other) resetCamera();
    else if (w / h < saved.aspect) {
      // the current view, widened vertically so a narrower page doesn't crop its sides
      camera.fov = 2 * Math.atan(Math.tan(saved.fov * Math.PI / 360) * saved.aspect / (w / h)) * 180 / Math.PI;
    }
    camera.updateProjectionMatrix();
    scene.background = new THREE.Color('#ffffff');
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/jpeg', 0.9);
  } finally {
    store.d = saved.d; store.sel = saved.sel; scene.background = saved.bg;
    renderer.setPixelRatio(saved.pr); renderer.setSize(saved.size.x, saved.size.y, false);
    camera.aspect = saved.aspect; camera.fov = saved.fov; camera.position.copy(saved.pos); controls.target.copy(saved.target);
    camera.updateProjectionMatrix(); controls.update();
    if (other) { rebuildRoom(); rebuildItems(); }
    updateSelection(); updateCutaway(); requestRender();
  }
}

// Where to stand (metres): just inside the door if there is one, else near the "front" wall, looking across the room.
export function standSpot() {
  const b = polyBounds(store.d.room.pts);
  const walls = wallsOf(store.d.room.pts);
  const door = store.d.openings.find((o) => o.type === 'door');
  let px = b.cx, py = b.y1 - 300;
  if (door && walls[door.wall]) { const w = walls[door.wall]; const t = door.offset + door.width / 2; px = w.a.x + w.ux * t + w.nx * 250; py = w.a.y + w.uy * t + w.ny * 250; }
  return { x: px * MM, z: py * MM, lookX: b.cx * MM, lookZ: b.cy * MM };
}
export function eyeLevel() {
  const s = standSpot();
  v3.camera.position.set(s.x, 1.6, s.z);
  v3.controls.target.set(s.lookX, 1.2, s.lookZ);
  v3.camera.fov = 70; v3.camera.updateProjectionMatrix();
  v3.controls.update(); updateCutaway(); requestRender();
}

// ------------------------------------------------------------------ notes
// A coloured pin at each note with a floating "n · text" label (also in VR). Rebuilt when notes or their anchors change.
let notesGroup = null, notesKey = '';
function noteLabel(n) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 96;
  const x = c.getContext('2d'), col = noteColor(n);
  const t = (n.text || '').length > 34 ? n.text.slice(0, 33) + '…' : (n.text || '');
  x.font = '600 40px system-ui, sans-serif';
  const w = Math.min(1016, 110 + (t ? x.measureText(t).width + 28 : 0));
  x.fillStyle = 'rgba(255,255,255,0.95)'; x.beginPath(); x.roundRect(4, 8, w, 80, 40); x.fill();
  x.fillStyle = col; x.beginPath(); x.arc(48, 48, 34, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(n.n), 48, 50);
  x.textAlign = 'left'; x.fillStyle = n.resolved ? '#8c939b' : '#25292e'; x.fillText(t, 96, 50);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.center.set(0, 0.5); sp.scale.set(0.06 * (c.width / c.height), 0.06, 1); sp.renderOrder = 30; // keep the canvas aspect
  return sp;
}
function updateNotes() {
  const d = store.d;
  const list = noteView.show ? notesOf(d).filter((n) => !(noteView.hideResolved && n.resolved)) : [];
  const anchors = list.map((n) => noteAnchor(n, d));
  const key = JSON.stringify([list.map((n) => [n.id, n.n, n.text, n.type, n.resolved]), anchors.map((a) => [Math.round(a.x), Math.round(a.y), Math.round(a.z)])]);
  if (key === notesKey && notesGroup) return;
  notesKey = key;
  if (notesGroup) { v3.scene.remove(notesGroup); notesGroup.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); }); }
  notesGroup = new THREE.Group();
  list.forEach((n, i) => {
    const a = anchors[i], col = noteColor(n);
    const pin = new THREE.Group(); pin.position.set(a.x * MM, a.z * MM, a.y * MM);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 14), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, roughness: 0.4 }));
    head.position.y = 0.11; pin.add(head);
    const stalk = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.09, 12), head.material); stalk.rotation.x = Math.PI; stalk.position.y = 0.06; pin.add(stalk);
    const lab = noteLabel(n); lab.position.set(0.045, 0.11, 0); pin.add(lab);
    notesGroup.add(pin);
  });
  v3.scene.add(notesGroup);
  requestRender();
}

// ------------------------------------------------------------------ view outside the windows
// A 360° photo (CC0, Poly Haven) on a big sphere around the room, seen through the windows with real perspective.
// Only shown when the camera is inside the room (from an orbit view it would wall everything in).
export const VIEWS = [
  { id: 'garden_nook', label: 'Garden' },
  { id: 'stuttgart_suburbs', label: 'Suburban street' },
  { id: 'evening_meadow', label: 'Countryside' },
  { id: 'zawiszy_czarnego', label: 'Town street' },
  { id: 'none', label: 'None (plain sky)' },
];
const viewTex = new Map();
let outside = null, outsideKey = '';
// Obscure glass: real transmission with a high roughness, so whatever is behind it (the view outside, or the room
// from outside) shows through heavily blurred and still shifts with parallax as you move.
function frostedGlass() {
  const k = '__frostWin';
  if (!viewTex.has(k)) viewTex.set(k, new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 1, roughness: 0.6, thickness: 0.006, ior: 1.5, metalness: 0, side: THREE.DoubleSide }));
  return viewTex.get(k);
}
export function outsideOf(room) {
  const o = room.outside || {};
  return { view: o.view || 'garden_nook', level: o.level || 0, turn: o.turn || 0 };
}
function updateOutside() {
  const room = store.d.room, o = outsideOf(room);
  const b = polyBounds(room.pts);
  const key = JSON.stringify([o, b.cx, b.cy]);
  if (key === outsideKey) return;
  outsideKey = key;
  if (!outside) {
    outside = new THREE.Mesh(new THREE.SphereGeometry(40, 64, 32), new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthWrite: false, toneMapped: false }));
    outside.renderOrder = -1; outside.visible = false;
    v3.scene.add(outside);
  }
  outside.position.set(b.cx * MM, 1.6 - o.level * 2.8, b.cy * MM);  // panorama eye ~1.6 m above its ground
  outside.rotation.y = -o.turn * Math.PI / 180;
  if (o.view === 'none') { outside.material.map = null; outside.material.color.set('#cfe0ee'); outside.material.needsUpdate = true; return; }
  outside.material.color.set('#ffffff');
  let tex = viewTex.get(o.view);
  if (!tex) {
    tex = new THREE.TextureLoader().load(`data/views/${o.view}.jpg`, () => requestRender());
    tex.colorSpace = THREE.SRGBColorSpace; tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.anisotropy = 4;
    viewTex.set(o.view, tex);
  }
  // equirect on the inside of a sphere: flip horizontally so it isn't mirrored
  tex.wrapS = THREE.RepeatWrapping; tex.repeat.x = -1;
  outside.material.map = tex; outside.material.needsUpdate = true;
}
function showOutside(on) {
  const hasWindow = store.d.openings.some((op) => op.type === 'window');
  if (outside) outside.visible = on && hasWindow;
  // hallways behind internal doors: only from inside, otherwise they'd stick out of the room in the overview
  for (const h of v3.hallways || []) h.visible = on;
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
  v3.lastNiche = nicheSignature();
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
  const shell = new THREE.MeshStandardMaterial({ color: '#d8d6d1', roughness: 0.95, side: THREE.DoubleSide }); // double-sided so a sloped cut through the wall reads as solid
  const topMat = new THREE.MeshStandardMaterial({ color: '#4a4f57', roughness: 0.9 });

  v3.walls = [];
  const n = pts.length;
  for (const w of walls) {
    const g = new THREE.Group();
    const ops = store.d.openings.filter((o) => o.wall === w.i).sort((a, b) => a.offset - b.offset);
    // Split the wall into vertical strips at door/window/niche edges; each strip is stacked from
    // full-depth pieces, nothing (doors/windows) and recessed pieces (niches).
    const nis = nichesOnWall(w, room);
    const ts = new Set([0, w.len]);
    for (const o of ops) { ts.add(Math.max(0, Math.min(w.len, o.offset))); ts.add(Math.max(0, Math.min(w.len, o.offset + o.width))); }
    for (const ni of nis) { ts.add(ni.t0); ts.add(ni.t1); }
    const tl = [...ts].sort((x, y) => x - y);
    const cuts = [];
    for (let k = 0; k < tl.length - 1; k++) {
      const t0 = tl[k], t1 = tl[k + 1], tm = (t0 + t1) / 2;
      if (t1 - t0 < 0.5) continue;
      const op = ops.find((o) => o.offset <= tm && o.offset + o.width >= tm);
      const here = nis.filter((ni) => ni.t0 <= tm && ni.t1 >= tm);
      const ys = new Set([0, room.height]);
      if (op) { ys.add(op.sill); ys.add(Math.min(room.height, op.sill + op.height)); }
      for (const ni of here) { ys.add(ni.y0); ys.add(ni.y1); }
      const yl = [...ys].filter((y) => y >= 0 && y <= room.height).sort((x, y) => x - y);
      for (let j = 0; j < yl.length - 1; j++) {
        const y0 = yl[j], y1 = yl[j + 1], ym = (y0 + y1) / 2;
        if (op && ym > op.sill && ym < op.sill + op.height) continue;
        const ni = here.find((n2) => ym > n2.y0 && ym < n2.y1);
        const last = cuts[cuts.length - 1];
        const depth = ni ? ni.depth : 0;
        if (last && last.t0 === t0 && last.y1 === y0 && last.depth === depth) last.y1 = y1;
        else cuts.push({ t0, t1, y0, y1, depth });
      }
    }
    const qa = outer[w.i], qb = outer[(w.i + 1) % n];
    const innerAt = (tt, dd = 0) => ({ x: w.a.x + w.ux * tt - w.nx * dd, y: w.a.y + w.uy * tt - w.ny * dd });
    const outerAt = (tt) => tt <= 0 ? qa : tt >= w.len ? qb : { x: w.a.x + w.ux * tt - w.nx * room.thickness, y: w.a.y + w.uy * tt - w.ny * room.thickness };
    for (const c of cuts) {
      if (c.y1 - c.y0 < 0.5 || c.t1 - c.t0 < 0.5) continue;
      const quad = [innerAt(c.t0, c.depth), innerAt(c.t1, c.depth), outerAt(c.t1), outerAt(c.t0)];
      const sh = new THREE.Shape(quad.map((p) => new THREE.Vector2(p.x * MM, p.y * MM)));
      const geo = new THREE.ExtrudeGeometry(sh, { depth: (c.y1 - c.y0) * MM, bevelEnabled: false });
      geo.rotateX(Math.PI / 2); geo.translate(0, c.y1 * MM, 0);
      const mesh = new THREE.Mesh(geo, [topMat, shell]); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
      if (c.depth) continue; // the niche item finishes its own recess
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

  // ceiling: flat, or a sloped part from the low wall up to full height plus the flat remainder.
  // A sloped ceiling also clips everything above it (walls, built-out walls, anything too tall for the roof).
  const slope = slopeOf(room);
  const ceil = new THREE.Group();
  const ceilMat = new THREE.MeshStandardMaterial({ color: '#f6f5f2', side: THREE.DoubleSide });
  const ceilPart = (poly) => {
    if (poly.length < 3) return;
    const g = new THREE.ShapeGeometry(new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x * MM, p.y * MM))));
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getY(i);
      pos.setXYZ(i, x, ceilingAt(room, x / MM, z / MM) * MM - 0.001, z);
    }
    g.computeVertexNormals();
    ceil.add(new THREE.Mesh(g, ceilMat));
  };
  if (slope) {
    // extend the sloped part over the wall tops so the roof reads as one surface from outside
    ceilPart(clipHalf(outer, slope.w.a, -slope.w.nx, -slope.w.ny, -slope.run));
    ceilPart(clipHalf(pts, slope.w.a, slope.w.nx, slope.w.ny, slope.run));
  } else ceilPart(pts);
  ceil.visible = v3.ceiling; ceil.userData.ceiling = true; v3.ceilingMesh = ceil; roomGroup.add(ceil);
  if (slope) {
    // keep where y <= low + k·d  (d = distance in from the low wall, metres)
    const { w, low, k } = slope;
    const plane = new THREE.Plane(new THREE.Vector3(k * w.nx, -1, k * w.ny), (low - k * (w.a.x * w.nx + w.a.y * w.ny)) * MM);
    plane.normalize();
    v3.renderer.clippingPlanes = [plane];
  } else v3.renderer.clippingPlanes = [];

  const b = polyBounds(pts);
  v3.sun.position.set(b.cx * MM + 2.5, 5, b.cy * MM + 3.5);
  v3.sun.target.position.set(b.cx * MM, 0, b.cy * MM);
  const ext = Math.max(b.w, b.h) * MM;
  Object.assign(v3.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 0.5, far: 15 });
  v3.sun.shadow.camera.updateProjectionMatrix();
  v3.ceilingLight.position.set(b.cx * MM, ceilingAt(room, b.cx, b.cy) * MM - 0.1, b.cy * MM);
  v3.hallways = [];
  roomGroup.traverse((o) => { if (o.isGroup && o.userData.hallway) { o.visible = false; v3.hallways.push(o); } });
  updateOutside();
  updateCutaway();
  requestRender();
}

// Niche items whose front face sits on this wall's inner face (they recess into the wall).
function nichesOnWall(w, room) {
  const out = [];
  for (const it of store.d.items) {
    if (modelOf(it)?.kind !== 'niche') continue;
    const s = sizeOf(it);
    const f = toWorld(it, 0, s.d / 2);
    const off = (f.x - w.a.x) * w.nx + (f.y - w.a.y) * w.ny;
    const r = it.rot * Math.PI / 180;
    const facing = -Math.sin(r) * w.nx + Math.cos(r) * w.ny; // item front (+y) should face into the room
    if (Math.abs(off) > 20 || facing < 0.98) continue;
    const t = (f.x - w.a.x) * w.ux + (f.y - w.a.y) * w.uy;
    const t0 = Math.max(0, t - s.w / 2), t1 = Math.min(w.len, t + s.w / 2);
    if (t1 - t0 < 10) continue;
    out.push({ t0, t1, y0: Math.max(0, it.elev), y1: Math.min(room.height, it.elev + s.h), depth: Math.min(s.d, room.thickness - 15) });
  }
  return out;
}
export const nicheSignature = () => JSON.stringify(store.d.items.filter((o) => modelOf(o)?.kind === 'niche').map((o) => [o.x, o.y, o.rot, o.elev, sizeOf(o).w, sizeOf(o).d, sizeOf(o).h]));

// Vertical sliding sash: the upper sash sits on the outside track and the lower sash on the inside, overlapping at
// the meeting rails. Glazing bars per sash: '1' (1 over 1), '2' (2 over 2), '6' (6 over 6, Georgian).
// 'half' glass = frosted lower sash.
function sashWindow(o, W, H, sill, ft, mk, frameM, fr) {
  const iw = W - 2 * ft, ih = H - 2 * ft, y0 = sill + ft, half = ih / 2;
  const meet = 0.035, sf = 0.05, topR = 0.05, botR = 0.075;
  const [cols, rows] = { 2: [2, 1], 6: [3, 2] }[o.bars] || [1, 1];
  const sash = (ya, yb, z, lower) => {
    const rb = lower ? botR : meet, rt = lower ? meet : topR, h = yb - ya, sh = h - rb - rt;
    mk(iw, rb, 0.045, 0, ya + rb / 2, z, frameM);
    mk(iw, rt, 0.045, 0, yb - rt / 2, z, frameM);
    mk(sf, sh, 0.045, -iw / 2 + sf / 2, ya + rb + sh / 2, z, frameM);
    mk(sf, sh, 0.045, iw / 2 - sf / 2, ya + rb + sh / 2, z, frameM);
    const gw = iw - 2 * sf, gy = ya + rb + sh / 2;
    const glassM = o.glass === 'frosted' || (o.glass === 'half' && lower) ? frostedGlass() : MATS.glass;
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(gw, sh), glassM); gl.position.set(0, gy, z); fr.add(gl);
    for (let c = 1; c < cols; c++) mk(0.02, sh, 0.03, -gw / 2 + (gw * c) / cols, gy, z, frameM);
    for (let r = 1; r < rows; r++) mk(gw, 0.02, 0.03, 0, ya + rb + (sh * r) / rows, z, frameM);
  };
  const zOut = -0.012, zIn = 0.03;
  sash(y0 + half - meet / 2, y0 + ih, zOut, false); // upper sash, outer track
  sash(y0, y0 + half + meet / 2, zIn, true);        // lower sash, inner track
  // fitch catch on the meeting rail and two sash lifts on the lower sash's bottom rail
  mk(0.07, 0.012, 0.035, 0, y0 + half + meet / 2 + 0.006, zIn - 0.005, MATS.chrome);
  for (const sx of [-1, 1]) {
    mk(0.035, 0.012, 0.012, sx * iw * 0.3, y0 + botR * 0.55, zIn + 0.028, MATS.chrome);
    mk(0.035, 0.022, 0.006, sx * iw * 0.3, y0 + botR * 0.55 - 0.012, zIn + 0.034, MATS.chrome);
  }
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
    // internal window board, 35 mm proud of the wall face
    const bd = T / 2 + 0.035;
    mk(W + 0.08, 0.022, bd, 0, sill - 0.011, bd / 2, mat('#f7f7f5', { roughness: 0.45 }));
    if (o.style === 'sash') sashWindow(o, W, H, sill, ft, mk, frameM, fr);
    else {
    // casement sashes (2 if wide enough) with clear or frosted (obscure) glass and a lever handle each
    const panes = o.panes || (W > 0.75 ? 2 : 1);
    const iw = W - 2 * ft, ih = H - 2 * ft, pw = iw / panes, sf = 0.045, y0 = sill + ft;
    // glass: 'clear', 'frosted' (obscure) or 'half' (obscure bottom half, clear top)
    for (let i = 0; i < panes; i++) {
      const cx = -iw / 2 + pw * (i + 0.5);
      mk(pw - 0.004, sf, 0.06, cx, y0 + sf / 2, 0, frameM);
      mk(pw - 0.004, sf, 0.06, cx, y0 + ih - sf / 2, 0, frameM);
      mk(sf, ih - 2 * sf, 0.06, cx - pw / 2 + sf / 2 + 0.002, y0 + ih / 2, 0, frameM);
      mk(sf, ih - 2 * sf, 0.06, cx + pw / 2 - sf / 2 - 0.002, y0 + ih / 2, 0, frameM);
      const gw = pw - 2 * sf, gh = ih - 2 * sf;
      const pane = (h, y, m) => { const gl = new THREE.Mesh(new THREE.PlaneGeometry(gw, h), m); gl.position.set(cx, y, 0); fr.add(gl); };
      if (o.glass === 'half') { pane(gh / 2, y0 + sf + gh / 4, frostedGlass()); pane(gh / 2, y0 + sf + gh * 0.75, MATS.glass); }
      else pane(gh, y0 + ih / 2, o.glass === 'frosted' ? frostedGlass() : MATS.glass);
      // handle on the closing edge (towards the middle for a pair), room side
      const hx = panes === 1 ? cx + pw / 2 - sf / 2 : i < panes / 2 ? cx + pw / 2 - sf / 2 : cx - pw / 2 + sf / 2;
      const hy = y0 + Math.min(ih / 2, 0.55);
      mk(0.022, 0.05, 0.012, hx, hy, 0.036, MATS.chrome);
      mk(0.014, 0.012, 0.03, hx, hy - 0.018, 0.05, MATS.chrome);
      mk(0.014, 0.1, 0.012, hx, hy - 0.07, 0.062, MATS.chrome);
    }
    }
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
    // what's beyond the door: a short hallway (default) instead of the outdoor view, unless it leads outside
    if (o.to !== 'outside') {
      const hw = W + 0.9, hd = 1.4, hh = Math.min(room.height * MM, 2.6);
      const wallM = new THREE.MeshStandardMaterial({ color: '#ece8e1', roughness: 0.95, side: THREE.BackSide });
      const ceilM = new THREE.MeshStandardMaterial({ color: '#f7f6f3', roughness: 0.95, side: THREE.BackSide });
      const floorM = new THREE.MeshStandardMaterial({ color: '#b39572', roughness: 0.7, side: THREE.BackSide });
      // box faces: +x, −x, +y (ceiling), −y (floor), +z, −z — back-face only, so the side facing the room is never drawn
      const hall = new THREE.Mesh(new THREE.BoxGeometry(hw, hh, hd), [wallM, wallM, ceilM, floorM, wallM, wallM]);
      hall.position.set(0, hh / 2, -T / 2 - hd / 2 - 0.001);
      hall.receiveShadow = true;
      hall.userData.hallway = true;
      // skirting along the back wall
      const sk = new THREE.Mesh(boxGeo(hw, 0.08, 0.015), mat('#f4f3ef'));
      sk.position.set(0, 0.04, -T / 2 - hd + 0.008);
      const hallG = new THREE.Group(); hallG.add(hall, sk); hallG.userData.hallway = true;
      fr.add(hallG);
    }
  }
  g.add(fr);
}

function updateCutaway() {
  if (!v3.ready || v3.vr) return;
  const cam = v3.camera.position;
  const H = store.d.room.height * MM;
  for (const g of v3.walls) {
    const w = g.userData.wall;
    // camera outside this wall's inner face (on the −normal side) → hide it
    const side = (cam.x / MM - w.a.x) * w.nx + (cam.z / MM - w.a.y) * w.ny;
    g.visible = !(v3.cutaway && side < -10 && cam.y < H * 8);
  }
  // Built-out walls / boxing hide together with the room wall they're built against; niches with their host.
  const hidden = new Map();
  for (const it of store.d.items) {
    if (modelOf(it)?.kind !== 'falsewall') continue;
    const h = builtOutHidden(it, cam, H); hidden.set(it.id, h);
    const g = itemMeshes.get(it.id);
    if (g) g.visible = !h;
  }
  for (const it of store.d.items) {
    if (modelOf(it)?.kind !== 'niche' && !modelOf(it)?.recessed) continue;
    const g = itemMeshes.get(it.id); if (!g) continue;
    g.visible = !nicheHidden(it, hidden);
  }
  if (v3.ceilingMesh) v3.ceilingMesh.visible = v3.ceiling && v3.camera.position.y < H;
}
function nicheHidden(it, fwHidden) {
  if (!v3.cutaway) return false;
  const s = sizeOf(it);
  const f = toWorld(it, 0, s.d / 2);
  for (const g of v3.walls) { const w = g.userData.wall; if (distToSeg(f, w.a, w.b).d < 25) return !g.visible; }
  for (const fw of store.d.items) {
    if (!fwHidden.has(fw.id)) continue;
    const fs = sizeOf(fw);
    if (distToSeg(f, toWorld(fw, -fs.w / 2, fs.d / 2), toWorld(fw, fs.w / 2, fs.d / 2)).d < 25) return fwHidden.get(fw.id);
  }
  return false;
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
  return side < -10 && cam.y < H * 8;
}
export function setCutaway(on) { v3.cutaway = on; updateCutaway(); requestRender(); }
export function setReflections(on) { setRefl(on); rebuildItems(); }
export function setCeiling(on) { v3.ceiling = on; updateCutaway(); requestRender(); }

// ------------------------------------------------------------------ items
const itemMeshes = new Map();
const boxingSig = () => store.d.items.filter((o) => /falsewall|boxing|generic-box|worktop/.test(o.model)).map((o) => [o.x, o.y, o.rot, o.elev, o.custom]);
const itemSig = new Map();
export function rebuildItems() {
  if (!v3.ready) return;
  // niches cut into room walls: rebuild the walls when they move or resize
  const ns = nicheSignature();
  if (ns !== v3.lastNiche) rebuildRoom();
  const { itemGroup } = v3;
  const seen = new Set();
  for (const it of store.d.items) {
    seen.add(it.id);
    const sig = JSON.stringify([reflectionsOn(), !!v3.vr, it.model, it.size, it.variant, it.custom, it.cfg, it.niche, it.bespoke, store.d.room.wallColor, store.d.room.wallTile, it.model.includes('toilet') ? [it.x, it.y, it.rot, it.elev, boxingSig()] : 0, /basin/.test(it.model) ? hasTapOn(it) : 0, /wetroom-panel/.test(it.model) || modelOf(it)?.kind === 'bath' ? [it.x, it.y, it.rot, store.d.room.pts] : 0, /falsewall|boxing/.test(it.model) ? v3.lastNiche : 0, /showerhead|overhead/.test(it.model) ? [it.elev, store.d.room.height] : 0]);
    let g = itemMeshes.get(it.id);
    if (!g || itemSig.get(it.id) !== sig) {
      if (g) { itemGroup.remove(g); disposeItem(g); }
      g = buildItem(it);
      if (!g) continue;
      addReflections(g, !!v3.vr);
      itemMeshes.set(it.id, g); itemSig.set(it.id, sig);
      itemGroup.add(g);
    }
    g.position.set(it.x * MM, it.elev * MM, it.y * MM);
    g.rotation.y = -it.rot * Math.PI / 180;
  }
  for (const [id, g] of itemMeshes) if (!seen.has(id)) { itemGroup.remove(g); disposeItem(g); itemMeshes.delete(id); itemSig.delete(id); }
  updateNotes();
  updateCutaway();
  updateSelection();
  requestRender();
}

export function updateSelection() {
  if (!v3.ready || v3.vr) return;
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
