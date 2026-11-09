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
    for (const [tile, g] of byTile) out.push({ key: `${key}|${tile}`, ovKey: kind === 'wall' ? null : key, group, label, kind, plane: 'v', polys: g.polys, tile, len, zones: g.zones, geo: { P0, e, n, len } });
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
  const L = layOptions(polys, tile), best = L.opts[0];
  return best ? { area: L.area, pieces: best.pieces, cells: best.cells, tw: L.tw, th: L.th, ok: best.ok } : { area: L.area, pieces: [], cells: [], tw: L.tw, th: L.th };
}

// As layTiles, but with every layout that is just as good on its own (same number of pieces, all cuts big enough)
// and cuts different sizes — so the room can pick the ones whose offcuts fit pieces elsewhere. Best first.
export function layOptions(polys, tile) {
  const { w: tw, h: th } = laidSize(tile), g = Math.max(0, +tile.joint || 0), shift = PATTERNS[tile.pattern]?.shift || 0;
  const area = polys.reduce((s, p) => s + areaOf(p), 0);
  if (!polys.length || area < 1) return { area, tw, th, opts: [] };
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
        // the bits of the surface in this cell; touching bits are one piece (an L round a window corner), bits
        // apart (either side of a door) are separate pieces
        const frags = [];
        for (const p of strip) {
          const c = clipBox(p, x, y, x + tw, y + th);
          if (c.length < 3) continue;
          const ca = areaOf(c); if (ca < 0.01) continue;
          const cb = polyBounds(c);
          frags.push({ a: ca, x0: cb.x0, y0: cb.y0, x1: cb.x1, y1: cb.y1 });
        }
        for (let m = true; m;) {
          m = false;
          for (let i = 0; i < frags.length && !m; i++) for (let k = i + 1; k < frags.length; k++) {
            const f = frags[i], o = frags[k];
            if (f.x0 > o.x1 + 1 || o.x0 > f.x1 + 1 || f.y0 > o.y1 + 1 || o.y0 > f.y1 + 1) continue;
            frags[i] = { a: f.a + o.a, x0: Math.min(f.x0, o.x0), y0: Math.min(f.y0, o.y0), x1: Math.max(f.x1, o.x1), y1: Math.max(f.y1, o.y1) };
            frags.splice(k, 1); m = true; break;
          }
        }
        let any = false, cellFull = false;
        for (const f of frags) {
          if (f.a < 1 || f.x1 - f.x0 < SLIVER || f.y1 - f.y0 < SLIVER) continue;
          const full = f.a >= tw * th - (tw + th) * 0.5;
          pieces.push(full ? { w: tw, h: th, full } : { w: f.x1 - f.x0, h: f.y1 - f.y0, full });
          any = true; cellFull ||= full;
        }
        if (any) cells.push({ x, y, full: cellFull });
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
  // start points: the four standard ones, then (when those leave slivers) a joint lined up with each edge of the
  // surface — the top of half-height tiling, a window sill or head, a box top, a door edge
  const edges = (k, t, p) => {
    const vs = [...new Set(polys.flat().map((q) => Math.round(q[k])))];
    return vs.flatMap((v) => [v, v - t]).map((f) => ({ f, m: ((f % p) + p) % p }));
  };
  const uniq = (list, p) => { const seen = []; return list.filter(({ m }) => !seen.some((s) => Math.min(Math.abs(s - m), p - Math.abs(s - m)) < 1) && seen.push(m)); };
  const all = [];
  const run = (us, vs) => { for (const fv of vs) for (const fu of us) all.push(at(fu, fv)); };
  const bu = phases(b.x0, b.x1, tw, pu), bv = phases(b.y0, b.y1, th, pv);
  run(bu, bv);
  if (!all.some((L) => L.ok)) {
    const more = (base, k, t, p) => {
      const b0 = base.map((f) => ({ f, m: ((f % p) + p) % p }));
      return uniq([...b0, ...edges(k, t, p)], p).slice(uniq(b0, p).length).slice(0, 10).map((o) => o.f);
    };
    const eu = more(bu, 'x', tw, pu), ev = more(bv, 'y', th, pv);
    run(eu, bv); run(bu, ev); run(eu, ev);
  }
  const better = (L, best) => L.ok !== best.ok ? L.ok
    : L.ok ? L.pieces.length < best.pieces.length || (L.pieces.length === best.pieces.length && L.tiles < best.tiles)
    : L.thin > best.thin + 0.5 || (Math.abs(L.thin - best.thin) <= 0.5 && L.tiles < best.tiles);
  let best = all[0];
  for (const L of all) if (better(L, best)) best = L;
  const opts = [best], seen = new Set([sig(best)]);
  if (best.ok) for (const L of all) {
    if (!L.ok || L.pieces.length !== best.pieces.length || seen.has(sig(L))) continue;
    seen.add(sig(L)); opts.push(L);
  }
  return { area, tw, th, opts };
}
const sig = (L) => L.pieces.map((p) => (p.full ? 'F' : `${Math.round(p.w)}x${Math.round(p.h)}`)).sort().join(' ');

