// Tiles dialog: the tile library (project), each room's tiling (default tile and height, per-wall zones, per-surface
// overrides) and the schedule — tiles to order per room and for the whole project, with a drawing of every surface.
import { store, on, checkpoint, commit, activeRoom, switchRoom } from './state.js';
import { wallsOf } from './geom.js';
import { PATTERNS, newTile, tilesOf, tileById, laidSize, tileLabel, tilingOf, zonesOf, roomSchedule, projectSchedule, wetZones } from './tiling.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const m2 = (mm2) => (mm2 / 1e6).toFixed(2);
const mm = (v) => `${Math.round(v)}`;
const SMALL_CUT = 50; // cuts thinner than this are flagged (mm)

let tab = 'room', clipN = 0;
const dlg = () => $('#tileDlg');

export function initTiles() {
  const d = dlg();
  d.addEventListener('click', (e) => { if (e.target.matches('[data-close]') || e.target === d) d.hidden = true; });
  d.addEventListener('keydown', (e) => { if (e.key === 'Escape') d.hidden = true; });
  on((kind) => { if (!d.hidden && kind !== 'select' && kind !== 'tool' && kind !== 'live') render(); });
}

export function openTiles(which) {
  if (which) tab = which;
  if (!tilesOf(store.project).length && !store.readOnly) seedTiles();
  dlg().hidden = false;
  render();
}

// First use: start the library from the active room's wall and floor tile sizes.
function seedTiles() {
  const r = store.d.room;
  store.project.tiles = [
    newTile({ name: 'Wall tile', w: r.wallTile?.tw || 300, h: r.wallTile?.th || 600, colour: r.wallTile?.color || '#f3f2ef' }),
    newTile({ name: 'Floor tile', w: r.floor?.tw || 600, h: r.floor?.th || 600, joint: 3, colour: r.floor?.color || '#c9c5bd' }),
  ];
  store.project.tileOpts = { reuse: true };
  commit('tiles');
}

// Keep the 3D view / elevations in step with the tiles chosen for each room.
function syncFinishes() {
  let changed = false;
  for (const r of store.project.rooms) {
    const d = r.design; if (!d.tiling) continue;
    const cfg = tilingOf(d, store.project), wt = tileById(store.project, cfg.wall), ft = tileById(store.project, cfg.floor);
    const set = (o, k, v) => { if (v != null && o[k] !== v) { o[k] = v; changed = true; } };
    if (wt) { const s = laidSize(wt); set(d.room.wallTile, 'tw', s.w); set(d.room.wallTile, 'th', s.h); set(d.room.wallTile, 'color', wt.colour); }
    if (ft) { const s = laidSize(ft); set(d.room.floor, 'tw', s.w); set(d.room.floor, 'th', s.h); set(d.room.floor, 'color', ft.colour); }
  }
  return changed;
}
// Change the active room's tiling (undoable).
function editRoom(fn) {
  checkpoint();
  const d = store.d; d.tiling = d.tiling || {};
  fn(d.tiling, d);
  syncFinishes();
  commit('room');
}
// Change the project's tile library / options.
function editLib(fn) { fn(store.project); commit(syncFinishes() ? 'room' : 'tiles'); }

// ------------------------------------------------------------------ rendering
function render() {
  const d = dlg(); if (d.hidden) return;
  const body = $('#tileBody');
  const y = body.scrollTop;
  $('#tileTabs').innerHTML = [['room', 'This room'], ['project', 'Whole project'], ['library', 'Tile library']]
    .map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('');
  body.innerHTML = `<fieldset ${store.readOnly ? 'disabled' : ''}>${tab === 'library' ? libraryHtml() : tab === 'project' ? projectHtml() : roomHtml()}</fieldset>`;
  body.scrollTop = y;
  wire(body);
}

