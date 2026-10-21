// PDF export: plan, wall elevations and a 3D view for a room or the whole project, on A4/A3, at a true scale with a
// scale bar and title block. Pages are laid out once (layoutPages) and drawn either into preview canvases or into a
// PDF via jsPDF (loaded from cdnjs on first use).
import { store } from './state.js';
import { renderPlanCanvas } from './plan2d.js';
import { elevationOf, elevationSize, elevationCanvas } from './elevation.js';
import { wallsOf } from './geom.js';
import { snapshot3D } from './view3d.js';

const PAPER = { a4: [297, 210], a3: [420, 297] }; // landscape mm
const MARGIN = 10, TITLE = 16;
const SCALES = [10, 20, 25, 50, 100, 200];
const PX_PER_MM = 6; // image resolution on paper (~150 dpi)
// room for the dimension lines around a plan: paper mm, so it's the same on the page at any scale
const planPad = (scale, dims) => (dims ? 25 : 13) * scale;
const PLAN_UI = 1.5; // plan text and lines 1.5× their on-screen size, so labels print at ~8pt

const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const area = (paper, portrait) => { const [w, h] = portrait ? [PAPER[paper][1], PAPER[paper][0]] : PAPER[paper]; return { pw: w, ph: h, w: w - 2 * MARGIN, h: h - 2 * MARGIN - TITLE }; };

// Best scale for a drawing of realW × realH mm: the largest one that fits (either orientation), or the requested one.
function pickScale(realW, realH, paper, want) {
  const fits = (s, portrait) => { const a = area(paper, portrait); return realW / s <= a.w && realH / s <= a.h; };
  const orient = (s) => (fits(s, false) ? false : fits(s, true) ? true : null);
  if (want !== 'auto') {
    const s = +want, o = orient(s);
    if (o !== null) return { scale: s, portrait: o, forced: false };
    const next = SCALES.find((x) => x > s && orient(x) !== null) || SCALES[SCALES.length - 1];
    return { scale: next, portrait: !!orient(next), forced: true, wanted: s };
  }
  const s = SCALES.find((x) => orient(x) !== null) || SCALES[SCALES.length - 1];
  return { scale: s, portrait: !!orient(s), forced: false };
}

// opts: { plan, elev, view3d, scope: 'room'|'project', paper: 'a4'|'a3', scale: 'auto'|number }
export function layoutPages(opts) {
  const rooms = opts.scope === 'project' ? store.project.rooms : [store.project.rooms.find((r) => r.id === store.project.active)];
  const pages = [], notes = [];
  for (const room of rooms) {
    const d = room.design, title = `${store.project.name} · ${room.name}`;
    if (opts.plan) {
      const pts = d.room.pts.map((p) => p);
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y), th = d.room.thickness;
      const ext = (sc) => ({ rw: Math.max(...xs) - Math.min(...xs) + 2 * (th + planPad(sc, opts.dims)), rh: Math.max(...ys) - Math.min(...ys) + 2 * (th + planPad(sc, opts.dims)) });
      // the padding grows with the scale, so try each scale with its own padding
      const fits = (x) => { const e = ext(x); return !pickScale(e.rw, e.rh, opts.paper, String(x)).forced; };
      const want = opts.scale === 'auto' ? null : +opts.scale;
      const pick = SCALES.find((x) => (want ? x >= want : true) && fits(x)) || SCALES[SCALES.length - 1];
      const { rw, rh } = ext(pick);
      const sc = { ...pickScale(rw, rh, opts.paper, String(pick)), ...(want && pick !== want ? { forced: true, wanted: want } : {}) };
      if (sc.forced) notes.push(`${room.name} plan doesn't fit at 1:${sc.wanted} — used 1:${sc.scale}.`);
      const a = area(opts.paper, sc.portrait);
      const img = { kind: 'plan', design: d, scale: sc.scale, dims: !!opts.dims };
      const w = rw / sc.scale, h = rh / sc.scale;
      pages.push({ ...a, title, sub: `Plan · 1:${sc.scale}`, scale: sc.scale, parts: [{ ...img, x: MARGIN + (a.w - w) / 2, y: MARGIN + (a.h - h) / 2, w, h }] });
    }
    if (opts.elev) {
      const walls = wallsOf(d.room.pts).map((_, i) => elevationOf(d, i)).filter(Boolean);
      const sizes = walls.map(elevationSize);
      const maxW = Math.max(...sizes.map((s) => s.w)), maxH = Math.max(...sizes.map((s) => s.h));
      const sc = pickScale(maxW, maxH + 60 * 0, opts.paper, opts.scale);
      if (sc.forced) notes.push(`${room.name} elevations don't fit at 1:${sc.wanted} — used 1:${sc.scale}.`);
      const portrait = false, a = area(opts.paper, portrait), gap = 6, label = 5;
      // shelf packing: left to right, then down; new page when full
      let page = null, x = 0, y = 0, rowH = 0;
      const newPage = () => { page = { ...a, title, sub: `Wall elevations (looking at each wall from inside) · 1:${sc.scale}`, scale: sc.scale, parts: [] }; pages.push(page); x = 0; y = 0; rowH = 0; };
      walls.forEach((el, k) => {
        const w = sizes[k].w / sc.scale, h = sizes[k].h / sc.scale + label;
        if (!page) newPage();
        if (x > 0 && x + w > a.w) { x = 0; y += rowH + gap; rowH = 0; }
        if (y + h > a.h && y > 0) newPage();
        page.parts.push({ kind: 'elev', design: d, wall: el.i, scale: sc.scale, x: MARGIN + x, y: MARGIN + y + label, w, h: h - label, label: `Wall ${el.i + 1} · ${Math.round(el.len)} mm` });
        x += w + gap; rowH = Math.max(rowH, h);
      });
    }
    if (opts.view3d) {
      const a = area(opts.paper, false);
      pages.push({ ...a, title, sub: '3D view · not to scale', scale: null, parts: [{ kind: '3d', design: d, x: MARGIN, y: MARGIN, w: a.w, h: a.h }] });
    }
  }
  pages.forEach((p, i) => { p.n = i + 1; p.of = pages.length; });
  return { pages, notes };
}

