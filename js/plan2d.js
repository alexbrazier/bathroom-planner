// 2D plan editor on a <canvas>. World units: mm.
import { store, emit, checkpoint, commit, select, sizeOf, modelOf, coloursOf, cfgOf, itemById, makeItem, uid, nicheOf } from './state.js';
import { wallsOf, outerPts, distToSeg, pointInPoly, itemCorners, toLocal, rayToWalls, polyBounds, snap, rad, deg, normAngle, signedArea } from './geom.js';
import { ABOVE_FLOOR_DASHED, byId, STACKS_ON } from './catalog.js';
import { placeItem, ridersOf, applyRiders, nearestWall } from './place.js';

const ACCENT = '#2f5d8a';
const WALL = '#3b4048';
const DIM = '#5b6470';

export const plan = {
  canvas: null, ctx: null, dpr: 1,
  scale: 0.25, ox: 0, oy: 0,
  tool: 'select',
  drag: null,
  hover: null,
  guides: [],
  measure: null,       // {a, b, done}
  drawPts: null,       // room drawing in progress
  drawInput: '',
  cursor: null,
  spaceDown: false,
};

const W2S = (p) => ({ x: p.x * plan.scale + plan.ox, y: p.y * plan.scale + plan.oy });
const S2W = (x, y) => ({ x: (x - plan.ox) / plan.scale, y: (y - plan.oy) / plan.scale });

export function initPlan(canvas, hud) {
  plan.canvas = canvas; plan.ctx = canvas.getContext('2d'); plan.hud = hud;
  new ResizeObserver(() => resize()).observe(canvas.parentElement);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('dblclick', onDbl);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  canvas.addEventListener('drop', onDrop);
  resize();
  fit();
}

function resize() {
  const r = plan.canvas.parentElement.getBoundingClientRect();
  if (!r.width || !r.height) return;
  plan.dpr = window.devicePixelRatio || 1;
  plan.canvas.width = r.width * plan.dpr; plan.canvas.height = r.height * plan.dpr;
  plan.w = r.width; plan.h = r.height;
  if (!plan.userMoved) fit();
  draw();
}

export function fit() {
  if (!plan.w) return;
  const b = polyBounds(store.d.room.pts);
  const pad = 140;
  plan.scale = Math.max(0.02, Math.min((plan.w - pad) / (b.w + 600), (plan.h - pad) / (b.h + 600)));
  plan.ox = plan.w / 2 - b.cx * plan.scale;
  plan.oy = plan.h / 2 - b.cy * plan.scale;
  plan.fitted = true; plan.userMoved = false;
  draw();
}
export function zoom(f, sx = plan.w / 2, sy = plan.h / 2) {
  const before = S2W(sx, sy);
  plan.userMoved = true;
  plan.scale = Math.min(3, Math.max(0.02, plan.scale * f));
  plan.ox = sx - before.x * plan.scale; plan.oy = sy - before.y * plan.scale;
  draw();
}

// Tools: 'select' (fittings), 'room' (walls, corners, doors, windows), 'measure', 'draw' (new room outline).
export function setTool(t) {
  if (store.readOnly && t === 'draw') t = 'select';
  const prev = plan.tool;
  plan.tool = t; plan.measure = null; plan.drawPts = t === 'draw' ? [] : null; plan.drawInput = ''; plan.drawCur = null;
  plan.canvas.style.cursor = t === 'select' || t === 'room' ? 'default' : 'crosshair';
  // leaving room editing drops room selections; entering it drops fitting selections
  const s = store.sel;
  if (s && ((t === 'select' && ['wall', 'vertex', 'opening'].includes(s.type)) || (t === 'room' && s.type === 'item'))) select(null);
  if (prev !== t) emit('tool');
  hud(); draw();
}

// ------------------------------------------------------------------ drawing
let raf = 0;
export function draw() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; render(plan.ctx, false); });
}

export function render(ctx, forExport) {
  const { dpr } = plan;
  const d = store.d;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fbfbfa';
  ctx.fillRect(0, 0, plan.canvas.width, plan.canvas.height);
  ctx.setTransform(dpr * plan.scale, 0, 0, dpr * plan.scale, dpr * plan.ox, dpr * plan.oy);
  const px = 1 / plan.scale; // one screen pixel in mm

  if (!forExport) drawGrid(ctx, px);
  const pts = d.room.pts;
  const walls = wallsOf(pts);

  // floor
  ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
  ctx.fillStyle = '#f3f1ec'; ctx.fill();
  // floor tile grid
  ctx.save(); ctx.clip();
  const b = polyBounds(pts);
  const ft = d.room.floor;
  if (ft.tw * plan.scale > 6) {
    ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = px;
    ctx.beginPath();
    for (let x = b.x0; x <= b.x1; x += ft.tw) { ctx.moveTo(x, b.y0); ctx.lineTo(x, b.y1); }
    for (let y = b.y0; y <= b.y1; y += ft.th) { ctx.moveTo(b.x0, y); ctx.lineTo(b.x1, y); }
    ctx.stroke();
  }
  ctx.restore();

  // items (floor first, then by elevation)
  const layer = (it) => { const k = modelOf(it)?.kind; return k === 'falsewall' ? -1 : ['walltap', 'showervalve', 'showerhead', 'towelholder', 'tap', 'handshower', 'showerrail', 'accessory'].includes(k) ? 5000 : it.elev; };
  const items = [...d.items].sort((a, b) => layer(a) - layer(b));
  if (plan.tool === 'room' && !forExport) ctx.globalAlpha = 0.35;
  for (const it of items) drawItem(ctx, it, px);
  ctx.globalAlpha = 1;

  // walls
  const outer = outerPts(pts, d.room.thickness);
  ctx.beginPath();
  outer.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
  ctx.fillStyle = WALL; ctx.fill('evenodd');

  // openings
  for (const op of d.openings) drawOpening(ctx, op, walls, px);

  // selected wall highlight
  const sel = store.sel;
  if (sel?.type === 'wall') {
    const w = walls[sel.index];
    if (w) { ctx.strokeStyle = ACCENT; ctx.lineWidth = 4 * px; ctx.beginPath(); ctx.moveTo(w.a.x, w.a.y); ctx.lineTo(w.b.x, w.b.y); ctx.stroke(); }
  }

  // wall dimensions
  walls.forEach((w) => wallDim(ctx, w, d.room.thickness, px));

  // vertices (room mode shows them all)
  if (!forExport) {
    for (let i = 0; i < pts.length; i++) {
      const on = sel?.type === 'vertex' && sel.index === i;
      const hv = plan.hover?.type === 'vertex' && plan.hover.index === i;
      if (!on && !hv && plan.tool !== 'room') continue;
      const s = (on ? 6 : 4.5) * px;
      ctx.fillStyle = on ? ACCENT : '#fff'; ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5 * px;
      ctx.fillRect(pts[i].x - s, pts[i].y - s, 2 * s, 2 * s); ctx.strokeRect(pts[i].x - s, pts[i].y - s, 2 * s, 2 * s);
    }
  }

  // selection overlays
  if (!forExport && sel?.type === 'item') {
    const it = itemById(sel.id);
    if (it) drawSelection(ctx, it, px);
  }
  if (!forExport && sel?.type === 'opening') {
    const op = d.openings.find((o) => o.id === sel.id);
    if (op) { openingDims(ctx, op, walls, px); openingHandles(ctx, op, walls, px); }
  }
  // pinned dimensions
  for (const dm of d.dims || []) {
    dimLine(ctx, dm.a, dm.b, px, '#7a4fb5', `${Math.round(Math.hypot(dm.b.x - dm.a.x, dm.b.y - dm.a.y))}`);
    if (!forExport && plan.tool === 'measure') {
      const m = { x: (dm.a.x + dm.b.x) / 2, y: (dm.a.y + dm.b.y) / 2 };
      const r = 7 * px;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#7a4fb5'; ctx.lineWidth = 1.2 * px;
      ctx.beginPath(); ctx.arc(m.x + 22 * px, m.y - 12 * px, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      text(ctx, '×', m.x + 22 * px, m.y - 12.5 * px, px, { color: '#7a4fb5', size: 12, weight: 700 });
    }
  }

  // guides
  if (!forExport) {
    ctx.strokeStyle = '#e0457b'; ctx.lineWidth = px; ctx.setLineDash([6 * px, 4 * px]);
    for (const g of plan.guides) { ctx.beginPath(); ctx.moveTo(g.a.x, g.a.y); ctx.lineTo(g.b.x, g.b.y); ctx.stroke(); }
    ctx.setLineDash([]);
  }

  if (plan.measure?.a && plan.measure.b) {
    const { a, b: bb } = plan.measure;
    dimLine(ctx, a, bb, px, '#e0457b', `${Math.round(Math.hypot(bb.x - a.x, bb.y - a.y))}`);
  }
  if (plan.drawPts) drawRoomPreview(ctx, px);
  if (!forExport) plan.afterRender?.();
}

function drawGrid(ctx, px) {
  const x0 = -plan.ox / plan.scale, y0 = -plan.oy / plan.scale;
  const x1 = x0 + plan.w / plan.scale, y1 = y0 + plan.h / plan.scale;
  const steps = [[100, 'rgba(0,0,0,0.035)'], [1000, 'rgba(0,0,0,0.08)']];
  for (const [st, col] of steps) {
    if (st * plan.scale < 6) continue;
    ctx.strokeStyle = col; ctx.lineWidth = px; ctx.beginPath();
    for (let x = Math.floor(x0 / st) * st; x < x1; x += st) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = Math.floor(y0 / st) * st; y < y1; y += st) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
  }
}

