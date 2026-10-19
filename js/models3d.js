// Procedural 3D models built from exact product dimensions.
// Local frame: origin at footprint centre, y=0 at the item's bottom, x along width, z along depth (back at −d/2).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WOOD, STONE } from './catalog.js';
import { sizeOf, modelOf, coloursOf, cfgOf, colourName, store, nicheOf } from './state.js';
import { itemCorners, pointInPoly, toWorld, toLocal, rayToWalls } from './geom.js';

const MM = 0.001;
const matCache = new Map();
const texCache = new Map();

// ------------------------------------------------------------------ textures
function woodTexture(hex) {
  const key = 'wood' + hex;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  const base = new THREE.Color(hex);
  g.fillStyle = '#' + base.getHexString(); g.fillRect(0, 0, c.width, c.height);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    const y = rnd() * c.height, amp = 2 + rnd() * 8, f = 0.002 + rnd() * 0.006, ph = rnd() * 6;
    const col = base.clone().offsetHSL(0, 0, (rnd() - 0.55) * 0.12);
    g.strokeStyle = '#' + col.getHexString(); g.globalAlpha = 0.25 + rnd() * 0.45; g.lineWidth = 0.6 + rnd() * 2.2;
    g.beginPath();
    for (let x = 0; x <= c.width; x += 16) { const yy = y + Math.sin(x * f + ph) * amp; x ? g.lineTo(x, yy) : g.moveTo(x, yy); }
    g.stroke();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1 / 0.9, 1 / 0.45); // texture spans 0.9 m × 0.45 m
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}

function stoneTexture(hex, veined) {
  const key = 'stone' + hex + veined;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = 1024; c.height = 1024;
  const g = c.getContext('2d');
  const base = new THREE.Color(hex);
  g.fillStyle = '#' + base.getHexString(); g.fillRect(0, 0, 1024, 1024);
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 4000; i++) {
    const col = base.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.06);
    g.fillStyle = '#' + col.getHexString(); g.globalAlpha = 0.5; g.fillRect(rnd() * 1024, rnd() * 1024, 2 + rnd() * 5, 2 + rnd() * 5);
  }
  if (veined) {
    const dark = base.getHSL({}).l < 0.4;
    g.strokeStyle = dark ? '#e8e6e1' : '#8d8a86';
    for (let i = 0; i < 9; i++) {
      g.globalAlpha = 0.25 + rnd() * 0.5; g.lineWidth = 0.6 + rnd() * 2.5;
      let x = rnd() * 1024, y = 0; g.beginPath(); g.moveTo(x, y);
      while (y < 1024) { x += (rnd() - 0.5) * 60; y += 20 + rnd() * 40; g.lineTo(x, y); }
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(1 / 1.2, 1 / 1.2);
  texCache.set(key, t);
  return t;
}

export function mat(hex, opts = {}) {
  const name = opts.name || '';
  const key = hex + '|' + name + '|' + JSON.stringify(opts);
  if (matCache.has(key)) return matCache.get(key);
  let m;
  if (WOOD.test(name)) {
    m = new THREE.MeshStandardMaterial({ map: woodTexture(hex), roughness: 0.62, metalness: 0 });
  } else if (STONE.test(name)) {
    m = new THREE.MeshStandardMaterial({ map: stoneTexture(hex, /Marquina|Statuario|Zeus/.test(name)), roughness: 0.35 });
  } else {
    m = new THREE.MeshStandardMaterial({ color: hex, roughness: opts.gloss ? 0.12 : (opts.roughness ?? 0.55), metalness: opts.metal ?? 0 });
  }
  matCache.set(key, m);
  return m;
}
export const MATS = {
  get chrome() { return mat('#d7dadd', { metal: 1, roughness: 0.12 }); },
  get black() { return mat('#18181a', { roughness: 0.45 }); },
  get dark() { return mat('#2a2d31', { roughness: 0.7 }); },
  get white() { return mat('#f7f7f5', { gloss: true }); },
  get porcelain() { return mat('#fbfbfa', { roughness: 0.15 }); },
  get mirror() {
    const k = '__mirror';
    if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: '#c9d3da', metalness: 0.85, roughness: 0.1, envMapIntensity: 2.2 }));
    return matCache.get(k);
  },
  get glass() {
    const k = '__glass';
    if (!matCache.has(k)) matCache.set(k, new THREE.MeshPhysicalMaterial({ color: '#dceaf0', metalness: 0, roughness: 0.05, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    return matCache.get(k);
  },
  get frosted() {
    const k = '__frost';
    if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: '#eef3f5', roughness: 0.9, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    return matCache.get(k);
  },
};

export function tileTexture(color, grout, tw, th, key) {
  const c = document.createElement('canvas');
  const px = 512;
  c.width = px; c.height = Math.round(px * (th / tw));
  const g = c.getContext('2d');
  g.fillStyle = grout; g.fillRect(0, 0, c.width, c.height);
  const gw = Math.max(1, (2 / tw) * px); // 2 mm grout
  const base = new THREE.Color(color);
  g.fillStyle = '#' + base.getHexString(); g.fillRect(gw / 2, gw / 2, c.width - gw, c.height - gw);
  // subtle variation
  const grd = g.createLinearGradient(0, 0, c.width, c.height);
  grd.addColorStop(0, 'rgba(255,255,255,0.05)'); grd.addColorStop(1, 'rgba(0,0,0,0.04)');
  g.fillStyle = grd; g.fillRect(gw / 2, gw / 2, c.width - gw, c.height - gw);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.repeat.set(1 / (tw * MM), 1 / (th * MM));
  return t;
}

// ------------------------------------------------------------------ geometry helpers
// Box with UVs scaled to metres so textures keep real-world scale.
export function boxGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
  }
  return g;
}
function box(w, h, d, m, x = 0, y = 0, z = 0, parent) {
  const mesh = new THREE.Mesh(boxGeo(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  if (parent) parent.add(mesh);
  return mesh;
}

function superPath(path, w, d, n = 4, cx = 0, cy = 0, segs = 64, reverse = false) {
  for (let i = 0; i <= segs; i++) {
    let th = (i / segs) * Math.PI * 2; if (reverse) th = -th;
    const c = Math.cos(th), s = Math.sin(th);
    const x = cx + (w / 2) * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const y = cy + (d / 2) * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    i ? path.lineTo(x, y) : path.moveTo(x, y);
  }
  return path;
}
// D-shaped outline (toilet pans/seats): squarish at the back (−z), elliptical at the front (+z).
function dPoint(th, w, d) {
  const c = Math.cos(th), s = Math.sin(th);
  const n = s < 0 ? 4.5 : 2.3;
  return [(w / 2) * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), (d / 2) * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)];
}
function dPath(path, w, d, cz = 0, segs = 64, reverse = false) {
  for (let i = 0; i <= segs; i++) {
    const th = ((reverse ? -i : i) / segs) * Math.PI * 2;
    const [x, z] = dPoint(th, w, d);
    i ? path.lineTo(x, z + cz) : path.moveTo(x, z + cz);
  }
  return path;
}
// Loft of D-shaped rings {y, sx, sz}; each ring keeps its back edge on the wall plane (z = −d/2). Capped at both ends.
function loftGeo(w, d, rings, segs = 64) {
  const pos = [], idx = [];
  for (const r of rings) {
    const rd = d * r.sz, zoff = -d / 2 + rd / 2;
    for (let j = 0; j <= segs; j++) {
      const [x, z] = dPoint((j / segs) * Math.PI * 2, w * r.sx, rd);
      pos.push(x, r.y, z + zoff);
    }
  }
  const row = segs + 1;
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < segs; j++) {
    const a = i * row + j, b = a + row;
    idx.push(a, b, a + 1, b, b + 1, a + 1); // outward-facing
  }
  for (const [ri, flip] of [[0, true], [rings.length - 1, false]]) {
    const r = rings[ri], rd = d * r.sz;
    const c = pos.length / 3;
    pos.push(0, r.y, -d / 2 + rd / 2);
    for (let j = 0; j < segs; j++) {
      const a = ri * row + j;
      flip ? idx.push(c, a, a + 1) : idx.push(c, a + 1, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function roundRectPath(path, w, h, r, cx = 0, cy = 0) {
  r = Math.min(r, w / 2, h / 2);
  const x = cx - w / 2, y = cy - h / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y); path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r); path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h); path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r); path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

// Horizontal slab from a 2D shape in plan (x, z), thickness t, bottom at y0.
function slab(shape, t, m, y0 = 0, bevel = 0) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 24 });
  g.rotateX(Math.PI / 2); // shape y → +z, extrude z → −y
  g.translate(0, y0 + t, 0);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

