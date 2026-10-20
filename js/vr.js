// WebXR walk-through (Meta Quest Browser, Apple Vision Pro Safari): stand in the room at real scale, point and pull the
// trigger (or look and pinch) to teleport, thumbstick left/right to snap-turn, A/X for the next room in the project.
// Vision Pro has no buttons, so it gets a floating ‹ room › switcher at waist height instead. View only.
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { store, switchRoom, activeRoom } from './state.js';
import { pointInPoly } from './geom.js';
import { AVATAR_LAYER } from './mirrors.js';

const MM = 0.001;
const SNAP = Math.PI / 6;
let v = null;          // the 3D view (v3)
let active = false;
const dolly = new THREE.Group();   // carries the headset camera + controllers around the room
const rig = { x: 0, z: 0, yaw: 0 };
let saved = null, turnLatch = [false, false], roomLatch = [false, false];
let startSpotFn = null, label = null, labelUntil = 0, avatar = null, switcher = null, switcherOn = false;
const ctrls = [];

export async function vrSupported() {
  try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')); } catch { return false; }
}

export function initVR(v3, startSpot) {
  v = v3; startSpotFn = startSpot;
  const { renderer, scene } = v;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.xr.setFoveation(1);

  // controllers: a pointer ray + a floor marker where a teleport would land
  const factory = new XRControllerModelFactory();
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.16, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#4aa3ff', transparent: true, opacity: 0.85, depthTest: false }));
  marker.visible = false; marker.renderOrder = 10; scene.add(marker);
  scene.add(dolly);
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: '#4aa3ff', transparent: true, opacity: 0.7 }));
    line.scale.z = 5; line.visible = false; c.add(line);
    c.userData = { line, aiming: false, hit: null, pressed: false, mode: null, btn: null };
    // what a press does is decided on the next frame, once the pointer's pose is known (Vision Pro's look-and-pinch
    // pointer only exists while pinching): on a switcher button it's a button press, anywhere else a teleport aim
    c.addEventListener('selectstart', () => { c.userData.pressed = true; c.userData.mode = null; c.userData.btn = null; });
    c.addEventListener('selectend', () => {
      const u = c.userData;
      if (u.mode === 'button' && u.btn) { u.btn.userData.press(); u.btn.scale.setScalar(1); }
      else if (u.mode === 'aim' && u.hit) teleport(u.hit);
      u.pressed = false; u.mode = null; u.btn = null; u.aiming = false; line.visible = false; marker.visible = false;
    });
    c.addEventListener('connected', (e) => { c.userData.handedness = e.data?.handedness; });
    dolly.add(c);
    const grip = renderer.xr.getControllerGrip(i);
    grip.add(factory.createControllerModel(grip));
    dolly.add(grip);
    ctrls.push(c);
  }
  v.vrMarker = marker;
  label = makeLabel(); scene.add(label);
  avatar = makeAvatar(); scene.add(avatar);
  switcher = makeSwitcher(); scene.add(switcher);

  renderer.xr.addEventListener('sessionstart', () => {
    // inside the room: every wall and the ceiling on, no selection box, lighter shadows
    saved = { cutaway: v.cutaway, ceiling: v.ceiling, shadow: v.sun.shadow.mapSize.x, cam: v.camera.position.clone(), target: v.controls.target.clone(), fov: v.camera.fov };
    active = true; avatar.visible = true;
    // Vision Pro: Safari on visionOS, or any look-and-pinch ("transient-pointer") input during the session
    switcherOn = isVisionOS();
    const session = renderer.xr.getSession();
    session?.addEventListener('inputsourceschange', (e) => { if ([...(e.added || [])].some((src) => src.targetRayMode === 'transient-pointer')) { switcherOn = true; refreshSwitcher(); } });
    switcher.userData.placed = false;
    dolly.add(v.camera);
    standAtStart();
    v.cutaway = false; v.ceiling = true;
    v.setVrMode?.(true);
    v.sun.shadow.mapSize.set(1024, 1024); v.sun.shadow.map?.dispose(); v.sun.shadow.map = null;
  });
  renderer.xr.addEventListener('sessionend', () => {
    active = false; avatar.visible = false;
    dolly.remove(v.camera);
    v.camera.quaternion.identity(); v.camera.scale.set(1, 1, 1);
    if (saved) {
      v.camera.position.copy(saved.cam); v.camera.fov = saved.fov; v.camera.updateProjectionMatrix();
      v.controls.target.copy(saved.target); v.controls.update();
      v.cutaway = saved.cutaway; v.ceiling = saved.ceiling;
      v.sun.shadow.mapSize.set(saved.shadow, saved.shadow); v.sun.shadow.map?.dispose(); v.sun.shadow.map = null;
    }
    v.setVrMode?.(false);
    marker.visible = false; label.visible = false; switcher.visible = false;
  });
}

