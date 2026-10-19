// Placement & snapping of items against walls, other items and supporting units.
import { store, sizeOf, modelOf } from './state.js';
import { wallsOf, deg, rad, snap, toLocal, toWorld, pointInPoly, itemCorners, normAngle, distToSeg } from './geom.js';
import { WALL_MOUNTED, STACKS_ON, SUPPORTS } from './catalog.js';

const GRID = 10;

function wallFrameRot(w) {
  // Rotation that puts the item's back (local −y) against wall w.
  let r = deg(w.angle);
  const ly = { x: -Math.sin(rad(r)), y: Math.cos(rad(r)) };
  if (ly.x * w.nx + ly.y * w.ny < 0) r += 180;
  return normAngle(r);
}

// Items considered "on" wall w: back face within a few mm of the wall line and parallel.
function itemsOnWall(w, exclude) {
  const res = [];
  for (const o of store.d.items) {
    if (exclude.has(o.id)) continue;
    const m = modelOf(o); if (!m) continue;
    const s = sizeOf(o);
    const rot = wallFrameRot(w);
    const dr = Math.abs(((normAngle(o.rot) - rot + 540) % 360) - 180);
    if (dr > 1) continue;
    const dist = (o.x - w.a.x) * w.nx + (o.y - w.a.y) * w.ny;
    if (Math.abs(dist - s.d / 2) > 40) continue;
    const t = (o.x - w.a.x) * w.ux + (o.y - w.a.y) * w.uy;
    res.push({ o, s, t0: t - s.w / 2, t1: t + s.w / 2, tc: t });
  }
  return res;
}

// A bath screen stands on the rim of the bath it is over.
function sitOnBath(it, exclude) {
  const b = store.d.items.find((o) => !exclude.has(o.id) && modelOf(o)?.kind === 'bath' && pointInPoly({ x: it.x, y: it.y }, itemCorners(o, sizeOf(o).w, sizeOf(o).d)));
  if (b) it.elev = b.elev + sizeOf(b).h;
}

export function findSupport(it, p, exclude) {
  const isTap = modelOf(it)?.kind === 'tap';
  const ok = (k) => isTap ? ['basin', 'ctbasin', 'worktop', 'vanity', 'base', 'console'].includes(k) : !['basin', 'ctbasin'].includes(k);
  // full-height built-out walls aren't surfaces to put things on
  const list = store.d.items.filter((o) => !exclude.has(o.id) && SUPPORTS.has(modelOf(o)?.kind) && ok(modelOf(o).kind) && !(modelOf(o).kind === 'falsewall' && o.elev + sizeOf(o).h > 1500));
  // top-most first
  list.sort((a, b) => (b.elev + sizeOf(b).h) - (a.elev + sizeOf(a).h));
  for (const o of list) {
    const s = sizeOf(o);
    if (pointInPoly(p, itemCorners(o, s.w, s.d))) return o;
  }
  return null;
}

/**
 * Snap `it` (mutated) towards proposed centre p.
 * opts: { free: bool (no snapping), tol: snap tolerance mm, exclude: Set of ids }
 * Returns guides: [{a:{x,y}, b:{x,y}}] for drawing.
 */
