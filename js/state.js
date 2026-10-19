// Design state, undo/redo, persistence and change notification.
import { byId, colourPair, defaultElev, parsePrice } from './catalog.js';

const LS_KEY = 'bathroom-designer:v1';            // legacy single-room storage
const PROJECT_KEY = 'bathroom-designer:project:v2';

export function defaultRoom() {
  return {
    pts: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 2000 }, { x: 0, y: 2000 }],
    thickness: 100,
    height: 2400,
    wallColor: '#ebe8e2',
    floor: { color: '#c9c5bd', tw: 600, th: 600, grout: '#a8a49c' },
    wallTile: { enabled: true, height: 1200, color: '#f3f2ef', tw: 300, th: 600, grout: '#d9d6d0' },
  };
}

export function newDesign() {
  return {
    version: 1,
    room: defaultRoom(),
    openings: [{ id: uid(), type: 'door', wall: 3, offset: 900, width: 762, height: 1981, sill: 0, hinge: 'left', swing: 'in' }],
    items: [],
  };
}

export const store = {
  d: null,          // active room's design (same object as project.rooms[active].design)
  project: null,    // { version: 2, name, rooms: [{ id, name, design }], active }
  readOnly: false,  // viewing a shared link: nothing is saved and editing is disabled
  sel: null, // { type: 'item'|'wall'|'opening'|'vertex', id|index }
  listeners: new Set(),
  undo: [],
  redo: [],
};
const history = new Map(); // room id → { undo, redo }

let idc = 0;
export function uid() { return Date.now().toString(36) + (idc++).toString(36) + Math.random().toString(36).slice(2, 5); }

export function on(fn) { store.listeners.add(fn); }
export function emit(kind = 'change') { for (const fn of store.listeners) fn(kind); }

// Call before a mutation that should be undoable.
export function checkpoint() {
  store.undo.push(JSON.stringify(store.d));
  if (store.undo.length > 150) store.undo.shift();
  store.redo.length = 0;
}
export function commit(kind = 'change') { save(); emit(kind); }

export function activeRoom() { return store.project.rooms.find((r) => r.id === store.project.active) || store.project.rooms[0]; }
function setActiveDesign(d) { store.d = d; activeRoom().design = d; }

export function undo() {
  if (!store.undo.length) return;
  store.redo.push(JSON.stringify(store.d));
  setActiveDesign(JSON.parse(store.undo.pop()));
  validateSel();
  commit('load');
}
export function redo() {
  if (!store.redo.length) return;
  store.undo.push(JSON.stringify(store.d));
  setActiveDesign(JSON.parse(store.redo.pop()));
  validateSel();
  commit('load');
}

function validateSel() {
  const s = store.sel;
  if (!s) return;
  if (s.type === 'item' && !store.d.items.find((i) => i.id === s.id)) store.sel = null;
  if (s.type === 'opening' && !store.d.openings.find((o) => o.id === s.id)) store.sel = null;
  if ((s.type === 'wall' || s.type === 'vertex') && s.index >= store.d.room.pts.length) store.sel = null;
}

// ---- projects (multiple rooms)
export function makeProject(design, name = 'My project', roomName = 'Bathroom') {
  const id = uid();
  return { version: 2, name, rooms: [{ id, name: roomName, design }], active: id };
}
// Accepts a project, or a legacy single-room design.
export function asProject(data, roomName = 'Bathroom') {
  if (data?.rooms?.length) { if (!data.rooms.find((r) => r.id === data.active)) data.active = data.rooms[0].id; return data; }
  if (data?.room?.pts) return makeProject(data, 'My project', roomName);
  return null;
}
function useProject(p) {
  store.project = p;
  history.clear();
  store.undo = []; store.redo = [];
  store.d = activeRoom().design;
  store.sel = null;
}

