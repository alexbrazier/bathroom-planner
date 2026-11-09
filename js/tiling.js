// Tile schedule. Every tiled surface of a room — wall zones, boxing faces and tops, niches, window reveals and the
// floor — is laid out tile by tile (grout joint, bond and balanced edge cuts), so full tiles and cut pieces are
// counted rather than guessed from the area. Each cut piece comes out of a whole tile, or out of an offcut that is
// big enough for the whole piece — pieces are never patched together from scraps.
//
// Data: project.tiles = [tile product], project.tileOpts = { reuse }, and per room design.tiling:
//   { wall, floor: tile id ('' = no tiles), walls: { [wall index]: [{ to, h, tile }] }, faces: { [key]: tile id | 'none' },
//     reveals, revealDepth, behind }
// Wall zones run left → right as you face the wall from inside the room; `to` is the zone's right edge (mm from the
// left corner, the last zone always runs to the corner). h: 'default' | 'full' | 'none' | mm. The default tile
// height is the room's wall-tile height (room.wallTile), so the 3D view and elevations stay in step.
import { wallsOf, itemCorners, slopeOf, clipHalf, toWorld, polyBounds, signedArea } from './geom.js';
import { modelOf, sizeOf, nicheOf, uid } from './state.js';

const TOUCH = 20;      // a fitting this close to a face counts as standing against it (mm)
const KERF = 3;        // lost to each cut (mm)
const MIN_OFFCUT = 30; // narrower offcuts are thrown away (mm)
const SLIVER = 3;      // thinner slivers are left to the grout / silicone (mm)

export const PATTERNS = { stack: { label: 'Stack (grid)', shift: 0 }, brick: { label: 'Brick bond (½ offset)', shift: 0.5 }, third: { label: '⅓ offset', shift: 1 / 3 } };

export function newTile(o = {}) {
  return { id: uid(), name: 'Wall tile', brand: '', w: 300, h: 600, joint: 2, pattern: 'stack', turn: false, extra: 10, perBox: 0, colour: '#f3f2ef', ...o };
}
export const tilesOf = (project) => project?.tiles || [];
export const tileById = (project, id) => tilesOf(project).find((t) => t.id === id) || null;
// Laid size: width along the surface, height up the wall (or down the plan for floors).
export const laidSize = (t) => (t.turn ? { w: t.h, h: t.w } : { w: t.w, h: t.h });
export const tileLabel = (t) => (t ? `${t.brand ? t.brand + ' ' : ''}${t.name}`.trim() : '');

// The room's tiling settings with defaults filled in (doesn't change the design).
export function tilingOf(design, project) {
  const t = design.tiling || {}, room = design.room, tiles = tilesOf(project);
  const pick = (v, dflt) => (v === '' ? '' : tiles.some((x) => x.id === v) ? v : dflt);
  const floorDflt = (tiles.find((x) => /floor/i.test(x.name)) || tiles[1] || tiles[0])?.id || '';
  const wt = room.wallTile || {};
  return {
    wall: pick(t.wall, tiles.find((x) => !/floor/i.test(x.name))?.id || tiles[0]?.id || ''),
    floor: pick(t.floor, floorDflt),
    height: !wt.enabled ? 0 : wt.height >= room.height ? Infinity : wt.height,
    walls: t.walls || {}, faces: t.faces || {},
    reveals: t.reveals ?? true, revealDepth: t.revealDepth ?? room.thickness, behind: t.behind ?? true,
  };
}

// Is a wall's start (a) on the left as you face it from inside the room? (as in elevation.js)
function aLeft(w) { const fx = -w.nx, fy = -w.ny; return -fy * w.ux + fx * w.uy > 0; }

// Wall i's zones, left → right: [{ x0, x1, top (mm, Infinity = full), tile, h, idx }]
export function zonesOf(cfg, i, len) {
  const raw = (cfg.walls[i] || []).filter((z) => z);
  const list = raw.length ? raw : [{ h: 'default', tile: '' }];
  const out = []; let x0 = 0;
  list.forEach((z, k) => {
    const last = k === list.length - 1, x1 = last ? len : Math.max(x0, Math.min(len, +z.to || 0));
    const top = z.h === 'full' ? Infinity : z.h === 'none' ? 0 : z.h === 'default' || z.h == null ? cfg.height : Math.max(0, +z.h);
    out.push({ x0, x1, top, tile: z.tile === 'none' ? '' : z.tile || cfg.wall, h: z.h ?? 'default', idx: k });
    x0 = x1;
  });
  return out;
}