// Bowl surface hanging below y=0 (superellipse outline bw × bd, depth dep).
function bowlGeo(bw, bd, dep, n = 4, rings = 14, segs = 64) {
  const pos = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const ph = (i / rings) * (Math.PI / 2);
    const s = Math.cos(ph) * 0.98 + 0.02 * (1 - i / rings), y = -dep * Math.sin(ph);
    for (let j = 0; j <= segs; j++) {
      const th = (j / segs) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      pos.push((bw / 2) * s * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), y, (bd / 2) * s * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n));
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = i * (segs + 1) + j, b = a + segs + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function tap(parent, x, y, z, scale = 1) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.02 * scale, 0.022 * scale, 0.16 * scale, 24), MATS.chrome);
  body.position.y = 0.08 * scale; g.add(body);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.009 * scale, 0.009 * scale, 0.12 * scale, 16), MATS.chrome);
  spout.rotation.x = Math.PI / 2; spout.position.set(0, 0.145 * scale, 0.06 * scale); g.add(spout);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.07), MATS.chrome);
  lever.position.set(0, 0.17 * scale, -0.03); lever.rotation.x = -0.4; g.add(lever);
  g.position.set(x, y, z);
  g.traverse((o) => (o.castShadow = true));
  parent.add(g);
}

// ------------------------------------------------------------------ fronts
function front(parent, x0, x1, y0, y1, zf, style, fm, opts = {}) {
  const gap = 0.003, t = 0.018;
  const w = x1 - x0 - gap, h = y1 - y0 - gap, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const z = zf - t / 2;
  if (style === 'mirror') {
    box(w, h, t, MATS.dark, cx, cy, z, parent);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.004, h - 0.004), MATS.mirror);
    p.position.set(cx, cy, zf + 0.0006); parent.add(p);
    return;
  }
  if (style === 'integrated') {
    const grip = 0.025;
    box(w, h - grip, t, fm, cx, cy - grip / 2, z, parent);
    box(w, grip, 0.004, MATS.dark, cx, y1 - gap / 2 - grip / 2, zf - t + 0.002, parent);
    box(w, 0.006, t * 0.6, fm, cx, y1 - gap / 2 - grip + 0.003, zf - t * 0.3, parent);
    return;
  }
  box(w, h, t, fm, cx, cy, z, parent);
  if (style === 'blackframe') {
    const b = 0.008, e = 0.0015;
    box(w, b, e, MATS.black, cx, cy + h / 2 - b / 2, zf + e / 2, parent);
    box(w, b, e, MATS.black, cx, cy - h / 2 + b / 2, zf + e / 2, parent);
    box(b, h - 2 * b, e, MATS.black, cx - w / 2 + b / 2, cy, zf + e / 2, parent);
    box(b, h - 2 * b, e, MATS.black, cx + w / 2 - b / 2, cy, zf + e / 2, parent);
  } else if (style === 'framed') {
    const b = Math.min(0.06, w * 0.12, h * 0.2), e = 0.005;
    box(w, b, e, fm, cx, cy + h / 2 - b / 2, zf + e / 2, parent);
    box(w, b, e, fm, cx, cy - h / 2 + b / 2, zf + e / 2, parent);
    box(b, h - 2 * b, e, fm, cx - w / 2 + b / 2, cy, zf + e / 2, parent);
    box(b, h - 2 * b, e, fm, cx + w / 2 - b / 2, cy, zf + e / 2, parent);
  } else if (style === 'fluted') {
    const pitch = 0.024, r = 0.0105;
    const n = Math.floor(w / pitch);
    const geo = new THREE.CylinderGeometry(r, r, h, 10, 1, true, -Math.PI / 2, Math.PI);
    const inst = new THREE.InstancedMesh(geo, fm, n);
    const m4 = new THREE.Matrix4();
    const start = cx - (n - 1) * pitch / 2;
    for (let i = 0; i < n; i++) { m4.makeTranslation(start + i * pitch, cy, zf - 0.004); inst.setMatrixAt(i, m4); }
    inst.castShadow = true; inst.receiveShadow = true;
    parent.add(inst);
  } else if (style === 'grooved' || style === 'curved') {
    const n = Math.max(2, Math.round(w / 0.035));
    const geo = boxGeo(0.0035, h, 0.002);
    const gm = new THREE.MeshStandardMaterial({ color: new THREE.Color(fm.map ? '#555' : fm.color).multiplyScalar(0.55), roughness: 0.8 });
    const inst = new THREE.InstancedMesh(geo, gm, n - 1);
    const m4 = new THREE.Matrix4();
    for (let i = 1; i < n; i++) { m4.makeTranslation(cx - w / 2 + (i * w) / n, cy, zf + 0.0002); inst.setMatrixAt(i - 1, m4); }
    parent.add(inst);
  }
  if (style === 'plain' && opts.handle !== false) {
    // Slim bar handle: centred top on drawers, opposite hinge on doors
    const hl = Math.min(0.16, w * 0.4);
    if (opts.hinge) {
      const hx = opts.hinge === 'L' ? cx + w / 2 - 0.04 : cx - w / 2 + 0.04;
      const hy = opts.handleY ?? cy;
      box(0.012, hl, 0.012, MATS.chrome, hx, hy, zf + 0.012, parent);
    } else {
      box(hl, 0.012, 0.012, MATS.chrome, cx, y1 - 0.045, zf + 0.012, parent);
    }
  }
}

// ------------------------------------------------------------------ builders
function cabinet(it, s, cfg, col, m) {
  const g = new THREE.Group();
  const W = s.w * MM, H = s.h * MM, D = s.d * MM;
  const name = colourName(it);
  const [fName, cName] = name.split('/').map((x) => x.trim());
  const fm = mat(col.front, { name: col.frontName || fName });
  const cm = mat(col.carcass, { name: col.carcassName || cName || fName });
  const ft = m.kind === 'open' || m.kind === 'shelf' ? 0 : 0.018;
  const zf = D / 2;
  const style = m.kind === 'mirrorcab' ? 'mirror' : cfg.front;

  if (m.kind === 'open' || m.kind === 'shelf') {
    const t = 0.016;
    box(W, t, D, cm, 0, t / 2, 0, g); box(W, t, D, cm, 0, H - t / 2, 0, g);
    box(t, H, D, cm, -W / 2 + t / 2, H / 2, 0, g); box(t, H, D, cm, W / 2 - t / 2, H / 2, 0, g);
    box(W - 2 * t, H - 2 * t, 0.008, cm, 0, H / 2, -D / 2 + 0.004, g);
    if (W > 0.9 && m.kind === 'open') box(t, H - 2 * t, D - 0.01, cm, 0, H / 2, 0, g);
    return g;
  }

  if (m.kind === 'vanity') {
    // Open-topped carcass like the real unit, so a basin bowl can drop into it.
    const t = 0.016, Dc = D - ft, zc = -ft / 2;
    box(t, H, Dc, cm, -W / 2 + t / 2, H / 2, zc, g);
    box(t, H, Dc, cm, W / 2 - t / 2, H / 2, zc, g);
    box(W - 2 * t, t, Dc, cm, 0, t / 2, zc, g);
    box(W - 2 * t, H - t, t, cm, 0, H / 2 + t / 2, zc - Dc / 2 + t / 2, g);
    // no top rails: the basin bowl drops into the open top
    // shadowy interior so the gap around the bowl reads as depth
    box(W - 2 * t - 0.002, 0.002, Dc - t - 0.002, MATS.dark, 0, H * 0.45, zc + t / 2, g);
  } else {
    const carcGeo = cfg.front === 'curved' ? new RoundedBoxGeometry(W, H, D - ft, 4, 0.03) : boxGeo(W, H, D - ft);
    const carc = new THREE.Mesh(carcGeo, cm); carc.position.set(0, H / 2, -ft / 2); carc.castShadow = carc.receiveShadow = true; g.add(carc);
  }

  const x0 = -W / 2, x1 = W / 2;
  const inset = cfg.front === 'curved' ? 0.02 : 0;
  if (m.kind === 'mirrorcab') {
    const n = s.doors || (W >= 1.1 ? 3 : W >= 0.75 ? 2 : 1);
    for (let i = 0; i < n; i++) front(g, x0 + (W * i) / n, x0 + (W * (i + 1)) / n, 0, H, zf, 'mirror', fm);
    const fin = colourName(it);
    if (m.recessed && /trim/i.test(fin) && !/no trim/i.test(fin)) {
      // trim kit: a slim metal frame around the recess, on the wall face
      const tm = metalMat(fin), b = 0.022, e = 0.004, zt = zf - 0.004 + e / 2;
      box(W + 2 * b, b, e, tm, 0, H + b / 2, zt, g); box(W + 2 * b, b, e, tm, 0, -b / 2, zt, g);
      box(b, H, e, tm, -W / 2 - b / 2, H / 2, zt, g); box(b, H, e, tm, W / 2 + b / 2, H / 2, zt, g);
    }
    return g;
  }
  if (cfg.drawers) {
    let rows;
    if (cfg.front === 'openshelf') rows = [[H * 0.5, H]];
    else if (cfg.drawers === 2) rows = [[H * 0.58, H], [0, H * 0.58]];
    else rows = [[0, H]];
    const split = (m.cols || 1) > 1 ? 2 : cfg.double && m.kind !== 'vanity' ? 2 : 1;
    for (const [y0, y1] of rows) for (let k = 0; k < split; k++) front(g, x0 + inset + ((W - 2 * inset) * k) / split, x0 + inset + ((W - 2 * inset) * (k + 1)) / split, y0, y1, zf, style, fm);
    if (cfg.front === 'openshelf') box(W - 0.04, 0.016, D - 0.06, cm, 0, H * 0.25, 0, g);
  } else if (cfg.doors) {
    const stacked = m.kind === 'tall' && cfg.doors === 2 && W < 0.5;
    if (stacked) {
      front(g, x0, x1, H * 0.45, H, zf, style, fm, { hinge: cfg.hinge || 'L', handleY: H * 0.45 + 0.12 });
      front(g, x0, x1, 0, H * 0.45, zf, style, fm, { hinge: cfg.hinge || 'L', handleY: H * 0.45 - 0.12 });
    } else if (cfg.doors === 2) {
      front(g, x0, 0, 0, H, zf, style, fm, { hinge: 'L', handleY: m.kind === 'tall' ? 1.0 - (it.elev * MM) : H - 0.1 });
      front(g, 0, x1, 0, H, zf, style, fm, { hinge: 'R', handleY: m.kind === 'tall' ? 1.0 - (it.elev * MM) : H - 0.1 });
    } else {
      const hy = m.kind === 'tall' ? Math.min(H - 0.15, Math.max(0.15, 1.0 - it.elev * MM)) : m.kind === 'wall' ? 0.12 : H - 0.1;
      front(g, x0, x1, 0, H, zf, style, fm, { hinge: cfg.hinge || 'L', handleY: hy });
    }
  } else {
    front(g, x0, x1, 0, H, zf, style, fm);
  }
  return g;
}

