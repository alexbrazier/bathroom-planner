// Plan notes: numbered pins with a short text, a type and a resolved flag, stored per room (design.notes) so they
// travel with share links. A note can follow a fitting, a door/window or a wall, or stay at a fixed floor spot.
//   { id, n, text, type: 'note'|'change'|'question'|'todo', resolved, at: {x, y},
//     on?: { kind: 'item', id, lx, ly } | { kind: 'opening', id, t } | { kind: 'wall', index, t } }
import { store, sizeOf, uid } from './state.js';
import { wallsOf, toWorld, toLocal, pointInPoly, itemCorners, distToSeg } from './geom.js';

// Shared view settings for the plan, side panel and 3D markers.
export const noteView = { show: true, hideResolved: false };

export const NOTE_TYPES = {
  note: { label: 'Note', color: '#2f6fb0' },
  change: { label: 'Change', color: '#d0602a' },
  question: { label: 'Question', color: '#8a4fd0' },
  todo: { label: 'To-do', color: '#b8860b' },
};
export const noteColor = (n) => (n.resolved ? '#8c939b' : (NOTE_TYPES[n.type] || NOTE_TYPES.note).color);
export const notesOf = (d = store.d) => d.notes || (d.notes = []);

// Where a note sits now: plan point (mm) plus a height for the 3D marker (mm above the floor).
export function noteAnchor(n, d = store.d) {
  const on = n.on;
  if (on?.kind === 'item') {
    const it = d.items.find((o) => o.id === on.id);
    if (it) { const p = toWorld(it, on.lx, on.ly); return { ...p, z: it.elev + sizeOf(it).h + 150 }; }
  }
  if (on?.kind === 'opening') {
    const op = d.openings.find((o) => o.id === on.id);
    const w = op && wallsOf(d.room.pts)[op.wall];
    if (w) {
      const t = op.offset + op.width * on.t, inset = 120;
      return { x: w.a.x + w.ux * t + w.nx * inset, y: w.a.y + w.uy * t + w.ny * inset, z: op.type === 'door' ? 1800 : op.sill + op.height / 2 };
    }
  }
  if (on?.kind === 'wall') {
    const w = wallsOf(d.room.pts)[on.index];
    if (w) { const t = w.len * on.t; return { x: w.a.x + w.ux * t + w.nx * 120, y: w.a.y + w.uy * t + w.ny * 120, z: 1500 }; }
  }
  return { x: n.at.x, y: n.at.y, z: 1200 };
}

// What's under a plan point: a fitting (topmost), else a door/window, else a wall (within ~250 mm), else nothing.
export function attachAt(p, d = store.d) {
  const items = [...d.items].sort((a, b) => (b.elev + sizeOf(b).h) - (a.elev + sizeOf(a).h));
  for (const it of items) {
    const s = sizeOf(it);
    if (pointInPoly(p, itemCorners(it, s.w, s.d))) { const l = toLocal(it, p); return { kind: 'item', id: it.id, lx: l.x, ly: l.y }; }
  }
  const walls = wallsOf(d.room.pts), th = d.room.thickness;
  for (const op of d.openings) {
    const w = walls[op.wall]; if (!w) continue;
    const t = (p.x - w.a.x) * w.ux + (p.y - w.a.y) * w.uy, nd = (p.x - w.a.x) * w.nx + (p.y - w.a.y) * w.ny;
    if (t >= op.offset - 50 && t <= op.offset + op.width + 50 && nd > -th - 50 && nd < 300) return { kind: 'opening', id: op.id, t: Math.max(0, Math.min(1, (t - op.offset) / op.width)) };
  }
  let best = null;
  for (const w of walls) {
    const h = distToSeg(p, w.a, w.b);
    if (h.d < 250 && (!best || h.d < best.d)) best = { d: h.d, w, t: h.t };
  }
  if (best) return { kind: 'wall', index: best.w.i, t: Math.max(0, Math.min(1, best.t)) };
  return null;
}

// A short description of what a note is attached to.
export function attachedTo(n, d = store.d, nameOf = () => 'a fitting') {
  const on = n.on;
  if (on?.kind === 'item') { const it = d.items.find((o) => o.id === on.id); return it ? nameOf(it) : 'a fitting that was removed'; }
  if (on?.kind === 'opening') { const op = d.openings.find((o) => o.id === on.id); return op ? `the ${op.type} on wall ${op.wall + 1}` : 'an opening that was removed'; }
  if (on?.kind === 'wall') return `wall ${on.index + 1}`;
  return 'a spot on the floor';
}

export function newNote(p, d = store.d) {
  const list = notesOf(d);
  const n = { id: uid(), n: list.reduce((m, x) => Math.max(m, x.n || 0), 0) + 1, text: '', type: 'note', resolved: false, at: { x: Math.round(p.x), y: Math.round(p.y) } };
  const on = attachAt(p, d); if (on) n.on = on;
  list.push(n);
  return n;
}
// Re-pin a note at a new point (after dragging it).
export function moveNote(n, p, d = store.d) {
  n.at = { x: Math.round(p.x), y: Math.round(p.y) };
  const on = attachAt(p, d);
  if (on) n.on = on; else delete n.on;
}
