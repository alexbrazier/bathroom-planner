// Library panel, properties panel and parts list.
import { MODELS, CATS, catOf, byId, parsePrice, fmtPrice, currencyOf, BRANDS, colourPair, defaultElev, STACKS_ON, SUPPORTS } from './catalog.js';
import { store, checkpoint, commit, select, modelOf, sizeOf, variantOf, cfgOf, priceOf, itemById, uid, defaultRoom, nicheOf, switchRoom } from './state.js';
import { wallsOf, polyBounds, normAngle, snap, pointInPoly, ceilingAt } from './geom.js';
import { addModelAt, clearances, splitWall, removeVertex, plan, drawActions } from './plan2d.js';
import { placeItem, ridersOf, applyRiders, findSupport } from './place.js';
import { braceInfo, flushInfo, bathInfo } from './models3d.js';
import { VIEWS, outsideOf } from './view3d.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ library
let libCat = 'vanity';
let libQuery = '';
let libBrand = 'all';

const shortName = (n) => n.replace(/^Villeroy & Boch /, 'V&B ').replace(/ with lighting and touch control| with touch control/i, '').replace(/, (left|right) hand hinged/i, (m, s) => ` (${s[0].toUpperCase()}H)`);

export function initLibrary() {
  const cats = $('#libCats');
  const all = [{ id: 'all', label: 'All' }, ...CATS];
  cats.innerHTML = all.map((c) => `<button data-cat="${c.id}" class="${c.id === libCat ? 'on' : ''}">${c.label}</button>`).join('');
  cats.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    libCat = b.dataset.cat;
    cats.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    renderLibrary();
  });
  const bs = $('#libBrand');
  bs.innerHTML = `<option value="used">★ Used in this project</option>` + BRANDS.map((b) => `<option value="${b.id}">${b.label}</option>`).join('');
  try { libBrand = localStorage.getItem('bathroom-designer:brand') || 'all'; } catch { /* ignore */ }
  bs.value = libBrand;
  bs.addEventListener('change', () => { libBrand = bs.value; try { localStorage.setItem('bathroom-designer:brand', libBrand); } catch { /* ignore */ } renderLibrary(); });
  $('#libSearch').addEventListener('input', (e) => { libQuery = e.target.value.trim().toLowerCase(); renderLibrary(); });
  const list = $('#libList');
  list.addEventListener('dragstart', (e) => {
    const c = e.target.closest('.card'); if (!c) return;
    e.dataTransfer.setData('text/x-model', c.dataset.id);
    e.dataTransfer.effectAllowed = 'copy';
    const img = c.querySelector('img'); if (img) e.dataTransfer.setDragImage(img, 40, 40);
  });
  list.addEventListener('click', (e) => {
    const c = e.target.closest('.card'); if (!c) return;
    quickAdd(c.dataset.id);
  });
  renderLibrary();
}

function quickAdd(id) {
  const m = byId.get(id);
  const sel = store.sel?.type === 'item' ? itemById(store.sel.id) : null;
  let p;
  if (sel && STACKS_ON.has(m.kind) && SUPPORTS.has(modelOf(sel)?.kind)) p = { x: sel.x, y: sel.y };
  else {
    const walls = wallsOf(store.d.room.pts);
    const w = walls.reduce((a, b) => (b.len > a.len ? b : a));
    const s = m.sizes[0];
    // find a free spot along the longest wall
    let t = w.len / 2;
    const taken = store.d.items.map((o) => ({ o, s: sizeOf(o) }));
    for (let k = 0; k < 20; k++) {
      const c = { x: w.a.x + w.ux * t + w.nx * (s.d / 2), y: w.a.y + w.uy * t + w.ny * (s.d / 2) };
      const e0 = defaultElev(m.kind, s.h);
      const clash = taken.some(({ o, s: os }) => Math.hypot(o.x - c.x, o.y - c.y) < (os.w + s.w) / 2 - 5 && o.elev < e0 + s.h && o.elev + os.h > e0);
      if (!clash) break;
      t = w.len / 2 + (k % 2 ? -1 : 1) * Math.ceil((k + 1) / 2) * 200;
    }
    p = { x: w.a.x + w.ux * t + w.nx * (s.d / 2 + 10), y: w.a.y + w.uy * t + w.ny * (s.d / 2 + 10) };
  }
  addModelAt(id, p);
}

function priceRange(m) {
  const vs = m.sizes.flatMap((s) => s.variants).filter((v) => parsePrice(v.price) != null);
  if (!vs.length) return null;
  const v = vs.reduce((a, b) => (parsePrice(b.price) < parsePrice(a.price) ? b : a));
  return fmtPrice(parsePrice(v.price), currencyOf(v.price));
}

// How many of each product are placed across every room in the project.
function usageCounts() {
  const n = new Map();
  for (const r of store.project?.rooms || [{ design: store.d }]) for (const it of r.design.items) n.set(it.model, (n.get(it.model) || 0) + 1);
  return n;
}