function isVisionOS() {
  try { if (localStorage.getItem('bathroom-designer:vrSwitcher') === '1') return true; } catch { /* ignore */ }
  const ua = navigator.userAgent;
  // visionOS Safari reports a Mac user agent but has touch input; Macs can't run immersive WebXR
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1 && /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|Firefox|Edg/.test(ua);
}

export async function enterVR() {
  const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
  await v.renderer.xr.setSession(session);
}
export function exitVR() { v?.renderer.xr.getSession()?.end(); }

// The dolly puts the headset's floor origin at rig.x/z (metres), turned by rig.yaw.
function applyRig() {
  dolly.position.set(rig.x, 0, rig.z);
  dolly.rotation.set(0, rig.yaw, 0);
  dolly.updateMatrixWorld(true);
}

function standAtStart() {
  const s = startSpotFn();
  rig.x = s.x; rig.z = s.z; rig.yaw = Math.atan2(-(s.lookX - s.x), -(s.lookZ - s.z));
  applyRig();
  showRoomLabel();
}

// Jump to the next room in the project (the 3D view rebuilds from the store as usual).
function nextRoom(step = 1) {
  const rooms = store.project?.rooms || [];
  if (rooms.length < 2) return showRoomLabel();
  const i = rooms.findIndex((r) => r.id === store.project.active);
  switchRoom(rooms[(i + step + rooms.length) % rooms.length].id);
  standAtStart();
  refreshSwitcher();
  switcher.userData.placed = false; // re-place it in front of you in the new room
}

// Floating room switcher (Vision Pro): ‹ [room name] › on a small panel at waist height, following your facing.
function canvasPlane(w, h, px, draw) {
  const c = document.createElement('canvas'); c.width = px; c.height = Math.round(px * h / w);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  m.renderOrder = 21; m.userData.redraw = () => { draw(c.getContext('2d'), c.width, c.height); tex.needsUpdate = true; };
  m.userData.redraw();
  return m;
}
function makeSwitcher() {
  const g = new THREE.Group(); g.visible = false;
  const pill = (x, w, h) => { x.beginPath(); x.roundRect(4, 4, w - 8, h - 8, (h - 8) / 2); };
  const name = canvasPlane(0.34, 0.075, 680, (x, w, h) => {
    x.clearRect(0, 0, w, h); x.fillStyle = 'rgba(20,28,38,0.82)'; pill(x, w, h); x.fill();
    const rooms = store.project?.rooms || [], i = rooms.findIndex((r) => r.id === store.project?.active);
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '600 54px system-ui, sans-serif';
    x.fillText(activeRoom()?.name || 'Room', w / 2, h * 0.42);
    x.font = '30px system-ui, sans-serif'; x.fillStyle = '#b9c6d4';
    x.fillText(rooms.length > 1 ? `${i + 1} of ${rooms.length} · pinch ‹ › to change room` : 'Only one room in this project', w / 2, h * 0.78);
  });
  g.add(name);
  const button = (label, x0, press) => {
    const b = canvasPlane(0.075, 0.075, 160, (x, w, h) => {
      x.clearRect(0, 0, w, h); x.fillStyle = 'rgba(47,93,138,0.92)'; x.beginPath(); x.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '700 110px system-ui, sans-serif'; x.fillText(label, w / 2, h / 2 + 6);
    });
    b.position.x = x0; b.userData.press = press; b.userData.isButton = true; g.add(b); return b;
  };
  g.userData.buttons = [button('‹', -0.225, () => nextRoom(-1)), button('›', 0.225, () => nextRoom(1))];
  g.userData.name = name;
  return g;
}
function refreshSwitcher() { switcher?.userData.name.userData.redraw(); }
const _h = new THREE.Vector3(), _f2 = new THREE.Vector3(), _want = new THREE.Vector3();
function poseSwitcher() {
  switcher.visible = switcherOn;
  if (!switcherOn) return;
  const cam = v.renderer.xr.getCamera();
  _h.setFromMatrixPosition(cam.matrixWorld);
  _f2.set(0, 0, -1).transformDirection(cam.matrixWorld); _f2.y = 0;
  if (_f2.lengthSq() < 1e-6) return;
  _f2.normalize();
  _want.copy(_h).addScaledVector(_f2, 0.5); _want.y = Math.max(0.6, _h.y - 0.5);
  // stay put while you look around; catch up when you've walked or turned away from it
  const far = switcher.position.distanceTo(_want) > 0.45;
  if (!switcher.userData.placed || far) { switcher.position.copy(_want); switcher.userData.placed = true; }
  switcher.lookAt(_h.x, switcher.position.y + 0.25, _h.z);
}