// ---- part images (cached per export run)
function partImage(part, cache) {
  const key = part.kind === 'plan' ? `plan:${part.scale}:${part.dims}:${cache.id(part.design)}` : part.kind === 'elev' ? `elev:${part.scale}:${cache.id(part.design)}:${part.wall}` : `3d:${cache.id(part.design)}`;
  if (cache.map.has(key)) return cache.map.get(key);
  let img;
  if (part.kind === 'plan') img = renderPlanCanvas(part.design, PX_PER_MM / part.scale, planPad(part.scale, part.dims), part.dims, PLAN_UI).canvas;
  else if (part.kind === 'elev') img = elevationCanvas(part.design, part.wall, PX_PER_MM / part.scale, PX_PER_MM).canvas;
  else {
    const aspect = part.w / part.h, pw = 1800;
    const url = snapshot3D(part.design, pw, Math.round(pw / aspect));
    img = new Image(); img.src = url; img.__url = url;
  }
  cache.map.set(key, img);
  return img;
}
export function newCache() { const ids = new WeakMap(); let n = 0; return { map: new Map(), id: (o) => { if (!ids.has(o)) ids.set(o, ++n); return ids.get(o); } }; }

// Scale bar length (real mm) giving a 30–60 mm bar on paper.
function barLength(scale) { return [250, 500, 1000, 2000, 5000, 10000].find((L) => L / scale >= 28) || 10000; }