// <option>s: the extra choices first ([value, label]), then every tile in the library.
const tileOpts = (sel, extra = []) => [
  ...extra.map(([v, l]) => `<option value="${v}" ${(sel || '') === v ? 'selected' : ''}>${esc(l)}</option>`),
  ...tilesOf(store.project).map((t) => `<option value="${t.id}" ${sel === t.id ? 'selected' : ''}>${esc(tileLabel(t))} (${t.w}×${t.h})</option>`),
].join('');

function libraryHtml() {
  const tiles = tilesOf(store.project), reuse = store.project.tileOpts?.reuse ?? true;
  return `
    <p class="note">Your tiles, shared by every room in this project. Width × height are the tile as sold; tick <b>Turn</b> to lay it
      the other way round (on walls, width runs along the wall). <b>Extra</b> is added on top of the tiles the layout needs — 10% is
      usual for a straight lay, 15% for brick bond, large-format or patterned tiles. Fill in <b>Per box</b> to round up to whole boxes.</p>
    <div class="tile-lib">
      <table class="bom tile-tbl"><thead><tr><th>Name</th><th>Brand / range</th><th class="num">W</th><th class="num">H</th><th class="num">Joint</th><th>Pattern</th><th>Turn</th><th class="num">Extra %</th><th class="num">Per box</th><th>Colour</th><th></th></tr></thead>
      <tbody>${tiles.map((t) => `<tr data-tile="${t.id}">
        <td><input type="text" data-f="name" value="${esc(t.name)}"></td>
        <td><input type="text" data-f="brand" value="${esc(t.brand)}" placeholder="e.g. Mandarin Stone"></td>
        <td class="num"><input type="number" data-f="w" value="${t.w}" min="10" step="1"></td>
        <td class="num"><input type="number" data-f="h" value="${t.h}" min="10" step="1"></td>
        <td class="num"><input type="number" data-f="joint" value="${t.joint}" min="0" step="0.5"></td>
        <td><select data-f="pattern">${Object.entries(PATTERNS).map(([k, p]) => `<option value="${k}" ${t.pattern === k ? 'selected' : ''}>${p.label}</option>`).join('')}</select></td>
        <td><input type="checkbox" data-f="turn" ${t.turn ? 'checked' : ''}></td>
        <td class="num"><input type="number" data-f="extra" value="${t.extra}" min="0" step="1"></td>
        <td class="num"><input type="number" data-f="perBox" value="${t.perBox || ''}" min="0" step="1" placeholder="—"></td>
        <td><input type="color" data-f="colour" value="${esc(t.colour || '#f3f2ef')}"></td>
        <td><button data-del="${t.id}" class="danger" title="Remove this tile">×</button></td></tr>`).join('')}</tbody></table>
    </div>
    <div class="btns"><button data-act="addTile" class="primary">Add a tile</button></div>
    <label class="row tile-chk"><input type="checkbox" data-act="reuse" ${reuse ? 'checked' : ''}> Use offcuts for other cut pieces</label>
    <p class="note">With this on, a cut piece is taken from an offcut only when the offcut holds the <i>whole</i> piece in one go (after a
      ${3} mm saw cut) — pieces are never made up from scraps. Turn it off to count a fresh tile for every cut piece (the most cautious).</p>`;
}

