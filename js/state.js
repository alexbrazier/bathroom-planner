// Design state, undo/redo, persistence and change notification.
import { byId, colourPair, defaultElev, parsePrice } from './catalog.js';

const LS_KEY = 'bathroom-designer:v1';            // legacy single-room storage
const PROJECT_KEY = 'bathroom-designer:project:v2'; // legacy single-project storage (migrated into the index)
// Several projects: an index of { id, name, rooms, updated } plus each project under its own key.
const INDEX_KEY = 'bathroom-designer:projects';
const projKey = (id) => `bathroom-designer:proj:${id}`;

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
  return { version: 2, id: uid(), name, rooms: [{ id, name: roomName, design }], active: id };
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

function readIndex() {
  try { const ix = JSON.parse(localStorage.getItem(INDEX_KEY) || 'null'); if (ix?.list) return ix; } catch { /* ignore */ }
  return null;
}
function writeIndex(ix) { try { localStorage.setItem(INDEX_KEY, JSON.stringify(ix)); } catch { /* storage unavailable */ } }
function readProject(id) { try { return asProject(JSON.parse(localStorage.getItem(projKey(id)) || 'null')); } catch { return null; } }
function writeProject(p) {
  try { localStorage.setItem(projKey(p.id), JSON.stringify(p)); } catch { /* storage unavailable */ }
  const ix = readIndex() || { list: [] };
  const e = { id: p.id, name: p.name, rooms: p.rooms.length, updated: Date.now() };
  const i = ix.list.findIndex((x) => x.id === p.id);
  if (i >= 0) ix.list[i] = e; else ix.list.push(e);
  writeIndex(ix);
}
// Older saves (one project, or one room) become the first project in the index.
function migrate() {
  if (readIndex()) return;
  let p = null;
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (raw) p = asProject(JSON.parse(raw));
    else if (localStorage.getItem(LS_KEY)) p = asProject(JSON.parse(localStorage.getItem(LS_KEY)), 'Ensuite');
  } catch { /* ignore */ }
  if (!p) return;
  p.id = p.id || uid();
  writeProject(p);
  writeIndex({ ...readIndex(), active: p.id });
}

