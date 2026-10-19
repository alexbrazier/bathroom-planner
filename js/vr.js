// WebXR walk-through (Meta Quest Browser etc.): stand in the room at real scale, point and pull the trigger to
// teleport, thumbstick left/right to snap-turn, A/X for the next room in the project. View only — edit on the desktop.
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
let startSpotFn = null, label = null, labelUntil = 0, avatar = null;
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
    c.userData = { line, aiming: false, hit: null };
    c.addEventListener('selectstart', () => { c.userData.aiming = true; line.visible = true; });
    c.addEventListener('selectend', () => {
      c.userData.aiming = false; line.visible = false; marker.visible = false;
      if (c.userData.hit) teleport(c.userData.hit);
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

  renderer.xr.addEventListener('sessionstart', () => {
    // inside the room: every wall and the ceiling on, no selection box, lighter shadows
    saved = { cutaway: v.cutaway, ceiling: v.ceiling, shadow: v.sun.shadow.mapSize.x, cam: v.camera.position.clone(), target: v.controls.target.clone(), fov: v.camera.fov };
    active = true; avatar.visible = true;
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
    marker.visible = false; label.visible = false;
  });
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
function nextRoom() {
  const rooms = store.project?.rooms || [];
  if (rooms.length < 2) return showRoomLabel();
  const i = rooms.findIndex((r) => r.id === store.project.active);
  switchRoom(rooms[(i + 1) % rooms.length].id);
  standAtStart();
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
  x.fillText(rooms.length > 1 ? `Room ${i + 1} of ${rooms.length} · press A / X for the next room` : 'Trigger: teleport · Stick: turn', c.width / 2, 200);
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
  for (const c of ctrls) {
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