export function renderLibrary() {
  const list = $('#libList');
  const used = usageCounts();
  let models = libBrand === 'used' ? MODELS.filter((m) => used.has(m.id)) : MODELS.filter(BRANDS.find((b) => b.id === libBrand)?.test || (() => true));
  if (libQuery) {
    const words = libQuery.split(/\s+/).filter(Boolean);
    models = models.filter((m) => {
      const hay = [m.name, m.brand, m.range, ...m.sizes.map((s) => s.variants[0]?.sku)].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  if (libCat !== 'all') models = models.filter((m) => catOf(m) === libCat);
  const card = (m) => {
    const ws = [...new Set(m.sizes.map((s) => s.w))];
    const meta = m.custom && m.mtm ? 'Any size' : ws.length > 1 ? `W ${Math.min(...ws) / 10}–${Math.max(...ws) / 10} cm` : `${m.sizes[0].w / 10}×${m.sizes[0].d / 10}×${m.sizes[0].h / 10} cm`;
    const pr = priceRange(m);
    const img = m.thumb ? `<img src="${m.thumb}" loading="lazy" alt="" draggable="false">` : `<div class="ph">${icon(m.kind)}</div>`;
    const k = used.get(m.id);
    return `<div class="card" draggable="true" data-id="${m.id}" title="${esc(m.name)}">${k ? `<span class="used" title="Used ${k}× in this project">×${k}</span>` : ''}${img}<div class="nm">${esc(shortName(m.name))}</div><div class="meta">${meta}${pr ? ` · from ${pr}` : ''}</div></div>`;
  };
  if (libCat === 'all') {
    let html = '';
    for (const c of CATS) {
      const ms = models.filter((m) => catOf(m) === c.id);
      if (ms.length) html += `<div class="lib-group">${c.label}</div>` + ms.map(card).join('');
    }
    list.innerHTML = html || `<div class="note">${libBrand === 'used' && !used.size ? 'Nothing placed in this project yet.' : 'No matches.'}</div>`;
  } else list.innerHTML = models.map(card).join('') || '<div class="note">No matches in this category.</div>';
}

function icon(kind) {
  return { vanity: '▭', base: '▭', bath: '🛁', tray: '⬚', wc: '🚽', toilet: '🚽', radiator: '▤', towelrail: '☰', door: '🚪', window: '⊞', box: '▦', glass: '▯' }[kind] || '▭';
}

// ------------------------------------------------------------------ properties
export function renderProps() {
  const el = $('#props');
  if (el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'color' && el.dataset.sel === JSON.stringify(store.sel)) {
    // don't clobber a field being typed in; refresh passive values only
    refreshLive();
    return;
  }
  el.dataset.sel = JSON.stringify(store.sel);
  const s = store.sel;
  if (s?.type === 'item') { const it = itemById(s.id); if (it) return itemPanel(el, it); }
  if (s?.type === 'wall') return wallPanel(el, s.index);
  if (s?.type === 'vertex') return vertexPanel(el, s.index);
  if (s?.type === 'opening') { const op = store.d.openings.find((o) => o.id === s.id); if (op) return openingPanel(el, op); }
  roomPanel(el);
}

function refreshLive() {
  const it = store.sel?.type === 'item' ? itemById(store.sel.id) : null;
  if (!it) return;
  const set = (k, v) => { const i = document.querySelector(`#props [data-live="${k}"]`); if (i && document.activeElement !== i) i.value = v; };
  const b = polyBounds(store.d.room.pts);
  set('x', Math.round(it.x - b.x0)); set('y', Math.round(it.y - b.y0)); set('rot', Math.round(it.rot)); set('elev', Math.round(it.elev));
  const cl = clearances(it);
  for (const k of ['left', 'right', 'back', 'front']) set('cl-' + k, cl[k].dist == null ? '' : Math.round(cl[k].dist));
}

function num(label, key, val, opts = {}) {
  return `<div class="row"><label>${label}</label><input type="number" data-k="${key}" ${opts.live ? `data-live="${opts.live}"` : ''} value="${val}" step="${opts.step ?? 1}" ${opts.min != null ? `min="${opts.min}"` : ''}><span class="unit">${opts.unit ?? 'mm'}</span></div>`;
}

function bind(el, handlers) {
  el.querySelectorAll('[data-k]').forEach((inp) => {
    const k = inp.dataset.k;
    const ev = inp.tagName === 'SELECT' || inp.type === 'checkbox' || inp.type === 'color' ? 'change' : 'change';
    inp.addEventListener(ev, () => handlers[k]?.(inp.type === 'checkbox' ? inp.checked : inp.value, inp));
    if (inp.type === 'number') inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
  });
  el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => handlers[b.dataset.act]?.(b)));
}

function mutate(fn, kind = 'items') { checkpoint(); fn(); commit(kind); }

function itemPanel(el, it) {
  const m = modelOf(it);
  const sz = sizeOf(it);
  const v = variantOf(it);
  const cfg = cfgOf(it);
  const sizeIdx = it.size || 0;
  const sizeList = m.sizes;
  const vars = sizeList[sizeIdx].variants;
  const price = priceOf(it);
  const b = polyBounds(store.d.room.pts);
  const cl = clearances(it);
  const img = v?.img || sizeList[sizeIdx].thumb || m.thumb;
  const swatches = vars.map((vv, i) => {
    const cp = colourPair(vv.colour, it.bespoke);
    const split = cp.front !== cp.carcass;
    return `<button class="sw ${i === (it.variant || 0) ? 'on' : ''} ${split ? 'split' : ''}" data-act="variant" data-i="${i}" title="${esc(vv.colour)}${vv.price ? ' · ' + vv.price : ''}" style="background:${cp.front};--c2:${cp.carcass}"></button>`;
  }).join('');
  const isCustom = !!it.custom;
  const showCfg = isCustom && ['vanity', 'base', 'tall', 'wall'].includes(m.kind);
  const bespoke = /bespoke/i.test(v?.colour || '');
  el.innerHTML = `
    ${img ? `<img class="prod-img" src="${esc(img)}" alt="" onerror="this.style.display='none'">` : ''}
    <h3>${esc(m.name)}</h3>
    <div class="sub">${v?.sku && v.sku !== 'MTM' ? `${esc(v.sku)} · ` : ''}${esc(v?.colour || '')}${v?.url ? ` · <a href="${esc(v.url)}" target="_blank" rel="noopener">View product</a>` : ''}</div>
    ${m.note ? `<div class="note">${esc(m.note)}</div>` : ''}
    <div class="price">${price != null ? fmtPrice(price, currencyOf(v?.price)) : isCustom && !m.generic ? 'Made to measure — price on request' : m.generic ? '' : '—'}</div>

    <h4>Size</h4>
    ${sizeList.length > 1 || m.custom ? `<div class="row"><label>Size</label><select data-k="size">
      ${sizeList.map((s, i) => `<option value="${i}" ${!isCustom && i === sizeIdx ? 'selected' : ''}>${s.w} × ${s.d} × ${s.h} mm</option>`).join('')}
      ${m.custom ? `<option value="custom" ${isCustom ? 'selected' : ''}>Custom size…</option>` : ''}
    </select></div>` : `<div class="note">${sz.w} × ${sz.d} × ${sz.h} mm (W × D × H)</div>`}
    ${isCustom ? `<div class="grid2" style="grid-template-columns:1fr 1fr 1fr">
      <div class="fld"><span>Width</span><input type="number" data-k="cw" value="${sz.w}" min="100" step="1"></div>
      <div class="fld"><span>Depth</span><input type="number" data-k="cd" value="${sz.d}" min="5" step="1"></div>
      <div class="fld"><span>Height</span><input type="number" data-k="ch" value="${sz.h}" min="5" step="1"></div>
    </div>` : ''}
    ${showCfg ? `<div class="grid2" style="margin-top:6px">
      <div class="fld"><span>Front</span><select data-k="front">${['plain', 'integrated', 'blackframe', 'framed', 'fluted', 'grooved', 'curved'].map((f) => `<option value="${f}" ${cfg.front === f ? 'selected' : ''}>${{ plain: 'Plain (handle)', integrated: 'Integrated handle', blackframe: 'Black frame', framed: 'Framed', fluted: 'Fluted', grooved: 'Grooved', curved: 'Curved & grooved' }[f]}</option>`).join('')}</select></div>
      <div class="fld"><span>Drawers / doors</span><select data-k="layout">${[['d1', '1 drawer'], ['d2', '2 drawers'], ['o1', '1 door'], ['o2', '2 doors']].map(([k, l]) => `<option value="${k}" ${(cfg.drawers ? 'd' + cfg.drawers : 'o' + (cfg.doors || 1)) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>` : ''}

    ${m.kind === 'falsewall' ? nicheHtml(it) : ''}
    ${m.kind === 'wetpanel' ? braceHtml(it) : ''}
    ${m.kind === 'bathscreen' ? `<h4>Fitting</h4><div class="row"><label>Wall profile end</label><select data-k="wpChannel"><option value="start" ${it.cfg?.channel !== 'end' ? 'selected' : ''}>Start</option><option value="end" ${it.cfg?.channel === 'end' ? 'selected' : ''}>End</option></select></div><div class="note">Stands on the rim of the bath below it (top of the bath ${(() => { const b = store.d.items.find((o) => modelOf(o)?.kind === 'bath' && Math.abs(it.elev - o.elev - sizeOf(o).h) < 2); return b ? 'found' : 'not found — set the height off the floor to the bath rim'; })()}).</div>` : ''}
    ${m.kind === 'toilet' ? flushHtml(it) : ''}
    ${m.kind === 'bath' && m.shape !== 'oval' ? bathHtml(it, m) : ''}
    ${m.kind === 'fan' ? `<h4>Mounting</h4><div class="row"><label>Fitted on</label><select data-k="fanMount"><option value="wall" ${it.cfg?.mount !== 'ceiling' ? 'selected' : ''}>Wall</option><option value="ceiling" ${it.cfg?.mount === 'ceiling' ? 'selected' : ''}>Ceiling</option></select></div><div class="note">${it.cfg?.mount === 'ceiling' ? 'Flush to the ceiling — drag it to where the duct can run.' : 'High on the wall, ideally opposite the door and close to the shower.'}</div>` : ''}
    ${m.kind === 'niche' ? `<h4>Niche</h4><div class="row"><label>LED strip</label><input type="checkbox" data-k="nkLed" ${it.cfg?.led !== false ? 'checked' : ''}></div><div class="note">Place it on a wall face — it cuts its own recess. On a real wall the depth is limited to the wall thickness.</div>` : ''}
    ${vars.length > 1 || bespoke ? `<h4>Colour</h4><div class="swatches">${swatches}</div>` : ''}
    ${bespoke ? `<div class="row" style="margin-top:8px"><label>Bespoke colour</label><input type="color" data-k="bespoke" value="${it.bespoke || '#8b9a86'}"></div>` : ''}

    <h4>Position</h4>
    <div class="grid2">
      <div class="fld"><span>X from left (mm)</span><input type="number" data-k="x" data-live="x" value="${Math.round(it.x - b.x0)}"></div>
      <div class="fld"><span>Y from top (mm)</span><input type="number" data-k="y" data-live="y" value="${Math.round(it.y - b.y0)}"></div>
      <div class="fld"><span>Rotation (°)</span><input type="number" data-k="rot" data-live="rot" value="${Math.round(it.rot)}" step="1"></div>
      <div class="fld"><span>Height off floor (mm)</span><input type="number" data-k="elev" data-live="elev" value="${Math.round(it.elev)}"></div>
    </div>
    <div class="note" style="margin-top:4px">Top of unit: <b>${Math.round(it.elev + sz.h)} mm</b> from floor${ridersOf(it).length ? ` (worktop/basin top ${Math.round(it.elev + sz.h + Math.max(...ridersOf(it).map((r) => sizeOf(r.o).h)))} mm)` : ''}.</div>

    <h4>Clearance to walls</h4>
    <div class="clear-grid">
      ${['left', 'right', 'back', 'front'].map((k) => `<div class="fld grid2" style="grid-template-columns:1fr"><span>${{ left: 'Left side', right: 'Right side', back: 'Behind', front: 'In front' }[k]} (mm)</span><input type="number" data-k="cl-${k}" data-live="cl-${k}" value="${cl[k].dist == null ? '' : Math.round(cl[k].dist)}"></div>`).join('')}
    </div>
    <div class="note" style="margin-top:4px">Type a clearance to move the unit exactly that far from the wall.</div>

    <div class="btns">
      <button data-act="rotate">Rotate 90°</button>
      <button data-act="dup">Duplicate</button>
      <button data-act="copy" title="⌘/Ctrl+C">Copy</button>
      <button data-act="del" class="danger">Delete</button>
    </div>
    ${(store.project?.rooms.length || 1) > 1 ? `<div class="row" style="margin-top:8px"><label>Copy to room</label><select data-k="copyTo"><option value="">Choose…</option>${store.project.rooms.filter((r) => r.id !== store.project.active).map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div>` : ''}
    <div class="note" style="margin-top:10px">Keys: R rotate · Del delete · ⌘/Ctrl+D duplicate · ⌘/Ctrl+C copy, ⌘/Ctrl+V paste (also into another room) · arrows nudge 10 mm (Shift = 1 mm) · drag the square edge handles to resize custom sizes · Alt-drag = no snapping</div>
  `;
  const riders = () => ridersOf(it);
  const withRiders = (fn) => { const r = riders(); fn(); applyRiders(it, r); };
  bind(el, {
    size: (val) => mutate(() => withRiders(() => {
      if (val === 'custom') { const s0 = sizeOf(it); it.custom = { w: s0.w, d: s0.d, h: s0.h }; }
      else {
        const oldS = sizeOf(it);
        delete it.custom; it.size = +val;
        const ns = m.sizes[it.size];
        // keep the same colour if available in the new size
        const cname = v?.colour;
        const vi = ns.variants.findIndex((x) => x.colour === cname);
        it.variant = vi >= 0 ? vi : 0;
        keepAgainstWall(it, oldS, ns);
      }
    })),
    cw: (val) => mutate(() => withRiders(() => { const o = { ...it.custom }; it.custom.w = Math.max(50, +val); keepAgainstWall(it, o, it.custom); })),
    cd: (val) => mutate(() => withRiders(() => { const o = { ...it.custom }; it.custom.d = Math.max(5, +val); keepAgainstWall(it, o, it.custom); })),
    ch: (val) => mutate(() => withRiders(() => {
      const o = it.custom.h; it.custom.h = Math.max(5, +val);
      if (['vanity', 'base'].includes(m.kind)) it.elev = Math.max(0, it.elev + o - it.custom.h); // keep the top height
    })),
    front: (val) => mutate(() => { it.cfg = { ...(it.cfg || {}), front: val }; }),
    layout: (val) => mutate(() => { const n = +val[1]; it.cfg = { ...(it.cfg || {}), drawers: val[0] === 'd' ? n : 0, doors: val[0] === 'o' ? n : 0, hinge: val === 'o1' ? (cfg.hinge || 'L') : '' }; }),
    variant: (btn) => mutate(() => { it.variant = +btn.dataset.i; }),
    bespoke: (val) => mutate(() => { it.bespoke = val; }),
    x: (val) => mutate(() => withRiders(() => { it.x = +val + b.x0; })),
    y: (val) => mutate(() => withRiders(() => { it.y = +val + b.y0; })),
    rot: (val) => mutate(() => withRiders(() => { it.rot = normAngle(+val); })),
    elev: (val) => mutate(() => withRiders(() => { it.elev = Math.max(0, +val); })),
    'cl-left': (val) => moveClear(it, 'left', +val),
    'cl-right': (val) => moveClear(it, 'right', +val),
    'cl-back': (val) => moveClear(it, 'back', +val),
    'cl-front': (val) => moveClear(it, 'front', +val),
    wpChannel: (val) => mutate(() => { if ((it.cfg?.channel === 'end') !== (val === 'end')) it.rot = normAngle(it.rot + 180); it.cfg = { ...(it.cfg || {}), channel: val }; }),
    wcFlush: (val) => mutate(() => { it.cfg = { ...(it.cfg || {}), flush: val }; }),
    fanMount: (val) => mutate(() => {
      it.cfg = { ...(it.cfg || {}), mount: val };
      if (val === 'ceiling') { it.elev = Math.round(ceilingAt(store.d.room, it.x, it.y) - sz.d); it.x += -Math.sin(it.rot * Math.PI / 180) * 300; it.y += Math.cos(it.rot * Math.PI / 180) * 300; }
      else { it.elev = defaultElev('fan', sz.h); placeItem(it, { x: it.x, y: it.y }); }
    }),
    bFront: (val) => mutate(() => { it.cfg = { ...(it.cfg || {}), frontPanel: val }; }),
    bEnd: (val) => mutate(() => { it.cfg = { ...(it.cfg || {}), endPanel: val }; }),
    bWaste: (val) => mutate(() => { it.cfg = { ...(it.cfg || {}), wasteEnd: val }; }),
    bPop: (val) => mutate(() => { it.cfg = { ...(it.cfg || {}), waste: val }; }),
    nkLed: (val) => mutate(() => { it.cfg = { ...(it.cfg || {}), led: val }; }),
    wpBrace: (val) => mutate(() => { it.cfg = { ...(it.cfg || {}), brace: val }; }),
    wpLen: (val) => mutate(() => { it.cfg = { ...(it.cfg || {}), braceLen: val === '' ? null : Math.max(100, +val) }; }),
    nOn: (val) => mutate(() => { it.niche = { ...nicheOf(it), on: val }; }),
    nB: (val) => mutate(() => { it.niche = { ...nicheOf(it), bottom: Math.max(0, +val) }; }),
    nH: (val) => mutate(() => { it.niche = { ...nicheOf(it), height: Math.max(20, +val) }; }),
    nD: (val) => mutate(() => { it.niche = { ...nicheOf(it), depth: Math.max(10, Math.min(sz.d - 15, +val)) }; }),
    nLed: (val) => mutate(() => { it.niche = { ...nicheOf(it), led: val }; }),
    nMatch: () => mutate(() => {
      // match niche depth to in-built mirror cabinets near this wall
      const cab = store.d.items.find((o) => /in-built/i.test(modelOf(o)?.name || '') && Math.hypot(o.x - it.x, o.y - it.y) < sz.w);
      it.niche = { ...nicheOf(it), depth: cab ? sizeOf(cab).d : 129 };
    }),
    rotate: () => rotateItem(it),
    dup: () => duplicateItem(it),
    copy: () => copyItem(it),
    copyTo: (val) => { if (val) copyToRoom(it, val); },
    del: () => deleteItem(it),
  });
}

function bathHtml(it, m) {
  const b = bathInfo(it);
  const sel = (k, cur, opts) => `<select data-k="${k}">${opts.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const auto = (on) => `Auto (${on ? 'panel' : 'against wall'})`;
  const ends = b.left && b.right ? 'both ends' : b.left ? 'left end' : b.right ? 'right end' : 'no end';
  return `<h4>Panels &amp; waste</h4>
    <div class="grid2">
      <div class="fld"><span>Front panel</span>${sel('bFront', b.frontMode, [['auto', auto(b.front)], ['on', 'Yes'], ['off', 'No (tiled / boxed in)']])}</div>
      <div class="fld"><span>End panel</span>${sel('bEnd', b.endMode, [['auto', `Auto (${ends})`], ['left', 'Left end'], ['right', 'Right end'], ['both', 'Both ends'], ['none', 'None']])}</div>
      ${b.wasteEnd === 'centre' ? '' : `<div class="fld"><span>Waste &amp; overflow end</span>${sel('bWaste', b.wasteEnd, [['left', 'Left'], ['right', 'Right']])}</div>`}
    </div>
    ${m.extras ? `<div class="row" style="margin-top:6px"><label>${esc(m.extras.waste.name)} (${esc(m.extras.waste.price)})</label><input type="checkbox" data-k="bPop" ${b.waste ? 'checked' : ''}></div>
    <div class="note">Panels are added to the parts list at a guide price for generic acrylic panels cut to size.</div>` : ''}
    <div class="note">${b.wasteEnd === 'centre' ? 'Double-ended: backrests at both ends, waste in the middle.' : 'The tap end is the waste end; the other end has the backrest.'}</div>`;
}

// Parts-list extras for an item (bath panels and waste chosen in the bath options).
function extrasOf(it, m) {
  if (!m.extras) return [];
  const b = bathInfo(it), out = [];
  if (b.waste) out.push(m.extras.waste);
  if (b.front) out.push(m.extras.front);
  for (let i = 0; i < (b.left ? 1 : 0) + (b.right ? 1 : 0); i++) out.push(m.extras.end);
  return out;
}

function flushHtml(it) {
  const f = flushInfo(it);
  if (!f.host) return `<h4>Flush plate</h4><div class="note">On the wall at 1000 mm. Put the WC against boxing (Walls, boxing &amp; doors) to mount the flush plate on the boxing face or on top of it.</div>`;
  return `<h4>Flush plate</h4>
    <div class="row"><label>Position</label><select data-k="wcFlush">
      <option value="face" ${f.mode === 'face' ? 'selected' : ''}>On the boxing face</option>
      <option value="top" ${f.mode === 'top' ? 'selected' : ''}>On top of the boxing</option>
    </select></div>
    <div class="note">${f.mode === 'top' ? `Flat on top at ${Math.round(f.top)} mm${f.onShelf ? ', set into the shelf on the boxing' : ''} — needs a cistern frame that can be flushed from the top (e.g. Geberit Omega).` : `Centred at ${Math.round(f.faceY)} mm on the boxing face.`}</div>`;
}

function braceHtml(it) {
  const c = it.cfg || {}, b = braceInfo(it);
  const reach = b.toWall == null ? 'No wall found on that side' : `Wall is ${Math.round(b.toWall)} mm away`;
  const ok = b.toWall != null && b.toWall <= 1005;
  return `<h4>Fitting</h4>
    <div class="grid2">
      <div class="fld"><span>Wall channel end</span><select data-k="wpChannel"><option value="start" ${c.channel !== 'end' ? 'selected' : ''}>Start</option><option value="end" ${c.channel === 'end' ? 'selected' : ''}>End</option></select></div>
      <div class="fld"><span>Bracing bar to</span><select data-k="wpBrace">${[['auto', 'Nearest wall'], ['front', 'Front side'], ['back', 'Back side']].map(([v, l]) => `<option value="${v}" ${(c.brace || 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="fld"><span>Bar length (mm)</span><input type="number" data-k="wpLen" value="${c.braceLen ?? ''}" placeholder="auto ${Math.round(b.len)}"></div>
    </div>
    <div class="note" style="margin-top:4px">${reach}${b.toWall != null ? (ok ? ' — the included 1000 mm bar cuts to fit.' : ' — <b style="color:var(--danger)">longer than the 1000 mm bar</b>; move the panel or use a T-piece/ceiling support.') : ''}</div>`;
}

function nicheHtml(it) {
  const n = nicheOf(it);
  return `<h4>Recessed niche</h4>
    <div class="row"><label>Niche</label><input type="checkbox" data-k="nOn" ${n.on ? 'checked' : ''}></div>
    ${n.on ? `<div class="grid2">
      <div class="fld"><span>Bottom (mm off floor)</span><input type="number" data-k="nB" value="${n.bottom}"></div>
      <div class="fld"><span>Height (mm)</span><input type="number" data-k="nH" value="${n.height}"></div>
      <div class="fld"><span>Depth (mm)</span><input type="number" data-k="nD" value="${n.depth}"></div>
      <div class="fld"><span>LED strip</span><input type="checkbox" data-k="nLed" ${n.led ? 'checked' : ''}></div>
    </div>
    <div class="btns"><button data-act="nMatch">Match depth to mirror cabinets</button></div>` : ''}`;
}

// When the size changes, keep the back against the wall and the left edge in place.
function keepAgainstWall(it, o, n) {
  const c = Math.cos(it.rot * Math.PI / 180), s = Math.sin(it.rot * Math.PI / 180);
  const dx = (n.w - o.w) / 2, dy = (n.d - o.d) / 2;
  it.x += dx * c - dy * s; it.y += dx * s + dy * c;
}

function moveClear(it, k, val) {
  const cl = clearances(it)[k];
  if (cl.dist == null || isNaN(val)) return;
  const delta = cl.dist - val;
  mutate(() => { const r = ridersOf(it); it.x += cl.dir.x * delta; it.y += cl.dir.y * delta; applyRiders(it, r); });
}

export function rotateItem(it, by = 90) { mutate(() => { const r = ridersOf(it); it.rot = normAngle(it.rot + by); applyRiders(it, r); }); }
export function deleteItem(it) {
  mutate(() => {
    const r = ridersOf(it).map((x) => x.o.id);
    store.d.items = store.d.items.filter((o) => o.id !== it.id && !r.includes(o.id));
    store.sel = null;
  });
}
// Clipboard for copying fittings between rooms: the item plus anything stacked on it (basin, tap, worktop).
let clip = null;
export function copyItem(it) {
  const m = modelOf(it);
  clip = { name: shortName(m?.name || 'item'), from: store.project?.active, items: [it, ...ridersOf(it).map((r) => r.o)].map((o) => JSON.parse(JSON.stringify(o))) };
  toast(`Copied ${clip.name}${(store.project?.rooms.length || 1) > 1 ? ' — switch room and press ⌘/Ctrl+V to paste' : ''}`);
  renderProps();
}
export const hasClip = () => !!clip;
export function pasteClip() {
  if (!clip) return;
  const pts = store.d.room.pts;
  const [main] = clip.items;
  let dx = 0, dy = 0;
  // same spot if it fits in this room (nudged if pasting back onto the original), else the middle of the room
  if (!pointInPoly(main, pts)) { const b = polyBounds(pts); dx = b.cx - main.x; dy = b.cy - main.y; }
  else if (store.d.items.some((o) => o.model === main.model && Math.hypot(o.x - main.x, o.y - main.y) < 5)) { dx = 100; dy = 100; }
  mutate(() => {
    const ids = [];
    for (const o of clip.items) { const c = JSON.parse(JSON.stringify(o)); c.id = uid(); c.x += dx; c.y += dy; store.d.items.push(c); ids.push(c.id); }
    const it = itemById(ids[0]);
    if (dx || dy) { const r = ridersOf(it); placeItem(it, { x: it.x, y: it.y }); applyRiders(it, r); }
    store.sel = { type: 'item', id: ids[0] };
  });
  toast(`Pasted ${clip.name}`);
}
export function copyToRoom(it, roomId) {
  copyItem(it);
  switchRoom(roomId);
  pasteClip();
}

export function duplicateItem(it) {
  const s = sizeOf(it);
  const riders = ridersOf(it);
  mutate(() => {
    const c = JSON.parse(JSON.stringify(it)); c.id = uid();
    const ang = it.rot * Math.PI / 180;
    c.x += Math.cos(ang) * (s.w + 10); c.y += Math.sin(ang) * (s.w + 10);
    store.d.items.push(c);
    for (const r of riders) { const rc = JSON.parse(JSON.stringify(r.o)); rc.id = uid(); rc.x += Math.cos(ang) * (s.w + 10); rc.y += Math.sin(ang) * (s.w + 10); store.d.items.push(rc); }
    store.sel = { type: 'item', id: c.id };
  });
}

// Change wall i to length L, keeping right angles (moves the two following corners).
export function setWallLength(i, L) {
  const pts = store.d.room.pts; const n = pts.length;
  const w = wallsOf(pts)[i];
  const delta = L - w.len;
  if (Math.abs(delta) < 0.5 || L < 50) return;
  mutate(() => {
    const move = n > 3 ? [(i + 1) % n, (i + 2) % n] : [(i + 1) % n];
    for (const k of move) { pts[k] = { x: Math.round(pts[k].x + w.ux * delta), y: Math.round(pts[k].y + w.uy * delta) }; }
    // keep items attached to moved walls in place relative to them
  }, 'room');
}

function wallPanel(el, i) {
  const walls = wallsOf(store.d.room.pts);
  const w = walls[i];
  el.innerHTML = `
    <h3>Wall ${i + 1}</h3>
    <div class="sub">Inside face length</div>
    ${num('Length', 'len', Math.round(w.len))}
    <div class="note">Changing the length moves the next corner(s), keeping walls square. Drag the wall in the plan to push it in or out.</div>
    <div class="btns">
      <button data-act="door">Add door</button>
      <button data-act="window">Add window</button>
      <button data-act="split">Add corner (split)</button>
    </div>
    <div class="btns"><button data-act="back">← Room settings</button></div>
  `;
  bind(el, {
    len: (v) => setWallLength(i, +v),
    door: () => addOpening('door', i),
    window: () => addOpening('window', i),
    split: () => splitWall(i),
    back: () => select(null),
  });
}

function vertexPanel(el, i) {
  const p = store.d.room.pts[i];
  const b = polyBounds(store.d.room.pts);
  el.innerHTML = `
    <h3>Corner ${i + 1}</h3>
    ${num('X', 'x', Math.round(p.x - b.x0))}
    ${num('Y', 'y', Math.round(p.y - b.y0))}
    <div class="btns"><button data-act="del" class="danger" ${store.d.room.pts.length <= 3 ? 'disabled' : ''}>Remove corner</button><button data-act="back">← Room</button></div>
    <div class="note" style="margin-top:8px">Drag corners in the plan; they snap square to neighbouring corners (hold Alt to disable).</div>`;
  bind(el, {
    x: (v) => mutate(() => { p.x = +v + b.x0; }, 'room'),
    y: (v) => mutate(() => { p.y = +v + b.y0; }, 'room'),
    del: () => removeVertex(i),
    back: () => select(null),
  });
}

// Add a door/window to a wall, centred on position t along it (mm from the wall's start) or mid-wall.
export function addOpening(type, wallIdx = 0, t = null) {
  const w = wallsOf(store.d.room.pts)[wallIdx];
  const width = Math.min(type === 'door' ? 762 : 900, Math.max(300, w.len - 20));
  const c = t ?? w.len / 2;
  mutate(() => {
    const op = { id: uid(), type, wall: wallIdx, offset: Math.max(0, Math.min(w.len - width, snap(c - width / 2, 10))), width, height: type === 'door' ? 1981 : 1050, sill: type === 'door' ? 0 : 900, hinge: 'left', swing: 'in' };
    store.d.openings.push(op);
    store.sel = { type: 'opening', id: op.id };
  }, 'room');
}

function openingPanel(el, op) {
  const w = wallsOf(store.d.room.pts)[op.wall];
  el.innerHTML = `
    <h3>${op.type === 'door' ? 'Door' : 'Window'}</h3>
    <div class="sub">On wall ${op.wall + 1} (${Math.round(w.len)} mm)</div>
    ${num('From corner', 'offset', Math.round(op.offset))}
    ${num('To other corner', 'offset2', Math.round(w.len - op.offset - op.width))}
    ${num('Width', 'width', op.width)}
    ${num('Height', 'height', op.height)}
    ${op.type === 'window' ? num('Sill height', 'sill', op.sill) : ''}
    ${op.type === 'window' ? `
      <div class="row"><label>Glass</label><select data-k="glass">${[['clear', 'Clear'], ['half', 'Frosted bottom half'], ['frosted', 'Frosted (obscure)']].map(([v, l]) => `<option value="${v}" ${(op.glass || 'clear') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="row"><label>Opening sashes</label><select data-k="panes">${[[0, 'Auto'], [1, '1'], [2, '2'], [3, '3']].map(([v, l]) => `<option value="${v}" ${(op.panes || 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
    ${op.type === 'door' ? `
      <div class="row"><label>Hinge side</label><select data-k="hinge"><option value="left" ${op.hinge !== 'right' ? 'selected' : ''}>Left</option><option value="right" ${op.hinge === 'right' ? 'selected' : ''}>Right</option></select></div>
      <div class="row"><label>Opens</label><select data-k="swing"><option value="in" ${op.swing !== 'out' ? 'selected' : ''}>Into room</option><option value="out" ${op.swing === 'out' ? 'selected' : ''}>Outwards</option></select></div>
      <div class="row"><label>Leads to</label><select data-k="doorTo"><option value="hall" ${op.to !== 'outside' ? 'selected' : ''}>Hallway / landing</option><option value="outside" ${op.to === 'outside' ? 'selected' : ''}>Outside</option></select></div>` : ''}
    <div class="btns"><button data-act="del" class="danger">Delete</button><button data-act="back">← Room</button></div>`;
  const clampOff = () => { op.offset = Math.max(0, Math.min(w.len - op.width, op.offset)); };
  bind(el, {
    offset: (v) => mutate(() => { op.offset = +v; clampOff(); }, 'room'),
    offset2: (v) => mutate(() => { op.offset = w.len - op.width - +v; clampOff(); }, 'room'),
    width: (v) => mutate(() => { op.width = Math.max(200, Math.min(w.len, +v)); clampOff(); }, 'room'),
    height: (v) => mutate(() => { op.height = Math.max(200, +v); }, 'room'),
    sill: (v) => mutate(() => { op.sill = Math.max(0, +v); }, 'room'),
    glass: (v) => mutate(() => { op.glass = v; }, 'room'),
    doorTo: (v) => mutate(() => { if (v === 'outside') op.to = 'outside'; else delete op.to; }, 'room'),
    panes: (v) => mutate(() => { if (+v) op.panes = +v; else delete op.panes; }, 'room'),
    hinge: (v) => mutate(() => { op.hinge = v; }, 'room'),
    swing: (v) => mutate(() => { op.swing = v; }, 'room'),
    del: () => mutate(() => { store.d.openings = store.d.openings.filter((o) => o !== op); store.sel = null; }, 'room'),
    back: () => select(null),
  });
}

function roomPanel(el) {
  const r = store.d.room;
  const walls = wallsOf(r.pts);
  const b = polyBounds(r.pts);
  const rect = r.pts.length === 4 && walls.every((w) => Math.abs(w.ux) < 1e-6 || Math.abs(w.uy) < 1e-6);
  el.innerHTML = `
    <h3>Room</h3>
    <div class="sub">${r.pts.length} walls · floor area ${(area(r.pts) / 1e6).toFixed(2)} m²</div>

    <h4>Quick shape</h4>
    <div class="grid2">
      <div class="fld"><span>Width (mm)</span><input type="number" data-k="rw" value="${Math.round(b.w)}"></div>
      <div class="fld"><span>Length (mm)</span><input type="number" data-k="rl" value="${Math.round(b.h)}"></div>
    </div>
    <div class="btns"><button data-act="rect">${rect ? 'Resize rectangle' : 'Make rectangle'}</button><button data-act="lshape">L-shape</button></div>

    <h4>Walls (inside lengths)</h4>
    <div class="walls-list">${walls.map((w, i) => `<div class="row"><label>Wall ${i + 1}</label><input type="number" data-k="wall-${i}" value="${Math.round(w.len)}"><span class="unit">mm</span></div>`).join('')}</div>
    <div class="btns"><button data-act="editRoom" class="primary">Edit walls, doors &amp; windows</button><button data-act="drawRoom">Draw new outline</button></div>
    <div class="note">In <b>Edit room</b> mode, click a wall to add a door or window where you clicked, split it, or type its length. Drag walls and corners to reshape. Fittings are locked while you edit the room.</div>

    ${clip ? `<div class="btns"><button data-act="paste" class="primary">Paste ${esc(clip.name)}</button></div>` : ''}

    <h4>Structure</h4>
    ${num('Ceiling height', 'height', r.height)}
    ${num('Wall thickness', 'thick', r.thickness)}
    <div class="row" style="margin-top:6px"><label>Sloped ceiling</label><input type="checkbox" data-k="slOn" ${r.slope?.on ? 'checked' : ''}></div>
    ${r.slope?.on ? (() => {
      const sl = r.slope, rise = r.height - Math.min(r.height, sl.low ?? 1200);
      const pitch = Math.round(Math.atan2(rise, Math.max(1, sl.run ?? 1500)) * 180 / Math.PI);
      return `<div class="grid2">
      <div class="fld"><span>Low side</span><select data-k="slWall">${walls.map((w, i) => `<option value="${i}" ${sl.wall === i ? 'selected' : ''}>Wall ${i + 1} (${Math.round(w.len)} mm)</option>`).join('')}</select></div>
      <div class="fld"><span>Height at low wall</span><input type="number" data-k="slLow" value="${sl.low ?? 1200}" step="10"></div>
      <div class="fld"><span>Slope reaches full height at</span><input type="number" data-k="slRun" value="${sl.run ?? 1500}" step="10"></div>
      <div class="fld"><span>Pitch (°)</span><input type="number" data-k="slPitch" value="${pitch}" min="5" max="75"></div>
    </div>
    <div class="note">The ceiling is ${sl.low ?? 1200} mm high at wall ${sl.wall + 1} and rises to ${r.height} mm, ${sl.run ?? 1500} mm into the room. In 2D the dashed lines show where full height starts and where headroom reaches 2000 mm. Select a wall in Edit room to see its number.</div>`;
    })() : ''}

    <h4>Outside the windows</h4>
    ${(() => { const o = outsideOf(r); return `<div class="grid2">
      <div class="fld"><span>View</span><select data-k="outView">${VIEWS.map((v) => `<option value="${v.id}" ${o.view === v.id ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
      <div class="fld"><span>Floor</span><select data-k="outLevel">${[[0, 'Ground floor'], [1, 'First floor'], [2, 'Second floor']].map(([v, l]) => `<option value="${v}" ${o.level === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="fld"><span>Turn view (°)</span><input type="number" data-k="outTurn" value="${o.turn}" step="15"></div>
    </div>
    ${o.view !== 'none' ? `<img class="view-thumb" src="data/views/${o.view}-thumb.jpg" alt="">` : ''}
    <div class="note">A 360° photo seen through the windows — clear glass shows it sharp, frosted glass heavily blurred. Shown from inside the room — try <b>Eye level</b> in 3D, or VR. Photos: Poly Haven, CC0.</div>`; })()}

    <h4>Finishes</h4>
    <div class="row"><label>Wall paint</label><input type="color" data-k="wallColor" value="${r.wallColor}"></div>
    <div class="row"><label>Wall tiles</label><input type="checkbox" data-k="wtOn" ${r.wallTile.enabled ? 'checked' : ''}></div>
    ${r.wallTile.enabled ? `
    <div class="grid2">
      <div class="fld"><span>Tile to height</span><input type="number" data-k="wtH" value="${r.wallTile.height}"></div>
      <div class="fld"><span>Colour</span><input type="color" data-k="wtC" value="${r.wallTile.color}"></div>
      <div class="fld"><span>Tile width</span><input type="number" data-k="wtW" value="${r.wallTile.tw}"></div>
      <div class="fld"><span>Tile height</span><input type="number" data-k="wtTh" value="${r.wallTile.th}"></div>
    </div>` : ''}
    <div class="grid2" style="margin-top:8px">
      <div class="fld"><span>Floor tile W</span><input type="number" data-k="ftW" value="${r.floor.tw}"></div>
      <div class="fld"><span>Floor tile L</span><input type="number" data-k="ftH" value="${r.floor.th}"></div>
      <div class="fld"><span>Floor colour</span><input type="color" data-k="ftC" value="${r.floor.color}"></div>
      <div class="fld"><span>Grout</span><input type="color" data-k="ftG" value="${r.floor.grout}"></div>
    </div>

    <h4>Getting started</h4>
    <div class="note">1. Set the room size above (all values in mm).<br>2. Use <b>Edit room</b> to add doors and windows.<br>3. Drag products from the left onto the plan — they snap flush to walls, corners and each other.<br>4. Drop a basin onto a vanity unit to sit it on top.<br>5. Select an item to change size, colour, or type exact clearances.<br>6. Switch to <b>Split</b> or <b>3D</b> to see it.</div>
  `;
  const R = (fn) => mutate(fn, 'room');
  const h = {
    rw: () => {}, rl: () => {},
    // presets keep doors/windows that still fit (see applyRoomShape)
    rect: () => { const W = +$('#props [data-k=rw]').value, L = +$('#props [data-k=rl]').value; if (W >= 300 && L >= 300) drawActions.preset('rect', W, L); },
    lshape: () => { const W = +$('#props [data-k=rw]').value, L = +$('#props [data-k=rl]').value; if (W >= 300 && L >= 300) drawActions.preset('L', W, L); },
    editRoom: () => document.getElementById('toolRoom')?.click(),
    paste: () => pasteClip(),
    drawRoom: () => document.getElementById('toolDraw')?.click(),
    height: (v) => R(() => { r.height = Math.max(1500, +v); }),
    thick: (v) => R(() => { r.thickness = Math.max(20, +v); }),
    outView: (v) => R(() => { r.outside = { ...outsideOf(r), view: v }; }),
    outLevel: (v) => R(() => { r.outside = { ...outsideOf(r), level: +v }; }),
    outTurn: (v) => R(() => { r.outside = { ...outsideOf(r), turn: ((+v % 360) + 360) % 360 }; }),
    slOn: (v) => R(() => {
      if (!r.slope) {
        // default: low side on the longest wall that has no door
        const doorWalls = new Set(store.d.openings.filter((o) => o.type === 'door').map((o) => o.wall));
        const best = walls.filter((w) => !doorWalls.has(w.i)).sort((x, y) => y.len - x.len)[0] || walls[0];
        r.slope = { on: true, wall: best.i, low: 1200, run: 1500 };
      } else r.slope.on = v;
    }),
    slWall: (v) => R(() => { r.slope.wall = +v; }),
    slLow: (v) => R(() => { r.slope.low = Math.max(300, Math.min(r.height, +v)); }),
    slRun: (v) => R(() => { r.slope.run = Math.max(100, +v); }),
    slPitch: (v) => R(() => { const a = Math.max(5, Math.min(75, +v)) * Math.PI / 180; r.slope.run = Math.max(100, Math.round((r.height - r.slope.low) / Math.tan(a))); }),
    wallColor: (v) => R(() => { r.wallColor = v; }),
    wtOn: (v) => R(() => { r.wallTile.enabled = v; }),
    wtH: (v) => R(() => { r.wallTile.height = Math.max(0, +v); }),
    wtC: (v) => R(() => { r.wallTile.color = v; }),
    wtW: (v) => R(() => { r.wallTile.tw = Math.max(20, +v); }),
    wtTh: (v) => R(() => { r.wallTile.th = Math.max(20, +v); }),
    ftW: (v) => R(() => { r.floor.tw = Math.max(20, +v); }),
    ftH: (v) => R(() => { r.floor.th = Math.max(20, +v); }),
    ftC: (v) => R(() => { r.floor.color = v; }),
    ftG: (v) => R(() => { r.floor.grout = v; }),
  };
  walls.forEach((w, i) => { h['wall-' + i] = (v) => setWallLength(i, +v); });
  bind(el, h);
}

function area(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a / 2); }

// ------------------------------------------------------------------ parts list
let bomScope = 'room';
export function showBOM(scope = bomScope) {
  bomScope = scope;
  const rows = new Map();
  const multi = store.project.rooms.length > 1;
  const sources = scope === 'all' ? store.project.rooms.map((r) => ({ name: r.name, items: r.design.items })) : [{ name: '', items: store.d.items }];
  for (const src of sources) for (const it of src.items) {
    const m = modelOf(it); if (!m || m.generic) continue;
    const v = variantOf(it); const s = sizeOf(it);
    const key = it.custom ? `${m.id}|${JSON.stringify(it.custom)}|${v?.colour}|${JSON.stringify(it.cfg || {})}` : v?.sku;
    const r = rows.get(key) || { m, v, s, it, qty: 0, price: priceOf(it), cur: currencyOf(v?.price), rooms: new Set() };
    r.qty++; if (src.name) r.rooms.add(src.name); rows.set(key, r);
    for (const x of extrasOf(it, m)) {
      const s = sizeOf(it), dims = x === m.extras.front ? [s.w, 18, s.h - 35] : x === m.extras.end ? [s.d, 18, s.h - 35] : null;
      const k = `extra|${x.name}|${dims}`;
      const e = rows.get(k) || { m: { name: x.name + (x.guide ? ' — guide price' : '') }, v: x, s: dims ? { w: dims[0], d: dims[1], h: dims[2] } : null, it: {}, qty: 0, price: parsePrice(x.price), cur: currencyOf(x.price), rooms: new Set() };
      e.qty++; if (src.name) e.rooms.add(src.name); rows.set(k, e);
    }
  }
  const list = [...rows.values()];
  const totals = {};
  for (const r of list) if (r.price != null) totals[r.cur] = (totals[r.cur] || 0) + r.price * r.qty;
  const unknown = list.some((r) => r.price == null);
  $('#bomBody').innerHTML = list.length ? `
    <table class="bom"><thead><tr><th></th><th>Product</th><th>SKU</th><th>Colour</th><th>Size (mm)</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th></tr></thead>
    <tbody>${list.map((r) => `<tr>
      <td>${r.v?.img || r.m.thumb ? `<img src="${esc(r.v?.img || r.m.thumb)}" alt="">` : ''}</td>
      <td>${r.v?.url ? `<a href="${esc(r.v.url)}" target="_blank" rel="noopener">${esc(r.m.name)}</a>` : esc(r.m.name)}${r.it.custom ? ' <i>(made to measure)</i>' : ''}</td>
      <td>${esc(r.it.custom ? '—' : r.v?.sku)}</td><td>${esc(r.v?.colour)}</td>
      <td>${r.s ? `${r.s.w} × ${r.s.d} × ${r.s.h}` : ''}</td><td class="num">${r.qty}</td>
      <td class="num">${r.price != null ? fmtPrice(r.price, r.cur) : 'POA'}</td><td class="num">${r.price != null ? fmtPrice(r.price * r.qty, r.cur) : 'POA'}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="7">Total${unknown ? ' (excluding made-to-measure / POA items)' : ''}</td><td class="num">${Object.entries(totals).map(([c, t]) => fmtPrice(t, c)).join(' + ') || '—'}</td></tr></tfoot></table>
    <p class="note">Dansani prices are UK list prices from dansani.co.uk (£); Villeroy &amp; Boch and hansgrohe prices are EU retail prices from megabad.com (€), except the Architectura bath, waste and panels (UK £, heatandplumb.com; panels are a guide price). All may have changed; options (lights, sockets, push-open) and handles aren't included.</p>
    <div class="btns"><button data-csv>Copy as CSV</button></div>`
    : '<p class="note">No Dansani products in the design yet.</p>';
  const scopeHtml = multi ? `<div class="bom-scope"><label><input type="radio" name="bomScope" value="room" ${scope === 'room' ? 'checked' : ''}> This room</label><label><input type="radio" name="bomScope" value="all" ${scope === 'all' ? 'checked' : ''}> All ${store.project.rooms.length} rooms</label></div>` : '';
  $('#bomBody').insertAdjacentHTML('afterbegin', scopeHtml);
  if (scope === 'all') $('#bomBody table.bom tbody')?.querySelectorAll('tr').forEach((tr, i) => { const r = list[i]; if (r?.rooms.size) tr.children[1].insertAdjacentHTML('beforeend', `<div class="note">${esc([...r.rooms].join(', '))}</div>`); });
  $('#bomBody').querySelectorAll('[name=bomScope]').forEach((x) => x.addEventListener('change', () => showBOM(x.value)));
  $('#bom').hidden = false;
  $('#bomBody [data-csv]')?.addEventListener('click', () => {
    const csv = [['Product', 'SKU', 'Colour', 'W', 'D', 'H', 'Qty', 'Unit price', 'URL'], ...list.map((r) => [r.m.name, r.it.custom ? 'MTM' : r.v?.sku, r.v?.colour, r.s?.w, r.s?.d, r.s?.h, r.qty, r.price ?? '', r.v?.url || ''])]
      .map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    navigator.clipboard.writeText(csv).then(() => toast('Copied parts list'));
  });
}

let toastT;
export function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800);
}
