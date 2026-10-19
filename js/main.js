import { loadCatalog } from './catalog.js';
import { store, on, load, undo, redo, select, itemById, newDesign, replaceDesign, checkpoint, commit, sizeOf, makeProject, asProject, loadProject, switchRoom, addRoom, renameRoom, deleteRoom, activeRoom, viewShared, leaveShared } from './state.js';
import { shareUrl, sharedToken, decodeProject } from './share.js';
import { exportGLB, exportOBJ } from './export3d.js';
import { initPlan, draw, fit, zoom, setTool, drawKey, exportPNG, addModelAt, plan } from './plan2d.js';
import { init3d, rebuildRoom, rebuildItems, updateSelection, onShow, resetCamera, eyeLevel, setCutaway, setCeiling, screenshot } from './view3d.js';
import { initLibrary, renderProps, showBOM, rotateItem, deleteItem, duplicateItem, toast } from './ui.js';
import { ridersOf, applyRiders } from './place.js';
import { TEMPLATES } from './templates.js';

const $ = (s) => document.querySelector(s);

async function main() {
  await loadCatalog();
  let sharedFailed = false;
  const tok = sharedToken();
  if (tok) {
    try { viewShared(asProject(await decodeProject(tok))); } catch (e) { console.error(e); sharedFailed = true; }
  }
  if (!tok || sharedFailed) {
    if (!load()) loadProject(makeProject(TEMPLATES[0].make(), 'My project', 'Ensuite'));
  }
  initLibrary();
  initPlan($('#plan'), $('#hud2d'));
  init3d($('#view3d'), { onDropModel: (id, p, free) => addModelAt(id, p, free) });
  renderProps();

  on((kind) => {
    syncRooms();
    if (kind === 'load') syncReadOnly();
    if (kind === 'rooms') return;
    if (kind === 'live') { rebuildItems(); return; }
    if (kind === 'live-room') { rebuildRoom(); return; }
    if (kind === 'select') { draw(); updateSelection(); renderProps(); return; }
    if (kind === 'tool') { syncTools(); return; }
    if (kind === 'room' || kind === 'load') rebuildRoom();
    rebuildItems();
    draw();
    renderProps();
    syncUndo();
  });
  syncUndo();
  syncRooms();
  syncReadOnly();
  if (sharedFailed) toast("That share link couldn't be opened — it may be incomplete");

  // sharing
  const sm = $('#shareMenu');
  $('#shareBtn').onclick = (e) => { e.stopPropagation(); sm.classList.toggle('open'); };
  document.addEventListener('click', (e) => { if (!sm.contains(e.target)) sm.classList.remove('open'); });
  sm.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-share]'); if (!b) return;
    sm.classList.remove('open');
    const whole = b.dataset.share === 'project';
    const room = activeRoom();
    const p = whole ? store.project : { version: 2, name: store.project.name, rooms: [room], active: room.id };
    const url = await shareUrl(p);
    $('#shareUrl').value = url;
    $('#shareWhat').textContent = whole
      ? `Whole project "${store.project.name}" — ${store.project.rooms.length} room${store.project.rooms.length > 1 ? 's' : ''} · link is ${(url.length / 1024).toFixed(1)} KB`
      : `Room "${room.name}" from "${store.project.name}" · link is ${(url.length / 1024).toFixed(1)} KB`;
    $('#shareDlg').hidden = false;
    $('#shareUrl').select();
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { /* user can press Copy */ }
  });
  $('#shareCopy').onclick = async () => { $('#shareUrl').select(); try { await navigator.clipboard.writeText($('#shareUrl').value); } catch { document.execCommand('copy'); } toast('Link copied'); };
  $('#shareDlg').addEventListener('click', (e) => { if (e.target.matches('[data-close]') || e.target === $('#shareDlg')) $('#shareDlg').hidden = true; });

  const clearHash = () => history.replaceState(null, '', location.pathname + location.search);
  $('#sharedCopy').onclick = () => { leaveShared(true); clearHash(); syncReadOnly(); fit(); resetCamera(); toast('Saved to your projects'); };
  $('#sharedClose').onclick = () => { leaveShared(false); clearHash(); syncReadOnly(); fit(); resetCamera(); };
  window.addEventListener('hashchange', async () => {
    const t = sharedToken(); if (!t) return;
    try { viewShared(asProject(await decodeProject(t))); fit(); resetCamera(); } catch { toast("That share link couldn't be opened"); }
  });

  // rooms
  const rm = $('#roomMenu');
  $('#roomSelect').onchange = (e) => { switchRoom(e.target.value); fit(); resetCamera(); };
  $('#roomBtn').onclick = (e) => { e.stopPropagation(); rm.classList.toggle('open'); };
  document.addEventListener('click', (e) => { if (!rm.contains(e.target)) rm.classList.remove('open'); });
  $('#roomTpl').innerHTML = TEMPLATES.map((t) => `<button data-room="tpl" data-tpl="${t.id}">Add room from template: ${t.name}</button>`).join('');
  rm.addEventListener('click', (e) => {
    const b = e.target.closest('[data-room]'); if (!b) return;
    rm.classList.remove('open');
    const act = b.dataset.room, cur = activeRoom();
    const n = store.project.rooms.length + 1;
    if (act === 'new') { const name = prompt('Name for the new room', `Room ${n}`); if (name) { addRoom(newDesign(), name); fit(); resetCamera(); } }
    if (act === 'tpl') { const t = TEMPLATES.find((x) => x.id === b.dataset.tpl); const name = prompt('Name for the new room', t.name.split(' ')[0]); if (name) { addRoom(t.make(), name); fit(); resetCamera(); } }
    if (act === 'dup') { addRoom(JSON.parse(JSON.stringify(cur.design)), cur.name + ' copy'); toast('Room duplicated'); }
    if (act === 'rename') { const name = prompt('Rename room', cur.name); if (name) renameRoom(cur.id, name.trim()); }
    if (act === 'delete') {
      if (store.project.rooms.length <= 1) { toast('A project needs at least one room'); return; }
      if (confirm(`Delete "${cur.name}"? This can't be undone.`)) { deleteRoom(cur.id); fit(); resetCamera(); }
    }
  });
  $('#projectName').onclick = () => {
    if (store.readOnly) return; const name = prompt('Project name', store.project.name); if (name) { store.project.name = name.trim(); commit('rooms'); } };

  // view mode
  const layout = $('#layout');
  const setMode = (m) => {
    layout.className = 'mode-' + m;
    document.querySelectorAll('#viewMode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    try { localStorage.setItem('bathroom-designer:mode', m); } catch { /* ignore */ }
    requestAnimationFrame(() => { onShow(); draw(); });
  };
  $('#viewMode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
  let mode = 'split';
  try { mode = localStorage.getItem('bathroom-designer:mode') || 'split'; } catch { /* ignore */ }
  setMode(mode);

  // tools
  const tools = { toolSelect: 'select', toolMeasure: 'measure', toolDraw: 'draw' };
  for (const [id, t] of Object.entries(tools)) $('#' + id).addEventListener('click', () => { setTool(plan.tool === t && t !== 'select' ? 'select' : t); syncTools(); if (t === 'draw' && plan.tool === 'draw') toast('Click corners to draw the room · type lengths + Enter for exact walls'); });
  function syncTools() { for (const [id, t] of Object.entries(tools)) $('#' + id).classList.toggle('on', plan.tool === t); }

  $('#zoomFit').onclick = () => fit();
  $('#zoomIn').onclick = () => zoom(1.25);
  $('#zoomOut').onclick = () => zoom(0.8);
  $('#undoBtn').onclick = undo;
  $('#redoBtn').onclick = redo;
  $('#bomBtn').onclick = showBOM;
  $('#bom').addEventListener('click', (e) => { if (e.target.matches('[data-close]') || e.target === $('#bom')) $('#bom').hidden = true; });
  $('#cutaway').onchange = (e) => setCutaway(e.target.checked);
  $('#showCeiling').onchange = (e) => setCeiling(e.target.checked);
  $('#cam3dReset').onclick = resetCamera;
  $('#camEye').onclick = eyeLevel;

  // file menu
  const fm = $('#fileMenu');
  $('#fileBtn').onclick = (e) => { e.stopPropagation(); fm.classList.toggle('open'); };
  document.addEventListener('click', (e) => { if (!fm.contains(e.target)) fm.classList.remove('open'); });
  $('#newBtn').onclick = () => {
    fm.classList.remove('open');
    if (!confirm('Start a new project? Save the current one first if you want to keep it.')) return;
    const name = prompt('Project name', 'My project') || 'My project';
    loadProject(makeProject(newDesign(), name, 'Bathroom')); fit(); resetCamera();
  };
  const base = () => `${slug(store.project.name)}-${slug(activeRoom().name)}`;
  $('#glbBtn').onclick = async () => { fm.classList.remove('open'); toast('Exporting 3D model…'); try { await exportGLB(base(), { ceiling: $('#expCeiling').checked }); toast('Exported .glb'); } catch (e) { console.error(e); toast('Export failed — see console'); } };
  $('#objBtn').onclick = () => { fm.classList.remove('open'); try { exportOBJ(base(), { ceiling: $('#expCeiling').checked }); toast('Exported .obj + .mtl'); } catch (e) { console.error(e); toast('Export failed — see console'); } };
  $('#expCeiling').onclick = (e) => e.stopPropagation();
  $('#tplMenu').innerHTML = TEMPLATES.map((t) => `<button data-tpl="${t.id}">Replace with template: ${t.name}</button>`).join('');
  $('#tplMenu').onclick = (e) => {
    const b = e.target.closest('[data-tpl]'); if (!b) return;
    replaceDesign(TEMPLATES.find((t) => t.id === b.dataset.tpl).make()); fit(); resetCamera(); fm.classList.remove('open'); toast('Template loaded — Undo to go back');
  };
  $('#saveBtn').onclick = () => { download(slug(store.project.name) + '.json', 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(store.project, null, 1))); fm.classList.remove('open'); };
  $('#openInput').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const p = asProject(JSON.parse(await f.text()), f.name.replace(/\.json$/i, '')); if (!p) throw new Error('bad'); loadProject(p); fit(); resetCamera(); toast(`Opened ${p.rooms.length} room${p.rooms.length > 1 ? 's' : ''}`); }
    catch { toast('That file is not a bathroom design'); }
    e.target.value = ''; fm.classList.remove('open');
  };
  $('#pngBtn').onclick = () => { download(base() + '-plan.png', exportPNG()); fm.classList.remove('open'); };
  $('#shotBtn').onclick = () => {
    if (layout.className === 'mode-2d') setMode('split');
    requestAnimationFrame(() => { download(base() + '-3d.png', screenshot()); });
    fm.classList.remove('open');
  };

  // keyboard
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea')) return;
    if (store.readOnly && !['Escape', 'f', 'F', 'v', 'V', 'm', 'M'].includes(e.key) && e.code !== 'Space') return;
    if (e.code === 'Space') { plan.spaceDown = true; }
    if (drawKey(e)) { e.preventDefault(); return; }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    const it = store.sel?.type === 'item' ? itemById(store.sel.id) : null;
    if (mod && e.key.toLowerCase() === 'd' && it) { e.preventDefault(); duplicateItem(it); return; }
    if (e.key === 'Escape') { if (plan.tool !== 'select') { setTool('select'); syncTools(); } else select(null); return; }
    if (e.key === 'v' || e.key === 'V') { setTool('select'); syncTools(); }
    if (e.key === 'm' || e.key === 'M') { setTool('measure'); syncTools(); }
    if (e.key === 'f' || e.key === 'F') fit();
    if (!it) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && store.sel?.type === 'opening') {
        checkpoint(); store.d.openings = store.d.openings.filter((o) => o.id !== store.sel.id); store.sel = null; commit('room');
      }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteItem(it); }
    if (e.key === 'r' || e.key === 'R') rotateItem(it, e.shiftKey ? -90 : 90);
    const step = e.shiftKey ? 1 : 10;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[e.key]) {
      e.preventDefault();
      checkpoint();
      const r = ridersOf(it);
      it.x += arrows[e.key][0]; it.y += arrows[e.key][1];
      applyRiders(it, r);
      commit('items');
    }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') plan.spaceDown = false; });
}

