// Plan geometry helpers. All plan units are millimetres; x → right, y → down (screen-like).

export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const snap = (v, step) => Math.round(v / step) * step;

export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function wallsOf(pts) {
  // In screen coords (y down) a positive signed area means clockwise on screen.
  const cw = signedArea(pts) > 0;
  const n = pts.length;
  const walls = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    // inward normal (points into the room)
    const nx = cw ? -uy : uy, ny = cw ? ux : -ux;
    walls.push({ i, a, b, len, ux, uy, nx, ny, angle: Math.atan2(dy, dx) });
  }
  return walls;
}

// Outer outline of walls of thickness t, mitred at corners.
export function outerPts(pts, t) {
  const walls = wallsOf(pts);
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const w0 = walls[(i - 1 + n) % n], w1 = walls[i];
    // offset lines outward (−normal)
    const p0 = { x: w0.a.x - w0.nx * t, y: w0.a.y - w0.ny * t };
    const p1 = { x: w1.a.x - w1.nx * t, y: w1.a.y - w1.ny * t };
    const hit = lineIntersect(p0, { x: w0.ux, y: w0.uy }, p1, { x: w1.ux, y: w1.uy });
    out.push(hit || { x: pts[i].x - w1.nx * t, y: pts[i].y - w1.ny * t });
  }
  return out;
}

export function lineIntersect(p, r, q, s) {
  const cross = r.x * s.y - r.y * s.x;
  if (Math.abs(cross) < 1e-9) return null;
  const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / cross;
  return { x: p.x + r.x * t, y: p.y + r.y * t };
}

export function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
  const x = a.x + dx * t, y = a.y + dy * t;
  return { d: Math.hypot(p.x - x, p.y - y), t, x, y };
}

export function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Ray from p in direction d (unit) → nearest hit on room walls (inner faces). Returns distance or null.
export function rayToWalls(p, d, pts) {
  let best = null;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const s = { x: b.x - a.x, y: b.y - a.y };
    const cross = d.x * s.y - d.y * s.x;
    if (Math.abs(cross) < 1e-9) continue;
    const t = ((a.x - p.x) * s.y - (a.y - p.y) * s.x) / cross;
    const u = ((a.x - p.x) * d.y - (a.y - p.y) * d.x) / cross;
    if (t > -0.5 && u >= -1e-6 && u <= 1 + 1e-6) {
      if (best === null || t < best) best = t;
    }
  }
  return best;
}

// Corners of an item footprint (centre x,y, width w along local x, depth d along local y, rot degrees).
export function itemCorners(it, w, d) {
  const c = Math.cos(rad(it.rot)), s = Math.sin(rad(it.rot));
  const hw = w / 2, hd = d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => ({ x: it.x + x * c - y * s, y: it.y + x * s + y * c }));
}

export function toLocal(it, p) {
  const c = Math.cos(rad(-it.rot)), s = Math.sin(rad(-it.rot));
  const dx = p.x - it.x, dy = p.y - it.y;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}
export function toWorld(it, x, y) {
  const c = Math.cos(rad(it.rot)), s = Math.sin(rad(it.rot));
  return { x: it.x + x * c - y * s, y: it.y + x * s + y * c };
}

export function polyBounds(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export function normAngle(a) { a %= 360; if (a < 0) a += 360; return a; }