function scheduleTable(rows, { project = false } = {}) {
  if (!rows.length) return '<p class="note">Nothing to tile yet — pick tiles above.</p>';
  return `<table class="bom tile-sch"><thead><tr><th>Tile</th><th>Laid</th><th class="num">Area</th>${project ? '<th>Rooms</th>' : '<th class="num">Full tiles</th><th class="num">Cut pieces</th>'}<th class="num">Tiles needed</th><th class="num">Extra</th><th class="num">Order</th></tr></thead>
    <tbody>${rows.map((r) => {
      const t = r.tile, s = laidSize(t), needed = project ? r.needed : r.count.tiles;
      const cutNote = project ? '' : `<td class="num">${r.count.full}</td><td class="num">${r.count.cut}<div class="note">${r.count.fresh} from new tiles${r.count.fromOffcut ? `, ${r.count.fromOffcut} from offcuts` : ''}</div></td>`;
      return `<tr><td><span class="sw" style="background:${esc(t.colour || '#ddd')}"></span><b>${esc(tileLabel(t))}</b><div class="note">${t.w} × ${t.h} mm, ${t.joint} mm joint, ${esc(PATTERNS[t.pattern]?.label || '')}</div></td>
        <td>${s.w} wide × ${s.h} high</td><td class="num">${m2(r.area)} m²</td>
        ${project ? `<td>${r.rooms.map((x) => `${esc(x.name)}: <b>${x.needed}</b> <span class="muted">(${m2(x.area)} m²)</span>`).join('<br>')}</td>` : cutNote}
        <td class="num"><b>${needed}</b></td><td class="num">+${t.extra}%</td>
        <td class="num"><b class="order">${r.order} tiles</b>${r.boxes ? `<div class="note">${r.boxes} box${r.boxes > 1 ? 'es' : ''} of ${t.perBox}</div>` : ''}<div class="note">${r.m2.toFixed(2)} m²</div></td></tr>`;
    }).join('')}</tbody></table>`;
}