// ---- polygon helpers (plain {x, y} arrays; the second axis is "up" for wall faces)
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const areaOf = (p) => Math.abs(signedArea(p));
const clipBox = (p, x0, y0, x1, y1) => {
  p = clipHalf(p, { x: x0, y: 0 }, 1, 0, 0); if (p.length < 3) return p;
  p = clipHalf(p, { x: x1, y: 0 }, -1, 0, 0); if (p.length < 3) return p;
  p = clipHalf(p, { x: 0, y: y0 }, 0, 1, 0); if (p.length < 3) return p;
  return clipHalf(p, { x: 0, y: y1 }, 0, -1, 0);
};
// not just a sliver (e.g. a fitting drawn a millimetre short of the corner)
const solid = (p) => { const b = polyBounds(p); return Math.min(b.w, b.h) >= SLIVER; };
// polys minus a convex hole: the parts outside each hole edge, in turn, inside the edges before it
function subtract(polys, hole) {
  if (hole.length < 3 || areaOf(hole) < 1) return polys;
  const hb = polyBounds(hole), cx = hole.reduce((s, p) => s + p.x, 0) / hole.length, cy = hole.reduce((s, p) => s + p.y, 0) / hole.length;
  const edges = hole.map((p, k) => {
    const q = hole[(k + 1) % hole.length]; let nx = q.y - p.y, ny = p.x - q.x;
    if ((cx - p.x) * nx + (cy - p.y) * ny > 0) { nx = -nx; ny = -ny; }
    return { p, nx, ny };
  });
  const out = [];
  for (const poly of polys) {
    const b = polyBounds(poly);
    if (b.x1 <= hb.x0 || b.x0 >= hb.x1 || b.y1 <= hb.y0 || b.y0 >= hb.y1) { out.push(poly); continue; }
    let rest = poly;
    for (const e of edges) {
      const o = clipHalf(rest, e.p, e.nx, e.ny, 0);
      if (o.length >= 3 && areaOf(o) > 0.5) out.push(o);
      rest = clipHalf(rest, e.p, -e.nx, -e.ny, 0);
      if (rest.length < 3) break;
    }
  }
  return out;
}

// ---- surfaces
const HIDES = new Set(['falsewall', 'box', 'bath', 'tray']);
const FURNITURE = new Set(['vanity', 'base', 'open', 'tall', 'wall', 'worktop', 'console']);
const shortName = (m) => m.name.replace(/^Villeroy & Boch /, 'V&B ').replace(/^hansgrohe /, '').replace(/\s*\(.*?\)\s*/g, ' ').trim();