function basin(it, s, cfg, col, m) {
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, Hs = s.h * MM;
  const t = Math.max(0.012, Math.min(Hs, 0.05));
  const cname = colourName(it);
  const bm = /gloss/i.test(cname) ? MATS.white : mat(col.front, { name: col.frontName, roughness: 0.35 });
  const shape = new THREE.Shape();
  roundRectPath(shape, W, D, /larghetto|kantate/i.test(m.name) ? 0.03 : 0.006);
  const n = cfg.double ? 2 : 1;
  const azL = /left-handed/i.test(m.name), azR = /right-handed/i.test(m.name);
  const bw = Math.min(n === 2 ? W / 2 - 0.12 : W - 0.16, n === 1 && W > 0.9 ? 0.56 : 0.44);
  const bd = D - 0.17;
  const bowls = [];
  for (let k = 0; k < n; k++) {
    let cx = n === 2 ? (k ? W / 4 : -W / 4) : 0;
    if (azL) cx = -W / 2 + bw / 2 + 0.06; if (azR) cx = W / 2 - bw / 2 - 0.06;
    const cz = 0.035;
    bowls.push({ cx, cz });
    const hole = new THREE.Path(); superPath(hole, bw, bd, 5, cx, cz, 64, true);
    shape.holes.push(hole);
  }
  g.add(slab(shape, t, bm, 0));
  for (const b of bowls) {
    const bowl = new THREE.Mesh(bowlGeo(bw, bd, 0.12, 5), bm.clone());
    bowl.material.side = THREE.DoubleSide;
    bowl.position.set(b.cx, t, b.cz); bowl.castShadow = true; g.add(bowl);
    const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.003, 24), MATS.chrome);
    drain.position.set(b.cx, t - 0.119, b.cz); g.add(drain);
    if (!/without tap/i.test(m.name) && !hasTapOn(it)) tap(g, b.cx, t, -D / 2 + 0.05);
  }
  return g;
}

// A separate tap item sitting on this basin replaces the default one.
export function hasTapOn(it) {
  const s = sizeOf(it), top = it.elev + s.h;
  const corners = itemCorners(it, s.w + 2, s.d + 2);
  return store.d.items.some((o) => o !== it && modelOf(o)?.kind === 'tap' && Math.abs(o.elev - top) < 6 && pointInPoly(o, corners));
}

function ctbasin(it, s, cfg, col, m) {
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, H = s.h * MM;
  const wall = 0.012;
  const outer = new THREE.Shape(), inner = new THREE.Path();
  if (cfg.shape === 'round' || cfg.shape === 'oval') {
    superPath(outer, W, D, cfg.shape === 'round' ? 2 : 2.6); superPath(inner, W - 2 * wall, D - 2 * wall, cfg.shape === 'round' ? 2 : 2.6, 0, 0, 64, true);
  } else { superPath(outer, W, D, 7); superPath(inner, W - 2 * wall, D - 2 * wall, 7, 0, 0, 64, true); }
  outer.holes.push(inner);
  g.add(slab(outer, H, MATS.porcelain, 0));
  const fl = new THREE.Shape(); superPath(fl, W - 2 * wall, D - 2 * wall, cfg.shape === 'round' ? 2 : cfg.shape === 'oval' ? 2.6 : 7);
  g.add(slab(fl, 0.012, MATS.porcelain, 0));
  const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.003, 24), MATS.chrome);
  drain.position.set(0, 0.0135, 0); g.add(drain);
  return g;
}

function worktop(it, s, cfg, col, m) {
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, H = s.h * MM;
  const tm = mat(col.front, { name: col.frontName, roughness: 0.4 });
  if (m.kind === 'console') {
    const cm = /black/i.test(colourName(it)) ? MATS.black : MATS.chrome;
    for (const x of [-W / 2 + 0.03, W / 2 - 0.03]) { box(0.015, 0.012, D, cm, x, H - 0.006, 0, g); box(0.015, H, 0.012, cm, x, H / 2, -D / 2 + 0.006, g); }
    return g;
  }
  const sh = new THREE.Shape(); roundRectPath(sh, W, D, /rounded/i.test(m.name) ? 0.05 : 0.002);
  g.add(slab(sh, H, tm, 0));
  return g;
}

function mirror(it, s, cfg, col, m) {
  const g = new THREE.Group();
  const W = s.w * MM, H = s.h * MM, D = Math.max(0.02, s.d * MM);
  const sh = new THREE.Shape();
  const r = cfg.shape === 'round' || cfg.shape === 'oval' ? Math.min(W, H) / 2 : cfg.shape === 'squircle' ? Math.min(W, H) * 0.22 : 0.008;
  roundRectPath(sh, W, H, r, 0, H / 2);
  const back = new THREE.ExtrudeGeometry(sh, { depth: D - 0.006, bevelEnabled: false, curveSegments: 32 });
  back.translate(0, 0, -D / 2);
  const bm = new THREE.Mesh(back, MATS.dark); bm.castShadow = true; g.add(bm);
  const face = new THREE.ShapeGeometry(sh, 32);
  const fmsh = new THREE.Mesh(face, MATS.mirror); fmsh.position.z = D / 2 - 0.005; g.add(fmsh);
  if (/lighting/i.test(m.name)) {
    // soft glow ring behind the mirror
    const ring = new THREE.Shape(); roundRectPath(ring, W + 0.004, H + 0.004, r + 0.002, 0, H / 2);
    const hole = new THREE.Path(); roundRectPath(hole, W - 0.01, H - 0.01, Math.max(0, r - 0.005), 0, H / 2); ring.holes.push(hole);
    const glow = new THREE.Mesh(new THREE.ShapeGeometry(ring, 32), new THREE.MeshBasicMaterial({ color: '#fff6e5' }));
    glow.position.z = -D / 2 + 0.001; g.add(glow);
  }
  if (/glass shelf/i.test(m.name)) box(W, 0.008, 0.1, MATS.glass, 0, 0.004, D / 2 + 0.05, g);
  return g;
}

