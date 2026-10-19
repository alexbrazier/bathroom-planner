// Real mirror reflections: flat mirror faces (MATS.mirror) are swapped for three.js Reflectors, which re-render
// the room from the mirrored viewpoint each frame (per eye in VR). Layer AVATAR_LAYER holds things that should
// only show up in reflections (the VR avatar).
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { MATS } from './models3d.js';

export const AVATAR_LAYER = 10;
let enabled = true;
try { enabled = localStorage.getItem('bathroom-designer:reflections') !== 'off'; } catch { /* ignore */ }
let busy = false; // a reflection never renders other reflections (mirrors facing each other would recurse)
const live = new Map(); // reflector → its plain mirror face (shown instead when viewed from outside the room)

export const reflectionsOn = () => enabled;
export function setReflections(on) {
  enabled = on;
  try { localStorage.setItem('bathroom-designer:reflections', on ? 'on' : 'off'); } catch { /* ignore */ }
}

// Replace the mirror faces inside an item's group. Texture resolution follows the mirror's size (capped),
// lower in VR where each mirror is rendered twice a frame.
export function addReflections(group, vr = false) {
  if (!enabled) return;
  const mirrorMat = MATS.mirror;
  const faces = [];
  group.traverse((o) => { if (o.isMesh && o.material === mirrorMat && o.geometry) faces.push(o); });
  for (const face of faces) {
    face.geometry.computeBoundingBox();
    const bb = face.geometry.boundingBox;
    const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y;
    if (w < 0.08 || h < 0.08) continue;
    const ppm = vr ? 700 : 1000, cap = vr ? 768 : 1024;
    const tw = Math.max(128, Math.min(cap, Math.round(w * ppm))), th = Math.max(128, Math.min(cap, Math.round(h * ppm)));
    const r = new Reflector(face.geometry, { textureWidth: tw, textureHeight: th, clipBias: 0.003, color: 0xc8ced3, multisample: vr ? 0 : 4 });
    r.camera.layers.enable(AVATAR_LAYER);
    r.position.copy(face.position); r.quaternion.copy(face.quaternion); r.scale.copy(face.scale);
    r.userData = { ...face.userData, reflector: true };
    const render = r.onBeforeRender;
    r.onBeforeRender = function (...args) {
      if (busy) return;
      busy = true;
      try { render.apply(this, args); } finally { busy = false; }
    };
    // keep the plain mirror face as a fallback for views from outside the room (see showReflections)
    face.visible = false;
    face.parent.add(r);
    live.set(r, face);
  }
}

// Free a group's GPU resources, including reflector render targets.
export function disposeGroup(g) {
  g.traverse((c) => { c.geometry?.dispose(); if (c.isReflector) { c.dispose(); live.delete(c); } });
}

// Reflections only make sense from inside the room; from an orbit view outside, the mirrored camera would look at
// the back of the walls. Outside, show the plain mirror finish instead.
export function showReflections(on) {
  for (const [r, face] of live) { r.visible = on; face.visible = !on; }
}