// Every surface that can be tiled in this room: { key, ovKey, group, label, kind: 'wall'|'box'|'top'|'niche'|'reveal'|'floor',
// plane: 'v' (x along, y up) | 'h' (plan), polys, tile (id or ''), zone }
export function surfacesOf(design, project) {
  const cfg = tilingOf(design, project), room = design.room, walls = wallsOf(room.pts), sl = slopeOf(room);
  const zones = walls.map((w) => zonesOf(cfg, w.i, w.len));
  const left = walls.map(aLeft);
  const items = design.items.map((it) => { const m = modelOf(it); if (!m) return null; const s = sizeOf(it); return { it, m, s, cs: itemCorners(it, s.w, s.d) }; }).filter(Boolean);
  const dflt = { top: cfg.height, tile: cfg.wall };
  const hostX = (i, P) => { const w = walls[i], t = (P.x - w.a.x) * w.ux + (P.y - w.a.y) * w.uy; return left[i] ? t : w.len - t; };
  const zoneAt = (i, x) => (i == null ? dflt : zones[i].find((z) => x >= z.x0 && x <= z.x1) || zones[i][zones[i].length - 1]);
  const over = (key, auto) => { const o = cfg.faces[key]; return o === 'none' ? '' : o && tilesOf(project).some((t) => t.id === o) ? o : auto; };
  const hides = (x) => HIDES.has(x.m.kind) && !(x.m.kind === 'bath' && x.m.shape === 'oval') && !(x.m.kind === 'tray' && x.m.wet)
    || (!cfg.behind && FURNITURE.has(x.m.kind));
  const out = [];

  const nicheParts = (base, W, H, D, tile, label, group) => {
    if (W < 1 || H < 1 || D < 1) return;
    out.push({ key: base + ':back', ovKey: base, group, label: `${label} — back`, kind: 'niche', plane: 'v', polys: [rect(0, 0, W, H)], tile });
    out.push({ key: base + ':l', ovKey: base, group, label: `${label} — left side`, kind: 'niche', plane: 'v', polys: [rect(0, 0, D, H)], tile });
    out.push({ key: base + ':r', ovKey: base, group, label: `${label} — right side`, kind: 'niche', plane: 'v', polys: [rect(0, 0, D, H)], tile });
    out.push({ key: base + ':b', ovKey: base, group, label: `${label} — shelf`, kind: 'niche', plane: 'h', polys: [rect(0, 0, W, D)], tile });
    out.push({ key: base + ':t', ovKey: base, group, label: `${label} — top`, kind: 'niche', plane: 'h', polys: [rect(0, 0, W, D)], tile });
  };

  // A vertical face from P0 to P1 (plan mm), seen from the side n points to, v0..v1 mm above the floor.
  function face({ P0, P1, n, v0, v1, host, key, label, group, kind, self, back, depth, ops = [], own = null }) {
    let ex = P1.x - P0.x, ey = P1.y - P0.y;
    if (n.y * ex - n.x * ey < 0) { [P0, P1] = [P1, P0]; ex = -ex; ey = -ey; } // left → right as seen (cf. aLeft)
    const len = Math.hypot(ex, ey); if (len < 1) return;
    const e = { x: ex / len, y: ey / len };
    const S = (P) => (P.x - P0.x) * e.x + (P.y - P0.y) * e.y, D = (P) => (P.x - P0.x) * n.x + (P.y - P0.y) * n.y;
    const holes = [], niches = [];
    for (const o of ops) {
      const a = { x: o.A.x, y: o.A.y }, b = { x: o.B.x, y: o.B.y };
      const s0 = Math.min(S(a), S(b)), s1 = Math.max(S(a), S(b));
      holes.push(rect(s0, o.y0, s1, o.y1));
    }
    for (const x of items) {
      if (x.it === self) continue;
      const ds = x.cs.map(D), ss = x.cs.map(S), dmin = Math.min(...ds), dmax = Math.max(...ds);
      const s0 = Math.max(0, Math.min(...ss)), s1 = Math.min(len, Math.max(...ss));
      if (s1 - s0 < 1) continue;
      const y0 = x.it.elev, y1 = x.it.elev + x.s.h;
      if (x.m.kind === 'niche') {
        const F = toWorld(x.it, 0, x.s.d / 2), r = x.it.rot * Math.PI / 180;
        if (Math.abs(D(F)) > TOUCH || -Math.sin(r) * n.x + Math.cos(r) * n.y < 0.98) continue;
        const c = S(F), n0 = Math.max(0, c - x.s.w / 2), n1 = Math.min(len, c + x.s.w / 2), b0 = Math.max(v0, y0), b1 = Math.min(v1, y1);
        if (n1 - n0 < 1 || b1 - b0 < 1) continue;
        holes.push(rect(n0, b0, n1, b1));
        niches.push({ key: 'n:' + x.it.id, s: (n0 + n1) / 2, W: n1 - n0, H: b1 - b0, bottom: b0, D: Math.min(x.s.d, depth - 15), label: `Niche ${Math.round(n1 - n0)}×${Math.round(b1 - b0)}` });
      } else if (hides(x)) {
        if (dmin <= TOUCH && dmax > 5 && dmin >= -back) holes.push(rect(s0, y0, s1, y1));
      } else if (x.m.kind !== 'falsewall' && x.m.kind !== 'box' && dmax >= -5 && dmax <= 25 && dmin < -15) {
        holes.push(rect(s0, y0, s1, y1)); // recessed into the wall (in-built mirror cabinet)
      }
    }
    if (own) {
      const b0 = Math.max(v0, own.bottom), b1 = Math.min(v1, own.bottom + own.height);
      if (b1 - b0 >= 1) { holes.push(rect(0, b0, len, b1)); niches.push({ key: 'n:' + self.id, s: len / 2, W: len, H: b1 - b0, bottom: b0, D: Math.min(own.depth, depth - 15), label: `Built-in niche ${Math.round(len)}×${Math.round(b1 - b0)}` }); }
    }
    // zones of the host wall along this face
    const at = (s) => ({ x: P0.x + e.x * s, y: P0.y + e.y * s });
    let parts;
    if (host == null) parts = [{ s0: 0, s1: len, z: dflt }];
    else {
      const xa = hostX(host, P0), xb = hostX(host, P1);
      if (Math.abs(xb - xa) < 1) {
        const c = self ? hostX(host, { x: self.x, y: self.y }) : xa;
        parts = [{ s0: 0, s1: len, z: zoneAt(host, xa + Math.sign(c - xa)) }];
      } else {
        const toS = (x) => ((x - xa) / (xb - xa)) * len;
        const cuts = [...new Set([0, len, ...zones[host].flatMap((z) => [toS(z.x0), toS(z.x1)]).filter((s) => s > 0 && s < len)])].sort((a, b) => a - b);
        parts = [];
        for (let k = 0; k < cuts.length - 1; k++) if (cuts[k + 1] - cuts[k] > 0.5) parts.push({ s0: cuts[k], s1: cuts[k + 1], z: zoneAt(host, hostX(host, at((cuts[k] + cuts[k + 1]) / 2))) });
      }
    }
    // ceiling (flat, or sloped: linear along the face)
    const ceilClip = (p) => {
      p = clipHalf(p, { x: 0, y: room.height }, 0, -1, 0);
      if (sl && p.length >= 3) {
        const d0 = (P0.x - sl.w.a.x) * sl.w.nx + (P0.y - sl.w.a.y) * sl.w.ny, dd = e.x * sl.w.nx + e.y * sl.w.ny;
        p = clipHalf(p, { x: 0, y: sl.low + sl.k * d0 }, sl.k * dd, -1, 0);
      }
      return p;
    };
    // one surface per tile on this face, so a tile straddling two zones counts once
    const byTile = new Map();
    for (const p of parts) {
      const tile = kind === 'wall' ? p.z.tile : over(key, p.z.tile);
      const top = Math.min(v1, p.z.top);
      if (top - v0 < SLIVER || (!tile && kind === 'wall')) continue;
      let polys = [ceilClip(rect(p.s0, v0, p.s1, top))].filter((q) => q.length >= 3);
      for (const h of holes) polys = subtract(polys, h);
      polys = polys.filter(solid);
      if (!polys.length) continue;
      const g = byTile.get(tile) || { polys: [], zones: [] };
      g.polys.push(...polys); g.zones.push(p.z); byTile.set(tile, g);
    }
    for (const [tile, g] of byTile) out.push({ key: `${key}|${tile}`, ovKey: kind === 'wall' ? null : key, group, label, kind, plane: 'v', polys: g.polys, tile, len, zones: g.zones });
    for (const nc of niches) {
      const z = host == null ? dflt : zoneAt(host, hostX(host, at(nc.s)));
      nicheParts(nc.key, nc.W, nc.H, nc.D, over(nc.key, z.top > nc.bottom ? z.tile : ''), nc.label, group);
    }
  }

  // room walls
  for (const w of walls) {
    const n = { x: w.nx, y: w.ny };
    const ops = design.openings.filter((o) => o.wall === w.i).map((o) => {
      const sill = o.type === 'door' ? 0 : o.sill || 0;
      return { o, A: { x: w.a.x + w.ux * o.offset, y: w.a.y + w.uy * o.offset }, B: { x: w.a.x + w.ux * (o.offset + o.width), y: w.a.y + w.uy * (o.offset + o.width) }, y0: sill, y1: sill + o.height };
    });
    face({ P0: w.a, P1: w.b, n, v0: 0, v1: room.height, host: w.i, key: 'w' + w.i, label: `Wall ${w.i + 1}`, group: w.i, kind: 'wall', back: room.thickness + 5, depth: room.thickness, ops });
    // window reveals
    for (const op of ops) {
      if (op.o.type !== 'window') continue;
      const o = op.o, T = cfg.revealDepth, key = 'r:' + o.id;
      const z = zoneAt(w.i, hostX(w.i, { x: (op.A.x + op.B.x) / 2, y: (op.A.y + op.B.y) / 2 }));
      const forced = cfg.faces[key] && cfg.faces[key] !== 'none';
      const tile = over(key, cfg.reveals && z.top > op.y0 ? z.tile : '');
      const top = forced ? op.y1 : Math.min(op.y1, z.top, room.height);
      if (T < 1 || top - op.y0 < 1) continue;
      const label = `Window reveal ${o.width}×${o.height}`;
      out.push({ key: key + ':l', ovKey: key, group: w.i, label: `${label} — left`, kind: 'reveal', plane: 'v', polys: [rect(0, 0, T, top - op.y0)], tile });
      out.push({ key: key + ':r', ovKey: key, group: w.i, label: `${label} — right`, kind: 'reveal', plane: 'v', polys: [rect(0, 0, T, top - op.y0)], tile });
      if (op.y0 > 0) out.push({ key: key + ':s', ovKey: key, group: w.i, label: `${label} — sill`, kind: 'reveal', plane: 'h', polys: [rect(0, 0, o.width, T)], tile });
      if (op.y1 <= top) out.push({ key: key + ':h', ovKey: key, group: w.i, label: `${label} — head`, kind: 'reveal', plane: 'h', polys: [rect(0, 0, o.width, T)], tile });
    }
  }

  // boxing and built-out walls: their exposed faces and tops
  for (const x of items) {
    if (x.m.kind !== 'falsewall' && x.m.kind !== 'box') continue;
    // the wall it's built against (longest contact) supplies the tile zones
    let host = null, best = 0;
    for (const w of walls) {
      const ds = x.cs.map((p) => (p.x - w.a.x) * w.nx + (p.y - w.a.y) * w.ny);
      if (Math.min(...ds) > TOUCH || Math.min(...ds) < -room.thickness) continue;
      const ts = x.cs.map((p) => (p.x - w.a.x) * w.ux + (p.y - w.a.y) * w.uy);
      const c = Math.min(w.len, Math.max(...ts)) - Math.max(0, Math.min(...ts));
      if (c > best) { best = c; host = w.i; }
    }
    const name = `${shortName(x.m)} ${Math.round(x.s.w)}×${Math.round(x.s.d)}×${Math.round(x.s.h)}`;
    const group = host ?? 'other';
    const ctr = { x: x.it.x, y: x.it.y };
    const nn = nicheOf(x.it);
    const sideName = ['back', 'end', 'front', 'end'];
    for (let k = 0; k < 4; k++) {
      const P0 = x.cs[k], P1 = x.cs[(k + 1) % 4];
      const mx = (P0.x + P1.x) / 2, my = (P0.y + P1.y) / 2;
      let nx = -(P1.y - P0.y), ny = P1.x - P0.x; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      if ((mx - ctr.x) * nx + (my - ctr.y) * ny < 0) { nx = -nx; ny = -ny; }
      // against a room wall: nothing to tile
      if (walls.some((w) => nx * w.nx + ny * w.ny < -0.9 && Math.abs((mx - w.a.x) * w.nx + (my - w.a.y) * w.ny) <= TOUCH)) continue;
      face({ P0, P1, n: { x: nx, y: ny }, v0: x.it.elev, v1: x.it.elev + x.s.h, host, key: `b:${x.it.id}:${k}`, label: `${name} — ${sideName[k]}`, group, kind: 'box', self: x.it, back: 5,
        depth: k % 2 ? x.s.w : x.s.d, own: k === 2 && x.m.kind === 'falsewall' && nn.on && nn.height > 0 ? nn : null });
    }
    // top: tiled when the wall tiling carries on above it, unless a worktop sits on it
    const topV = x.it.elev + x.s.h, key = `b:${x.it.id}:top`;
    const z = host == null ? dflt : zoneAt(host, hostX(host, ctr));
    const covered = items.some((o) => (o.m.kind === 'worktop' || o.m.kind === 'console') && Math.abs(o.it.elev - topV) <= 30 && Math.hypot(o.it.x - ctr.x, o.it.y - ctr.y) < Math.max(x.s.w, x.s.d) / 2);
    const tile = over(key, z.top > topV + 10 && !covered ? z.tile : '');
    if (topV < room.height - 10 && (tile || cfg.faces[key])) out.push({ key, ovKey: key, group, label: `${name} — top`, kind: 'top', plane: 'h', polys: [x.cs], tile });
  }

  // floor (fixed baths, trays and boxing aren't tiled under; wet-room areas are their own surface)
  const floorHoles = items.filter((x) => x.it.elev <= 5 && (x.m.kind === 'falsewall' || x.m.kind === 'box' || (x.m.kind === 'bath' && x.m.shape !== 'oval') || (x.m.kind === 'tray' && !x.m.wet)));
  const wets = items.filter((x) => x.m.kind === 'tray' && x.m.wet);
  let fl = [room.pts.map((p) => ({ x: p.x, y: p.y }))];
  for (const h of [...floorHoles, ...wets]) fl = subtract(fl, h.cs);
  fl = fl.filter(solid);
  if (fl.length) out.push({ key: 'floor', ovKey: 'floor', group: 'floor', label: 'Floor', kind: 'floor', plane: 'h', polys: fl, tile: over('floor', cfg.floor) });
  for (const wx of wets) {
    let p = [room.pts.map((q) => ({ x: q.x, y: q.y }))];
    // room ∩ wet area: room minus everything outside the wet area's (convex) footprint
    const b = polyBounds(wx.cs), big = 1e5;
    p = subtract(p, rect(b.x0 - big, b.y0 - big, b.x1 + big, b.y0)); p = subtract(p, rect(b.x0 - big, b.y1, b.x1 + big, b.y1 + big));
    p = subtract(p, rect(b.x0 - big, b.y0, b.x0, b.y1)); p = subtract(p, rect(b.x1, b.y0, b.x1 + big, b.y1));
    for (const h of floorHoles) p = subtract(p, h.cs);
    p = p.filter(solid);
    if (p.length) out.push({ key: 'wet:' + wx.it.id, ovKey: 'wet:' + wx.it.id, group: 'floor', label: `Wet-room floor ${Math.round(wx.s.w)}×${Math.round(wx.s.d)}`, kind: 'floor', plane: 'h', polys: p, tile: over('wet:' + wx.it.id, cfg.floor) });
  }
  return out;
}