function toilet(it, s, cfg, col, m) {
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, H = s.h * MM;
  if (m.kind === 'wc') {
    box(0.2, 0.38, 0.32, MATS.porcelain, 0, 0.19, -D / 2 + 0.33, g);
    const bowl = new THREE.Mesh(new RoundedBoxGeometry(W, 0.4, D - 0.2, 6, 0.08), MATS.porcelain);
    bowl.position.set(0, 0.2, 0.1); g.add(bowl);
    const cist = new THREE.Mesh(new RoundedBoxGeometry(W, 0.4, 0.18, 4, 0.03), MATS.porcelain);
    cist.position.set(0, 0.6, -D / 2 + 0.09); g.add(cist);
    g.traverse((o) => (o.castShadow = true));
    return g;
  }
  // Wall-hung pan: lofted D-shaped body, narrow at the base and flaring to the rim, back flat to the wall.
  const ease = (f) => Math.pow(Math.sin((f * Math.PI) / 2), 1.6);
  const rings = [];
  const N = 16;
  for (let k = 0; k <= N; k++) {
    const f = k / N;
    const sc = 0.5 + 0.5 * ease(f);
    rings.push({ y: H * 0.97 * f, sx: (0.62 + 0.38 * ease(f)) * (k === 0 ? 0.94 : 1), sz: sc * (k === 0 ? 0.96 : 1) });
  }
  rings.push({ y: H * 0.985, sx: 1, sz: 1 }, { y: H, sx: 0.985, sz: 0.988 }); // softened rim edge
  const body = new THREE.Mesh(loftGeo(W, D, rings), MATS.porcelain);
  body.castShadow = body.receiveShadow = true; g.add(body);
  // dark recess at the wall junction so the pan reads as wall-hung
  box(W * 0.5, H * 0.5, 0.004, MATS.dark, 0, H * 0.4, -D / 2 + 0.002, g);
  // seat and closed lid
  const sd = D - 0.075, scz = 0.0375;
  const seat = new THREE.Shape(); dPath(seat, W - 0.008, sd, scz);
  const hole = new THREE.Path(); dPath(hole, W - 0.13, sd - 0.15, scz + 0.035, 64, true); seat.holes.push(hole);
  g.add(slab(seat, 0.014, MATS.white, H + 0.003, 0.003));
  const shower = m.showertoilet || /viclean/i.test(m.name);
  const lid = new THREE.Shape(); dPath(lid, W - 0.02, sd - 0.012, scz - 0.002);
  g.add(slab(lid, shower ? 0.03 : 0.016, MATS.white, H + 0.021, 0.004));
  if (shower) {
    // shower-toilet unit: housing behind the lid and a small status light
    const unit = new THREE.Mesh(new RoundedBoxGeometry(W * 0.86, 0.075, 0.14, 4, 0.025), MATS.white);
    unit.position.set(0, H + 0.035, -D / 2 + 0.075); unit.castShadow = true; g.add(unit);
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.004, 16), new THREE.MeshBasicMaterial({ color: '#7fd0ff' }));
    led.position.set(W * 0.3, H + 0.06, -D / 2 + 0.146); g.add(led);
  }
  for (const x of [-0.07, 0.07]) {
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.035, 16), MATS.chrome);
    hinge.rotation.z = Math.PI / 2; hinge.position.set(x, H + 0.016, -D / 2 + 0.05); g.add(hinge);
  }
  // flush plate: on the wall / boxing face above the pan, or flat on top of the boxing (set in the WC's details)
  const fl = flushInfo(it, s);
  if (fl.mode === 'top') {
    const y = (fl.top - it.elev) * MM, z = -D / 2 - fl.depth * MM / 2;
    box(0.22, 0.006, 0.14, MATS.white, 0, y + 0.003, z, g);
    for (const x of [-0.045, 0.045]) {
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.004, 32), MATS.chrome);
      btn.position.set(x, y + 0.007, z); g.add(btn);
    }
  } else {
    const plateY = Math.max(H + 0.12, (fl.faceY - it.elev) * MM);
    box(0.24, 0.16, 0.008, MATS.white, 0, plateY, -D / 2 + 0.004, g);
    box(0.09, 0.09, 0.004, MATS.chrome, -0.05, plateY, -D / 2 + 0.01, g);
    box(0.09, 0.09, 0.004, MATS.chrome, 0.05, plateY, -D / 2 + 0.01, g);
  }
  return g;
}

function bath(it, s, cfg, col, m) {
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, H = s.h * MM;
  const rim = 0.06;
  const outer = new THREE.Shape();
  const n = cfg.shape === 'oval' ? 2.4 : 8;
  if (cfg.shape === 'oval') superPath(outer, W, D, n); else roundRectPath(outer, W, D, 0.01);
  const inner = new THREE.Path(); superPath(inner, W - 2 * rim, D - 2 * rim, cfg.shape === 'oval' ? 2.4 : 5, 0, 0, 64, true);
  outer.holes.push(inner);
  g.add(slab(outer, H, MATS.porcelain, 0));
  const tub = new THREE.Mesh(bowlGeo(W - 2 * rim, D - 2 * rim, H - 0.06, cfg.shape === 'oval' ? 2.4 : 5), MATS.porcelain.clone());
  tub.material.side = THREE.DoubleSide; tub.position.y = H; g.add(tub);
  const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.003, 24), MATS.chrome);
  drain.position.set(-W / 2 + 0.23, 0.065, 0); g.add(drain);
  return g;
}

function tray(it, s, cfg, col, m) {
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, H = Math.max(0.004, s.h * MM);
  if (m.wet) {
    // Wet-room zone: same floor tiles, just a faint wet sheen and a linear drain along the wall edge.
    const sheen = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: '#7f9fb5', transparent: true, opacity: 0.07, roughness: 0.15, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    sheen.rotation.x = -Math.PI / 2; sheen.position.y = 0.0006; g.add(sheen);
    const L = Math.max(0.3, W - 0.2), dz = -D / 2 + 0.08;
    box(L + 0.012, 0.0015, 0.05, MATS.chrome, 0, 0.0008, dz, g);
    const slots = new THREE.InstancedMesh(new THREE.BoxGeometry(0.004, 0.0004, 0.03), MATS.dark, Math.floor(L / 0.012));
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < slots.count; i++) { m4.makeTranslation(-L / 2 + 0.006 + i * 0.012, 0.0017, dz); slots.setMatrixAt(i, m4); }
    g.add(slots);
    return g;
  }
  box(W, H, D, MATS.porcelain, 0, H / 2, 0, g);
  const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.003, 32), MATS.chrome);
  drain.position.set(0, H + 0.0015, 0); g.add(drain);
  return g;
}

function glass(it, s, cfg, col, m) {
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, H = s.h * MM;
  const cname = colourName(it);
  const prof = /black/i.test(cname) ? MATS.black : MATS.chrome;
  const gm = /frosted/i.test(cname) ? MATS.frosted : MATS.glass;
  const panel = (len, x, z, rotY) => {
    const p = new THREE.Group();
    box(len, H, 0.006, gm, 0, H / 2, 0, p);
    box(len, 0.02, 0.02, prof, 0, H - 0.01, 0, p);
    box(0.02, H, 0.02, prof, -len / 2 + 0.01, H / 2, 0, p);
    p.position.set(x, 0, z); p.rotation.y = rotY; g.add(p);
  };
  if (D > 0.3) {
    panel(W, 0, D / 2 - 0.01, 0);
    panel(D, W / 2 - 0.01, 0, Math.PI / 2);
  } else panel(W, 0, 0, 0);
  return g;
}

function rail(it, s, cfg, col, m) {
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, H = s.h * MM;
  const rm = /black/i.test(colourName(it)) ? MATS.black : m.kind === 'radiator' ? MATS.white : MATS.chrome;
  if (m.kind === 'radiator') {
    box(W, H, D * 0.6, rm, 0, H / 2, 0, g);
    const n = Math.floor(W / 0.05);
    for (let i = 0; i < n; i++) box(0.01, H - 0.04, 0.004, mat('#e7e7e5'), -W / 2 + 0.025 + i * 0.05, H / 2, D * 0.3 + 0.002, g);
    return g;
  }
  const r = 0.012;
  const tube = (len) => new THREE.CylinderGeometry(r, r, len, 16);
  for (const x of [-W / 2 + r, W / 2 - r]) { const t = new THREE.Mesh(tube(H), rm); t.position.set(x, H / 2, D / 2 - r); g.add(t); }
  const bars = Math.max(2, Math.floor(H / 0.11));
  for (let i = 0; i < bars; i++) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, W - 2 * r, 12), rm);
    t.rotation.z = Math.PI / 2; t.position.set(0, 0.06 + (i * (H - 0.12)) / (bars - 1), D / 2 - r); g.add(t);
  }
  for (const y of [0.15, H - 0.15]) for (const x of [-W / 2 + r, W / 2 - r]) box(0.02, 0.02, D - 2 * r, rm, x, y, -r, g);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function blockBox(it, s) {
  const g = new THREE.Group();
  box(s.w * MM, s.h * MM, s.d * MM, mat(store.d.room.wallColor, { roughness: 0.9 }), 0, s.h * MM / 2, 0, g);
  return g;
}

// ------------------------------------------------------------------ built-out walls, taps, showers
function metalMat(name) {
  if (/black chrome/i.test(name)) return mat('#3d3d40', { metal: 1, roughness: 0.3 });
  if (/black/i.test(name)) return mat('#1c1c1e', { metal: 0.6, roughness: 0.4 });
  if (/brass|gold/i.test(name)) return mat('#c19a5b', { metal: 1, roughness: 0.32 });
  if (/bronze/i.test(name)) return mat('#7d5c3e', { metal: 1, roughness: 0.38 });
  if (/black chrome/i.test(name)) return mat('#3d3d40', { metal: 1, roughness: 0.3 });
  if (/nickel/i.test(name)) return mat('#b4b3ad', { metal: 1, roughness: 0.3 });
  if (/gunmetal/i.test(name)) return mat('#5b5d61', { metal: 1, roughness: 0.3 });
  return MATS.chrome;
}