// ---- preview (canvas at k px per paper mm)
export async function drawPagePreview(page, k, cache) {
  const c = document.createElement('canvas'); c.width = Math.round(page.pw * k); c.height = Math.round(page.ph * k);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  for (const part of page.parts) {
    const img = partImage(part, cache);
    if (img instanceof Image && !img.complete) await new Promise((r) => { img.onload = r; img.onerror = r; });
    const fit = fitBox(img, part);
    x.drawImage(img, fit.x * k, fit.y * k, fit.w * k, fit.h * k);
    if (part.label) { x.fillStyle = '#1d232b'; x.font = `600 ${3.2 * k}px -apple-system, sans-serif`; x.textBaseline = 'bottom'; x.fillText(part.label, part.x * k, (part.y - 0.8) * k); }
  }
  drawTitleCanvas(x, page, k);
  return c;
}
// keep the image's aspect inside its box (exact for scaled drawings; the 3D shot is letterboxed)
function fitBox(img, part) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (part.kind !== '3d' || !iw) return part;
  const s = Math.min(part.w / iw, part.h / ih), w = iw * s, h = ih * s;
  return { x: part.x + (part.w - w) / 2, y: part.y + (part.h - h) / 2, w, h };
}
function drawTitleCanvas(x, page, k) {
  const y0 = page.ph - MARGIN - TITLE + 3;
  x.strokeStyle = '#1d232b'; x.lineWidth = Math.max(1, 0.25 * k);
  x.beginPath(); x.moveTo(MARGIN * k, y0 * k); x.lineTo((page.pw - MARGIN) * k, y0 * k); x.stroke();
  x.fillStyle = '#1d232b'; x.textBaseline = 'top';
  x.font = `700 ${4 * k}px -apple-system, sans-serif`; x.fillText(page.title, MARGIN * k, (y0 + 2) * k);
  x.font = `${3 * k}px -apple-system, sans-serif`; x.fillText(`${page.sub} · ${today()}`, MARGIN * k, (y0 + 7.5) * k);
  x.textAlign = 'right'; x.fillText(`Page ${page.n} of ${page.of}`, (page.pw - MARGIN) * k, (y0 + 7.5) * k); x.textAlign = 'left';
  if (page.scale) {
    const L = barLength(page.scale), len = L / page.scale, bx = page.pw - MARGIN - 40 - len, by = y0 + 3, seg = 5;
    for (let i = 0; i < seg; i++) { x.fillStyle = i % 2 ? '#fff' : '#1d232b'; x.fillRect((bx + (len * i) / seg) * k, by * k, (len / seg) * k, 2 * k); }
    x.strokeRect(bx * k, by * k, len * k, 2 * k);
    x.fillStyle = '#1d232b'; x.font = `${2.4 * k}px -apple-system, sans-serif`; x.textAlign = 'center';
    x.fillText('0', bx * k, (by + 2.6) * k); x.fillText(`${L >= 1000 ? L / 1000 + ' m' : L + ' mm'}`, (bx + len) * k, (by + 2.6) * k); x.textAlign = 'left';
  }
}

// ---- PDF
let jsPDFp = null;
function loadJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  return jsPDFp ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = () => res(window.jspdf.jsPDF); s.onerror = () => { jsPDFp = null; rej(new Error("Couldn't load the PDF library")); };
    document.head.appendChild(s);
  });
}
export async function buildPDF(layout) {
  const JsPDF = await loadJsPDF();
  const cache = newCache();
  let doc = null;
  for (const page of layout.pages) {
    const orient = page.pw > page.ph ? 'landscape' : 'portrait', fmt = [Math.min(page.pw, page.ph), Math.max(page.pw, page.ph)];
    if (!doc) doc = new JsPDF({ orientation: orient, unit: 'mm', format: fmt, compress: true });
    else doc.addPage(fmt, orient);
    for (const part of page.parts) {
      const img = partImage(part, cache);
      if (img instanceof Image && !img.complete) await new Promise((r) => { img.onload = r; img.onerror = r; });
      const fit = fitBox(img, part);
      const data = img.__url || img.toDataURL('image/png');
      doc.addImage(data, part.kind === '3d' ? 'JPEG' : 'PNG', fit.x, fit.y, fit.w, fit.h, undefined, 'FAST');
      if (part.label) { doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(29, 35, 43); doc.text(part.label, part.x, part.y - 0.8); }
    }
    // title block + scale bar (vector)
    const y0 = page.ph - MARGIN - TITLE + 3;
    doc.setDrawColor(29, 35, 43); doc.setLineWidth(0.25); doc.line(MARGIN, y0, page.pw - MARGIN, y0);
    doc.setTextColor(29, 35, 43);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(page.title, MARGIN, y0 + 5.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(`${page.sub} · ${today()}`, MARGIN, y0 + 10.5);
    doc.text(`Page ${page.n} of ${page.of}`, page.pw - MARGIN, y0 + 10.5, { align: 'right' });
    if (page.scale) {
      const L = barLength(page.scale), len = L / page.scale, bx = page.pw - MARGIN - 40 - len, by = y0 + 3, seg = 5;
      for (let i = 0; i < seg; i++) { if (i % 2) doc.setFillColor(255, 255, 255); else doc.setFillColor(29, 35, 43); doc.rect(bx + (len * i) / seg, by, len / seg, 2, 'F'); }
      doc.rect(bx, by, len, 2, 'S');
      doc.setFontSize(7); doc.text('0', bx, by + 5, { align: 'center' }); doc.text(L >= 1000 ? `${L / 1000} m` : `${L} mm`, bx + len, by + 5, { align: 'center' });
    }
  }
  return doc;
}