export function placeItem(it, p, opts = {}) {
  const m = modelOf(it);
  const s = sizeOf(it);
  const tol = opts.tol ?? 60;
  const exclude = opts.exclude || new Set([it.id]);
  const guides = [];
  if (opts.free || !m) {
    it.x = snap(p.x, GRID); it.y = snap(p.y, GRID);
    return guides;
  }

  // 1. Stack basins / worktops on top of vanity units.
  if (STACKS_ON.has(m.kind)) {
    const sup = findSupport(it, p, exclude);
    if (sup) {
      const ss = sizeOf(sup);
      it.rot = sup.rot;
      it.elev = sup.elev + ss.h;
      const l = toLocal(sup, p);
      let lx = snap(l.x, GRID);
      const cands = [0, -ss.w / 4, ss.w / 4, -ss.w / 2 + s.w / 2, ss.w / 2 - s.w / 2];
      for (const c of cands) if (Math.abs(l.x - c) < tol) { lx = c; break; }
      const ly = -ss.d / 2 + s.d / 2; // back edges flush
      const wpt = toWorld(sup, lx, ly);
      it.x = wpt.x; it.y = wpt.y;
      guides.push({ a: toWorld(sup, lx, -ss.d / 2 - 80), b: toWorld(sup, lx, ss.d / 2 + 80) });
      return guides;
    }
  }

  // 2a. Glass panels stand end-on to a wall (channel against it), not flat against it.
  if (m.kind === 'wetpanel' || m.kind === 'bathscreen' || (m.kind === 'glass' && s.d <= 300)) {
    const walls = [...wallsOf(store.d.room.pts), ...builtOutFaces(it, s, exclude)];
    let best = null;
    for (const w of walls) {
      const h = distToSeg(p, w.a, w.b);
      if (h.d < s.w / 2 + Math.max(250, tol * 3) && (!best || h.d < best.d)) best = { w, h };
    }
    if (best) {
      const { w } = best;
      const flip = it.cfg?.channel === 'end' ? -1 : 1;
      it.rot = normAngle(deg(Math.atan2(w.ny, w.nx)) + (flip < 0 ? 180 : 0));
      let t = (p.x - w.a.x) * w.ux + (p.y - w.a.y) * w.uy;
      // snap the glass line to the wall ends (+20 mm for a tray/tile lip) or to the grid
      const cands = [20, w.len - 20];
      t = cands.find((c) => Math.abs(t - c) < tol) ?? snap(t, GRID);
      it.x = w.a.x + w.ux * t + w.nx * (s.w / 2);
      it.y = w.a.y + w.uy * t + w.ny * (s.w / 2);
      if (m.kind === 'bathscreen') sitOnBath(it, exclude);
      return guides;
    }
  }

  // 2. Snap against the nearest wall (ceiling-mounted shower heads hang free).
  if (WALL_MOUNTED.has(m.kind) && !(m.kind === 'showerhead' && /ceiling/i.test(m.name))) {
    const walls = [...wallsOf(store.d.room.pts), ...builtOutFaces(it, s, exclude)];
    let best = null;
    for (const w of walls) {
      const h = distToSeg(p, w.a, w.b);
      const side = (p.x - w.a.x) * w.nx + (p.y - w.a.y) * w.ny;
      if (side < -50) continue;
      const reach = Math.min(s.w, s.d) / 2 + Math.max(250, tol * 2);
      if (h.d < reach + s.d / 2 && h.t > -0.05 && h.t < 1.05 && (!best || h.d < best.d)) best = { w, d: h.d };
    }
    if (best) {
      const w = best.w;
      it.rot = wallFrameRot(w);
      let t = (p.x - w.a.x) * w.ux + (p.y - w.a.y) * w.uy;
      const hw = s.w / 2;
      // candidate t positions with a priority (lower = stronger)
      const cand = [];
      cand.push({ t: hw, g: 'start' });
      cand.push({ t: w.len - hw, g: 'end' });
      for (const o of itemsOnWall(w, exclude)) {
        const vOverlap = it.elev < o.o.elev + o.s.h && it.elev + s.h > o.o.elev;
        if (vOverlap) { cand.push({ t: o.t1 + hw, o }); cand.push({ t: o.t0 - hw, o }); }
        cand.push({ t: o.tc, o, centre: true });
        cand.push({ t: o.t0 + hw, o }); cand.push({ t: o.t1 - hw, o });
      }
      let snapped = null;
      for (const c of cand) {
        if (Math.abs(t - c.t) < tol && (!snapped || Math.abs(t - c.t) < Math.abs(t - snapped.t))) snapped = c;
      }
      // The door/window openings on this wall: snap item edges to opening edges.
      for (const op of store.d.openings) {
        if (op.wall !== w.i) continue;
        for (const c of [op.offset - hw, op.offset + op.width + hw]) {
          if (Math.abs(t - c) < tol && (!snapped || Math.abs(t - c) < Math.abs(t - snapped.t))) snapped = { t: c };
        }
      }
      t = snapped ? snapped.t : snap(t, GRID);
      // niches sit inside the wall with the front flush; recessed cabinets sit in it with the front ~5 mm proud
      const off = m.kind === 'niche' ? -s.d / 2 : m.recessed ? -s.d / 2 + 5 : s.d / 2;
      it.x = w.a.x + w.ux * t + w.nx * off;
      it.y = w.a.y + w.uy * t + w.ny * off;
      if (snapped) {
        let edge = t;
        if (!snapped.centre) {
          const refs = snapped.o ? [snapped.o.t0, snapped.o.t1] : [0, w.len, ...store.d.openings.filter((o) => o.wall === w.i).flatMap((o) => [o.offset, o.offset + o.width])];
          let bd = Infinity;
          for (const e of [t - hw, t + hw]) for (const r of refs) if (Math.abs(e - r) < bd) { bd = Math.abs(e - r); edge = e; }
        }
        const gx = w.a.x + w.ux * edge, gy = w.a.y + w.uy * edge;
        guides.push({ a: { x: gx, y: gy }, b: { x: gx + w.nx * 900, y: gy + w.ny * 900 } });
      }
      return guides;
    }
  }

  it.x = snap(p.x, GRID); it.y = snap(p.y, GRID);
  return guides;
}