let tileMatCache = { key: '', m: null };
function roomTileMat() {
  const wt = store.d.room.wallTile;
  if (!wt.enabled) return null;
  const key = JSON.stringify(wt);
  if (tileMatCache.key !== key) tileMatCache = { key, m: new THREE.MeshStandardMaterial({ map: tileTexture(wt.color, wt.grout, wt.tw, wt.th), roughness: 0.3 }) };
  return tileMatCache.m;
}

let glowTex = null;
function ledGlowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = 4; c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, 'rgba(255,236,200,0.95)'); grd.addColorStop(0.35, 'rgba(255,230,190,0.35)'); grd.addColorStop(1, 'rgba(255,230,190,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 4, 128);
  glowTex = new THREE.CanvasTexture(c); glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

// Vertical face (facing +z) from x0..x1, y0..y1 at depth z; split into tiled / painted bands at the room tile height.
function finishFace(parent, x0, x1, y0, y1, z, elev, paint, horizontal = null) {
  const tileM = roomTileMat();
  const tileTop = tileM ? store.d.room.wallTile.height * MM - elev : -1;
  const bands = [];
  if (tileTop > y0) bands.push([y0, Math.min(y1, tileTop), tileM]);
  if (y1 > Math.max(y0, tileTop)) bands.push([Math.max(y0, tileTop), y1, paint]);
  for (const [a, b, m] of bands) {
    const L = x1 - x0, h = b - a;
    if (L <= 0.001 || h <= 0.001) continue;
    const pg = new THREE.PlaneGeometry(L, h);
    const uv = pg.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, x0 + uv.getX(i) * L, elev + a + uv.getY(i) * h);
    const pm = new THREE.Mesh(pg, m);
    pm.position.set((x0 + x1) / 2, (a + b) / 2, z); pm.receiveShadow = true;
    parent.add(pm);
  }
}

// Finish the inside of a recess (back, shelf, ceiling, sides) and optional LED strip.
// Coordinates are in the host's local frame; zFront is the wall face, depth goes back from it.
function recessFinish(g, x0, x1, y0, y1, zFront, depth, E, paint, led) {
  const W = x1 - x0, cx = (x0 + x1) / 2, zc = zFront - depth / 2;
  const tm = roomTileMat();
  const tileTop = tm ? store.d.room.wallTile.height * MM - E : -1;
  const revealMat = (y) => (tm && y < tileTop ? tm : paint);
  finishFace(g, x0, x1, y0, y1, zFront - depth + 0.0008, E, paint);
  const shelf = new THREE.Mesh(new THREE.PlaneGeometry(W, depth), revealMat(y0));
  shelf.rotation.x = -Math.PI / 2; shelf.position.set(cx, y0 + 0.0008, zc); shelf.receiveShadow = true; g.add(shelf);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, depth), revealMat(y1));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(cx, y1 - 0.0008, zc); g.add(ceil);
  for (const [x, ry] of [[x0 + 0.0008, Math.PI / 2], [x1 - 0.0008, -Math.PI / 2]]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(depth, y1 - y0), revealMat((y0 + y1) / 2));
    side.rotation.y = ry; side.position.set(x, (y0 + y1) / 2, zc); side.receiveShadow = true; g.add(side);
  }
  if (led) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(W - 0.01, 0.005, 0.012), new THREE.MeshBasicMaterial({ color: '#fff3dc' }));
    strip.position.set(cx, y1 - 0.004, zFront - 0.025); g.add(strip);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(W, y1 - y0), new THREE.MeshBasicMaterial({ map: ledGlowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.set(cx, (y0 + y1) / 2, zFront - depth + 0.002); g.add(glow);
    const shelfGlow = new THREE.Mesh(new THREE.PlaneGeometry(W, depth), new THREE.MeshBasicMaterial({ color: '#ffe9c4', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    shelfGlow.rotation.x = -Math.PI / 2; shelfGlow.position.set(cx, y0 + 0.0015, zc); g.add(shelfGlow);
  }
}

// Niche items sitting on the front face of built-out wall `fw` → recesses in fw's local frame (metres).
export function nichesIn(fw) {
  const fs = sizeOf(fw), out = [];
  for (const o of store.d.items) {
    if (o === fw || modelOf(o)?.kind !== 'niche') continue;
    const s = sizeOf(o);
    const f = toWorld(o, 0, s.d / 2);
    const l = toLocal(fw, f);
    const dr = Math.abs(((o.rot - fw.rot) % 360 + 540) % 360 - 180);
    if (dr > 1 || Math.abs(l.y - fs.d / 2) > 20 || Math.abs(l.x) > fs.w / 2) continue;
    out.push({ x0: Math.max(-fs.w / 2, l.x - s.w / 2) * MM, x1: Math.min(fs.w / 2, l.x + s.w / 2) * MM,
      y0: Math.max(0, o.elev - fw.elev) * MM, y1: Math.min(fs.h, o.elev + s.h - fw.elev) * MM, depth: Math.min(s.d, fs.d - 15) * MM, item: o });
  }
  return out;
}

function falseWall(it, s, m) {
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, H = s.h * MM, E = it.elev * MM;
  const paint = mat(store.d.room.wallColor, { roughness: 0.92 });
  const n = nicheOf(it);
  const hasN = n.on && n.bottom - it.elev < s.h && n.height > 0;
  // recesses: the wall's own full-length niche plus any niche items placed on its face
  const rec = nichesIn(it);
  if (hasN) {
    const nb = Math.max(0, n.bottom * MM - E);
    rec.push({ x0: -W / 2, x1: W / 2, y0: nb, y1: Math.min(H, nb + n.height * MM), depth: Math.min(D - 0.015, n.depth * MM), own: true });
  }
  const zf = D / 2 + 0.0008;
  // slice into vertical strips at recess edges, then stack solid / recessed pieces
  const xs = [...new Set([-W / 2, W / 2, ...rec.flatMap((r) => [r.x0, r.x1])])].sort((a, b) => a - b);
  for (let k = 0; k < xs.length - 1; k++) {
    const x0 = xs[k], x1 = xs[k + 1], xm = (x0 + x1) / 2;
    if (x1 - x0 < 0.0005) continue;
    const here = rec.filter((r) => r.x0 <= xm && r.x1 >= xm);
    const ys = [...new Set([0, H, ...here.flatMap((r) => [r.y0, r.y1])])].filter((y) => y >= 0 && y <= H).sort((a, b) => a - b);
    for (let j = 0; j < ys.length - 1; j++) {
      const y0 = ys[j], y1 = ys[j + 1], ym = (y0 + y1) / 2;
      if (y1 - y0 < 0.0005) continue;
      const r = here.find((q) => ym > q.y0 && ym < q.y1);
      if (r) box(x1 - x0, y1 - y0, D - r.depth, paint, xm, ym, -r.depth / 2, g);
      else { box(x1 - x0, y1 - y0, D, paint, xm, ym, 0, g); finishFace(g, x0, x1, y0, y1, zf, E, paint); }
    }
  }
  for (const r of rec) if (r.own) recessFinish(g, r.x0, r.x1, r.y0, r.y1, D / 2, r.depth, E, paint, n.led);
  return g;
}

// Niche item: a recess of its own size, cut into whichever wall it is placed on (room wall or built-out wall).
// The host builds the hole; this draws the finished inside and LED strip. Front face = local +z (wall face).
function niche(it, s, m) {
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, H = s.h * MM;
  const paint = mat(store.d.room.wallColor, { roughness: 0.92 });
  recessFinish(g, -W / 2, W / 2, 0, H, D / 2, D, it.elev * MM, paint, it.cfg?.led !== false);
  return g;
}

function wallTap(it, s, m) {
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, H = s.h * MM;
  const mm = metalMat(colourName(it));
  const plate = new THREE.Mesh(new RoundedBoxGeometry(W, H, 0.008, 3, 0.004), mm);
  plate.position.set(0, H / 2, -D / 2 + 0.004); g.add(plate);
  const reach = D - 0.008;
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, reach, 20), mm);
  spout.rotation.x = Math.PI / 2; spout.position.set(0, H / 2, -D / 2 + 0.008 + reach / 2); g.add(spout);
  const aer = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.004, 20), MATS.dark);
  aer.position.set(0, H / 2 - 0.0105, D / 2 - 0.012); g.add(aer);
  const lx = W / 2 - 0.035;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 24), mm);
  hub.rotation.x = Math.PI / 2; hub.position.set(lx, H / 2, -D / 2 + 0.023); g.add(hub);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.06, 0.008), mm);
  lever.position.set(lx, H / 2 - 0.025, -D / 2 + 0.04); g.add(lever);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function showerValve(it, s, m) {
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, H = s.h * MM;
  const mm = metalMat(colourName(it));
  const plate = new THREE.Mesh(new RoundedBoxGeometry(W, H, 0.01, 3, Math.min(W, H) * 0.12), mm);
  plate.position.set(0, H / 2, -D / 2 + 0.005); g.add(plate);
  const dials = H > W * 1.5 ? [H * 0.27, H * 0.73] : [H / 2];
  for (const y of dials) {
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, 0.045, 32), mm);
    dial.rotation.x = Math.PI / 2; dial.position.set(0, y, -D / 2 + 0.032); g.add(dial);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