// ---- laying out tiles
// Where the grid can start along one axis: a full tile at the start (the floor, or the left corner), at the far end,
// or the layout centred on a tile or on a joint.
const phases = (lo, hi, t, p) => { const c = (lo + hi) / 2; return [lo, hi - t, c - t / 2, c + (p - t) / 2]; };

// Tiles over polys (holes already cut out). Every combination of start points is laid out; a layout is "good" when
// no cut is thinner than a third of the tile (or 150 mm), and the good layout with the fewest pieces (the biggest
// pieces, fewest joints) wins, then the one needing fewest tiles — a face is never chopped into strips just to get
// more pieces out of each tile. Slivers beside doors, windows and boxing are avoided as well as at the corners.
// If no layout is good, the one whose thinnest cut is widest wins. Returns { area (mm²), pieces: [{ w, h, full }], cells: [{ x, y, full }], tw, th }.
export function layTiles(polys, tile) {
  const { w: tw, h: th } = laidSize(tile), g = Math.max(0, +tile.joint || 0), shift = PATTERNS[tile.pattern]?.shift || 0;
  const area = polys.reduce((s, p) => s + areaOf(p), 0);
  if (!polys.length || area < 1) return { area, pieces: [], cells: [], tw, th };
  const b = polyBounds(polys.flat()), pu = tw + g, pv = th + g;
  const at = (fu, fv) => {
    const pieces = [], cells = [];
    const j0 = Math.floor((b.y0 - fv) / pv);
    for (let j = j0; fv + j * pv < b.y1; j++) {
      const y = fv + j * pv;
      const strip = polys.map((p) => clipBox(p, -Infinity, y, Infinity, y + th)).filter((p) => p.length >= 3 && areaOf(p) > 0.01);
      if (!strip.length) continue;
      const sb = polyBounds(strip.flat());
      const fx = fu + (((j - j0) * shift) % 1) * pu;
      for (let x = fx + Math.floor((sb.x0 - fx) / pu) * pu; x < sb.x1; x += pu) {
        let a = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of strip) {
          const c = clipBox(p, x, y, x + tw, y + th);
          if (c.length < 3) continue;
          const ca = areaOf(c); if (ca < 0.01) continue;
          a += ca;
          for (const q of c) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
        }
        if (a < 1 || x1 - x0 < SLIVER || y1 - y0 < SLIVER) continue;
        const full = a >= tw * th - (tw + th) * 0.5;
        pieces.push(full ? { w: tw, h: th, full } : { w: x1 - x0, h: y1 - y0, full });
        cells.push({ x, y, full });
      }
    }
    // the thinnest cut, in mm and as a share of the tile
    let thin = Infinity, ok = true;
    for (const p of pieces) {
      if (p.full) continue;
      for (const [v, t] of [[p.w, tw], [p.h, th]]) if (v < t - 1) { thin = Math.min(thin, v); if (v < Math.min(t / 3, 150) - 0.5) ok = false; }
    }
    return { pieces, cells, thin, ok, tiles: countTiles(pieces, tile).tiles };
  };
  let best = null, order = 0;
  for (const fv of phases(b.y0, b.y1, th, pv)) for (const fu of phases(b.x0, b.x1, tw, pu)) {
    const L = at(fu, fv); L.order = order++;
    if (!best) { best = L; continue; }
    const better = L.ok !== best.ok ? L.ok
      : L.ok ? L.pieces.length < best.pieces.length || (L.pieces.length === best.pieces.length && L.tiles < best.tiles)
      : L.thin > best.thin + 0.5 || (Math.abs(L.thin - best.thin) <= 0.5 && L.tiles < best.tiles);
    if (better) best = L;
  }
  return { area, pieces: best.pieces, cells: best.cells, tw, th, ok: best.ok };
}