// Front faces of built-out walls / boxing, used as extra snapping walls for items that overlap them in height.
function builtOutFaces(it, s, exclude) {
  const out = [];
  for (const o of store.d.items) {
    if (exclude.has(o.id) || o.id === it.id) continue;
    const om = modelOf(o);
    if (om?.kind !== 'falsewall') continue;
    const os = sizeOf(o);
    if (!(it.elev < o.elev + os.h - 1)) continue; // item sits above the boxing → ignore
    const a = toWorld(o, -os.w / 2, os.d / 2), b = toWorld(o, os.w / 2, os.d / 2);
    const len = os.w, ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const r = rad(o.rot);
    out.push({ i: -1, a, b, len, ux, uy, nx: -Math.sin(r), ny: Math.cos(r), angle: Math.atan2(uy, ux) });
  }
  return out;
}

// Items resting on top of `sup`, and items resting on those (e.g. vanity → basin → tap), to move together.
export function ridersOf(sup) {
  const top0 = sup.elev + sizeOf(sup).h;
  const out = [];
  const walk = (s, depth) => {
    if (depth > 3) return;
    const ss = sizeOf(s), top = s.elev + ss.h;
    const corners = itemCorners(s, ss.w + 2, ss.d + 2);
    for (const o of store.d.items) {
      if (o === sup || o === s || out.some((r) => r.o === o)) continue;
      if (!STACKS_ON.has(modelOf(o)?.kind) || Math.abs(o.elev - top) > 6 || !pointInPoly(o, corners)) continue;
      out.push({ o, l: toLocal(sup, o), dr: o.rot - sup.rot, dz: o.elev - top0 });
      walk(o, depth + 1);
    }
  };
  walk(sup, 0);
  return out;
}
export function applyRiders(sup, riders) {
  const top = sup.elev + sizeOf(sup).h;
  for (const r of riders) {
    const p = toWorld(sup, r.l.x, r.l.y);
    r.o.x = p.x; r.o.y = p.y; r.o.rot = normAngle(sup.rot + r.dr); r.o.elev = top + (r.dz || 0);
  }
}

// Place a door/window opening on the wall nearest to p.
export function nearestWall(p) {
  const walls = wallsOf(store.d.room.pts);
  let best = null;
  for (const w of walls) {
    const h = distToSeg(p, w.a, w.b);
    if (!best || h.d < best.d) best = { w, d: h.d, t: h.t * w.len };
  }
  return best;
}