// How an overhead shower is mounted, from its name (falls back to proportions for unnamed/generic ones).
export function showerMount(m, s) {
  const n = (m.name || '').toLowerCase();
  if (/ceiling-integrated|ceiling integrated|flush/.test(n)) return 'flush';
  if (/ceiling/.test(n)) return 'ceiling';
  if (/arm|wall/.test(n) || m.generic) return 'wall';
  return s.d > s.w * 1.15 ? 'wall' : 'ceiling';
}

function showerHead(it, s, m) {
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, H = Math.max(0.01, s.h * MM);
  const mm = metalMat(colourName(it));
  const square = m.shape === 'rect';
  const mount = showerMount(m, s);
  const wall = mount === 'wall';
  const hd = wall ? Math.min(W, D - 0.1) : Math.min(W, D);   // head depth (front-to-back)
  const hz = wall ? D / 2 - hd / 2 : 0;                        // head centre along the arm
  const headGeo = square ? new RoundedBoxGeometry(W, 0.012, hd, 3, 0.004) : new THREE.CylinderGeometry(W / 2, W / 2, 0.01, 48);
  if (!square && Math.abs(hd - W) > 0.001) headGeo.scale(1, 1, hd / W);
  const head = new THREE.Mesh(headGeo, mm); head.position.set(0, 0.012, hz); g.add(head);
  const faceGeo = square ? new THREE.PlaneGeometry(W - 0.016, hd - 0.016) : new THREE.CircleGeometry(W / 2 - 0.008, 48);
  if (!square && Math.abs(hd - W) > 0.001) faceGeo.scale(1, hd / W, 1);
  const face = new THREE.Mesh(faceGeo, MATS.dark); face.rotation.x = Math.PI / 2; face.position.set(0, 0.0055, hz); g.add(face);
  const bar = (len, axis) => square ? new THREE.Mesh(new THREE.BoxGeometry(axis === 'z' ? 0.02 : 0.02, axis === 'y' ? len : 0.02, axis === 'z' ? len : 0.02), mm)
    : (() => { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, len, 16), mm); if (axis === 'z') c.rotation.x = Math.PI / 2; return c; })();
  if (wall) {
    // wall arm: flange on the wall at the top, arm out to above the head, short drop into it
    const armY = Math.max(H, 0.06);
    const flange = square ? new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.01), mm) : new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 24), mm);
    if (!square) flange.rotation.x = Math.PI / 2;
    flange.position.set(0, armY, -D / 2 + 0.005); g.add(flange);
    const armLen = hz + D / 2;
    const arm = bar(armLen, 'z'); arm.position.set(0, armY, -D / 2 + armLen / 2); g.add(arm);
    const drop = bar(armY - 0.012, 'y'); drop.position.set(0, (armY + 0.012) / 2, hz); g.add(drop);
  } else if (mount === 'ceiling') {
    // ceiling connection: rod straight up to the ceiling, with a cover plate
    const top = store.d.room.height * MM - it.elev * MM;
    const len = Math.max(0.02, top - 0.012);
    const rod = bar(len, 'y'); rod.position.set(0, 0.012 + len / 2, 0); g.add(rod);
    const plate = square ? new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.008, 0.07), mm) : new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.008, 24), mm);
    plate.position.set(0, top - 0.004, 0); g.add(plate);
  }
  // 'flush' (ceiling-integrated): head only, set its height to the ceiling
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function towelHolder(it, s, m) {
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, H = s.h * MM;
  const mm = metalMat(colourName(it));
  const rose = (x, y) => { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 24), mm); r.rotation.x = Math.PI / 2; r.position.set(x, y, -D / 2 + 0.006); g.add(r); };
  if (m.shape === 'round' || /ring/i.test(m.name)) {
    rose(0, H - 0.02);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, D - 0.02, 12), mm); arm.rotation.x = Math.PI / 2; arm.position.set(0, H - 0.02, 0); g.add(arm);
    const R = Math.min(W, H) / 2 - 0.01;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.006, 12, 48), mm); ring.position.set(0, H - 0.02 - R, D / 2 - 0.02); g.add(ring);
  } else if (m.shape === 'hook' || /hook/i.test(m.name)) {
    rose(0, H / 2);
    const hk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, D - 0.012, 12), mm); hk.rotation.x = Math.PI / 2 - 0.25; hk.position.set(0, H / 2 + 0.005, 0.005); g.add(hk);
  } else {
    for (const x of [-W / 2 + 0.02, W / 2 - 0.02]) {
      rose(x, H / 2);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, D - 0.012, 12), mm); post.rotation.x = Math.PI / 2; post.position.set(x, H / 2, 0.006); g.add(post);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, W - 0.02, 16), mm); bar.rotation.z = Math.PI / 2; bar.position.set(0, H / 2, D / 2 - 0.008); g.add(bar);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

// Deck-mounted basin / bath mixer: body at the back of the footprint, spout reaching forward to the front.
function deckTap(it, s, m) {
  const g = new THREE.Group();
  const W = Math.max(0.03, s.w * MM), D = Math.max(0.06, s.d * MM), H = Math.max(0.06, s.h * MM);
  const mm = metalMat(colourName(it));
  const square = /tecturis e|vernis shape|subway|finoris|metropol|square/i.test(m.name);
  const bw = Math.min(W, 0.055);
  const body = square ? new THREE.Mesh(new RoundedBoxGeometry(bw, H, bw, 3, 0.006), mm) : new THREE.Mesh(new THREE.CylinderGeometry(bw / 2, bw / 2 + 0.002, H, 32), mm);
  const bz = -D / 2 + bw / 2;
  body.position.set(0, H / 2, bz); g.add(body);
  const reach = D - bw / 2;
  const spout = square ? new THREE.Mesh(new RoundedBoxGeometry(bw * 0.7, 0.018, reach, 2, 0.006), mm) : new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, reach, 16), mm);
  if (!square) spout.rotation.x = Math.PI / 2;
  spout.position.set(0, H - 0.03, bz + reach / 2); g.add(spout);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.012, 0.075), mm);
  lever.position.set(0, H + 0.006, bz - 0.01); lever.rotation.x = -0.25; g.add(lever);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function handShower(it, s, m) {
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, H = s.h * MM;
  const mm = metalMat(colourName(it));
  const rail = m.kind === 'showerrail';
  if (rail) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, H, 16), mm); bar.position.set(0, H / 2, -D / 2 + 0.04); g.add(bar);
    for (const y of [0.03, H - 0.03]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.04), mm); b.position.set(0, y, -D / 2 + 0.02); g.add(b); }
  } else {
    const holder = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.04, 20), mm); holder.rotation.x = Math.PI / 2; holder.position.set(0, H * 0.25, -D / 2 + 0.02); g.add(holder);
  }
  if (rail && H > 0.85 && D > 0.3) {
    // shower system: riser with arm and overhead shower on top, thermostat at the bottom
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, D - 0.04, 16), mm); arm.rotation.x = Math.PI / 2; arm.position.set(0, H, -D / 2 + 0.04 + (D - 0.04) / 2 - 0.02); g.add(arm);
    const hr = Math.min(W, 0.3) / 2;
    const head = new THREE.Mesh(m.shape === 'rect' ? new RoundedBoxGeometry(hr * 2, 0.012, hr * 2, 3, 0.004) : new THREE.CylinderGeometry(hr, hr, 0.01, 48), mm);
    head.position.set(0, H - 0.01, D / 2 - hr); g.add(head);
    const thermo = new THREE.Mesh(new RoundedBoxGeometry(Math.max(0.3, W * 0.8), 0.06, 0.08, 3, 0.02), mm);
    thermo.position.set(0, 0.05, -D / 2 + 0.05); g.add(thermo);
  }
  // the hand shower itself, angled out from its holder
  const hs = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.016, 0.16, 16), mm); grip.position.y = 0.08; hs.add(grip);
  const hr = Math.max(0.045, Math.min(W / 2, 0.075));
  const head = new THREE.Mesh(new THREE.CylinderGeometry(hr, hr, 0.022, 32), mm); head.rotation.x = Math.PI / 2; head.position.set(0, 0.16 + hr * 0.8, 0.012); hs.add(head);
  const face = new THREE.Mesh(new THREE.CircleGeometry(hr - 0.006, 32), MATS.dark); face.position.set(0, 0.16 + hr * 0.8, 0.0235); hs.add(face);
  hs.position.set(0, rail ? H * 0.62 : H * 0.18, -D / 2 + 0.06); hs.rotation.x = -0.35;
  g.add(hs);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