// How many tiles the pieces take: a full tile each, and cut pieces from a fresh tile or (reuse) from an offcut
// that holds the whole piece. Biggest pieces first; offcuts are cut guillotine-style, keeping the larger leftover.
export function countTiles(pieces, tile, reuse = true) {
  const { w: tw, h: th } = laidSize(tile);
  const cuts = pieces.filter((p) => !p.full).sort((a, b) => b.w * b.h - a.w * a.h);
  const full = pieces.length - cuts.length;
  const offcuts = [];
  let fresh = 0, fromOffcut = 0;
  for (const p of cuts) {
    let bi = -1;
    if (reuse) offcuts.forEach((o, i) => { if (o.w >= p.w && o.h >= p.h && (bi < 0 || o.w * o.h < offcuts[bi].w * offcuts[bi].h)) bi = i; });
    let src;
    if (bi >= 0) { src = offcuts.splice(bi, 1)[0]; fromOffcut++; } else { src = { w: tw, h: th }; fresh++; }
    const rw = src.w - p.w - KERF, rh = src.h - p.h - KERF;
    const A = [{ w: rw, h: src.h }, { w: p.w, h: rh }], B = [{ w: src.w, h: rh }, { w: rw, h: p.h }];
    const big = (s) => Math.max(0, ...s.filter((o) => o.w > 0 && o.h > 0).map((o) => o.w * o.h));
    for (const o of big(A) >= big(B) ? A : B) if (o.w >= MIN_OFFCUT && o.h >= MIN_OFFCUT) offcuts.push(o);
  }
  return { full, cut: cuts.length, fresh, fromOffcut, tiles: full + fresh, noReuse: pieces.length };
}