// Shared (view-only) mode: banner, and hide anything that edits or saves.
const RO_HIDE = ['#undoBtn', '#redoBtn', '#roomBtn', '#toolDraw', '#newBtn', '#saveBtn', '#tplMenu'];
function syncReadOnly() {
  const ro = store.readOnly;
  document.body.classList.toggle('readonly', ro);
  document.body.classList.toggle('shared', ro);
  $('#sharedBar').hidden = !ro;
  for (const s of RO_HIDE) $(s)?.classList.toggle('ro-hide', ro);
  $('#openInput')?.closest('label')?.classList.toggle('ro-hide', ro);
  window.dispatchEvent(new Event('resize'));
}

function syncRooms() {
  const sel = $('#roomSelect');
  const rooms = store.project.rooms;
  const html = rooms.map((r) => `<option value="${r.id}">${r.name.replace(/</g, '&lt;')}</option>`).join('');
  if (sel.innerHTML !== html) sel.innerHTML = html;
  sel.value = store.project.active;
  $('#projectName').textContent = store.project.name;
  document.title = `${activeRoom().name} · ${store.project.name} — Bathroom Designer`;
}
const slug = (s) => String(s || 'design').trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'design';

function syncUndo() {
  $('#undoBtn').disabled = !store.undo.length;
  $('#redoBtn').disabled = !store.redo.length;
}

function download(name, href) {
  const a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

main().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:60px;left:20px;background:#fff;padding:10px;border:1px solid #c00;z-index:999">${e.stack || e}</pre>`); });