// How many tiles the pieces take: a full tile each, and cut pieces from a fresh tile or (reuse) from an offcut
// that holds the whole piece. Biggest pieces first; offcuts are cut guillotine-style, keeping the larger leftover.
// `sheets` is the cutting list: each tile that gets cut, with the pieces taken from it in order (a piece keeps
// whatever else it carried, e.g. the surface it's for).
export function countTiles(pieces, tile, reuse = true) {
  const { w: tw, h: th } = laidSize(tile);
  const cuts = pieces.filter((p) => !p.full).sort((a, b) => b.w * b.h - a.w * a.h);
  const full = pieces.length - cuts.length;
  const offcuts = [], sheets = [];
  let fresh = 0, fromOffcut = 0;
  for (const p of cuts) {
    let bi = -1;
    if (reuse) offcuts.forEach((o, i) => { if (o.w >= p.w && o.h >= p.h && (bi < 0 || o.w * o.h < offcuts[bi].w * offcuts[bi].h)) bi = i; });
    let src;
    if (bi >= 0) { src = offcuts.splice(bi, 1)[0]; fromOffcut++; } else { src = { w: tw, h: th, sheet: sheets.length }; sheets.push({ pieces: [] }); fresh++; }
    sheets[src.sheet].pieces.push(p);
    const rw = src.w - p.w - KERF, rh = src.h - p.h - KERF;
    const A = [{ w: rw, h: src.h }, { w: p.w, h: rh }], B = [{ w: src.w, h: rh }, { w: rw, h: p.h }];
    const big = (s) => Math.max(0, ...s.filter((o) => o.w > 0 && o.h > 0).map((o) => o.w * o.h));
    for (const o of big(A) >= big(B) ? A : B) if (o.w >= MIN_OFFCUT && o.h >= MIN_OFFCUT) offcuts.push({ ...o, sheet: src.sheet });
  }
  return { full, cut: cuts.length, fresh, fromOffcut, tiles: full + fresh, noReuse: pieces.length, sheets };
}

// Internal corners between tiled faces (walls, boxing, built-out walls): where two meet, one runs into the corner and
// the other stops against its tiles, so it loses the tile + adhesive thickness there. Returns
// [{ sides: [{ s, x, dir, y0, y1 }, …] }] — s a surface, x the end of its tiling, dir +1 if the tiling runs right of x.
function cornersOf(surfaces) {
  const faces = surfaces.filter((s) => s.geo && s.plane === 'v');
  const ends = [];
  for (const s of faces) for (const p of s.polys) {
    const b = polyBounds(p);
    for (const [x, dir] of [[b.x0, 1], [b.x1, -1]]) {
      const ys = p.filter((q) => Math.abs(q.x - x) < 1).map((q) => q.y);
      if (ys.length < 2) continue;
      const { P0, e } = s.geo;
      ends.push({ s, x, dir, y0: Math.min(...ys), y1: Math.max(...ys), C: { x: P0.x + e.x * x, y: P0.y + e.y * x }, d: { x: e.x * dir, y: e.y * dir } });
    }
  }
  const out = [], tol = 12;
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    const a = ends[i], b = ends[j];
    if (a.s === b.s || Math.hypot(a.C.x - b.C.x, a.C.y - b.C.y) > tol * 1.5) continue;
    // at right angles, each running away from the other's face into the room
    const na = a.s.geo.n, nb = b.s.geo.n;
    if (nb.x * a.d.x + nb.y * a.d.y < 0.95 || na.x * b.d.x + na.y * b.d.y < 0.95) continue;
    const y0 = Math.max(a.y0, b.y0), y1 = Math.min(a.y1, b.y1);
    if (y1 - y0 < 10) continue;
    // one corner per pair of faces at one place, however many pieces each face is split into there
    const same = out.find((c) => c.sides[0].s === a.s && c.sides[1].s === b.s && Math.abs(c.sides[0].x - a.x) < 1 && Math.abs(c.sides[1].x - b.x) < 1);
    if (same) { for (const sd of same.sides) { sd.y0 = Math.min(sd.y0, y0); sd.y1 = Math.max(sd.y1, y1); } continue; }
    out.push({ sides: [{ s: a.s, x: a.x, dir: a.dir, y0, y1 }, { s: b.s, x: b.x, dir: b.dir, y0, y1 }] });
  }
  return out;
}

// Order quantity: tiles needed plus the extra allowance, rounded up to whole boxes when the box size is known.
export function orderOf(tile, needed) {
  const order = Math.ceil(needed * (1 + (+tile.extra || 0) / 100) - 1e-9);
  const per = +tile.perBox || 0;
  const boxes = per > 0 ? Math.ceil(order / per) : null;
  return { order: boxes ? boxes * per : order, boxes, m2: ((boxes ? boxes * per : order) * tile.w * tile.h) / 1e6 };
}

