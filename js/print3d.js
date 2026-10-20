// 3D-print export: the room rebuilt as simple, printable solids at model scale (millimetres, Z up).
//  - floor plate under the whole room (including the walls' footprint)
//  - walls as solid blocks, with door and window openings cut out, optionally cut down to a lower height
//  - fittings as blocks (round ones as cylinders); taps, rails and other tiny parts dropped; glass thickened
//  - wall-hung floor units (vanities, WCs, boxing…) optionally filled down to the floor so they print without supports
// Writes 3MF (room shell and fittings as separate objects, e.g. for two colours) or binary STL.
import * as THREE from 'three';
import { store, sizeOf, modelOf } from './state.js';
import { wallsOf, outerPts, itemCorners } from './geom.js';

const PLATE = 2;     // floor plate thickness, printed mm
const MIN_FEATURE = 0.8; // thinnest printable wall, printed mm
// fittings too fine or fiddly to print at model scale
const TINY = new Set(['tap', 'walltap', 'bathmixer', 'showervalve', 'showerhead', 'handshower', 'showerrail', 'porterset', 'porter', 'walloutlet', 'towelholder', 'accessory', 'fan', 'niche', 'towelrail', 'radiator']);
// wall-hung units that sit near the floor: fill underneath so they don't need supports
const FILL_UNDER = new Set(['vanity', 'base', 'open', 'toilet', 'wc', 'worktop', 'console', 'tall', 'bath', 'tray', 'box', 'falsewall']);

// ---- mesh building (positions in printed mm; every prism is a closed shell)
class Mesh {
  constructor(name) { this.name = name; this.v = []; this.t = []; this.vol = 0; }
  // vertical prism over a plan polygon (printed mm, any winding), from z0 to z1
  prism(poly, z0, z1) {
    if (z1 - z0 < 1e-3 || poly.length < 3) return;
    let a = 0;
    for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y; }
    const pts = a < 0 ? [...poly].reverse() : poly; // counter-clockwise seen from above
    const n = pts.length, base = this.v.length / 3;
    for (const p of pts) this.v.push(p.x, p.y, z0);
    for (const p of pts) this.v.push(p.x, p.y, z1);
    const tris = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p.x, p.y)), []);
    for (const [i, j, k] of tris) { this.t.push(base + i, base + k, base + j); this.t.push(base + n + i, base + n + j, base + n + k); }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.t.push(base + i, base + j, base + n + j, base + i, base + n + j, base + n + i);
    }
    this.vol += Math.abs(a) / 2 * (z1 - z0);
  }
  get empty() { return !this.t.length; }
}

const ellipse = (cx, cy, rx, ry, rot, segs = 32) => Array.from({ length: segs }, (_, i) => {
  const a = (i / segs) * Math.PI * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry, c = Math.cos(rot), s = Math.sin(rot);
  return { x: cx + x * c - y * s, y: cy + x * s + y * c };
});