// Floating name tag ~1.5 m ahead of the start spot for a few seconds.
function makeLabel() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  m.renderOrder = 20; m.visible = false; m.userData.canvas = c;
  return m;
}
function showRoomLabel() {
  const rooms = store.project?.rooms || [];
  const i = rooms.findIndex((r) => r.id === store.project?.active);
  const c = label.userData.canvas, x = c.getContext('2d');
  x.clearRect(0, 0, c.width, c.height);
  x.fillStyle = 'rgba(20,28,38,0.78)'; x.beginPath(); x.roundRect(8, 8, c.width - 16, c.height - 16, 40); x.fill();
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = '600 76px system-ui, sans-serif';
  x.fillText(activeRoom()?.name || 'Room', c.width / 2, 120);
  x.font = '44px system-ui, sans-serif'; x.fillStyle = '#b9c6d4';
  x.fillText(switcherOn ? (rooms.length > 1 ? `Room ${i + 1} of ${rooms.length} · pinch ‹ › below to change room` : 'Look at the floor and pinch to move') : rooms.length > 1 ? `Room ${i + 1} of ${rooms.length} · press A / X for the next room` : 'Trigger: teleport · Stick: turn', c.width / 2, 200);
  label.material.map.needsUpdate = true;
  const s = startSpotFn(), dx = s.lookX - s.x, dz = s.lookZ - s.z, L = Math.hypot(dx, dz) || 1, d = Math.min(1.5, L);
  label.position.set(s.x + dx / L * d, 1.75, s.z + dz / L * d);
  label.lookAt(s.x, 1.75, s.z);
  label.visible = true; labelUntil = performance.now() + 4000;
}

// A simple figure that follows the headset. It lives on AVATAR_LAYER, which only mirror cameras render, so
// you see yourself in mirrors without your own head blocking the view.
function makeAvatar() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: '#d9b49a', roughness: 0.7 });
  const hairM = new THREE.MeshStandardMaterial({ color: '#3b2f28', roughness: 0.9 });
  const shirt = new THREE.MeshStandardMaterial({ color: '#4f6d8a', roughness: 0.8 });
  const head = new THREE.Group(); head.name = 'head';
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.095, 24, 18), skin); skull.scale.set(0.88, 1.12, 1); head.add(skull);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.099, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM); hair.scale.set(0.9, 1.1, 1.02); hair.position.set(0, 0.012, 0.008); head.add(hair);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.035, 8), skin); nose.rotation.x = -Math.PI / 2; nose.position.set(0, -0.012, -0.1); head.add(nose);
  for (const sx of [-1, 1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), MATS_DARK); eye.position.set(sx * 0.032, 0.012, -0.088); head.add(eye); }
  g.add(head);
  const body = new THREE.Group(); body.name = 'body';
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 12), skin); neck.position.y = -0.13; body.add(neck);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.36, 6, 16), shirt); torso.scale.set(1.2, 1, 0.65); torso.position.y = -0.46; body.add(torso);
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.42, 4, 10), shirt); arm.position.set(sx * 0.22, -0.48, 0.01); arm.rotation.z = sx * 0.08; body.add(arm);
  }
  g.add(body);
  g.traverse((o) => o.layers.set(AVATAR_LAYER));
  g.visible = false;
  return g;
}
const MATS_DARK = new THREE.MeshBasicMaterial({ color: '#1d1f22' });
const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _f = new THREE.Vector3();
function poseAvatar() {
  const cam = v.renderer.xr.getCamera();
  cam.matrixWorld.decompose(_p, _q, _f);
  const head = avatar.getObjectByName('head'), body = avatar.getObjectByName('body');
  head.position.copy(_p); head.quaternion.copy(_q);
  // body follows the head's position and facing (yaw only)
  _f.set(0, 0, -1).applyQuaternion(_q); _f.y = 0;
  const yaw = _f.lengthSq() > 1e-6 ? Math.atan2(-_f.x, -_f.z) : 0;
  body.position.copy(_p);
  body.rotation.set(0, yaw, 0);
  body.translateZ(0.06); // neck sits a little behind the eyes
}