export function save() {
  if (store.readOnly || !store.project) return;
  store.project.id = store.project.id || uid();
  writeProject(store.project);
}
// Load the active project (true), or start a fresh one (false) when there are none yet.
export function load() {
  migrate();
  const ix = readIndex();
  const id = ix?.active && ix.list.some((x) => x.id === ix.active) ? ix.active : ix?.list[0]?.id;
  const p = id && readProject(id);
  if (p) { p.id = id; useProject(p); return true; }
  useProject(makeProject(newDesign()));
  return false;
}
// All saved projects (newest first is up to the caller): [{ id, name, rooms, updated }].
export function listProjects() { migrate(); return readIndex()?.list || []; }
function setActiveProject(id) { const ix = readIndex() || { list: [] }; ix.active = id; writeIndex(ix); }
// Open a project from the list (saving the current one first).
export function switchProject(id) {
  if (store.project?.id === id && !store.readOnly) return;
  save();
  const p = readProject(id); if (!p) return false;
  p.id = id;
  store.readOnly = false;
  useProject(p); setActiveProject(id); commit('load');
  return true;
}
// Add a project (new, imported or duplicated) and open it.
export function loadProject(p) {
  if (!store.readOnly && store.project && listProjects().some((x) => x.id === store.project.id)) save();
  store.readOnly = false;
  if (!p.id || listProjects().some((x) => x.id === p.id)) p.id = uid();
  useProject(p); setActiveProject(p.id); commit('load');
}
export function renameProject(name) { if (!name) return; store.project.name = name; commit('rooms'); }
export function duplicateProject() {
  const p = JSON.parse(JSON.stringify(store.project));
  p.id = uid(); p.name = `${store.project.name} copy`;
  // fresh room ids so share links and history stay with the original
  for (const r of p.rooms) { const nid = uid(); if (p.active === r.id) p.active = nid; r.id = nid; }
  loadProject(p);
}
// Delete the current project and open another (or a fresh one if it was the last).
export function deleteProject() {
  const id = store.project.id;
  try { localStorage.removeItem(projKey(id)); } catch { /* ignore */ }
  const ix = readIndex() || { list: [] };
  ix.list = ix.list.filter((x) => x.id !== id); writeIndex(ix);
  const next = ix.list[0];
  if (next) { store.project = null; switchProject(next.id); }
  else { store.project = null; loadProject(makeProject(newDesign())); }
}
// Move (or copy) a room into another project — or a new project if targetId is null. Moving keeps the room's id,
// so a live share link for that room keeps working from its new project.
export function moveRoom(roomId, targetId, { copy = false, newName } = {}) {
  const src = store.project, room = src.rooms.find((r) => r.id === roomId);
  if (!room) return false;
  if (!copy && src.rooms.length <= 1) return false;
  const moved = copy ? { id: uid(), name: room.name, design: JSON.parse(JSON.stringify(room.design)) } : room;
  let target = targetId ? readProject(targetId) : { version: 2, id: uid(), name: newName || room.name, rooms: [], active: moved.id };
  if (!target) return false;
  if (targetId) target.id = targetId;
  const names = new Set(target.rooms.map((r) => r.name)); let n = 2;
  while (names.has(moved.name)) moved.name = `${room.name} (${n++})`;
  target.rooms.push(moved);
  if (!target.active) target.active = moved.id;
  writeProject(target);
  if (!copy) {
    src.rooms = src.rooms.filter((r) => r.id !== roomId);
    history.delete(roomId);
    if (src.active === roomId) { src.active = src.rooms[0].id; const h = history.get(src.active) || { undo: [], redo: [] }; store.undo = h.undo; store.redo = h.redo; store.d = activeRoom().design; store.sel = null; }
    commit('load');
  }
  return target.id;
}
// Show someone else's project from a share link without touching the saved one.
export function viewShared(p) { useProject(p); store.readOnly = true; emit('load'); }
// Leave the shared view, optionally adding its rooms to the user's own project.
// copyRooms: 'merge' (or true) adds the shared rooms to the user's current project, 'new' saves them as a project
// of their own. Returns the ids of the copied rooms.
export function leaveShared(copyRooms = false) {
  const shared = store.project;
  store.readOnly = false;
  const hadOwn = load();
  let ids = [];
  if (copyRooms === 'new' || (copyRooms && !hadOwn)) {
    // its own project (always on a first visit); a fresh id so it can't overwrite the sharer's copy in this browser
    const p = JSON.parse(JSON.stringify(shared));
    p.id = uid();
    if (!hadOwn) store.project = null; // don't keep the blank placeholder
    loadProject(p);
    return store.project.rooms.map((r) => r.id);
  } else if (copyRooms) {
    const names = new Set(store.project.rooms.map((r) => r.name));
    for (const r of shared.rooms) {
      let name = r.name; let n = 2;
      while (names.has(name)) name = `${r.name} (${n++})`;
      names.add(name);
      const id = uid(); ids.push(id);
      store.project.rooms.push({ id, name, design: JSON.parse(JSON.stringify(r.design)) });
    }
    store.project.active = store.project.rooms[store.project.rooms.length - shared.rooms.length].id;
    useProject(store.project);
  }
  commit('load');
  return ids;
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
  const it = { id: uid(), model: modelId, size: 0, variant: vi, x, y, rot: 0, elev: m.elev ?? defaultElev(m.kind, s.h) };
  if (m.mtm) it.custom = { w: s.w, d: s.d, h: s.h };
  return it;
}

export function itemById(id) { return store.d.items.find((i) => i.id === id); }

// Recessed niche settings for built-out walls (heights are mm above the floor).
export function nicheOf(it) {
  const m = modelOf(it) || {};
  return { on: !!m.niche, bottom: 1060, height: 200, depth: 129, led: true, ...(it.niche || {}) };
}
