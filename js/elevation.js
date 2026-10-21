// Wall elevations: a 2D drawing of one wall as seen from inside the room — the wall (and sloped ceiling), doors and
// windows at their real heights, the tile line, and the fittings standing or hanging against that wall — with the
// dimensions you need for windows, doors and fitting heights.
import { sizeOf, modelOf, coloursOf } from './state.js';
import { wallsOf, itemCorners, ceilingAt } from './geom.js';

const NEAR = 450;      // fittings whose nearest edge is within this distance of the wall (mm) are drawn on it
const MARGIN = { l: 380, r: 420, t: 420, b: 380 }; // room for dimensions around the wall (mm, real)

const shortName = (n) => n.replace(/^Villeroy & Boch /, 'V&B ').replace(/^hansgrohe /, '').replace(/ with lighting and touch control| with touch control/i, '').replace(/\s*\(.*?\)\s*/g, ' ').trim();

// Everything needed to draw wall i: geometry along the wall (t = mm from the left as you face it), openings and items.
export function elevationOf(design, i) {
  const room = design.room, w = wallsOf(room.pts)[i];
  if (!w) return null;
  // facing the wall from inside: is the wall's start (a) on the left?
  const fx = -w.nx, fy = -w.ny, rx = -fy, ry = fx;
  const aLeft = rx * w.ux + ry * w.uy > 0;
  const T = (t) => (aLeft ? t : w.len - t); // wall-param → left-to-right
  // ceiling along the wall (piecewise linear when the ceiling slopes)
  const ceil = (t) => ceilingAt(room, w.a.x + w.ux * t + w.nx * 1, w.a.y + w.uy * t + w.ny * 1);
  const samples = [0, w.len];
  for (let k = 1; k < 20; k++) samples.push((w.len * k) / 20);
  const top = samples.sort((a, b) => a - b).map((t) => ({ x: T(t), y: ceil(t) })).sort((a, b) => a.x - b.x);
  const ops = design.openings.filter((o) => o.wall === i).map((o) => {
    const x0 = Math.min(T(o.offset), T(o.offset + o.width)), sill = o.type === 'door' ? 0 : o.sill;
    return { o, x0, x1: x0 + o.width, y0: sill, y1: sill + o.height };
  });
  const items = [];
  for (const it of design.items) {
    const m = modelOf(it); if (!m) continue;
    const s = sizeOf(it);
    const cs = itemCorners(it, s.w, s.d);
    const ds = cs.map((p) => (p.x - w.a.x) * w.nx + (p.y - w.a.y) * w.ny); // distance into the room
    const ts = cs.map((p) => (p.x - w.a.x) * w.ux + (p.y - w.a.y) * w.uy);
    const dmin = Math.min(...ds), dmax = Math.max(...ds);
    if (dmin > NEAR || dmax < -room.thickness) continue;
    const t0 = Math.max(0, Math.min(...ts)), t1 = Math.min(w.len, Math.max(...ts));
    if (t1 - t0 < 5) continue;
    const xa = T(t0), xb = T(t1);
    items.push({ it, m, s, x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: it.elev, y1: it.elev + s.h, dist: dmin });
  }
  // built-out walls / boxing are wall surfaces: draw them first, then fittings far-to-near so the ones against the
  // wall end up on top
  const surface = (f) => (['falsewall', 'box'].includes(f.m.kind) ? 0 : 1);
  items.sort((a, b) => surface(a) - surface(b) || b.dist - a.dist);
  const H = Math.max(...top.map((p) => p.y));
  return { i, w, len: w.len, H, top, ops, items, tile: room.wallTile?.enabled ? room.wallTile.height : 0 };
}

// Size of the drawing in real mm, including the dimension margins.
export function elevationSize(el) { return { w: el.len + MARGIN.l + MARGIN.r, h: el.H + MARGIN.t + MARGIN.b }; }