// Order quantity: tiles needed plus the extra allowance, rounded up to whole boxes when the box size is known.
export function orderOf(tile, needed) {
  const order = Math.ceil(needed * (1 + (+tile.extra || 0) / 100) - 1e-9);
  const per = +tile.perBox || 0;
  const boxes = per > 0 ? Math.ceil(order / per) : null;
  return { order: boxes ? boxes * per : order, boxes, m2: ((boxes ? boxes * per : order) * tile.w * tile.h) / 1e6 };
}

// Everything for one room: surfaces with their layouts, and one row per tile.
export function roomSchedule(design, project) {
  const reuse = project?.tileOpts?.reuse ?? true;
  const surfaces = surfacesOf(design, project);
  const rows = new Map();
  for (const s of surfaces) {
    const t = tileById(project, s.tile);
    if (!t) continue;
    s.lay = layTiles(s.polys, t);
    if (!s.lay.pieces.length) { s.empty = true; continue; } // only slivers under the grout line
    const cuts = s.lay.pieces.filter((p) => !p.full);
    s.minCut = cuts.length ? Math.min(...cuts.map((p) => Math.min(p.w, p.h))) : null;
    const r = rows.get(t.id) || { tile: t, area: 0, pieces: [], surfaces: [] };
    r.area += s.lay.area; r.pieces.push(...s.lay.pieces); r.surfaces.push(s); rows.set(t.id, r);
  }
  for (const r of rows.values()) { r.count = countTiles(r.pieces, r.tile, reuse); Object.assign(r, orderOf(r.tile, r.count.tiles)); }
  return { surfaces, rows: [...rows.values()] };
}