function headWorld() {
  const cam = v.renderer.xr.getCamera();
  return new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
}

// Move so the head (not the play-space centre) lands on the target point.
function teleport(p) {
  const h = headWorld();
  rig.x += p.x - h.x; rig.z += p.z - h.z;
  applyRig();
}
function turn(delta) {
  const h = headWorld();
  const dx = rig.x - h.x, dz = rig.z - h.z, c = Math.cos(delta), s = Math.sin(delta);
  rig.x = h.x + dx * c + dz * s; rig.z = h.z - dx * s + dz * c;
  rig.yaw += delta;
  applyRig();
}

const ray = new THREE.Raycaster();
const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmp = new THREE.Matrix4();

// Called every XR frame before rendering.
export function vrTick() {
  if (!active) return;
  const pts = store.d.room.pts;
  let aimed = null;
  poseSwitcher();
  for (const c of ctrls) {
    const u = c.userData;
    if (u.pressed && !u.mode) {
      tmp.identity().extractRotation(c.matrixWorld);
      ray.ray.origin.setFromMatrixPosition(c.matrixWorld);
      ray.ray.direction.set(0, 0, -1).applyMatrix4(tmp);
      const hitBtn = switcher.visible && ray.intersectObjects(switcher.userData.buttons, false)[0];
      if (hitBtn) { u.mode = 'button'; u.btn = hitBtn.object; u.btn.scale.setScalar(0.88); }
      else { u.mode = 'aim'; u.aiming = true; u.line.visible = true; }
    }
    if (!c.userData.aiming) { c.userData.hit = null; continue; }
    tmp.identity().extractRotation(c.matrixWorld);
    ray.ray.origin.setFromMatrixPosition(c.matrixWorld);
    ray.ray.direction.set(0, 0, -1).applyMatrix4(tmp);
    const p = new THREE.Vector3();
    const ok = ray.ray.intersectPlane(floor, p) && pointInPoly({ x: p.x / MM, y: p.z / MM }, pts);
    c.userData.hit = ok ? p : null;
    c.userData.line.scale.z = ok ? ray.ray.origin.distanceTo(p) : 5;
    if (ok) aimed = p;
  }
  v.vrMarker.visible = !!aimed;
  if (aimed) v.vrMarker.position.set(aimed.x, 0.005, aimed.z);

  if (label.visible && performance.now() > labelUntil) label.visible = false;
  poseAvatar();

  // snap turn on either thumbstick; A (right) / X (left) = next room
  const session = v.renderer.xr.getSession();
  let i = 0;
  for (const src of session?.inputSources || []) {
    const gp = src.gamepad;
    if (!gp) continue;
    const ax = gp.axes;
    if (ax?.length >= 4) {
      const x = ax[2];
      if (Math.abs(x) > 0.7 && !turnLatch[i]) { turnLatch[i] = true; turn(x > 0 ? -SNAP : SNAP); }
      else if (Math.abs(x) < 0.3) turnLatch[i] = false;
    }
    const a = !!gp.buttons?.[4]?.pressed;
    if (a && !roomLatch[i]) nextRoom();
    roomLatch[i] = a;
    i = Math.min(1, i + 1);
  }
}