function roomHtml() {
  const rooms = store.project.rooms, room = activeRoom(), d = store.d, cfg = tilingOf(d, store.project);
  const tiles = tilesOf(store.project);
  if (!tiles.length) return '<p class="note">Add your tiles in the <b>Tile library</b> first.</p>';
  const sch = roomSchedule(d, store.project);
  const walls = wallsOf(d.room.pts);
  const hMode = cfg.height === 0 ? 'none' : cfg.height === Infinity ? 'full' : 'custom';
  const groups = new Map();
  for (const s of sch.surfaces) { if (s.empty) continue; const g = groups.get(s.group) || []; g.push(s); groups.set(s.group, g); }
  const dfltH = cfg.height === Infinity ? 'full height' : cfg.height ? `${cfg.height} mm` : 'not tiled';
  return `
    <div class="tile-head">
      ${rooms.length > 1 ? `<div class="fld"><span>Room</span><select data-act="room">${rooms.map((r) => `<option value="${r.id}" ${r.id === room.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>` : ''}
      <div class="fld"><span>Wall tile</span><select data-cfg="wall">${tileOpts(cfg.wall, [['', 'No wall tiles']])}</select></div>
      <div class="fld"><span>Tile walls to</span><div class="inl"><select data-act="hMode">
        <option value="full" ${hMode === 'full' ? 'selected' : ''}>Full height</option><option value="custom" ${hMode === 'custom' ? 'selected' : ''}>A set height</option><option value="none" ${hMode === 'none' ? 'selected' : ''}>Not tiled</option></select>
        ${hMode === 'custom' ? `<input type="number" data-act="height" value="${cfg.height}" step="10" min="0"> mm` : ''}</div></div>
      <div class="fld"><span>Floor tile</span><select data-cfg="floor">${tileOpts(cfg.floor, [['', 'No floor tiles']])}</select></div>
    </div>
    <div class="tile-opts">
      <label><input type="checkbox" data-cfg="reveals" ${cfg.reveals ? 'checked' : ''}> Tile window reveals, <input type="number" data-cfg="revealDepth" value="${cfg.revealDepth}" step="5" min="0"> mm deep</label>
      <label><input type="checkbox" data-cfg="behind" ${cfg.behind ? 'checked' : ''}> Tile behind vanity units and cabinets</label>
    </div>
    <div class="btns"><button data-act="wet" title="On each wall, the stretch behind a shower tray, wet-room area or bath goes full height; the rest stays at the room's height">Full height around shower &amp; bath</button>
      <button data-act="resetWalls">Reset every wall to the room default</button><button data-act="csv">Copy schedule (CSV)</button><button data-act="print">Print / save as PDF</button></div>

    <h3>${esc(room.name)} — tiles to order</h3>
    ${scheduleTable(sch.rows)}
    <p class="note">Counted tile by tile from the layouts below: every full tile, plus one tile (or a big-enough offcut) for every cut piece. The
      extra allowance covers breakages, miscuts and a few spares for repairs — buy everything from the same batch.</p>

    ${walls.map((w) => wallSection(w, cfg, groups.get(w.i) || [])).join('')}
    ${groups.has('other') ? `<section class="tile-wall"><h4>Boxing not against a wall</h4>${surfList(groups.get('other'))}</section>` : ''}
    <section class="tile-wall"><h4>Floor</h4>${surfList(groups.get('floor') || [])}</section>`;
}

function wallSection(w, cfg, surfs) {
  const zones = zonesOf(cfg, w.i, w.len), custom = !!cfg.walls[w.i]?.length;
  const H = store.d.room.height;
  const zoneRows = zones.map((z, k) => {
    const hv = z.h === 'default' || z.h === 'full' || z.h === 'none' ? z.h : 'custom';
    const last = k === zones.length - 1;
    return `<div class="zone" data-z="${k}">
      <span class="zr">${mm(z.x0)} → ${last ? `${mm(z.x1)} mm` : `<input type="number" data-zf="to" value="${mm(z.x1)}" step="10" min="0" max="${mm(w.len)}"> mm`}</span>
      <select data-zf="h"><option value="default" ${hv === 'default' ? 'selected' : ''}>Room height (${cfg.height === Infinity ? 'full' : cfg.height ? cfg.height + ' mm' : 'none'})</option>
        <option value="full" ${hv === 'full' ? 'selected' : ''}>Full height</option><option value="custom" ${hv === 'custom' ? 'selected' : ''}>Set height…</option><option value="none" ${hv === 'none' ? 'selected' : ''}>Not tiled</option></select>
      ${hv === 'custom' ? `<input type="number" data-zf="hmm" value="${z.top}" step="10" min="0"> mm` : ''}
      <select data-zf="tile">${tileOpts(cfg.walls[w.i]?.[k]?.tile || '', [['', `Room wall tile${tileById(store.project, cfg.wall) ? ` (${tileLabel(tileById(store.project, cfg.wall))})` : ''}`]])}</select>
      <button data-zact="split" title="Split this stretch in two">Split</button>${zones.length > 1 ? '<button data-zact="del" title="Merge into the stretch before (or after)">Merge</button>' : ''}
    </div>`;
  }).join('');
  // strip: the wall to scale, its doors and windows, and each stretch tiled to its height
  const k = Math.min(560 / Math.max(w.len, 1), 170 / H), hh = H * k, sy = (v) => hh - Math.min(v, H) * k;
  const L = (() => { const fx = -w.nx, fy = -w.ny; return -fy * w.ux + fx * w.uy > 0; })();
  const ops = store.d.openings.filter((o) => o.wall === w.i).map((o) => {
    const x0 = L ? o.offset : w.len - o.offset - o.width, y0 = o.type === 'door' ? 0 : o.sill || 0;
    return `<rect x="${x0 * k}" y="${sy(y0 + o.height)}" width="${o.width * k}" height="${o.height * k}" fill="var(--panel)" stroke="currentColor" stroke-opacity=".6"/>`;
  }).join('');
  const strip = `<svg class="zone-strip" viewBox="-1 -1 ${w.len * k + 2} ${hh + 2}" width="${w.len * k + 2}" height="${hh + 2}">
    <rect x="0" y="0" width="${w.len * k}" height="${hh}" fill="var(--panel)" stroke="currentColor" stroke-opacity=".5"/>
    ${zones.map((z) => { const t = tileById(store.project, z.tile); return z.top > 0 && t ? `<rect x="${z.x0 * k}" y="${sy(z.top)}" width="${(z.x1 - z.x0) * k}" height="${hh - sy(z.top)}" fill="${esc(t.colour || '#ccd')}" stroke="currentColor" stroke-opacity=".7"/><rect x="${z.x0 * k}" y="${sy(z.top)}" width="${(z.x1 - z.x0) * k}" height="${hh - sy(z.top)}" fill="var(--accent)" fill-opacity=".14"/>` : ''; }).join('')}
    ${ops}
    ${zones.map((z, i) => `${i ? `<line x1="${z.x0 * k}" x2="${z.x0 * k}" y1="0" y2="${hh}" stroke="#d07a2a" stroke-width="1.5" stroke-dasharray="4 3"/>` : ''}
      <text x="${((z.x0 + z.x1) / 2) * k}" y="${z.top >= H ? 12 : Math.max(12, sy(z.top) - 4)}" text-anchor="middle" font-size="10" fill="currentColor">${(z.x1 - z.x0) * k < 34 ? '' : z.top === 0 ? 'none' : z.top >= H ? 'full' : mm(z.top)}</text>`).join('')}
  </svg>`;
  return `<section class="tile-wall" data-wall="${w.i}">
    <h4>Wall ${w.i + 1} · ${mm(w.len)} mm <span class="muted">— seen from inside the room, measured from the left corner</span>${custom ? ' <span class="pill">custom</span>' : ''}</h4>
    <div class="zones">${strip}${zoneRows}</div>
    ${surfList(surfs)}
  </section>`;
}

function surfList(surfs) {
  if (!surfs.length) return '<p class="note">Nothing tiled here.</p>';
  // group niche / reveal parts under one override control
  const seen = new Set();
  return `<div class="surfs">${surfs.map((s) => {
    const t = tileById(store.project, s.tile), lay = s.lay;
    const ov = s.ovKey && !seen.has(s.ovKey) ? (seen.add(s.ovKey), s.ovKey) : null;
    const cfgFaces = tilingOf(store.d, store.project).faces;
    const b = bounds(s.polys);
    const stats = lay ? `${m2(lay.area)} m² · <b>${lay.pieces.filter((p) => p.full).length}</b> full + <b>${lay.pieces.filter((p) => !p.full).length}</b> cut${s.minCut != null ? ` · smallest cut ${mm(s.minCut)} mm${s.minCut < SMALL_CUT ? ' <span class="warn" title="A thin sliver: consider moving the zone edge, or the layout, so the cut is bigger">⚠</span>' : ''}` : ''}` : 'not tiled';
    return `<div class="surf ${t ? '' : 'off'}">
      ${t && lay ? drawSurface(s, t) : `<div class="surf-off">${mm(b.w)} × ${mm(b.h)}</div>`}
      <div class="surf-info"><b>${esc(s.label)}</b><div class="note">${mm(b.w)} × ${mm(b.h)} mm${t ? ` · ${esc(tileLabel(t))}` : ''}</div><div class="note">${stats}</div>
      ${ov ? `<select data-face="${esc(ov)}" title="Tile for this surface">${tileOpts(cfgFaces[ov] || '', [['', 'Automatic (as the wall)'], ['none', 'Not tiled']])}</select>` : ''}</div>
    </div>`;
  }).join('')}</div>`;
}

const bounds = (polys) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const q of p) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
};

// The surface with its tiles: full tiles in the tile colour, cut pieces amber, the rest (openings, fittings) hatched.
export function drawSurface(s, t, maxW = 230, maxH = 150) {
  const b = bounds(s.polys), lay = s.lay, flip = s.plane === 'v';
  const k = Math.min(maxW / Math.max(b.w, 1), maxH / Math.max(b.h, 1));
  const W = b.w * k, H = b.h * k;
  const X = (x) => (x - b.x0) * k, Y = (y) => (flip ? (b.y1 - y) * k : (y - b.y0) * k);
  const id = `tc${++clipN}`;
  const path = s.polys.map((p) => 'M' + p.map((q) => `${X(q.x).toFixed(1)},${Y(q.y).toFixed(1)}`).join('L') + 'Z').join('');
  const cells = lay.cells.map((c) => {
    const x = X(c.x), y = flip ? Y(c.y + lay.th) : Y(c.y);
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(lay.tw * k).toFixed(1)}" height="${(lay.th * k).toFixed(1)}" class="${c.full ? 'tf' : 'tc'}"/>`;
  }).join('');
  return `<svg class="surf-svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" style="--tile:${esc(t.colour || '#e8ecef')}">
    <defs><clipPath id="${id}"><path d="${path}"/></clipPath><pattern id="${id}h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="hatch"/></pattern></defs>
    <rect width="${W.toFixed(1)}" height="${H.toFixed(1)}" fill="url(#${id}h)" class="bg"/>
    <g clip-path="url(#${id})">${cells}</g>
  </svg>`;
}