// Whole project: per tile, the tiles each room needs and the order for all of them together.
export function projectSchedule(project) {
  const rooms = project.rooms.map((r) => ({ room: r, sch: roomSchedule(r.design, project) }));
  const totals = new Map();
  for (const { room, sch } of rooms) for (const row of sch.rows) {
    const t = totals.get(row.tile.id) || { tile: row.tile, area: 0, needed: 0, full: 0, cut: 0, rooms: [] };
    t.area += row.area; t.needed += row.count.tiles; t.full += row.count.full; t.cut += row.count.cut;
    t.rooms.push({ name: room.name, needed: row.count.tiles, area: row.area });
    totals.set(row.tile.id, t);
  }
  for (const t of totals.values()) Object.assign(t, orderOf(t.tile, t.needed));
  return { rooms, totals: [...totals.values()] };
}

// Full height around showers and baths: on each wall, the stretch behind a shower tray, wet-room area or bath
// (directly or via boxing built on that wall) goes full height; the rest of the wall keeps the room default.
export function wetZones(design) {
  const room = design.room, walls = wallsOf(room.pts), out = {};
  const items = design.items.map((it) => { const m = modelOf(it); if (!m) return null; const s = sizeOf(it); return { it, m, s, cs: itemCorners(it, s.w, s.d) }; }).filter(Boolean);
  const wet = items.filter((x) => x.m.kind === 'tray' || x.m.kind === 'bath');
  const boxes = items.filter((x) => x.m.kind === 'falsewall' || x.m.kind === 'box');
  for (const w of walls) {
    const D = (p) => (p.x - w.a.x) * w.nx + (p.y - w.a.y) * w.ny, T = (p) => (p.x - w.a.x) * w.ux + (p.y - w.a.y) * w.uy;
    const onWall = boxes.filter((b) => { const d = b.cs.map(D); return Math.min(...d) <= TOUCH && Math.min(...d) >= -room.thickness; });
    const reach = (x) => { // how far from the wall this wet area may start and still count as against it
      const near = Math.min(...x.cs.map(D));
      if (near <= TOUCH) return true;
      return onWall.some((b) => Math.abs(Math.max(...b.cs.map(D)) - near) <= TOUCH);
    };
    const rs = [];
    for (const x of wet) {
      if (!reach(x)) continue;
      const ts = x.cs.map(T), t0 = Math.max(0, Math.min(...ts)), t1 = Math.min(w.len, Math.max(...ts));
      if (t1 - t0 > 50) rs.push([t0, t1]);
    }
    if (!rs.length) continue;
    const L = aLeft(w);
    const xs = rs.map(([a, b]) => (L ? [a, b] : [w.len - b, w.len - a])).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of xs) { const m = merged[merged.length - 1]; if (m && r[0] <= m[1] + 1) m[1] = Math.max(m[1], r[1]); else merged.push([...r]); }
    const zs = []; let x = 0;
    for (const [a, b] of merged) {
      if (a > x + 1) zs.push({ to: Math.round(a), h: 'default', tile: '' });
      zs.push({ to: Math.round(b), h: 'full', tile: '' });
      x = b;
    }
    if (x < w.len - 1) zs.push({ to: Math.round(w.len), h: 'default', tile: '' });
    out[w.i] = zs;
  }
  return out;
}