export function save() {
  if (store.readOnly) return;
  try { localStorage.setItem(PROJECT_KEY, JSON.stringify(store.project)); } catch { /* storage unavailable */ }
}
export function load() {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (raw) { useProject(asProject(JSON.parse(raw))); return true; }
    const legacy = localStorage.getItem(LS_KEY);
    if (legacy) { useProject(asProject(JSON.parse(legacy), 'Ensuite')); save(); return true; }
  } catch { /* ignore */ }
  useProject(makeProject(newDesign()));
  return false;
}
export function loadProject(p) { store.readOnly = false; useProject(p); commit('load'); }
// Show someone else's project from a share link without touching the saved one.
export function viewShared(p) { useProject(p); store.readOnly = true; emit('load'); }
// Leave the shared view, optionally adding its rooms to the user's own project.
export function leaveShared(copyRooms = false) {
  const shared = store.project;
  store.readOnly = false;
  const hadOwn = load();
  if (copyRooms && !hadOwn) {
    // first visit: the shared project simply becomes theirs
    useProject(JSON.parse(JSON.stringify(shared)));
  } else if (copyRooms) {
    const names = new Set(store.project.rooms.map((r) => r.name));
    for (const r of shared.rooms) {
      let name = r.name; let n = 2;
      while (names.has(name)) name = `${r.name} (${n++})`;
      names.add(name);
      store.project.rooms.push({ id: uid(), name, design: JSON.parse(JSON.stringify(r.design)) });
    }
    store.project.active = store.project.rooms[store.project.rooms.length - shared.rooms.length].id;
    useProject(store.project);
  }
  commit('load');
}

// Replace the active room's design (undoable).
export function replaceDesign(d) {
  checkpoint();
  setActiveDesign(d);
  store.sel = null;
  commit('load');
}

export function switchRoom(id) {
  if (id === store.project.active) return;
  history.set(store.project.active, { undo: store.undo, redo: store.redo });
  store.project.active = id;
  const h = history.get(id) || { undo: [], redo: [] };
  store.undo = h.undo; store.redo = h.redo;
  store.d = activeRoom().design;
  store.sel = null;
  commit('load');
}
export function addRoom(design, name) {
  const r = { id: uid(), name, design };
  store.project.rooms.push(r);
  switchRoom(r.id);
  return r;
}
export function renameRoom(id, name) { const r = store.project.rooms.find((x) => x.id === id); if (r && name) { r.name = name; commit('rooms'); } }
export function deleteRoom(id) {
  const rooms = store.project.rooms;
  if (rooms.length <= 1) return false;
  const i = rooms.findIndex((r) => r.id === id);
  rooms.splice(i, 1);
  history.delete(id);
  if (store.project.active === id) {
    store.project.active = rooms[Math.max(0, i - 1)].id;
    const h = history.get(store.project.active) || { undo: [], redo: [] };
    store.undo = h.undo; store.redo = h.redo;
    store.d = activeRoom().design; store.sel = null;
  }
  commit('load');
  return true;
}

export function select(sel) { store.sel = sel; emit('select'); }

// ---- item helpers ----
export function modelOf(it) { return byId.get(it.model); }
export function sizeOf(it) {
  const m = modelOf(it);
  if (!m) return { w: 600, d: 400, h: 500 };
  if (it.custom) return it.custom;
  return m.sizes[Math.min(it.size || 0, m.sizes.length - 1)];
}
export function variantOf(it) {
  const m = modelOf(it);
  if (!m) return null;
  const s = m.sizes[Math.min(it.size || 0, m.sizes.length - 1)];
  return s.variants[Math.min(it.variant || 0, s.variants.length - 1)] || s.variants[0];
}
export function colourName(it) { return variantOf(it)?.colour || 'White matt'; }
export function coloursOf(it) { return colourPair(colourName(it), it.bespoke); }
export function cfgOf(it) {
  const m = modelOf(it) || {};
  return {
    front: it.cfg?.front ?? m.front,
    drawers: it.cfg?.drawers ?? m.drawers,
    doors: it.cfg?.doors ?? m.doors,
    hinge: it.cfg?.hinge ?? m.hinge,
    double: it.cfg?.double ?? m.double,
    shape: m.shape,
  };
}
export function priceOf(it) {
  if (it.custom && modelOf(it)?.mtm) return null;
  if (it.custom) return null;
  return parsePrice(variantOf(it)?.price);
}

export function makeItem(modelId, x, y) {
  const m = byId.get(modelId);
  const s = m.sizes[0];
  // Prefer a "White matt" variant, then first.
  let vi = s.variants.findIndex((v) => v.colour === 'White matt');
  if (vi < 0) vi = s.variants.findIndex((v) => /white|chrome/i.test(v.colour));
  vi = Math.max(0, vi);
  const it = { id: uid(), model: modelId, size: 0, variant: vi, x, y, rot: 0, elev: defaultElev(m.kind, s.h) };
  if (m.mtm) it.custom = { w: s.w, d: s.d, h: s.h };
  return it;
}

export function itemById(id) { return store.d.items.find((i) => i.id === id); }

// Recessed niche settings for built-out walls (heights are mm above the floor).
export function nicheOf(it) {
  const m = modelOf(it) || {};
  return { on: !!m.niche, bottom: 1060, height: 200, depth: 129, led: true, ...(it.niche || {}) };
}