function projectHtml() {
  if (!tilesOf(store.project).length) return '<p class="note">Add your tiles in the <b>Tile library</b> first.</p>';
  const ps = projectSchedule(store.project);
  return `
    <h3>${esc(store.project.name)} — tiles to order</h3>
    ${scheduleTable(ps.totals, { project: true })}
    <p class="note">Each room is counted from its own layout (offcuts aren't carried between rooms), then the extra allowance is added to the
      project total once. Rooms you haven't set up use the first tile in the library on the walls (at the room's tile height) and the floor tile on the floor.</p>
    <h3>By room</h3>
    ${ps.rooms.map(({ room, sch }) => `<h4>${esc(room.name)}</h4>${scheduleTable(sch.rows)}`).join('')}
    <div class="btns"><button data-act="csv">Copy schedule (CSV)</button><button data-act="print">Print / save as PDF</button></div>`;
}

// ------------------------------------------------------------------ events
function wire(body) {
  const tabs = $('#tileTabs');
  tabs.onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; render(); } };
  // library
  body.querySelectorAll('[data-tile] [data-f]').forEach((el) => el.addEventListener('change', () => {
    const id = el.closest('[data-tile]').dataset.tile, f = el.dataset.f;
    editLib((p) => {
      const t = p.tiles.find((x) => x.id === id); if (!t) return;
      if (f === 'turn') t.turn = el.checked;
      else if (['w', 'h'].includes(f)) t[f] = Math.max(10, +el.value || t[f]);
      else if (['joint', 'extra', 'perBox'].includes(f)) t[f] = Math.max(0, +el.value || 0);
      else t[f] = el.value;
    });
  }));
  body.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', () => {
    const t = tileById(store.project, el.dataset.del);
    if (!t || !confirm(`Remove "${tileLabel(t)}" from the library? Rooms using it fall back to another tile.`)) return;
    editLib((p) => { p.tiles = p.tiles.filter((x) => x.id !== t.id); });
  }));
  const act = (name, fn, ev = 'click') => body.querySelectorAll(`[data-act="${name}"]`).forEach((el) => el.addEventListener(ev, () => fn(el)));
  act('addTile', () => editLib((p) => { p.tiles = p.tiles || []; p.tiles.push(newTile({ name: `Tile ${p.tiles.length + 1}` })); }));
  act('reuse', (el) => editLib((p) => { p.tileOpts = { ...(p.tileOpts || {}), reuse: el.checked }; }), 'change');
  act('room', (el) => switchRoom(el.value), 'change');
  // room settings
  body.querySelectorAll('[data-cfg]').forEach((el) => el.addEventListener('change', () => editRoom((t, d) => {
    const k = el.dataset.cfg;
    if (el.type === 'checkbox') t[k] = el.checked;
    else if (k === 'revealDepth') t[k] = Math.max(0, +el.value || 0);
    else t[k] = el.value;
  })));
  act('hMode', (el) => editRoom((t, d) => {
    const wt = d.room.wallTile;
    if (el.value === 'none') wt.enabled = false;
    else if (el.value === 'full') { wt.enabled = true; wt.height = d.room.height; }
    else { wt.enabled = true; if (wt.height >= d.room.height || !wt.height) wt.height = 1200; }
  }), 'change');
  act('height', (el) => editRoom((t, d) => { d.room.wallTile.enabled = true; d.room.wallTile.height = Math.max(0, +el.value || 0); }), 'change');
  act('wet', () => {
    const z = wetZones(store.d);
    if (!Object.keys(z).length) { alert('No shower tray, wet-room area or bath against a wall in this room.'); return; }
    editRoom((t) => { t.walls = { ...(t.walls || {}), ...z }; });
  });
  act('resetWalls', () => editRoom((t) => { t.walls = {}; }));
  act('csv', () => navigator.clipboard.writeText(csv()).then(() => flash('Copied the tile schedule')));
  act('print', () => printSchedule());
  // per-surface overrides
  body.querySelectorAll('[data-face]').forEach((el) => el.addEventListener('change', () => editRoom((t) => {
    t.faces = { ...(t.faces || {}) };
    if (el.value) t.faces[el.dataset.face] = el.value; else delete t.faces[el.dataset.face];
  })));
  // wall zones
  body.querySelectorAll('[data-wall]').forEach((sec) => {
    const i = +sec.dataset.wall, w = wallsOf(store.d.room.pts)[i];
    const zonesNow = (t) => {
      const cfg = tilingOf(store.d, store.project);
      const cur = zonesOf(cfg, i, w.len).map((z) => ({ to: Math.round(z.x1), h: z.h, tile: (t.walls?.[i] || [])[z.idx]?.tile || '' }));
      t.walls = { ...(t.walls || {}) }; t.walls[i] = cur; return cur;
    };
    sec.querySelectorAll('[data-z]').forEach((row) => {
      const k = +row.dataset.z;
      row.querySelectorAll('[data-zf]').forEach((el) => el.addEventListener('change', () => editRoom((t) => {
        const z = zonesNow(t), f = el.dataset.zf;
        if (f === 'to') { const lo = k ? z[k - 1].to : 0, hi = z[k + 1] ? (k + 1 < z.length - 1 ? z[k + 1].to : w.len) : w.len; z[k].to = Math.max(lo + 10, Math.min(hi - 10, Math.round(+el.value || 0))); }
        else if (f === 'h') { const top = zonesOf(tilingOf(store.d, store.project), i, w.len)[k].top; z[k].h = el.value === 'custom' ? (top === Infinity ? 2000 : top || 1200) : el.value; }
        else if (f === 'hmm') z[k].h = Math.max(0, Math.round(+el.value || 0));
        else if (f === 'tile') z[k].tile = el.value;
      })));
      row.querySelectorAll('[data-zact]').forEach((el) => el.addEventListener('click', () => editRoom((t) => {
        const z = zonesNow(t);
        const x0 = k ? z[k - 1].to : 0, x1 = k === z.length - 1 ? w.len : z[k].to;
        if (el.dataset.zact === 'split') { if (x1 - x0 < 40) return; z.splice(k, 0, { ...z[k], to: Math.round((x0 + x1) / 20) * 10 }); }
        else if (z.length > 1) z.splice(k, 1); // the next stretch (or the one before, for the last) takes its place
        if (z.length === 1 && z[0].h === 'default' && !z[0].tile) delete t.walls[i];
      })));
    });
  });
}