// Everything for one room: surfaces with their layouts, and one row per tile. Each surface gets one of its equally
// good layouts (fewest pieces, no thin cuts); which one — and, with a tile thickness set, which face runs into each
// tiled corner — is chosen for the fewest tiles across the room, so one wall's offcuts are cut to fit pieces elsewhere.
export function roomSchedule(design, project) {
  const reuse = project?.tileOpts?.reuse ?? true, bu = Math.max(0, +project?.tileOpts?.buildUp || 0);
  const surfaces = surfacesOf(design, project);
  const live = [];
  for (const s of surfaces) { const t = tileById(project, s.tile); if (t) live.push({ s, t }); }
  const corners = bu > 0 ? cornersOf(live.map((x) => x.s)) : [];
  const cornersOn = new Map(); // surface → [{ k: corner, w: its side, sd }]
  corners.forEach((c, k) => c.sides.forEach((sd, w) => { const l = cornersOn.get(sd.s) || []; l.push({ k, w, sd }); cornersOn.set(sd.s, l); }));
  const choice = corners.map(() => 0); // the side that stops against the other's tiles
  const pick = new Map(live.map((x) => [x.s, 0]));
  const cache = new Map();
  const butting = (s) => (cornersOn.get(s) || []).filter((o) => choice[o.k] === o.w);
  const variant = (x) => {
    const mine = butting(x.s), key = x.s.key + '#' + mine.map((o) => o.k).join(',');
    let v = cache.get(key);
    if (!v) {
      let polys = x.s.polys;
      for (const { sd } of mine) polys = subtract(polys, sd.dir > 0 ? rect(sd.x - 1, sd.y0, sd.x + bu, sd.y1) : rect(sd.x - bu, sd.y0, sd.x + 1, sd.y1)).filter(solid);
      v = { polys, ...layOptions(polys, x.t) };
      cache.set(key, v);
    }
    return v;
  };
  const layOf = (x) => { const v = variant(x); return v.opts[Math.min(pick.get(x.s), v.opts.length - 1)]; };
  const cost = () => { // fewest pieces, then fewest tiles
    const by = new Map(); let n = 0;
    for (const x of live) { const L = layOf(x); if (!L) continue; n += L.pieces.length; const a = by.get(x.t) || []; a.push(...L.pieces); by.set(x.t, a); }
    let tiles = 0; for (const [t, ps] of by) tiles += countTiles(ps, t, reuse).tiles;
    return n * 1e5 + tiles;
  };
  if (live.length) {
    let best = cost();
    for (let pass = 0; pass < 4; pass++) {
      let improved = false;
      for (let k = 0; k < corners.length; k++) { choice[k] ^= 1; const c = cost(); if (c < best) { best = c; improved = true; } else choice[k] ^= 1; }
      for (const x of live) {
        const n = variant(x).opts.length; if (n < 2) continue;
        let bi = Math.min(pick.get(x.s), n - 1);
        for (let i = 0; i < n; i++) { if (i === bi) continue; pick.set(x.s, i); const c = cost(); if (c < best) { best = c; bi = i; improved = true; } }
        pick.set(x.s, bi);
      }
      if (!improved) break;
    }
  }
  const rows = new Map();
  for (const x of live) {
    const s = x.s, t = x.t, v = variant(x), L = layOf(x);
    s.polys = v.polys;
    s.butts = [...new Set(butting(s).map((o) => corners[o.k].sides[1 - o.w].s.label))];
    s.lay = { area: v.area, tw: v.tw, th: v.th, pieces: L ? L.pieces.map((p) => ({ ...p, s })) : [], cells: L ? L.cells : [], ok: L?.ok };
    if (!s.lay.pieces.length) { s.empty = true; continue; } // only slivers under the grout line
    const cuts = s.lay.pieces.filter((p) => !p.full);
    s.minCut = cuts.length ? Math.min(...cuts.map((p) => Math.min(p.w, p.h))) : null;
    const r = rows.get(t.id) || { tile: t, area: 0, pieces: [], surfaces: [] };
    r.area += s.lay.area; r.pieces.push(...s.lay.pieces); r.surfaces.push(s); rows.set(t.id, r);
  }
  for (const r of rows.values()) {
    r.count = countTiles(r.pieces, r.tile, reuse); Object.assign(r, orderOf(r.tile, r.count.tiles));
    // offcuts that go from one surface to another
    r.moves = 0;
    r.count.sheets.forEach((sh, n) => {
      sh.n = n + 1;
      const from = sh.pieces[0].s;
      for (const p of sh.pieces.slice(1)) {
        if (p.s === from) continue;
        r.moves++;
        (p.s.offIn ||= []).push({ from: from.label, w: p.w, h: p.h, n: sh.n });
        (from.offOut ||= []).push({ to: p.s.label, w: p.w, h: p.h, n: sh.n });
      }
    });
  }
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