function text(ctx, str, x, y, px, opts = {}) {
  ctx.save();
  ctx.translate(x, y);
  if (opts.angle) ctx.rotate(opts.angle);
  ctx.scale(px, px);
  ctx.font = `${opts.weight || 500} ${opts.size || 11}px -apple-system, Segoe UI, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (opts.bg) {
    const w = ctx.measureText(str).width + 8;
    ctx.fillStyle = opts.bg; ctx.fillRect(-w / 2, -8, w, 16);
  }
  ctx.fillStyle = opts.color || DIM;
  ctx.fillText(str, 0, 0);
  ctx.restore();
}

function readableAngle(a) {
  a = Math.atan2(Math.sin(a), Math.cos(a));
  if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI;
  return a;
}

function dimLine(ctx, a, b, px, color = DIM, label, offsetPx = 0) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  if (L < 1) return;
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const o = offsetPx * px;
  const A = { x: a.x + nx * o, y: a.y + ny * o }, B = { x: b.x + nx * o, y: b.y + ny * o };
  ctx.strokeStyle = color; ctx.lineWidth = px;
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
  const t = 4 * px;
  for (const P of [A, B]) { ctx.moveTo(P.x + (nx + ux) * t, P.y + (ny + uy) * t); ctx.lineTo(P.x - (nx + ux) * t, P.y - (ny + uy) * t); }
  ctx.stroke();
  if (label != null) text(ctx, label, (A.x + B.x) / 2, (A.y + B.y) / 2, px, { color, bg: 'rgba(251,251,250,0.92)', angle: readableAngle(Math.atan2(dy, dx)) });
}

function wallDim(ctx, w, th, px) {
  const off = th + 24 * px;
  const a = { x: w.a.x - w.nx * off, y: w.a.y - w.ny * off }, b = { x: w.b.x - w.nx * off, y: w.b.y - w.ny * off };
  ctx.strokeStyle = 'rgba(91,100,112,0.35)'; ctx.lineWidth = px;
  ctx.beginPath(); ctx.moveTo(w.a.x - w.nx * th, w.a.y - w.ny * th); ctx.lineTo(a.x - w.nx * 5 * px, a.y - w.ny * 5 * px);
  ctx.moveTo(w.b.x - w.nx * th, w.b.y - w.ny * th); ctx.lineTo(b.x - w.nx * 5 * px, b.y - w.ny * 5 * px); ctx.stroke();
  const sel = store.sel?.type === 'wall' && store.sel.index === w.i;
  dimLine(ctx, a, b, px, sel ? ACCENT : DIM, `${Math.round(w.len)}`);
}

function drawOpening(ctx, op, walls, px) {
  const w = walls[op.wall]; if (!w) return;
  const th = store.d.room.thickness;
  const p0 = { x: w.a.x + w.ux * op.offset, y: w.a.y + w.uy * op.offset };
  const p1 = { x: p0.x + w.ux * op.width, y: p0.y + w.uy * op.width };
  // clear the wall
  ctx.fillStyle = '#f3f1ec';
  ctx.beginPath();
  ctx.moveTo(p0.x + w.nx * 1, p0.y + w.ny * 1); ctx.lineTo(p1.x + w.nx * 1, p1.y + w.ny * 1);
  ctx.lineTo(p1.x - w.nx * (th + 1), p1.y - w.ny * (th + 1)); ctx.lineTo(p0.x - w.nx * (th + 1), p0.y - w.ny * (th + 1)); ctx.closePath(); ctx.fill();
  const sel = store.sel?.type === 'opening' && store.sel.id === op.id;
  const col = sel ? ACCENT : '#4a515b';
  ctx.strokeStyle = col; ctx.lineWidth = 1.2 * px;
  // jambs
  ctx.beginPath();
  for (const p of [p0, p1]) { ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - w.nx * th, p.y - w.ny * th); }
  ctx.stroke();
  if (op.type === 'window') {
    ctx.beginPath();
    for (const f of [0.3, 0.5, 0.7]) {
      ctx.moveTo(p0.x - w.nx * th * f, p0.y - w.ny * th * f); ctx.lineTo(p1.x - w.nx * th * f, p1.y - w.ny * th * f);
    }
    ctx.stroke();
  } else {
    const inward = op.swing !== 'out';
    const sgn = inward ? 1 : -1;
    const base = inward ? 0 : th;
    const hingeAtStart = op.hinge !== 'right';
    const H = hingeAtStart ? p0 : p1, F = hingeAtStart ? p1 : p0;
    const Hb = { x: H.x - w.nx * base, y: H.y - w.ny * base };
    const tip = { x: Hb.x + w.nx * op.width * sgn, y: Hb.y + w.ny * op.width * sgn };
    ctx.beginPath(); ctx.moveTo(Hb.x, Hb.y); ctx.lineTo(tip.x, tip.y); ctx.lineWidth = 2 * px; ctx.stroke();
    const a0 = Math.atan2(F.y - H.y, F.x - H.x), a1 = Math.atan2(tip.y - Hb.y, tip.x - Hb.x);
    let ccw = ((a1 - a0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI < 0;
    ctx.beginPath(); ctx.lineWidth = px; ctx.setLineDash([4 * px, 3 * px]);
    ctx.arc(Hb.x, Hb.y, op.width, a0, a1, ccw); ctx.stroke(); ctx.setLineDash([]);
  }
}

function openingDims(ctx, op, walls, px) {
  const w = walls[op.wall]; if (!w) return;
  const at = (t) => ({ x: w.a.x + w.ux * t + w.nx * 30 * px, y: w.a.y + w.uy * t + w.ny * 30 * px });
  dimLine(ctx, at(0), at(op.offset), px, ACCENT, `${Math.round(op.offset)}`);
  dimLine(ctx, at(op.offset), at(op.offset + op.width), px, ACCENT, `${Math.round(op.width)}`);
  dimLine(ctx, at(op.offset + op.width), at(w.len), px, ACCENT, `${Math.round(w.len - op.offset - op.width)}`);
}

// Resize handles at both ends of the selected door/window.
function openingEnds(op, walls) {
  const w = walls[op.wall]; if (!w) return [];
  return [op.offset, op.offset + op.width].map((t, i) => ({ end: i, x: w.a.x + w.ux * t + w.nx * 18 / plan.scale, y: w.a.y + w.uy * t + w.ny * 18 / plan.scale }));
}
function openingHandles(ctx, op, walls, px) {
  if (plan.tool !== 'room' || store.readOnly) return;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5 * px;
  for (const h of openingEnds(op, walls)) { ctx.beginPath(); ctx.arc(h.x, h.y, 6 * px, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
}
export function screenOf(p) { return W2S(p); }

function tint(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const m = (c) => Math.round(c * a + 255 * (1 - a));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

function rrect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawItem(ctx, it, px) {
  const m = modelOf(it); if (!m) return;
  const s = sizeOf(it); const c = coloursOf(it); const cfg = cfgOf(it);
  const { w, d } = s; const hw = w / 2, hd = d / 2;
  ctx.save();
  ctx.translate(it.x, it.y); ctx.rotate(rad(it.rot));
  const dashed = ABOVE_FLOOR_DASHED.has(m.kind);
  ctx.lineWidth = 1.2 * px; ctx.strokeStyle = '#59606b';
  if (dashed) ctx.setLineDash([5 * px, 3 * px]);
  const hov = plan.hover?.type === 'item' && plan.hover.id === it.id;
  switch (m.kind) {
    case 'basin': case 'worktop': case 'console': {
      ctx.fillStyle = m.kind === 'basin' ? '#ffffff' : tint(c.front, 0.55);
      rrect(ctx, -hw, -hd, w, d, m.kind === 'basin' ? 15 : 3); ctx.fill(); ctx.stroke();
      if (m.kind === 'basin') {
        const n = cfg.double ? 2 : 1;
        const azL = /left-handed/i.test(m.name), azR = /right-handed/i.test(m.name);
        const bw = Math.min(n === 2 ? w / 2 - 120 : w - 160, 420 + (w > 900 && n === 1 ? 120 : 0));
        for (let k = 0; k < n; k++) {
          let cx = n === 2 ? (k ? w / 4 : -w / 4) : 0;
          if (azL) cx = -hw + bw / 2 + 60; if (azR) cx = hw - bw / 2 - 60;
          ctx.fillStyle = '#eef1f3';
          rrect(ctx, cx - bw / 2, -hd + 95, bw, d - 150, 60); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.arc(cx, -hd + 50, 14, 0, Math.PI * 2); ctx.stroke();
        }
      }
      break;
    }
    case 'ctbasin': {
      ctx.fillStyle = '#ffffff';
      if (cfg.shape === 'round' || cfg.shape === 'oval') { ctx.beginPath(); ctx.ellipse(0, 0, hw, hd, 0, 0, Math.PI * 2); }
      else rrect(ctx, -hw, -hd, w, d, 30);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#eef1f3';
      if (cfg.shape === 'round' || cfg.shape === 'oval') { ctx.beginPath(); ctx.ellipse(0, 0, hw - 20, hd - 20, 0, 0, Math.PI * 2); }
      else rrect(ctx, -hw + 25, -hd + 25, w - 50, d - 50, 25);
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'mirror': {
      ctx.fillStyle = '#cfdbe3';
      if (cfg.shape === 'round' || cfg.shape === 'oval') rrect(ctx, -hw, -hd, w, Math.max(d, 25), Math.max(d, 25) / 2);
      else ctx.rect(-hw, -hd, w, Math.max(d, 25));
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'toilet': case 'wc': {
      ctx.fillStyle = '#ffffff';
      const back = m.kind === 'wc' ? 190 : 60;
      ctx.beginPath(); ctx.rect(-hw, -hd, w, back); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, -hd + back + (d - back) / 2, hw - 5, (d - back) / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, -hd + back + (d - back) / 2 + 15, hw - 55, (d - back) / 2 - 60, 0, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'bath': {
      ctx.fillStyle = '#ffffff';
      if (cfg.shape === 'oval') { ctx.beginPath(); ctx.ellipse(0, 0, hw, hd, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.ellipse(0, 0, hw - 70, hd - 70, 0, 0, Math.PI * 2); ctx.stroke(); }
      else { ctx.beginPath(); ctx.rect(-hw, -hd, w, d); ctx.fill(); ctx.stroke(); rrect(ctx, -hw + 70, -hd + 70, w - 140, d - 140, 160); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(-hw + 230, 0, 22, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'tray': {
      if (m.wet) {
        ctx.fillStyle = 'rgba(120,170,210,0.07)'; ctx.strokeStyle = 'rgba(80,130,170,0.55)';
        ctx.setLineDash([8 * px, 5 * px]); ctx.beginPath(); ctx.rect(-hw, -hd, w, d); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        const L = Math.max(300, w - 200);
        ctx.fillStyle = '#c9ccd0'; ctx.fillRect(-L / 2, -hd + 55, L, 50); ctx.strokeStyle = '#7d848c'; ctx.lineWidth = px; ctx.strokeRect(-L / 2, -hd + 55, L, 50);
        text(ctx, 'Wet zone', 0, 0, px, { size: 10, color: 'rgba(60,100,140,0.8)', angle: readableAngle(rad(it.rot)) - rad(it.rot) });
        break;
      }
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.rect(-hw, -hd, w, d); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.strokeStyle = 'rgba(89,96,107,0.25)'; ctx.beginPath(); ctx.moveTo(-hw, -hd); ctx.lineTo(hw, hd); ctx.moveTo(hw, -hd); ctx.lineTo(-hw, hd); ctx.stroke(); ctx.restore();
      ctx.beginPath(); ctx.arc(0, 0, 45, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'glass': {
      ctx.strokeStyle = '#5f8fb3'; ctx.lineWidth = 3 * px;
      ctx.beginPath();
      if (d > 300) { ctx.moveTo(-hw, hd); ctx.lineTo(hw, hd); ctx.lineTo(hw, -hd); }
      else { ctx.moveTo(-hw, 0); ctx.lineTo(hw, 0); }
      ctx.stroke();
      if (/hinged|bifold|quadrant/i.test(m.name) && d <= 300) {
        ctx.lineWidth = px; ctx.setLineDash([4 * px, 3 * px]);
        ctx.beginPath(); ctx.arc(-hw, 0, w, 0, Math.PI / 2); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.lineWidth = 0;
      ctx.fillStyle = 'rgba(95,143,179,0.06)'; ctx.fillRect(-hw, -hd, w, d);
      break;
    }
    case 'towelrail': case 'radiator': {
      ctx.fillStyle = m.kind === 'radiator' ? '#ffffff' : '#e8eaec';
      ctx.beginPath(); ctx.rect(-hw, -hd, w, d); ctx.fill(); ctx.stroke();
      ctx.beginPath(); for (let x = -hw + 40; x < hw - 20; x += 60) { ctx.moveTo(x, -hd + 15); ctx.lineTo(x, hd - 15); } ctx.save(); ctx.strokeStyle = 'rgba(89,96,107,0.35)'; ctx.stroke(); ctx.restore();
      break;
    }
    case 'falsewall': {
      ctx.setLineDash([]);
      ctx.fillStyle = '#9aa0a8'; ctx.beginPath(); ctx.rect(-hw, -hd, w, d); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.beginPath(); ctx.rect(-hw, -hd, w, d); ctx.clip(); ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); for (let k = -w - d; k < w + d; k += 50) { ctx.moveTo(-hw + k, -hd); ctx.lineTo(-hw + k + d, hd); } ctx.stroke(); ctx.restore();
      const n = nicheOf(it);
      if (n.on) { ctx.strokeStyle = '#f2b84b'; ctx.lineWidth = 1.5 * px; ctx.setLineDash([6 * px, 4 * px]); const y = hd - Math.min(d - 10, n.depth); ctx.beginPath(); ctx.moveTo(-hw, y); ctx.lineTo(hw, y); ctx.stroke(); ctx.setLineDash([]); }
      break;
    }
    case 'towelholder': case 'tap': case 'handshower': case 'showerrail': case 'accessory': {
      ctx.setLineDash([]); ctx.fillStyle = '#c9ccd0'; ctx.beginPath(); ctx.rect(-hw, -hd, w, Math.max(d, 15)); ctx.fill(); ctx.stroke();
      break;
    }
    case 'walltap': case 'showervalve': case 'showerhead': {
      ctx.setLineDash([]);
      ctx.fillStyle = '#c9ccd0';
      if (m.kind === 'showerhead') { ctx.fillRect(-6, -hd, 12, d - w / 2); ctx.beginPath(); ctx.arc(0, hd - w / 2, w / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      else { ctx.fillRect(-hw, -hd, w, 14); ctx.strokeRect(-hw, -hd, w, 14); if (m.kind === 'walltap') { ctx.fillRect(-9, -hd, 18, d); ctx.strokeRect(-9, -hd, 18, d); } else { ctx.beginPath(); ctx.arc(0, -hd + 30, 30, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); } }
      break;
    }
    case 'box': {
      ctx.fillStyle = '#e6e3dd'; ctx.beginPath(); ctx.rect(-hw, -hd, w, d); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.beginPath(); ctx.rect(-hw, -hd, w, d); ctx.clip(); ctx.strokeStyle = 'rgba(89,96,107,0.3)';
      ctx.beginPath(); for (let k = -w - d; k < w + d; k += 60) { ctx.moveTo(-hw + k, -hd); ctx.lineTo(-hw + k + d, hd); } ctx.stroke(); ctx.restore();
      break;
    }
    default: { // cabinets
      ctx.fillStyle = tint(c.front, m.kind === 'open' ? 0.25 : 0.5);
      ctx.beginPath(); ctx.rect(-hw, -hd, w, d); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 2.5 * px; ctx.strokeStyle = cfg.front === 'blackframe' ? '#111' : '#59606b';
      ctx.beginPath(); ctx.moveTo(-hw, hd); ctx.lineTo(hw, hd); ctx.stroke();
      if (m.kind === 'mirrorcab') { ctx.strokeStyle = '#8fb0c5'; ctx.beginPath(); ctx.moveTo(-hw + 10, hd - 6); ctx.lineTo(hw - 10, hd - 6); ctx.stroke(); }
      if (cfg.doors && cfg.hinge && m.kind !== 'mirrorcab') {
        const hx = cfg.hinge === 'L' ? -hw : hw;
        ctx.lineWidth = px; ctx.setLineDash([4 * px, 3 * px]); ctx.strokeStyle = 'rgba(89,96,107,0.5)';
        ctx.beginPath(); ctx.arc(hx, hd, w, cfg.hinge === 'L' ? 0 : Math.PI / 2, cfg.hinge === 'L' ? Math.PI / 2 : Math.PI); ctx.stroke();
      }
    }
  }
  ctx.setLineDash([]);
  // label
  if (w * plan.scale > 50 && !['glass', 'mirror', 'walltap', 'showervalve', 'showerhead', 'falsewall', 'towelholder', 'tap', 'handshower', 'showerrail', 'accessory'].includes(m.kind)) {
    const sku = m.generic ? '' : it.custom ? 'MTM' : (m.sizes[it.size]?.variants[0]?.sku || '').split('-')[0];
    const lbl = `${sku ? sku + ' · ' : ''}${Math.round(w)}`;
    if (!(m.kind === 'vanity' && hasRider(it))) text(ctx, lbl, 0, m.kind === 'basin' ? hd - 25 : 0, px, { size: 10, color: '#3d444e', angle: readableAngle(rad(it.rot)) - rad(it.rot) });
  }
  if (hov) { ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5 * px; ctx.strokeRect(-hw, -hd, w, d); }
  ctx.restore();
}

function hasRider(it) { return ridersOf(it).length > 0; }

function rotHandlePos(it) {
  const s = sizeOf(it);
  const off = s.d / 2 + 28 / plan.scale;
  return { x: it.x - Math.sin(rad(it.rot)) * off, y: it.y + Math.cos(rad(it.rot)) * off };
}

export function clearances(it) {
  const s = sizeOf(it);
  const pts = store.d.room.pts;
  const c = Math.cos(rad(it.rot)), sn = Math.sin(rad(it.rot));
  const dirs = { left: [-1, 0], right: [1, 0], back: [0, -1], front: [0, 1] };
  const out = {};
  for (const [k, [lx, ly]] of Object.entries(dirs)) {
    const ox = lx * s.w / 2, oy = ly * s.d / 2;
    const p = { x: it.x + ox * c - oy * sn, y: it.y + ox * sn + oy * c };
    const dvec = { x: lx * c - ly * sn, y: lx * sn + ly * c };
    const t = rayToWalls(p, dvec, pts);
    out[k] = { p, dir: dvec, dist: t == null ? null : Math.max(0, t) };
  }
  return out;
}

function drawSelection(ctx, it, px) {
  const s = sizeOf(it);
  const corners = itemCorners(it, s.w, s.d);
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 2 * px;
  ctx.beginPath(); corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
  // clearances to walls
  const cl = clearances(it);
  for (const k of Object.keys(cl)) {
    const { p, dir, dist } = cl[k];
    if (dist == null || dist < 1 || dist > 8000) continue;
    const q = { x: p.x + dir.x * dist, y: p.y + dir.y * dist };
    ctx.setLineDash([3 * px, 3 * px]);
    dimLine(ctx, p, q, px, '#d0602a', `${Math.round(dist)}`);
    ctx.setLineDash([]);
  }
  // size labels along front & side
  const l = (x, y) => ({ x: it.x + x * Math.cos(rad(it.rot)) - y * Math.sin(rad(it.rot)), y: it.y + x * Math.sin(rad(it.rot)) + y * Math.cos(rad(it.rot)) });
  // rotation handle
  const h = rotHandlePos(it);
  const f = l(0, s.d / 2);
  ctx.strokeStyle = ACCENT; ctx.lineWidth = px; ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(h.x, h.y); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(h.x, h.y, 6 * px, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  text(ctx, `${Math.round(s.w)} × ${Math.round(s.d)}${it.elev ? ` · ↑${Math.round(it.elev)}` : ''}`, l(0, -s.d / 2 - 14 * px).x, l(0, -s.d / 2 - 14 * px).y, px, { color: ACCENT, bg: 'rgba(255,255,255,0.9)', angle: readableAngle(rad(it.rot)) });
}

function drawRoomPreview(ctx, px) {
  const P = plan.drawPts;
  if (!P.length && !plan.cursor) return;
  const cur = plan.drawCur;
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 2 * px; ctx.beginPath();
  P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (cur && P.length) ctx.lineTo(cur.x, cur.y);
  ctx.stroke();
  for (let i = 1; i < P.length; i++) dimLine(ctx, P[i - 1], P[i], px, ACCENT, `${Math.round(Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y))}`, -14);
  if (cur && P.length) dimLine(ctx, P[P.length - 1], cur, px, '#e0457b', plan.drawInput ? plan.drawInput + '▏' : `${Math.round(Math.hypot(cur.x - P[P.length - 1].x, cur.y - P[P.length - 1].y))}`, -14);
  ctx.fillStyle = ACCENT;
  for (const p of P) { ctx.beginPath(); ctx.arc(p.x, p.y, 4 * px, 0, Math.PI * 2); ctx.fill(); }
}

// ------------------------------------------------------------------ interaction
function evPt(e) {
  const r = plan.canvas.getBoundingClientRect();
  return { sx: e.clientX - r.left, sy: e.clientY - r.top };
}

function hitTest(w) {
  const px = 1 / plan.scale;
  const d = store.d;
  const sel = store.sel;
  const room = plan.tool === 'room';
  if (room) {
    if (sel?.type === 'opening') {
      const op = d.openings.find((o) => o.id === sel.id);
      if (op) for (const h of openingEnds(op, wallsOf(d.room.pts))) if (Math.hypot(w.x - h.x, w.y - h.y) < 10 * px) return { type: 'opEnd', id: op.id, end: h.end };
    }
  }
  if (!room && sel?.type === 'item') {
    const it = itemById(sel.id);
    if (it) { const h = rotHandlePos(it); if (Math.hypot(w.x - h.x, w.y - h.y) < 9 * px) return { type: 'rotate', id: it.id }; }
  }
  const walls = wallsOf(d.room.pts);
  if (room) {
    for (let i = 0; i < d.room.pts.length; i++) {
      const p = d.room.pts[i];
      if (Math.hypot(w.x - p.x, w.y - p.y) < 9 * px) return { type: 'vertex', index: i };
    }
  }
  if (room) for (const op of d.openings) {
    const wl = walls[op.wall]; if (!wl) continue;
    const t = (w.x - wl.a.x) * wl.ux + (w.y - wl.a.y) * wl.uy;
    const n = (w.x - wl.a.x) * wl.nx + (w.y - wl.a.y) * wl.ny;
    if (t > op.offset && t < op.offset + op.width && n < 4 * px + 20 && n > -d.room.thickness - 4 * px) return { type: 'opening', id: op.id };
  }
  if (!room) {
  const items = [...d.items].sort((a, b) => (b.elev + sizeOf(b).h) - (a.elev + sizeOf(a).h));
  // prefer the currently selected item if the point is inside it
  if (sel?.type === 'item') {
    const it = itemById(sel.id);
    if (it) { const s = sizeOf(it); if (pointInPoly(w, itemCorners(it, s.w, Math.max(s.d, 40)))) return { type: 'item', id: it.id }; }
  }
  for (const it of items) {
    const s = sizeOf(it);
    if (pointInPoly(w, itemCorners(it, s.w, Math.max(s.d, 40)))) return { type: 'item', id: it.id };
  }
  return null;
  }
  for (const wl of walls) {
    const n = (w.x - wl.a.x) * wl.nx + (w.y - wl.a.y) * wl.ny;
    const t = (w.x - wl.a.x) * wl.ux + (w.y - wl.a.y) * wl.uy;
    if (t >= 0 && t <= wl.len && n <= 6 * px && n >= -d.room.thickness - 6 * px) return { type: 'wall', index: wl.i };
  }
  return null;
}

// Touch pointers currently down (for pinch-zoom / two-finger pan).
const touches = new Map();
function pinchInfo() {
  const [a, b] = [...touches.values()];
  return { d: Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1, mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
}

function onDown(e) {
  try { plan.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
  const { sx, sy } = evPt(e);
  const w = S2W(sx, sy);
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { sx, sy });
    if (touches.size === 2) {
      // a second finger turns the gesture into pinch-zoom, unless something is already being dragged
      if (plan.drag?.moved) return;
      const p = pinchInfo();
      plan.drag = { type: 'pinch', d0: p.d, scale0: plan.scale, anchor: S2W(p.mx, p.my) };
      plan.userMoved = true;
      return;
    }
    if (touches.size > 2) return;
  }
  if (e.button === 1 || e.button === 2 || plan.spaceDown) {
    plan.drag = { type: 'pan', sx, sy, ox: plan.ox, oy: plan.oy };
    return;
  }
  if (plan.tool === 'measure') {
    // click the × on a pinned dimension to remove it
    const px = 1 / plan.scale;
    const pinned = (store.d.dims || []).find((dm) => Math.hypot(w.x - ((dm.a.x + dm.b.x) / 2 + 22 * px), w.y - ((dm.a.y + dm.b.y) / 2 - 12 * px)) < 9 * px);
    if (pinned && !store.readOnly) { checkpoint(); store.d.dims = store.d.dims.filter((x) => x !== pinned); commit('room'); return; }
    const p = snapToFeatures(w);
    plan.measure = { a: p, b: p };
    plan.drag = { type: 'measure' };
    draw(); return;
  }
  if (plan.tool === 'draw') { drawClick(w, e); return; }

  const hit = hitTest(w);
  if (store.readOnly) {
    // view-only: allow selecting to read sizes/clearances, never dragging
    if (hit && hit.type !== 'rotate' && hit.type !== 'opEnd') select(hit.type === 'item' || hit.type === 'opening' ? { type: hit.type, id: hit.id } : { type: hit.type, index: hit.index });
    else if (!hit) select(null);
    plan.drag = { type: 'pan', sx, sy, ox: plan.ox, oy: plan.oy };
    return;
  }
  if (!hit) {
    select(null);
    plan.drag = { type: 'pan', sx, sy, ox: plan.ox, oy: plan.oy, maybeClick: true };
    return;
  }
  const d = store.d;
  if (hit.type === 'rotate') {
    const it = itemById(hit.id);
    plan.drag = { type: 'rotate', it, start: JSON.stringify(d), riders: ridersOf(it) };
    return;
  }
  if (hit.type === 'item') {
    const it = itemById(hit.id);
    if (e.altKey && e.shiftKey === false && e.metaKey === false && e.ctrlKey === false && false) return;
    select({ type: 'item', id: it.id });
    plan.drag = { type: 'item', it, start: JSON.stringify(d), off: { x: w.x - it.x, y: w.y - it.y }, riders: ridersOf(it), moved: false, sx, sy };
    return;
  }
  if (hit.type === 'opEnd') {
    const op = d.openings.find((o) => o.id === hit.id);
    plan.drag = { type: 'opEnd', op, end: hit.end, start: JSON.stringify(d), o0: op.offset, w0: op.width, moved: false };
    return;
  }
  if (hit.type === 'vertex') {
    select({ type: 'vertex', index: hit.index });
    plan.drag = { type: 'vertex', index: hit.index, start: JSON.stringify(d), moved: false };
    return;
  }
  if (hit.type === 'opening') {
    select({ type: 'opening', id: hit.id });
    const op = d.openings.find((o) => o.id === hit.id);
    const wl = wallsOf(d.room.pts)[op.wall];
    const t = (w.x - wl.a.x) * wl.ux + (w.y - wl.a.y) * wl.uy;
    plan.drag = { type: 'opening', op, start: JSON.stringify(d), dt: t - op.offset, moved: false };
    return;
  }
  if (hit.type === 'wall') {
    const wl0 = wallsOf(d.room.pts)[hit.index];
    const tClick = Math.max(0, Math.min(wl0.len, (w.x - wl0.a.x) * wl0.ux + (w.y - wl0.a.y) * wl0.uy));
    select({ type: 'wall', index: hit.index, t: tClick });
    const pts = d.room.pts; const n = pts.length;
    plan.drag = { type: 'wall', index: hit.index, start: JSON.stringify(d), w0: w, a0: { ...pts[hit.index] }, b0: { ...pts[(hit.index + 1) % n] }, moved: false };
  }
}

function onMove(e) {
  const { sx, sy } = evPt(e);
  if (e.pointerType === 'touch' && touches.has(e.pointerId)) touches.set(e.pointerId, { sx, sy });
  if (plan.drag?.type === 'pinch') {
    if (touches.size < 2) return;
    const p = pinchInfo(), dg = plan.drag;
    plan.scale = Math.min(3, Math.max(0.02, dg.scale0 * (p.d / dg.d0)));
    plan.ox = p.mx - dg.anchor.x * plan.scale; plan.oy = p.my - dg.anchor.y * plan.scale;
    draw();
    return;
  }
  const w = S2W(sx, sy);
  plan.cursor = w;
  const dg = plan.drag;
  if (plan.tool === 'draw') { plan.drawCur = drawSnap(w, e); hud(); draw(); return; }
  if (!dg) {
    const h = plan.tool === 'select' || plan.tool === 'room' ? hitTest(w) : null;
    const key = JSON.stringify(h);
    if (key !== plan.hoverKey) {
      plan.hover = h; plan.hoverKey = key;
      plan.canvas.style.cursor = !h ? (plan.tool === 'select' || plan.tool === 'room' ? 'default' : 'crosshair') : h.type === 'rotate' ? 'grab' : h.type === 'opEnd' ? 'ew-resize' : h.type === 'vertex' ? 'crosshair' : 'move';
      draw();
    }
    hud();
    return;
  }
  const d = store.d;
  const px = 1 / plan.scale;
  switch (dg.type) {
    case 'pan':
      plan.ox = dg.ox + sx - dg.sx; plan.oy = dg.oy + sy - dg.sy; plan.userMoved = true;
      if (Math.hypot(sx - dg.sx, sy - dg.sy) > 3) dg.maybeClick = false;
      draw(); break;
    case 'measure':
      plan.measure.b = e.shiftKey ? w : snapToFeatures(w);
      hud(); draw(); break;
    case 'item': {
      if (!dg.moved && Math.hypot(sx - dg.sx, sy - dg.sy) < 3) return;
      if (!dg.moved) { dg.moved = true; }
      const it = dg.it;
      const p = { x: w.x - dg.off.x, y: w.y - dg.off.y };
      plan.guides = placeItem(it, p, { free: e.altKey, tol: 10 * px });
      applyRiders(it, dg.riders);
      emit('live'); draw(); hud(); break;
    }
    case 'rotate': {
      const it = dg.it;
      let a = deg(Math.atan2(w.y - it.y, w.x - it.x)) - 90;
      a = e.shiftKey ? Math.round(a) : Math.round(a / 15) * 15;
      it.rot = normAngle(a);
      applyRiders(it, dg.riders);
      emit('live'); draw(); break;
    }
    case 'vertex': {
      dg.moved = true;
      const pts = d.room.pts; const n = pts.length;
      let p = { x: snap(w.x, 10), y: snap(w.y, 10) };
      const prev = pts[(dg.index - 1 + n) % n], next = pts[(dg.index + 1) % n];
      if (!e.altKey) for (const q of [prev, next]) {
        if (Math.abs(p.x - q.x) < 10 * px) p.x = q.x;
        if (Math.abs(p.y - q.y) < 10 * px) p.y = q.y;
      }
      pts[dg.index] = p;
      emit('live-room'); draw(); break;
    }
    case 'opEnd': {
      dg.moved = true;
      const op = dg.op;
      const wl = wallsOf(d.room.pts)[op.wall];
      const t = snap((w.x - wl.a.x) * wl.ux + (w.y - wl.a.y) * wl.uy, 10);
      const MIN = 300;
      if (dg.end === 0) { const right = dg.o0 + dg.w0; const o = Math.max(0, Math.min(right - MIN, t)); op.offset = o; op.width = right - o; }
      else { op.width = Math.max(MIN, Math.min(wl.len - op.offset, t - op.offset)); }
      emit('live-room'); draw(); hud(); break;
    }
    case 'wall': {
      if (!dg.moved && Math.hypot(w.x - dg.w0.x, w.y - dg.w0.y) < 4 / plan.scale) return;
      dg.moved = true;
      const pts = d.room.pts; const n = pts.length;
      const wl = wallsOf(JSON.parse(dg.start).room.pts)[dg.index];
      let dn = (w.x - dg.w0.x) * wl.nx + (w.y - dg.w0.y) * wl.ny;
      dn = snap(dn, 10);
      pts[dg.index] = { x: dg.a0.x + wl.nx * dn, y: dg.a0.y + wl.ny * dn };
      pts[(dg.index + 1) % n] = { x: dg.b0.x + wl.nx * dn, y: dg.b0.y + wl.ny * dn };
      emit('live-room'); draw(); hud(); break;
    }
    case 'opening': {
      dg.moved = true;
      const op = dg.op;
      const wl = wallsOf(d.room.pts)[op.wall];
      const t = (w.x - wl.a.x) * wl.ux + (w.y - wl.a.y) * wl.uy - dg.dt;
      op.offset = Math.max(0, Math.min(wl.len - op.width, snap(t, 10)));
      emit('live-room'); draw(); break;
    }
  }
}

function onUp(e) {
  if (e.pointerType === 'touch') touches.delete(e.pointerId);
  if (e.type === 'pointercancel') touches.delete(e.pointerId);
  const dg = plan.drag;
  if (dg?.type === 'pinch') { if (touches.size < 2) plan.drag = null; return; }
  if (!dg) return;
  plan.drag = null;
  plan.guides = [];
  hud();
  if (dg.type === 'measure') { plan.measure.done = true; draw(); return; }
  if (['item', 'vertex', 'wall', 'opening', 'opEnd', 'rotate'].includes(dg.type) && (dg.moved || dg.type === 'rotate')) {
    store.undo.push(dg.start); store.redo.length = 0;
    commit(dg.type === 'item' || dg.type === 'rotate' ? 'items' : 'room');
  }
  draw();
}

function onDbl(e) {
  if (store.readOnly) return;
  if (plan.tool === 'draw') { finishDraw(); return; }
  if (plan.tool !== 'room') return;
  const { sx, sy } = evPt(e);
  const w = S2W(sx, sy);
  const hit = hitTest(w);
  if (hit?.type === 'wall') splitWall(hit.index, w);
  else if (hit?.type === 'vertex') removeVertex(hit.index);
}

export function splitWall(index, p) {
  const d = store.d; const walls = wallsOf(d.room.pts); const wl = walls[index];
  let t = p ? (p.x - wl.a.x) * wl.ux + (p.y - wl.a.y) * wl.uy : wl.len / 2;
  t = snap(Math.max(50, Math.min(wl.len - 50, t)), 10);
  checkpoint();
  d.room.pts.splice(index + 1, 0, { x: wl.a.x + wl.ux * t, y: wl.a.y + wl.uy * t });
  for (const op of d.openings) {
    if (op.wall > index) op.wall++;
    else if (op.wall === index && op.offset >= t) { op.wall++; op.offset -= t; }
  }
  store.sel = { type: 'vertex', index: index + 1 };
  commit('room');
}

export function removeVertex(index) {
  const d = store.d; const n = d.room.pts.length;
  if (n <= 3) return;
  checkpoint();
  const prevWall = (index - 1 + n) % n;
  d.room.pts.splice(index, 1);
  d.openings = d.openings.filter((op) => op.wall !== index && op.wall !== prevWall);
  for (const op of d.openings) if (op.wall > index) op.wall--;
  store.sel = null;
  commit('room');
}

function onWheel(e) {
  e.preventDefault();
  const { sx, sy } = evPt(e);
  if (!e.ctrlKey && Math.abs(e.deltaX) > 0 && e.deltaMode === 0 && Math.abs(e.deltaY) < 40) {
    // trackpad two-finger pan
    plan.ox -= e.deltaX; plan.oy -= e.deltaY; plan.userMoved = true; draw(); return;
  }
  const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
  zoom(f, sx, sy);
}

function onDrop(e) {
  e.preventDefault();
  const id = e.dataTransfer.getData('text/x-model');
  if (!id) return;
  const { sx, sy } = evPt(e);
  addModelAt(id, S2W(sx, sy), e.altKey);
}

export function addModelAt(id, w, free = false) {
  if (store.readOnly) return;
  const m = byId.get(id); if (!m) return;
  const d = store.d;
  checkpoint();
  if (m.opening) {
    const nw = nearestWall(w);
    const s = m.sizes[0];
    const op = { id: uid(), type: m.kind, wall: nw.w.i, width: s.w, height: s.h, sill: m.kind === 'window' ? 900 : 0, hinge: 'left', swing: 'in' };
    op.offset = Math.max(0, Math.min(nw.w.len - s.w, snap(nw.t - s.w / 2, 10)));
    d.openings.push(op);
    store.sel = { type: 'opening', id: op.id };
    commit('room');
    return op;
  }
  const it = makeItem(id, w.x, w.y);
  if (m.niche) it.custom = { ...(it.custom || { w: m.sizes[0].w, d: m.sizes[0].d }), h: d.room.height };
  else if (m.kind === 'falsewall') it.custom = { w: m.sizes[0].w, d: m.sizes[0].d, h: m.sizes[0].h };
  d.items.push(it);
  placeItem(it, w, { free, tol: 12 / plan.scale });
  store.sel = { type: 'item', id: it.id };
  commit('items');
  return it;
}

// ---- measure helpers
function snapToFeatures(w) {
  const tol = 10 / plan.scale;
  let best = null, bd = tol;
  const cand = [...store.d.room.pts];
  for (const it of store.d.items) { const s = sizeOf(it); cand.push(...itemCorners(it, s.w, s.d)); }
  for (const p of cand) { const dd = Math.hypot(p.x - w.x, p.y - w.y); if (dd < bd) { bd = dd; best = p; } }
  if (best) return { ...best };
  // snap onto wall faces
  for (const wl of wallsOf(store.d.room.pts)) { const h = distToSeg(w, wl.a, wl.b); if (h.d < tol) return { x: h.x, y: h.y }; }
  return { x: snap(w.x, 5), y: snap(w.y, 5) };
}

// ---- room drawing tool
function drawSnap(w, e) {
  const P = plan.drawPts;
  let p = { x: snap(w.x, 10), y: snap(w.y, 10) };
  if (P.length && !e?.altKey) {
    const last = P[P.length - 1];
    const ang = Math.atan2(p.y - last.y, p.x - last.x);
    const q = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(ang - q) < rad(12)) {
      const L = snap(Math.hypot(p.x - last.x, p.y - last.y), 10);
      p = { x: last.x + Math.round(Math.cos(q)) * L, y: last.y + Math.round(Math.sin(q)) * L };
    }
    if (P.length > 2 && Math.hypot(p.x - P[0].x, p.y - P[0].y) < 12 / plan.scale) p = { ...P[0], close: true };
    // align with first point
    if (Math.abs(p.x - P[0].x) < 8 / plan.scale) p.x = P[0].x;
    if (Math.abs(p.y - P[0].y) < 8 / plan.scale) p.y = P[0].y;
  }
  if (plan.drawInput && P.length) {
    const last = P[P.length - 1];
    const L = parseFloat(plan.drawInput);
    const dx = p.x - last.x, dy = p.y - last.y, cur = Math.hypot(dx, dy) || 1;
    if (L > 0) p = { x: last.x + (dx / cur) * L, y: last.y + (dy / cur) * L };
  }
  return p;
}
function drawClick(w, e) {
  const p = drawSnap(w, e);
  if (p.close) { finishDraw(); return; }
  plan.drawPts.push({ x: p.x, y: p.y });
  plan.drawInput = '';
  hud(); draw();
}
export function drawKey(e) {
  if (plan.tool !== 'draw') return false;
  if (/^[0-9.]$/.test(e.key)) { plan.drawInput += e.key; plan.drawCur = drawSnap(plan.cursor || { x: 0, y: 0 }); draw(); hud(); return true; }
  if (e.key === 'Backspace') { if (plan.drawInput) { plan.drawInput = plan.drawInput.slice(0, -1); plan.drawCur = drawSnap(plan.cursor || { x: 0, y: 0 }); } else plan.drawPts.pop(); draw(); hud(); return true; }
  if (e.key === 'Enter') {
    if (plan.drawInput && plan.drawPts.length) { const p = drawSnap(plan.cursor || plan.drawPts[plan.drawPts.length - 1]); plan.drawPts.push({ x: Math.round(p.x), y: Math.round(p.y) }); plan.drawInput = ''; plan.drawCur = p; draw(); hud(); }
    else finishDraw();
    return true;
  }
  if (e.key === 'Escape') { setTool('room'); return true; }
  return false;
}
// Re-attach doors/windows to the nearest wall of a new outline (keeps the ones that still fit).
function remapOpenings(oldPts, newPts, openings, shift = { x: 0, y: 0 }) {
  const oldW = wallsOf(oldPts), newW = wallsOf(newPts);
  const kept = [];
  for (const op of openings) {
    const w = oldW[op.wall]; if (!w) continue;
    const t = op.offset + op.width / 2;
    const c = { x: w.a.x + w.ux * t - shift.x, y: w.a.y + w.uy * t - shift.y };
    let best = null;
    for (const nw of newW) {
      const h = distToSeg(c, nw.a, nw.b);
      if (nw.len >= op.width + 20 && (!best || h.d < best.d)) best = { nw, d: h.d, t: h.t * nw.len };
    }
    if (best && best.d < 250) kept.push({ ...op, wall: best.nw.i, offset: Math.round(Math.max(0, Math.min(best.nw.len - op.width, best.t - op.width / 2))) });
  }
  return kept;
}

// Replace the room outline: normalise to 0,0 and clockwise, move fittings with it, keep doors/windows.
export function applyRoomShape(P, { shiftItems = true } = {}) {
  const d = store.d;
  checkpoint();
  const b = polyBounds(P);
  let pts = P.map((p) => ({ x: Math.round(p.x - b.x0), y: Math.round(p.y - b.y0) }));
  if (signedArea(pts) < 0) pts.reverse();
  const shift = shiftItems ? { x: b.x0, y: b.y0 } : { x: 0, y: 0 };
  if (shiftItems) for (const it of d.items) { it.x -= shift.x; it.y -= shift.y; }
  if (shiftItems) for (const dm of d.dims || []) { dm.a.x -= shift.x; dm.a.y -= shift.y; dm.b.x -= shift.x; dm.b.y -= shift.y; }
  const before = d.openings.length;
  d.openings = remapOpenings(d.room.pts, pts, d.openings, shift);
  d.room.pts = pts;
  store.sel = null;
  commit('room');
  return before - d.openings.length; // how many doors/windows no longer fit
}

function finishDraw() {
  const P = plan.drawPts;
  if (!P || P.length < 3) { setTool('room'); return; }
  const lost = applyRoomShape(P);
  setTool('room');
  fit();
  plan.onNotice?.(lost ? `Room updated — ${lost} door/window${lost > 1 ? 's no longer fitted and were' : ' no longer fitted and was'} removed` : 'Room updated');
}
export const drawActions = {
  undo() { if (plan.drawInput) plan.drawInput = ''; else plan.drawPts?.pop(); hud(); draw(); },
  finish() { if (plan.drawInput && plan.drawPts?.length) { const p = drawSnap(plan.cursor || plan.drawPts.at(-1)); plan.drawPts.push({ x: Math.round(p.x), y: Math.round(p.y) }); plan.drawInput = ''; } finishDraw(); },
  cancel() { setTool('room'); },
  preset(kind, W, L) {
    W = Math.max(500, Math.round(W)); L = Math.max(500, Math.round(L));
    const pts = kind === 'L'
      ? [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: Math.round(L * 0.55) }, { x: Math.round(W * 0.55), y: Math.round(L * 0.55) }, { x: Math.round(W * 0.55), y: L }, { x: 0, y: L }]
      : [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: L }, { x: 0, y: L }];
    const lost = applyRoomShape(pts, { shiftItems: false });
    setTool('room'); fit();
    plan.onNotice?.(lost ? `Room updated — ${lost} door/window${lost > 1 ? 's no longer fitted and were' : ' no longer fitted and was'} removed` : 'Room updated');
  },
};
// Pin the current measurement as a permanent dimension on the plan.
export function pinMeasure() {
  const m = plan.measure; if (!m?.a || !m.b || Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y) < 1) return;
  checkpoint();
  store.d.dims = [...(store.d.dims || []), { id: uid(), a: { ...m.a }, b: { ...m.b } }];
  plan.measure = null;
  commit('room');
}
export function clearMeasure(all = false) {
  plan.measure = null;
  if (all && store.d.dims?.length) { checkpoint(); store.d.dims = []; commit('room'); }
  draw(); hud();
}

function hud() {
  const el = plan.hud; if (!el) return;
  const c = plan.cursor;
  let s = '';
  if (plan.tool === 'draw') s = '';
  else if (plan.tool === 'measure') s = plan.measure?.b ? '' : 'Drag to measure — snaps to corners, fittings and walls (Shift = free)';
  else if (plan.drag?.type === 'item') s = 'Hold Alt to place freely without snapping';
  else if (plan.tool === 'room') s = store.sel ? 'Drag walls or corners to reshape · drag a door/window along its wall, or its round handles to resize · double-click a wall to add a corner' : 'Editing the room — click a wall to add a door or window · fittings are locked';
  else if (c) s = `x ${Math.round(c.x)}  y ${Math.round(c.y)} mm`;
  el.textContent = s;
}

export function exportPNG() {
  const c = document.createElement('canvas');
  const b = polyBounds(store.d.room.pts);
  const scale = 0.5; // px per mm
  const pad = 400;
  c.width = (b.w + pad * 2) * scale; c.height = (b.h + pad * 2) * scale;
  const saved = { scale: plan.scale, ox: plan.ox, oy: plan.oy, dpr: plan.dpr, canvas: plan.canvas };
  Object.assign(plan, { scale, ox: (pad - b.x0) * scale, oy: (pad - b.y0) * scale, dpr: 1, canvas: c });
  render(c.getContext('2d'), true);
  Object.assign(plan, saved);
  return c.toDataURL('image/png');
}