// Toilet roll holders: wall rose, arm, rod and a real-size roll (Ø110 × 98 mm) with cardboard core.
function rollMesh(axis) {
  const g = new THREE.Group();
  const R = 0.055, L = 0.098;
  const paper = mat('#fbfaf6', { roughness: 0.95 });
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 48, 1, true), paper); g.add(roll);
  const endGeo = new THREE.RingGeometry(0.021, R, 48);
  for (const sgn of [1, -1]) {
    const e = new THREE.Mesh(endGeo, mat('#f3f1ea', { roughness: 0.95 })); e.rotation.x = -sgn * Math.PI / 2; e.position.y = sgn * L / 2; g.add(e);
    const core = new THREE.Mesh(new THREE.RingGeometry(0.0185, 0.021, 32), mat('#b8956a', { roughness: 0.9 })); core.rotation.x = -sgn * Math.PI / 2; core.position.y = sgn * (L / 2 + 0.0002); g.add(core);
  }
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.0185, 0.0185, L, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#9b7a52', side: THREE.BackSide, roughness: 0.9 })); g.add(tube);
  if (axis === 'x') g.rotation.z = Math.PI / 2;
  g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  return g;
}

function paperHolder(it, s, m) {
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, H = s.h * MM;
  const mm = metalMat(colourName(it));
  const n = m.name.toLowerCase();
  const back = -D / 2;
  const zc = back + 0.012 + 0.062;           // roll axis clear of the wall
  const yc = H / 2;
  const rose = (x, y) => { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 32), mm); r.rotation.x = Math.PI / 2; r.position.set(x, y, back + 0.006); g.add(r); };
  const armZ = (x, y) => { const len = zc - (back + 0.012); const a = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, len, 16), mm); a.rotation.x = Math.PI / 2; a.position.set(x, y, back + 0.012 + len / 2); g.add(a); };
  const rodX = (x0, x1, y) => { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, Math.abs(x1 - x0), 16), mm); r.rotation.z = Math.PI / 2; r.position.set((x0 + x1) / 2, y, zc); g.add(r); };
  const tail = (x, y) => { // loose sheet hanging down the front of the roll
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.096, 0.07), new THREE.MeshStandardMaterial({ color: '#fbfaf6', roughness: 0.95, side: THREE.DoubleSide }));
    sh.position.set(x, y - 0.035, zc + 0.0555); g.add(sh);
  };
  if (/replacement|spare/.test(n)) {
    // spare roll holder: vertical rod with a roll stacked on it
    const top = H - 0.02;
    rose(0, top); armZ(0, top);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, top - 0.01, 16), mm); rod.position.set(0, (top + 0.01) / 2, zc); g.add(rod);
    const r = rollMesh('y'); r.position.set(0, 0.06, zc); g.add(r);
    return g;
  }
  if (/double/.test(n)) {
    rose(0, yc); armZ(0, yc);
    for (const sgn of [-1, 1]) { rodX(0, sgn * 0.115, yc); const r = rollMesh('x'); r.position.set(sgn * 0.063, yc, zc); g.add(r); tail(sgn * 0.063, yc); }
    return g;
  }
  const x0 = -Math.max(W, 0.14) / 2 + 0.024;
  rose(x0, yc); armZ(x0, yc); rodX(x0, x0 + 0.115, yc);
  const rx = x0 + 0.012 + 0.051;
  const r = rollMesh('x'); r.position.set(rx, yc, zc); g.add(r); tail(rx, yc);
  if (/lid|cover/.test(n) && !/without/.test(n)) {
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.118, 48, 1, true, -0.25, Math.PI + 0.5), mm.clone());
    lid.material.side = THREE.DoubleSide; lid.rotation.z = Math.PI / 2; lid.position.set(rx, yc, zc); g.add(lid);
  }
  if (/shelf/.test(n)) box(Math.max(W, 0.15), 0.008, D, mm, x0 + Math.max(W, 0.15) / 2 - 0.024, yc + 0.07, 0, g);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function accessory(it, s, m) {
  if (/roll holder|paper holder|toilet roll|paper roll/i.test(m.name)) return paperHolder(it, s, m);
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, H = s.h * MM;
  const mm = metalMat(colourName(it));
  box(Math.min(W, 0.06), Math.min(H, 0.06), 0.01, mm, 0, H / 2, -D / 2 + 0.005, g);
  if (/shelf|basket|dish|holder|tray/i.test(m.name)) {
    box(W, 0.008, D - 0.01, /glass/i.test(m.name) ? MATS.glass : mm, 0, H * 0.2, 0.005, g);
  } else box(W, H, D, mm, 0, H / 2, 0, g);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

// Hand shower on a hose: wall outlet (FixFit) at the bottom, holder (Porter) at the top with the hand
// shower parked in it, and the hose hanging in a loop between them. Item height = outlet → holder.
function wallRose(parent, mm, x, y, back, r = 0.028) {
  const rose = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.012, 32), mm);
  rose.rotation.x = Math.PI / 2; rose.position.set(x, y, back + 0.006); parent.add(rose);
}
function handShowerMesh(mm, headW, square) {
  const hs = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.17, 20), mm); grip.position.y = 0.085; hs.add(grip);
  const hr = Math.max(0.04, Math.min(headW / 2, 0.07));
  const head = square ? new THREE.Mesh(new RoundedBoxGeometry(hr * 2, hr * 2, 0.022, 3, 0.012), mm) : new THREE.Mesh(new THREE.CylinderGeometry(hr, hr, 0.022, 40), mm);
  if (!square) head.rotation.x = Math.PI / 2;
  head.position.set(0, 0.17 + hr * 0.85, 0.012); hs.add(head);
  const face = new THREE.Mesh(square ? new THREE.PlaneGeometry(hr * 2 - 0.012, hr * 2 - 0.012) : new THREE.CircleGeometry(hr - 0.006, 40), MATS.dark);
  face.position.set(0, 0.17 + hr * 0.85, 0.0235); hs.add(face);
  return hs;
}
function porterSet(it, s, m) {
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, H = Math.max(0.18, s.h * MM);
  const mm = metalMat(colourName(it));
  const back = -D / 2;
  const square = m.shape === 'rect' && /\b(e|q)\b|square|angular/i.test(m.name);
  // wall outlet
  wallRose(g, mm, 0, 0.03, back, 0.026);
  const nip = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.03, 16), mm);
  nip.position.set(0, 0.012, back + 0.024); g.add(nip);
  // holder
  const hy = H - 0.03;
  wallRose(g, mm, 0, hy, back);
  const cradle = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.035, 0.05, 2, 0.008), mm);
  cradle.position.set(0, hy - 0.005, back + 0.035); cradle.rotation.x = 0.35; g.add(cradle);
  // hand shower parked in the holder, tilted away from the wall
  const hs = handShowerMesh(mm, W, square);
  const gripBottom = hy - 0.085;
  hs.position.set(0, gripBottom, back + 0.05); hs.rotation.x = -0.3; g.add(hs);
  // hose: from the outlet, down in a loop, and up into the bottom of the handle
  const z0 = back + 0.04, sag = Math.min(0.45, 0.2 + H * 0.4);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.004, z0),
    new THREE.Vector3(0.03, -sag * 0.55, z0 + 0.03),
    new THREE.Vector3(0.07, -sag, z0 + 0.06),
    new THREE.Vector3(0.09, -sag * 0.55, z0 + 0.05),
    new THREE.Vector3(0.05, gripBottom - 0.12, z0 + 0.02),
    new THREE.Vector3(0, gripBottom - 0.01, back + 0.05),
  ]);
  const hose = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.0065, 10), mm);
  g.add(hose);
  g.traverse((o) => (o.castShadow = true));
  return g;
}
function porter(it, s, m) {
  const g = new THREE.Group();
  const D = s.d * MM, H = s.h * MM, mm = metalMat(colourName(it)), back = -D / 2;
  const isOutlet = /fixfit/i.test(m.name);
  wallRose(g, mm, 0, H / 2, back, isOutlet ? 0.03 : 0.026);
  const cradle = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.035, Math.max(0.03, D - 0.012), 2, 0.008), mm);
  cradle.position.set(0, H / 2, back + 0.012 + Math.max(0.03, D - 0.012) / 2); cradle.rotation.x = 0.35; g.add(cradle);
  if (isOutlet) { const nip = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.03, 16), mm); nip.position.set(0, H / 2 - 0.03, back + 0.024); g.add(nip); }
  g.traverse((o) => (o.castShadow = true));
  return g;
}
function wallOutlet(it, s, m) {
  const g = new THREE.Group();
  const W = s.w * MM, D = s.d * MM, H = s.h * MM, mm = metalMat(colourName(it)), back = -D / 2;
  const square = /\bq\b|\be\b/i.test(m.name);
  const rose = square ? new THREE.Mesh(new RoundedBoxGeometry(W, H, 0.012, 2, 0.006), mm) : new THREE.Mesh(new THREE.CylinderGeometry(W / 2, W / 2, 0.012, 32), mm);
  if (!square) rose.rotation.x = Math.PI / 2;
  rose.position.set(0, H / 2, back + 0.006); g.add(rose);
  const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, D - 0.012, 16), mm);
  elbow.rotation.x = Math.PI / 2; elbow.position.set(0, H / 2, back + 0.012 + (D - 0.012) / 2); g.add(elbow);
  const nip = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.02, 16), mm);
  nip.position.set(0, H / 2 - 0.012, back + D - 0.012); g.add(nip);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