let flashT;
function flash(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(flashT); flashT = setTimeout(() => t.classList.remove('show'), 1800); }

// ------------------------------------------------------------------ export
function csv() {
  const ps = projectSchedule(store.project);
  const rows = [['Room', 'Tile', 'Brand', 'Tile W (mm)', 'Tile H (mm)', 'Area (m²)', 'Full tiles', 'Cut pieces', 'Tiles needed', 'Extra %', 'Order (tiles)', 'Boxes', 'Order (m²)']];
  for (const { room, sch } of ps.rooms) for (const r of sch.rows) rows.push([room.name, r.tile.name, r.tile.brand, r.tile.w, r.tile.h, m2(r.area), r.count.full, r.count.cut, r.count.tiles, r.tile.extra, r.order, r.boxes ?? '', r.m2.toFixed(2)]);
  for (const t of ps.totals) rows.push(['PROJECT TOTAL', t.tile.name, t.tile.brand, t.tile.w, t.tile.h, m2(t.area), t.full, t.cut, t.needed, t.tile.extra, t.order, t.boxes ?? '', t.m2.toFixed(2)]);
  return rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

function printSchedule() {
  const ps = projectSchedule(store.project);
  const one = tab === 'room' ? ps.rooms.filter((x) => x.room.id === activeRoom().id) : ps.rooms;
  const roomPart = ({ room, sch }) => {
    const walls = wallsOf(room.design.room.pts);
    const groups = new Map();
    for (const s of sch.surfaces) if (!s.empty && s.lay) { const g = groups.get(s.group) || []; g.push(s); groups.set(s.group, g); }
    const name = (g) => (g === 'floor' ? 'Floor' : g === 'other' ? 'Other boxing' : `Wall ${g + 1} · ${mm(walls[g].len)} mm`);
    return `<section><h2>${esc(room.name)}</h2>${scheduleTable(sch.rows)}
      ${[...groups].map(([g, list]) => `<h3>${name(g)}</h3><div class="surfs">${list.map((s) => { const t = tileById(store.project, s.tile), b = bounds(s.polys), c = s.lay.pieces.filter((p) => !p.full).length;
        return `<div class="surf">${drawSurface(s, t, 200, 130)}<div><b>${esc(s.label)}</b><br>${mm(b.w)} × ${mm(b.h)} mm · ${esc(tileLabel(t))}<br>${m2(s.lay.area)} m² · ${s.lay.pieces.length - c} full + ${c} cut${s.minCut != null ? ` · smallest cut ${mm(s.minCut)} mm` : ''}</div></div>`; }).join('')}</div>`).join('')}</section>`;
  };
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Tile schedule — ${esc(store.project.name)}</title><style>
    body{font:12px -apple-system,Segoe UI,sans-serif;color:#1d232b;margin:18px} h1{font-size:18px} h2{font-size:15px;margin:22px 0 6px;page-break-before:auto} h3{font-size:12.5px;margin:12px 0 4px}
    table{border-collapse:collapse;width:100%} th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top} .num{text-align:right}
    .note{color:#6b7380;font-size:10.5px} .muted{color:#6b7380} .sw{display:inline-block;width:10px;height:10px;border:1px solid #999;margin-right:5px;vertical-align:-1px}
    .surfs{display:flex;flex-wrap:wrap;gap:10px} .surf{display:flex;gap:8px;align-items:flex-start;width:48%;break-inside:avoid;font-size:11px}
    .surf-svg .tf{fill:var(--tile);stroke:#555;stroke-width:.6} .surf-svg .tc{fill:#f3c27a;stroke:#555;stroke-width:.6} .surf-svg .hatch{stroke:#ccc;stroke-width:1} .surf-svg{border:1px solid #bbb;flex:none}
    section{break-inside:auto} @media print{body{margin:8mm}}</style></head><body>
    <h1>Tile schedule — ${esc(store.project.name)}</h1>
    ${tab === 'room' ? '' : `<h2>Project total</h2>${scheduleTable(ps.totals, { project: true })}`}
    ${one.map(roomPart).join('')}
    <p class="note">Full tiles shown in the tile colour, cut pieces in amber, untiled areas (doors, windows, boxing, fittings) hatched. Wall drawings are seen from inside the room.</p>
    <script>window.onload=()=>setTimeout(()=>print(),200)<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups to print the schedule.'); return; }
  w.document.write(html); w.document.close();
}