// opts: { scale (e.g. 50 for 1:50), wallHeight (mm, real; 0 = full), small: 'drop'|'keep', fill: true/false }
export function buildPrint(opts, d = store.d) {
  const k = 1 / opts.scale;
  const P = (p) => ({ x: p.x * k, y: -p.y * k }); // plan y runs down the screen: flip so the print isn't mirrored
  const room = d.room, H = Math.min(room.height, opts.wallHeight || room.height);
  const shell = new Mesh('Room shell'), fits = new Mesh('Fittings');
  const walls = wallsOf(room.pts), outer = outerPts(room.pts, room.thickness), n = room.pts.length;
  const zTop = (mm) => PLATE + mm * k;

  shell.prism(outer.map(P), 0, PLATE);

  for (const w of walls) {
    const qa = outer[w.i], qb = outer[(w.i + 1) % n];
    const inner = (t) => ({ x: w.a.x + w.ux * t, y: w.a.y + w.uy * t });
    const outerAt = (t) => (t <= 0 ? qa : t >= w.len ? qb : { x: w.a.x + w.ux * t - w.nx * room.thickness, y: w.a.y + w.uy * t - w.ny * room.thickness });
    const piece = (t0, t1, y0, y1) => { if (y1 - y0 > 1 && t1 - t0 > 1) shell.prism([inner(t0), inner(t1), outerAt(t1), outerAt(t0)].map(P), zTop(y0), zTop(y1)); };
    const ops = d.openings.filter((o) => o.wall === w.i).sort((a, b) => a.offset - b.offset);
    let t = 0;
    for (const o of ops) {
      const t0 = Math.max(0, o.offset), t1 = Math.min(w.len, o.offset + o.width);
      piece(t, t0, 0, H);
      const sill = o.type === 'door' ? 0 : o.sill, head = sill + o.height;
      piece(t0, t1, 0, Math.min(H, sill));       // below a window
      if (head < H) piece(t0, t1, head, H);       // above the opening
      t = t1;
    }
    piece(t, w.len, 0, H);
  }

  const skipped = [];
  for (const it of d.items) {
    const m = modelOf(it); if (!m) continue;
    const s = sizeOf(it);
    if (TINY.has(m.kind) && opts.small !== 'keep') { skipped.push(m.name); continue; }
    if (it.elev >= H) { skipped.push(m.name); continue; } // entirely above the cut-down walls
    if (m.wet) continue; // the wet-room floor zone is a marking, not a thing
    // thin-but-large parts (glass, worktops, basins, mirrors) are thickened to the thinnest printable size, not dropped
    const minMM = MIN_FEATURE * opts.scale;
    const w = Math.max(s.w, minMM), dd = Math.max(s.d, minMM);
    const bottom = opts.fill && FILL_UNDER.has(m.kind) ? 0 : it.elev;
    const top = Math.min(H, Math.max(it.elev + s.h, bottom + minMM));
    const round = m.shape === 'round' || m.shape === 'oval';
    const foot = round ? ellipse(it.x, it.y, w / 2, dd / 2, it.rot * Math.PI / 180) : itemCorners(it, w, dd);
    const target = m.kind === 'falsewall' || m.kind === 'box' ? shell : fits;
    target.prism(foot.map(P), zTop(bottom), zTop(top));
  }

  // centre on the origin, sitting on Z = 0
  const all = [...shell.v, ...fits.v];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z1 = 0;
  for (let i = 0; i < all.length; i += 3) { x0 = Math.min(x0, all[i]); x1 = Math.max(x1, all[i]); y0 = Math.min(y0, all[i + 1]); y1 = Math.max(y1, all[i + 1]); z1 = Math.max(z1, all[i + 2]); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (const m of [shell, fits]) for (let i = 0; i < m.v.length; i += 3) { m.v[i] -= cx; m.v[i + 1] -= cy; }
  const volume = shell.vol + fits.vol; // mm³, overlaps counted twice so a slight over-estimate
  return { meshes: [shell, fits].filter((m) => !m.empty), size: { x: x1 - x0, y: y1 - y0, z: z1 }, volume, skipped };
}

// ---- writers
export function toSTL(meshes) {
  const tris = meshes.reduce((a, m) => a + m.t.length / 3, 0);
  const buf = new ArrayBuffer(84 + tris * 50), dv = new DataView(buf);
  new Uint8Array(buf).set(new TextEncoder().encode('Bathroom designer 3D print').slice(0, 80));
  dv.setUint32(80, tris, true);
  let o = 84;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (const m of meshes) for (let i = 0; i < m.t.length; i += 3) {
    a.fromArray(m.v, m.t[i] * 3); b.fromArray(m.v, m.t[i + 1] * 3); c.fromArray(m.v, m.t[i + 2] * 3);
    nrm.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    for (const v of [nrm, a, b, c]) { dv.setFloat32(o, v.x, true); dv.setFloat32(o + 4, v.y, true); dv.setFloat32(o + 8, v.z, true); o += 12; }
    o += 2;
  }
  return new Blob([buf], { type: 'model/stl' });
}

export function to3MF(meshes, title) {
  const f = (x) => +x.toFixed(3);
  const objects = meshes.map((m, i) => {
    let vs = '', ts = '';
    for (let j = 0; j < m.v.length; j += 3) vs += `<vertex x="${f(m.v[j])}" y="${f(m.v[j + 1])}" z="${f(m.v[j + 2])}"/>`;
    for (let j = 0; j < m.t.length; j += 3) ts += `<triangle v1="${m.t[j]}" v2="${m.t[j + 1]}" v3="${m.t[j + 2]}"/>`;
    return `<object id="${i + 1}" name="${m.name}" type="model"><mesh><vertices>${vs}</vertices><triangles>${ts}</triangles></mesh></object>`;
  }).join('');
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-GB" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${title.replace(/[<&"]/g, '')}</metadata><metadata name="Application">Bathroom Designer</metadata>
<resources>${objects}</resources>
<build>${meshes.map((_, i) => `<item objectid="${i + 1}"/>`).join('')}</build>
</model>`;
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'],
    ['3D/3dmodel.model', model],
  ]);
}

// Minimal zip (stored, no compression) — enough for a 3MF package.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true);
    parts.push(h.buffer, nb, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, offset, true);
    central.push(c.buffer, nb);
    offset += 30 + nb.length + data.length;
  }
  const size = central.reduce((a, p) => a + p.byteLength, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'model/3mf' });
}