// Wet room panel: wall channel on one edge (cfg.channel 'start' = local −x), 8 mm glass, and a straight
// bracing bar from the top of the free end to the nearest wall on one side (cfg.brace 'auto' | 'front' | 'back').
export function braceInfo(it) {
  const s = sizeOf(it), cfg = it.cfg || {};
  const flip = cfg.channel === 'end' ? -1 : 1;              // which end is free
  const fx = flip * (s.w / 2 - 60);                          // bar sits 60 mm in from the free edge
  const r = it.rot * Math.PI / 180;
  const p = toWorld(it, fx, 0);
  const dirs = { front: { x: -Math.sin(r), y: Math.cos(r) }, back: { x: Math.sin(r), y: -Math.cos(r) } };
  const dist = (k) => rayToWalls(p, dirs[k], store.d.room.pts);
  let side = cfg.brace && cfg.brace !== 'auto' ? cfg.brace : null;
  if (!side) {
    const df = dist('front'), db = dist('back');
    side = df == null ? 'back' : db == null ? 'front' : df <= db ? 'front' : 'back';
  }
  const toWall = dist(side);
  const len = cfg.braceLen || (toWall != null ? Math.min(toWall, 1500) : 1000);
  return { side, fx, len, toWall, fits: toWall != null && len >= toWall - 5 && toWall <= 1000 + 5 };
}
function wetPanel(it, s, m) {
  const g = new THREE.Group();
  const W = s.w * MM, H = s.h * MM, T = Math.max(0.008, s.d * MM);
  const fin = colourName(it);
  const mm = metalMat(fin);
  const cfg = it.cfg || {};
  const flip = cfg.channel === 'end' ? -1 : 1;
  const glass = new THREE.MeshPhysicalMaterial({ color: '#e3eef0', metalness: 0, roughness: 0.04, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
  // glass sits in the channel (which takes ~12 mm) and stops 6 mm off the floor
  const gw = W - 0.012;
  box(gw, H - 0.006, T, glass, flip * 0.006, (H + 0.006) / 2, 0, g);
  // polished edges read slightly green
  const edge = new THREE.MeshStandardMaterial({ color: '#9fc7bf', transparent: true, opacity: 0.55, roughness: 0.1 });
  box(0.0015, H - 0.006, T + 0.0004, edge, flip * (W / 2 - 0.0008), (H + 0.006) / 2, 0, g);
  box(gw, 0.0015, T + 0.0004, edge, flip * 0.006, H - 0.0008, 0, g);
  // wall channel
  box(0.02, H, 0.022, mm, -flip * (W / 2 - 0.01), H / 2, 0, g);
  // bracing bar
  const b = braceInfo(it);
  const L = b.len * MM, sz = b.side === 'front' ? 1 : -1;
  const y = H - 0.035, x = b.fx * MM;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, L, 20), mm);
  bar.rotation.x = Math.PI / 2; bar.position.set(x, y, sz * L / 2); g.add(bar);
  const clamp = new THREE.Mesh(new RoundedBoxGeometry(0.045, 0.03, T + 0.024, 2, 0.006), mm);
  clamp.position.set(x, y, 0); g.add(clamp);
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.01, 24), mm);
  flange.rotation.x = Math.PI / 2; flange.position.set(x, y, sz * (L - 0.005)); g.add(flange);
  g.traverse((o) => { if (o.material !== glass) o.castShadow = true; });
  return g;
}

// Where a WC's flush plate goes (all mm). If there is boxing behind the pan:
//  - 'face': on the boxing face, centred ~110 mm below its top (max 1000 mm off the floor)
//  - 'top' : flat on top of the boxing, or in a worktop/shelf sitting on it, centred over the boxing depth
// With no boxing it is always on the wall at 1000 mm.
export function flushInfo(it, s = sizeOf(it)) {
  const behind = toWorld(it, 0, -s.d / 2 - 25);
  const host = store.d.items.find((o) => {
    if (o === it) return false;
    const k = modelOf(o)?.kind;
    if (k !== 'falsewall' && k !== 'box') return false;
    const os = sizeOf(o);
    return pointInPoly(behind, itemCorners(o, os.w, os.d));
  });
  if (!host) return { mode: 'face', faceY: 1000, host: null };
  const hs = sizeOf(host), hc = itemCorners(host, hs.w, hs.d);
  let depth = 25;
  while (depth < 800 && pointInPoly(toWorld(it, 0, -s.d / 2 - depth - 10), hc)) depth += 10;
  let top = host.elev + hs.h;
  const mid = toWorld(it, 0, -s.d / 2 - depth / 2);
  const shelf = store.d.items.find((o) => modelOf(o)?.kind === 'worktop' && Math.abs(o.elev - top) < 6 && pointInPoly(mid, itemCorners(o, sizeOf(o).w, sizeOf(o).d)));
  if (shelf) top = shelf.elev + sizeOf(shelf).h;
  const mode = it.cfg?.flush === 'top' ? 'top' : 'face';
  return { mode, faceY: Math.min(1000, host.elev + hs.h - 110), top, depth, host, onShelf: !!shelf };
}

export function buildItem(it) {
  const m = modelOf(it); if (!m) return null;
  const s = sizeOf(it), cfg = cfgOf(it), col = coloursOf(it);
  let g;
  switch (m.kind) {
    case 'basin': g = basin(it, s, cfg, col, m); break;
    case 'ctbasin': g = ctbasin(it, s, cfg, col, m); break;
    case 'worktop': case 'console': g = worktop(it, s, cfg, col, m); break;
    case 'mirror': g = mirror(it, s, cfg, col, m); break;
    case 'toilet': case 'wc': g = toilet(it, s, cfg, col, m); break;
    case 'bath': g = bath(it, s, cfg, col, m); break;
    case 'tray': g = tray(it, s, cfg, col, m); break;
    case 'glass': g = glass(it, s, cfg, col, m); break;
    case 'towelrail': case 'radiator': g = rail(it, s, cfg, col, m); break;
    case 'box': g = blockBox(it, s); break;
    case 'falsewall': g = falseWall(it, s, m); break;
    case 'walltap': g = wallTap(it, s, m); break;
    case 'showervalve': g = showerValve(it, s, m); break;
    case 'showerhead': g = showerHead(it, s, m); break;
    case 'towelholder': g = towelHolder(it, s, m); break;
    case 'tap': g = deckTap(it, s, m); break;
    case 'handshower': case 'showerrail': g = handShower(it, s, m); break;
    case 'accessory': g = accessory(it, s, m); break;
    case 'porterset': g = porterSet(it, s, m); break;
    case 'porter': g = porter(it, s, m); break;
    case 'walloutlet': g = wallOutlet(it, s, m); break;
    case 'wetpanel': g = wetPanel(it, s, m); break;
    case 'niche': g = niche(it, s, m); break;
    case 'shelf':
      if (s.h < 20) { g = new THREE.Group(); box(s.w * MM, s.h * MM, s.d * MM, MATS.glass, 0, s.h * MM / 2, 0, g); box(0.02, 0.03, 0.03, MATS.chrome, -s.w * MM / 2 + 0.04, -0.015, -s.d * MM / 2 + 0.015, g); box(0.02, 0.03, 0.03, MATS.chrome, s.w * MM / 2 - 0.04, -0.015, -s.d * MM / 2 + 0.015, g); }
      else g = cabinet(it, s, cfg, col, m);
      break;
    default: g = cabinet(it, s, cfg, col, m);
  }
  g.position.set(it.x * MM, it.elev * MM, it.y * MM);
  g.rotation.y = -it.rot * Math.PI / 180;
  g.userData.itemId = it.id;
  g.traverse((o) => { o.userData.itemId = it.id; });
  return g;
}
