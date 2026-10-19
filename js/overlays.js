// Floating toolbars on the 2D plan: wall bar, door/window bar, draw-room panel, measure bar.
import { store, checkpoint, commit, select } from './state.js';
import { wallsOf, polyBounds } from './geom.js';
import { plan, screenOf, splitWall, drawActions, pinMeasure, clearMeasure, draw } from './plan2d.js';
import { setWallLength, addOpening } from './ui.js';

const $ = (s, el = document) => el.querySelector(s);
let host, bars = {};
let lastKey = '';

export function initOverlays(view) {
  host = view;
  for (const id of ['wallBar', 'openBar', 'drawBar', 'measureBar']) {
    const el = document.createElement('div');
    el.id = id; el.className = 'float-bar'; el.hidden = true;
    // keep clicks inside the bar from reaching the canvas
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    host.appendChild(el); bars[id] = el;
  }
  const len = document.createElement('div');
  len.id = 'drawLen'; len.className = 'draw-len'; len.hidden = true; host.appendChild(len); bars.drawLen = len;
  plan.afterRender = sync;
}

const num = (v) => Math.round(+v || 0);
function mutate(fn) { checkpoint(); fn(); commit('room'); }
function place(el, p, dy = 0) {
  // position centred under/over a plan point, clamped inside the 2D view
  const s = screenOf(p);
  const W = host.clientWidth, H = host.clientHeight;
  el.style.left = '0px'; el.style.top = '0px';
  const bw = el.offsetWidth, bh = el.offsetHeight;
  const x = Math.max(8, Math.min(W - bw - 8, s.x - bw / 2));
  const y = Math.max(8, Math.min(H - bh - 8, s.y + dy - (dy < 0 ? bh : 0)));
  el.style.left = x + 'px'; el.style.top = y + 'px';
}

