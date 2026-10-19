// Export the 3D scene for Twinmotion / Blender / SketchUp etc.
// GLB keeps materials and textures; OBJ+MTL is geometry with flat colours.
// Units: metres, Y up (glTF convention). Everything is exported, including walls hidden by the cutaway.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { v3 } from './view3d.js';
import { store, modelOf, variantOf } from './state.js';

function exportScene({ ceiling = false } = {}) {
  const root = new THREE.Group();
  root.name = 'Bathroom';
  const room = v3.roomGroup.clone(true); room.name = 'Room';
  const items = v3.itemGroup.clone(true); items.name = 'Fittings';
  root.add(room, items);

  let wn = 0;
  room.children.forEach((c) => {
    if (c.userData?.wall) c.name = `Wall ${++wn}`;
    else if (c.isMesh && !c.name) c.name = c.userData?.ceiling ? 'Ceiling' : 'Floor';
  });
  for (const g of items.children) {
    const it = store.d.items.find((o) => o.id === g.userData.itemId);
    const m = it && modelOf(it);
    const v = it && variantOf(it);
    g.name = m ? `${m.name}${v?.sku ? ' ' + v.sku : ''}`.replace(/[^\w\s.&()-]/g, '').slice(0, 80) : 'Item';
  }

  // live mirror reflections → a plain mirror material (other apps have their own reflections)
  // (each reflector has its plain mirror face next to it, hidden; the traverse below makes everything visible)
  const refl = [];
  root.traverse((o) => { if (o.isReflector) refl.push(o); });
  for (const r of refl) { r.parent.remove(r); r.getRenderTarget?.().dispose(); }

  const remove = [];
  root.traverse((o) => {
    if (o === v3.ceilingMesh || o.userData?.ceiling) { o.visible = ceiling; if (!ceiling) remove.push(o); return; }
    if (o.userData?.hallway) { remove.push(o); return; } // view-only scenery behind doors
    o.visible = true;
    // additive LED glow planes don't translate to other renderers
    if (o.material?.blending === THREE.AdditiveBlending) remove.push(o);
  });
  for (const o of remove) o.parent?.remove(o);

  // Flatten instanced meshes (fluting, grooves, drain slots) into ordinary meshes.
  const inst = [];
  root.traverse((o) => { if (o.isInstancedMesh) inst.push(o); });
  const m4 = new THREE.Matrix4();
  for (const im of inst) {
    const geos = [];
    for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m4); geos.push(im.geometry.clone().applyMatrix4(m4)); }
    const merged = geos.length ? mergeGeometries(geos) : null;
    if (merged) {
      const mesh = new THREE.Mesh(merged, im.material);
      mesh.position.copy(im.position); mesh.quaternion.copy(im.quaternion); mesh.scale.copy(im.scale);
      im.parent.add(mesh);
    }
    im.parent.remove(im);
  }

  // Bake texture repeat into UVs (many importers ignore texture transforms).
  const matCache = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
    const map = o.material.map;
    if (!map || (map.repeat.x === 1 && map.repeat.y === 1 && map.offset.x === 0 && map.offset.y === 0)) return;
    const geo = o.geometry.clone();
    const uv = geo.attributes.uv;
    if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * map.repeat.x + map.offset.x, uv.getY(i) * map.repeat.y + map.offset.y);
    o.geometry = geo;
    let mat = matCache.get(o.material);
    if (!mat) {
      mat = o.material.clone();
      mat.map = map.clone(); mat.map.repeat.set(1, 1); mat.map.offset.set(0, 0); mat.map.needsUpdate = true;
      matCache.set(o.material, mat);
    }
    o.material = mat;
  });
  root.updateMatrixWorld(true);
  return root;
}

function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function exportGLB(baseName, opts) {
  const root = exportScene(opts);
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(root, (buf) => { download(baseName + '.glb', buf, 'model/gltf-binary'); resolve(); }, reject, { binary: true, onlyVisible: true });
  });
}

function avgColour(mat) {
  const img = mat.map?.image;
  if (img && (img.width || img.naturalWidth)) {
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, 1, 1);
    const [r, gg, b] = g.getImageData(0, 0, 1, 1).data;
    return [r / 255, gg / 255, b / 255];
  }
  const col = (mat.color || new THREE.Color('#cccccc')).clone();
  const hex = col.getHex(); // sRGB
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

export function exportOBJ(baseName, opts) {
  const root = exportScene(opts);
  const mats = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) if (m && !mats.has(m)) { m.name = `mat_${mats.size}`; mats.set(m, m.name); }
  });
  let mtl = '# Bathroom Designer materials\n';
  for (const [m, name] of mats) {
    const [r, g, b] = avgColour(m);
    const metal = m.metalness ?? 0, rough = m.roughness ?? 0.6;
    mtl += `\nnewmtl ${name}\nKd ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}\nKa 0 0 0\n`;
    mtl += `Ks ${(0.04 + metal * 0.9).toFixed(3)} ${(0.04 + metal * 0.9).toFixed(3)} ${(0.04 + metal * 0.9).toFixed(3)}\nNs ${Math.round((1 - rough) * 900 + 10)}\n`;
    mtl += `d ${(m.transparent ? m.opacity : 1).toFixed(3)}\nillum 2\n`;
  }
  const obj = `# Bathroom Designer export — units: metres, Y up\nmtllib ${baseName}.mtl\n` + new OBJExporter().parse(root);
  download(baseName + '.obj', obj, 'text/plain');
  setTimeout(() => download(baseName + '.mtl', mtl, 'text/plain'), 400);
}