// Draw onto ctx with kPx = canvas px per real mm; paperPx = canvas px per printed mm (text and line sizes).
export function drawElevation(ctx, el, kPx, paperPx = 4) {
  const { w: W, h: Hh } = elevationSize(el);
  const X = (x) => (MARGIN.l + x) * kPx, Y = (y) => (MARGIN.t + el.H - y) * kPx; // y up from the floor
  const lw = (mm) => Math.max(0.5, mm * paperPx);
  const font = (mm, weight = 500) => `${weight} ${mm * paperPx}px -apple-system, Segoe UI, sans-serif`;
  ctx.save();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W * kPx, Hh * kPx);
  // wall face
  ctx.beginPath(); ctx.moveTo(X(0), Y(0));
  for (const p of el.top) ctx.lineTo(X(p.x), Y(p.y));
  ctx.lineTo(X(el.len), Y(0)); ctx.closePath();
  ctx.fillStyle = '#f6f4ef'; ctx.fill();
  if (el.tile) {
    ctx.save(); ctx.clip();
    ctx.fillStyle = 'rgba(160,170,180,0.12)'; ctx.fillRect(X(0), Y(el.tile), X(el.len) - X(0), Y(0) - Y(el.tile));
    ctx.restore();
  }
  ctx.strokeStyle = '#3b4048'; ctx.lineWidth = lw(0.5); ctx.stroke();
  // floor line
  ctx.beginPath(); ctx.moveTo(X(-150), Y(0)); ctx.lineTo(X(el.len + 150), Y(0)); ctx.lineWidth = lw(0.6); ctx.stroke();
  if (el.tile) {
    ctx.save(); ctx.setLineDash([lw(1.2), lw(0.8)]); ctx.strokeStyle = 'rgba(90,100,110,0.6)'; ctx.lineWidth = lw(0.2);
    ctx.beginPath(); ctx.moveTo(X(0), Y(el.tile)); ctx.lineTo(X(el.len), Y(el.tile)); ctx.stroke(); ctx.restore();
  }
  // openings
  for (const op of el.ops) {
    const { o } = op;
    ctx.fillStyle = o.type === 'window' ? '#e3eef5' : '#ffffff';
    ctx.fillRect(X(op.x0), Y(op.y1), X(op.x1) - X(op.x0), Y(op.y0) - Y(op.y1));
    ctx.strokeStyle = '#3b4048'; ctx.lineWidth = lw(0.35); ctx.strokeRect(X(op.x0), Y(op.y1), X(op.x1) - X(op.x0), Y(op.y0) - Y(op.y1));
    ctx.lineWidth = lw(0.18); ctx.beginPath();
    if (o.type === 'window') {
      const f = 45; ctx.strokeRect(X(op.x0 + f), Y(op.y1 - f), X(op.x1 - f) - X(op.x0 + f), Y(op.y0 + f) - Y(op.y1 - f));
      if (o.style === 'sash') { const ym = (op.y0 + op.y1) / 2; ctx.moveTo(X(op.x0 + f), Y(ym)); ctx.lineTo(X(op.x1 - f), Y(ym)); }
      else { const n = o.panes || (o.width > 750 ? 2 : 1); for (let k = 1; k < n; k++) { const xm = op.x0 + (o.width * k) / n; ctx.moveTo(X(xm), Y(op.y0 + f)); ctx.lineTo(X(xm), Y(op.y1 - f)); } }
      if (o.glass === 'frosted' || o.glass === 'half') {
        ctx.stroke(); ctx.beginPath(); ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.55)';
        const yTop = o.glass === 'half' ? (op.y0 + op.y1) / 2 : op.y1 - f;
        ctx.fillRect(X(op.x0 + f), Y(yTop), X(op.x1 - f) - X(op.x0 + f), Y(op.y0 + f) - Y(yTop)); ctx.restore();
      }
    } else {
      const hingeLeft = (o.hinge !== 'right');
      ctx.moveTo(X(hingeLeft ? op.x1 : op.x0), Y(op.y0)); ctx.lineTo(X(hingeLeft ? op.x0 : op.x1), Y(op.y1 - 300)); ctx.lineTo(X(hingeLeft ? op.x1 : op.x0), Y(op.y1));
      const hx = hingeLeft ? op.x1 - 80 : op.x0 + 80; ctx.moveTo(X(hx) + lw(1), Y(1000)); ctx.arc(X(hx), Y(1000), lw(1), 0, Math.PI * 2);
    }
    ctx.stroke();
  }
  // fittings; height tags that would collide with an earlier one are skipped
  const tags = [];
  for (const f of el.items) {
    const c = coloursOf(f.it), kind = f.m.kind;
    const glass = ['glass', 'wetpanel', 'bathscreen'].includes(kind);
    ctx.globalAlpha = glass ? 0.35 : 0.9;
    ctx.fillStyle = glass ? '#cfe2ee' : ['mirror', 'mirrorcab'].includes(kind) ? '#dfe7ec' : tintHex(c.front || '#e8e6e1', 0.45);
    ctx.fillRect(X(f.x0), Y(f.y1), X(f.x1) - X(f.x0), Y(f.y0) - Y(f.y1));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#59606b'; ctx.lineWidth = lw(0.25);
    ctx.strokeRect(X(f.x0), Y(f.y1), X(f.x1) - X(f.x0), Y(f.y0) - Y(f.y1));
    // name inside if there's room, height of the top at the top right
    ctx.fillStyle = '#3b4048'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = font(1.6);
    const label = shortName(f.m.name), bw = X(f.x1) - X(f.x0), bh = Y(f.y0) - Y(f.y1);
    if (bh > 3 * paperPx && ctx.measureText(label).width < bw - paperPx) ctx.fillText(label, (X(f.x0) + X(f.x1)) / 2, (Y(f.y0) + Y(f.y1)) / 2);
    else if (bh > 3 * paperPx) { const lab2 = label.length > 18 ? label.slice(0, 17) + '…' : label; if (ctx.measureText(lab2).width < bw - paperPx) ctx.fillText(lab2, (X(f.x0) + X(f.x1)) / 2, (Y(f.y0) + Y(f.y1)) / 2); }
    if (!glass && f.y1 < el.H - 20) {
      ctx.font = font(1.5, 600); ctx.fillStyle = '#2f5d8a'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      const t = `↑${Math.round(f.y1)}`, tx = X(f.x1) - paperPx * 0.4, ty = Y(f.y1) - paperPx * 0.4, tw = ctx.measureText(t).width, th = paperPx * 1.6;
      if (!tags.some(r => tx - tw < r.x && tx > r.x - r.w && ty - th < r.y && ty > r.y - th)) { ctx.fillText(t, tx, ty); tags.push({ x: tx, y: ty, w: tw }); }
    }
  }
  // dimensions
  const dimH = (x0, x1, y, label, below = false) => {
    const yy = Y(0) + (below ? 1 : -1) * 0, py = y;
    ctx.strokeStyle = '#5b6470'; ctx.lineWidth = lw(0.18); ctx.beginPath();
    ctx.moveTo(X(x0), py); ctx.lineTo(X(x1), py);
    for (const x of [x0, x1]) { ctx.moveTo(X(x) - lw(0.8), py + lw(0.8)); ctx.lineTo(X(x) + lw(0.8), py - lw(0.8)); }
    ctx.stroke(); void yy;
    ctx.fillStyle = '#3b4048'; ctx.font = font(1.7); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(label, (X(x0) + X(x1)) / 2, py - lw(0.5));
  };
  const dimV = (y0, y1, x, label) => {
    ctx.strokeStyle = '#5b6470'; ctx.lineWidth = lw(0.18); ctx.beginPath();
    ctx.moveTo(x, Y(y0)); ctx.lineTo(x, Y(y1));
    for (const y of [y0, y1]) { ctx.moveTo(x - lw(0.8), Y(y) + lw(0.8)); ctx.lineTo(x + lw(0.8), Y(y) - lw(0.8)); }
    ctx.stroke();
    ctx.save(); ctx.translate(x - lw(0.6), (Y(y0) + Y(y1)) / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#3b4048'; ctx.font = font(1.7); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(label, 0, 0); ctx.restore();
  };
  // overall length below, ceiling height on the left
  dimH(0, el.len, Y(0) + 200 * kPx, `${Math.round(el.len)}`);
  const hL = el.top[0].y, hR = el.top[el.top.length - 1].y;
  dimV(0, hL, X(0) - 170 * kPx, `${Math.round(hL)}`);
  if (Math.abs(hR - hL) > 5) dimV(0, hR, X(el.len) + 330 * kPx, `${Math.round(hR)}`);
  // openings: chain of positions along the top, width above each, sill and head on the right of each
  const chainY = Y(el.H) - 120 * kPx;
  let last = 0;
  for (const op of [...el.ops].sort((a, b) => a.x0 - b.x0)) {
    if (op.x0 - last > 20) dimH(last, op.x0, chainY, `${Math.round(op.x0 - last)}`);
    dimH(op.x0, op.x1, chainY, `${Math.round(op.x1 - op.x0)}`);
    last = op.x1;
    const vx = X(op.x1) + 90 * kPx;
    if (op.y0 > 0) dimV(0, op.y0, vx, `${Math.round(op.y0)}`);
    dimV(op.y0, op.y1, vx, `${Math.round(op.y1 - op.y0)}`);
    ctx.font = font(1.5, 600); ctx.fillStyle = '#2f5d8a'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`head ${Math.round(op.y1)}`, X(op.x0) + paperPx, Y(op.y1) - lw(1.6));
  }
  if (el.ops.length && el.len - last > 20) dimH(last, el.len, chainY, `${Math.round(el.len - last)}`);
  ctx.restore();
}

function tintHex(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#e8e6e1';
  const n = parseInt(m[1], 16), mix = (c) => Math.round(c + (255 - c) * a);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

// Convenience: a canvas with wall i drawn at kPx px per real mm.
export function elevationCanvas(design, i, kPx, paperPx) {
  const el = elevationOf(design, i); if (!el) return null;
  const sz = elevationSize(el);
  const c = document.createElement('canvas'); c.width = Math.ceil(sz.w * kPx); c.height = Math.ceil(sz.h * kPx);
  drawElevation(c.getContext('2d'), el, kPx, paperPx);
  return { canvas: c, el, size: sz };
}