function sync() {
  if (!host || !host.offsetParent) return;
  const s = store.sel, d = store.d, tool = plan.tool, ro = store.readOnly;
  const walls = wallsOf(d.room.pts);
  const wall = tool === 'room' && s?.type === 'wall' ? walls[s.index] : null;
  const op = tool === 'room' && s?.type === 'opening' ? d.openings.find((o) => o.id === s.id) : null;
  const key = JSON.stringify([tool, s, ro, wall && Math.round(wall.len), op, plan.drawPts?.length, !!plan.measure?.done, (d.dims || []).length]);
  const focused = host.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
  const rebuild = key !== lastKey && !focused;
  if (rebuild) lastKey = key;

  // ---- wall bar
  const wb = bars.wallBar;
  wb.hidden = !wall || ro || !!plan.drag;
  if (!wb.hidden) {
    if (rebuild) {
      wb.innerHTML = `<span class="fb-title">Wall ${wall.i + 1}</span>
        <label class="fb-num">Length <input type="number" data-f="len" value="${Math.round(wall.len)}" step="1"> mm</label>
        <button data-a="door">+ Door</button><button data-a="window">+ Window</button><button data-a="split" title="Add a corner here">Split here</button>`;
      $('[data-f=len]', wb).onchange = (e) => setWallLength(wall.i, num(e.target.value));
      $('[data-f=len]', wb).onkeydown = (e) => { if (e.key === 'Enter') e.target.blur(); };
      wb.querySelector('[data-a=door]').onclick = () => addOpening('door', wall.i, s.t);
      wb.querySelector('[data-a=window]').onclick = () => addOpening('window', wall.i, s.t);
      wb.querySelector('[data-a=split]').onclick = () => splitWall(wall.i, { x: wall.a.x + wall.ux * s.t, y: wall.a.y + wall.uy * s.t });
    }
    const t = Math.min(wall.len, Math.max(0, s.t ?? wall.len / 2));
    place(wb, { x: wall.a.x + wall.ux * t + wall.nx * 50 / plan.scale, y: wall.a.y + wall.uy * t + wall.ny * 50 / plan.scale }, 0);
  }

  // ---- door / window bar
  const ob = bars.openBar;
  ob.hidden = !op || ro || !!plan.drag;
  if (!ob.hidden) {
    const w = walls[op.wall];
    if (rebuild) {
      const door = op.type === 'door';
      ob.innerHTML = `<span class="fb-title">${door ? 'Door' : 'Window'}</span>
        <label class="fb-num">W <input type="number" data-f="width" value="${op.width}"></label>
        <label class="fb-num">H <input type="number" data-f="height" value="${op.height}"></label>
        ${door ? `<button data-a="hinge" title="Swap hinge side">⇄ Hinge ${op.hinge === 'right' ? 'R' : 'L'}</button>
                 <button data-a="swing" title="Open into or out of the room">${op.swing === 'out' ? '↑ Opens out' : '↓ Opens in'}</button>`
               : `<label class="fb-num">Sill <input type="number" data-f="sill" value="${op.sill}"></label>`}
        <button data-a="del" class="danger" title="Delete">Delete</button>`;
      const clamp = () => { op.width = Math.max(300, Math.min(w.len, op.width)); op.offset = Math.max(0, Math.min(w.len - op.width, op.offset)); };
      ob.querySelectorAll('input').forEach((inp) => {
        inp.onkeydown = (e) => { if (e.key === 'Enter') e.target.blur(); };
        inp.onchange = () => mutate(() => {
          const f = inp.dataset.f, v = num(inp.value);
          if (f === 'width') { const c = op.offset + op.width / 2; op.width = v; op.offset = c - v / 2; clamp(); }
          if (f === 'height') op.height = Math.max(200, v);
          if (f === 'sill') op.sill = Math.max(0, v);
        });
      });
      const b = (a) => ob.querySelector(`[data-a=${a}]`);
      if (b('hinge')) b('hinge').onclick = () => mutate(() => { op.hinge = op.hinge === 'right' ? 'left' : 'right'; });
      if (b('swing')) b('swing').onclick = () => mutate(() => { op.swing = op.swing === 'out' ? 'in' : 'out'; });
      b('del').onclick = () => mutate(() => { d.openings = d.openings.filter((o) => o !== op); store.sel = null; });
    }
    const t = op.offset + op.width / 2;
    place(ob, { x: w.a.x + w.ux * t + w.nx * 70 / plan.scale, y: w.a.y + w.uy * t + w.ny * 70 / plan.scale }, 0);
  }

  // ---- draw room panel
  const db = bars.drawBar;
  db.hidden = tool !== 'draw';
  if (!db.hidden) {
    db.classList.add('top');
    if (rebuild) {
      const n = plan.drawPts.length;
      const b = polyBounds(d.room.pts);
      db.innerHTML = n === 0
        ? `<span class="fb-title">New room outline</span>
           <label class="fb-num">W <input type="number" data-f="W" value="${Math.round(b.w)}"></label>
           <label class="fb-num">L <input type="number" data-f="L" value="${Math.round(b.h)}"></label>
           <button data-a="rect" class="primary">Rectangle</button><button data-a="L">L-shape</button>
           <span class="fb-note">…or click on the plan to place corners one by one</span>
           <button data-a="cancel">Cancel</button>`
        : `<span class="fb-title">Corner ${n + 1}</span>
           <label class="fb-num">Next wall <input type="number" data-f="len" placeholder="length" inputmode="numeric"> mm</label>
           <button data-a="place">Place</button>
           <button data-a="undo" ${n ? '' : 'disabled'}>Undo corner</button>
           <button data-a="finish" class="primary" ${n >= 3 ? '' : 'disabled'}>Finish</button>
           <button data-a="cancel">Cancel</button>
           <span class="fb-note">Point the line where the wall goes, then type its length · click the first corner to close · Esc cancels</span>`;
      const q = (a) => db.querySelector(`[data-a="${a}"]`);
      q('cancel').onclick = () => drawActions.cancel();
      if (n === 0) {
        q('rect').onclick = () => drawActions.preset('rect', num($('[data-f=W]', db).value), num($('[data-f=L]', db).value));
        q('L').onclick = () => drawActions.preset('L', num($('[data-f=W]', db).value), num($('[data-f=L]', db).value));
      } else {
        const lenInp = $('[data-f=len]', db);
        const placeOne = () => {
          // place a corner at the typed length along the current direction
          const last = plan.drawPts.at(-1), cur = plan.drawCur || plan.cursor || { x: last.x + 1000, y: last.y };
          let dx = cur.x - last.x, dy = cur.y - last.y; const L = Math.hypot(dx, dy) || 1;
          const len = num(lenInp.value);
          if (!len) return;
          // snap the direction to 90° steps unless clearly diagonal
          const ang = Math.atan2(dy, dx), q90 = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
          const a = Math.abs(ang - q90) < 0.21 ? q90 : ang;
          dx = Math.cos(a); dy = Math.sin(a);
          plan.drawPts.push({ x: Math.round(last.x + dx * len), y: Math.round(last.y + dy * len) });
          plan.drawInput = ''; plan.drawCur = null; lenInp.value = '';
          draw();
        };
        q('place').onclick = placeOne;
        lenInp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); placeOne(); } if (e.key === 'Escape') drawActions.cancel(); };
        q('undo').onclick = () => drawActions.undo();
        q('finish').onclick = () => drawActions.finish();
      }
    }
  }
  // length bubble following the cursor while drawing
  const dl = bars.drawLen;
  const last = plan.drawPts?.at(-1), cur = plan.drawCur;
  dl.hidden = !(tool === 'draw' && last && cur);
  if (!dl.hidden) {
    const L = plan.drawInput || Math.round(Math.hypot(cur.x - last.x, cur.y - last.y));
    dl.innerHTML = `${L} mm${plan.drawInput ? '<span class="caret">▏</span>' : ''}<small>${plan.drawInput ? 'Enter to place' : 'type a length'}</small>`;
    const sc = screenOf(cur);
    dl.style.left = sc.x + 14 + 'px'; dl.style.top = sc.y + 14 + 'px';
  }

  // ---- measure bar
  const mb = bars.measureBar;
  const m = plan.measure;
  const hasDims = (d.dims || []).length > 0;
  mb.hidden = tool !== 'measure' || (!m?.b && !hasDims);
  if (!mb.hidden) {
    mb.classList.add('top');
    const dist = m?.b ? Math.round(Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y)) : null;
    const html = `${dist != null ? `<span class="fb-title">${dist} mm</span>` : '<span class="fb-note">Drag to measure</span>'}
      ${dist != null && m.done && !ro ? '<button data-a="pin" class="primary">📌 Pin to plan</button>' : ''}
      ${dist != null ? '<button data-a="clear">Clear</button>' : ''}
      ${hasDims && !ro ? `<button data-a="clearAll">Remove all pinned (${d.dims.length})</button>` : ''}`;
    if (mb.dataset.html !== html) {
      mb.dataset.html = html; mb.innerHTML = html;
      mb.querySelector('[data-a=pin]')?.addEventListener('click', () => pinMeasure());
      mb.querySelector('[data-a=clear]')?.addEventListener('click', () => clearMeasure(false));
      mb.querySelector('[data-a=clearAll]')?.addEventListener('click', () => clearMeasure(true));
    }
  }
}

export function closeOverlays() { select(null); }
