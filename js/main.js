import { loadCatalog } from './catalog.js';
import { store, on, load, undo, redo, select, itemById, newDesign, replaceDesign, checkpoint, commit, sizeOf, makeProject, asProject, loadProject, switchRoom, addRoom, renameRoom, deleteRoom, activeRoom, viewShared, leaveShared, listProjects, switchProject, renameProject, duplicateProject, deleteProject, moveRoom } from './state.js';
import { shareUrl, sharedToken, resolveShared, publishLive, linkFor, forgetLink, checkEditKey, rememberLink, liveLinks } from './share.js';
import { exportGLB, exportOBJ } from './export3d.js';
import { initPlan, draw, fit, zoom, setTool, drawKey, exportPNG, addModelAt, plan } from './plan2d.js';
import { enterVR, vrSupported } from './vr.js';
import { init3d, rebuildRoom, rebuildItems, updateSelection, onShow, resetCamera, eyeLevel, setCutaway, setCeiling, setReflections, screenshot } from './view3d.js';
import { reflectionsOn } from './mirrors.js';
import { initLibrary, renderLibrary, renderProps, showBOM, rotateItem, deleteItem, duplicateItem, copyItem, pasteClip, hasClip, toast } from './ui.js';
import { ridersOf, applyRiders } from './place.js';
import { initOverlays } from './overlays.js';
import { TEMPLATES } from './templates.js';

const $ = (s) => document.querySelector(s);
const isPhone = () => window.matchMedia('(max-width: 820px)').matches;

async function main() {
  await loadCatalog();
  let sharedFailed = false;
  const tok = sharedToken();
  if (tok) {
    try { viewShared(asProject(await resolveShared(tok))); } catch (e) { console.error(e); sharedFailed = e.message || true; }
  }
  if (!tok || sharedFailed) {
    if (!load()) loadProject(makeProject(TEMPLATES[0].make(), 'My project', 'Ensuite'));
  }
  initLibrary();
  initPlan($('#plan'), $('#hud2d'));
  initOverlays($('#view2d'));
  plan.onNotice = (msg) => toast(msg);
  init3d($('#view3d'), { onDropModel: (id, p, free) => addModelAt(id, p, free) });
  renderProps();

  on((kind) => {
    syncRooms();
    if (kind === 'load') syncReadOnly();
    if (kind === 'rooms') return;
    if (kind === 'live') { rebuildItems(); return; }
    if (kind === 'live-room') { rebuildRoom(); return; }
    $('#propsToggle').classList.toggle('has-sel', !!store.sel);
    if (kind === 'select') { draw(); updateSelection(); renderProps(); return; }
    if (kind === 'tool') { syncTools(); return; }
    if (kind === 'room' || kind === 'load') rebuildRoom();
    if (kind !== 'select' && kind !== 'tool') renderLibrary(); // "used in project" badges
    rebuildItems();
    draw();
    renderProps();
    syncUndo();
  });
  syncUndo();
  syncRooms();
  syncReadOnly();
  if (sharedFailed) toast(typeof sharedFailed === 'string' && /expired|not exist|server|not set up/.test(sharedFailed) ? sharedFailed : "That share link couldn't be opened — it may be incomplete");

  // sharing
  const sm = $('#shareMenu');
  $('#shareBtn').onclick = (e) => { e.stopPropagation(); sm.classList.toggle('open'); };
  document.addEventListener('click', (e) => { if (!sm.contains(e.target)) sm.classList.remove('open'); });
  // Share = a live link: sharing the same rooms again updates it (you keep its edit key in this browser).
  let shareCtx = null;
  const showLink = async (url) => {
    $('#shareUrl').value = url; $('#shareUrl').select();
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { /* user can press Copy */ }
  };
  const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(t).toLocaleString(); };
  const doShare = async (mode = 'live') => {
    const { p, roomIds, label, name } = shareCtx;
    $('#shareDlg').hidden = false;
    $('#shareUrl').value = 'Making link…'; $('#shareStatus').textContent = '';
    $('#shareKeyBox').hidden = true; $('#shareNew').hidden = true;
    $('#shareWhat').textContent = label;
    if (mode === 'live') {
      try {
        const r = await publishLive(p, roomIds, name);
        $('#shareStatus').innerHTML = `<b>Live link</b> — ${r.created ? 'created' : 'updated with your latest changes'} ${ago(r.updated)}. Share these rooms again any time to update what it shows (it can take up to a minute to reach everyone).`;
        $('#shareKey').value = r.edit; $('#shareKeyBox').hidden = false; $('#shareNew').hidden = r.created;
        return showLink(r.url);
      } catch (err) {
        console.warn('Live link failed', err);
        $('#shareStatus').textContent = "Couldn't reach the share server, so this is a snapshot link instead.";
      }
    }
    const { url, short } = await shareUrl(p);
    if (mode !== 'live') $('#shareStatus').textContent = short ? 'Frozen snapshot — this link always shows the design as it is now.' : `Snapshot with the design inside the link (${(url.length / 1024).toFixed(1)} KB).`;
    return showLink(url);
  };
  sm.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-share]'); if (!b) return;
    sm.classList.remove('open');
    const whole = b.dataset.share === 'project';
    const room = activeRoom();
    const rooms = whole ? store.project.rooms : [room];
    shareCtx = {
      p: whole ? store.project : { version: 2, name: store.project.name, rooms: [room], active: room.id },
      roomIds: rooms.map((r) => r.id),
      name: whole ? store.project.name : room.name,
      label: whole ? `Whole project "${store.project.name}" — ${rooms.length} room${rooms.length > 1 ? 's' : ''}` : `Room "${room.name}" from "${store.project.name}"`,
    };
    doShare('live');
  });
  $('#shareSnapshot').onclick = () => shareCtx && doShare('snapshot');
  $('#shareNew').onclick = () => {
    if (!shareCtx) return;
    const rec = linkFor(shareCtx.roomIds);
    if (rec && !confirm('Make a brand-new live link? The current link keeps showing the design as it was last shared, and you won\'t be able to update it any more.')) return;
    if (rec) forgetLink(rec.key);
    doShare('live');
  };
  $('#shareKeyCopy').onclick = async () => { $('#shareKey').select(); try { await navigator.clipboard.writeText($('#shareKey').value); } catch { document.execCommand('copy'); } toast('Edit key copied — keep it private'); };
  $('#shareCopy').onclick = async () => { $('#shareUrl').select(); try { await navigator.clipboard.writeText($('#shareUrl').value); } catch { document.execCommand('copy'); } toast('Link copied'); };
  $('#shareDlg').addEventListener('click', (e) => { if (e.target.matches('[data-close]') || e.target === $('#shareDlg')) $('#shareDlg').hidden = true; });

  const clearHash = () => history.replaceState(null, '', location.pathname + location.search);
  // Opening someone's live link with its edit key: the saved copy stays linked, so sharing it updates the same link.
  let claim = null;
  $('#sharedClaim').onclick = async () => {
    const t = sharedToken(); if (t?.kind !== 's') return;
    const edit = (prompt('Paste the edit key for this link') || '').trim(); if (!edit) return;
    try {
      if (!(await checkEditKey(t.key, edit))) { toast("That edit key doesn't match this link"); return; }
      claim = { key: t.key, edit };
      $('#sharedClaim').textContent = '✓ Edit key added'; $('#sharedClaim').disabled = true;
      toast('Edit key accepted — now Save a copy to edit and update this link');
    } catch (err) { toast(err.message || "Couldn't check the key"); }
  };
  const saveShared = (how) => {
    const name = store.project.rooms.length > 1 ? store.project.name : store.project.rooms[0]?.name;
    const t = sharedToken();
    const ids = leaveShared(how);
    if (claim && claim.key === t?.key) { rememberLink(claim.key, { edit: claim.edit, rooms: ids, name, updated: Date.now() }); toast('Saved — sharing these rooms will update the original link'); claim = null; }
    else toast(how === 'new' ? `Saved as a new project "${store.project.name}"` : 'Added to your project');
    clearHash(); syncReadOnly(); fit(); resetCamera();
  };
  $('#sharedCopy').onclick = () => saveShared('merge');
  $('#sharedNew').onclick = () => saveShared('new');
  $('#sharedClose').onclick = () => { leaveShared(false); clearHash(); syncReadOnly(); fit(); resetCamera(); };
  window.addEventListener('hashchange', async () => {
    const t = sharedToken(); if (!t) return;
    try { viewShared(asProject(await resolveShared(t))); fit(); resetCamera(); } catch (e) { toast(e.message && !/JSON|Unexpected/.test(e.message) ? e.message : "That share link couldn't be opened"); }
  });

  // rooms
  const rm = $('#roomMenu');
  $('#roomSelect').onchange = (e) => { switchRoom(e.target.value); fit(); resetCamera(); };
  $('#roomBtn').onclick = (e) => { e.stopPropagation(); renderRoomMove(); rm.classList.toggle('open'); };
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
  // projects: switch, add, rename, duplicate, delete
  const pm = $('#projMenu');
  const projList = () => listProjects().slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const renderProjMenu = () => {
    const cur = store.project.id;
    pm.innerHTML = `<div class="menu-sep">Projects</div>`
      + projList().map((p) => `<button data-proj="${p.id}" class="${p.id === cur ? 'on' : ''}">${p.id === cur ? '✓ ' : ''}${esc(p.name)} <span class="muted">· ${p.rooms} room${p.rooms === 1 ? '' : 's'}</span></button>`).join('')
      + `<div class="menu-sep">This project</div>
        <button data-pact="new">New project…</button>
        <button data-pact="rename">Rename project…</button>
        <button data-pact="dup">Duplicate project</button>
        <button data-pact="delete" class="danger">Delete project…</button>`;
  };
  $('#projBtn').onclick = (e) => { e.stopPropagation(); if (store.readOnly) return; renderProjMenu(); pm.classList.toggle('open'); };
  document.addEventListener('click', (e) => { if (!pm.contains(e.target)) pm.classList.remove('open'); });
  pm.addEventListener('click', (e) => {
    const b = e.target.closest('[data-proj], [data-pact]'); if (!b) return;
    pm.classList.remove('open');
    const done = () => { fit(); resetCamera(); };
    if (b.dataset.proj) { if (switchProject(b.dataset.proj)) { done(); toast(`Opened "${store.project.name}"`); } return; }
    const act = b.dataset.pact;
    if (act === 'new') { const name = prompt('Name for the new project', 'New project'); if (name) { loadProject(makeProject(newDesign(), name.trim(), 'Bathroom')); done(); } }
    if (act === 'rename') { const name = prompt('Project name', store.project.name); if (name) renameProject(name.trim()); }
    if (act === 'dup') { duplicateProject(); done(); toast('Project duplicated'); }
    if (act === 'delete' && confirm(`Delete the project "${store.project.name}" and all ${store.project.rooms.length} of its rooms? This can't be undone.`)) { const n = store.project.name; deleteProject(); done(); toast(`Deleted "${n}"`); }
  });
  // rooms: move / copy the current room to another project
  const renderRoomMove = () => {
    const others = projList().filter((p) => p.id !== store.project.id);
    const many = store.project.rooms.length > 1;
    $('#roomMove').innerHTML = `<div class="menu-sep">Move this room to</div>`
      + (many ? others.map((p) => `<button data-mv="${p.id}">${esc(p.name)}</button>`).join('') + `<button data-mv="new">A new project…</button>` : `<div class="menu-note">Add another room first — a project needs at least one</div>`)
      + `<div class="menu-sep">Copy this room to</div>`
      + others.map((p) => `<button data-cp="${p.id}">${esc(p.name)}</button>`).join('') + `<button data-cp="new">A new project…</button>`;
  };
  $('#roomMove').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mv], [data-cp]'); if (!b) return;
    rm.classList.remove('open');
    const copy = !!b.dataset.cp, target = b.dataset.mv || b.dataset.cp, room = activeRoom();
    let newName;
    if (target === 'new') { newName = prompt('Name for the new project', room.name); if (!newName) return; }
    const id = moveRoom(room.id, target === 'new' ? null : target, { copy, newName: newName?.trim() });
    if (!id) { toast("Couldn't move that room"); return; }
    const where = target === 'new' ? newName.trim() : listProjects().find((p) => p.id === id)?.name;
    if (copy) toast(`Copied "${room.name}" to "${where}"`);
    else { fit(); resetCamera(); toast(`Moved "${room.name}" to "${where}"`); }
  });

  // view mode
  const layout = $('#layout');
  const modeKey = () => (isPhone() ? 'bathroom-designer:mode:phone' : 'bathroom-designer:mode');
  const setMode = (m) => {
    layout.className = 'mode-' + m;
    document.querySelectorAll('#viewMode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    try { localStorage.setItem(modeKey(), m); } catch { /* ignore */ }
    requestAnimationFrame(() => { onShow(); draw(); });
  };
  $('#viewMode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
  // phones default to 3D; desktop to split
  let mode = isPhone() ? '3d' : 'split';
  try { mode = localStorage.getItem(modeKey()) || mode; } catch { /* ignore */ }
  setMode(mode);
  requestAnimationFrame(() => requestAnimationFrame(() => { fit(); resetCamera(); }));

  // phones: menus are pinned (the bar rows scroll sideways), so open them just below their button
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.menu > button');
    if (b && isPhone()) document.documentElement.style.setProperty('--menu-top', Math.round(b.getBoundingClientRect().bottom + 4) + 'px');
  }, true);

  // side panels: collapsible columns on desktop, slide-in drawers on phones
  const panels = { lib: $('#libToggle'), props: $('#propsToggle') };
  try { for (const k of ['lib', 'props']) document.body.classList.toggle('hide-' + k, localStorage.getItem('bathroom-designer:hide-' + k) === '1'); } catch { /* ignore */ }
  const panelOpen = (k) => (isPhone() ? document.body.classList.contains('show-' + k) : !document.body.classList.contains('hide-' + k));
  const syncPanels = () => { for (const k in panels) panels[k].classList.toggle('on', panelOpen(k)); };
  const togglePanel = (k, force) => {
    if (isPhone()) {
      const open = force ?? !document.body.classList.contains('show-' + k);
      document.body.classList.remove('show-lib', 'show-props');
      document.body.classList.toggle('show-' + k, open);
    } else {
      const hide = force === undefined ? !document.body.classList.contains('hide-' + k) : !force;
      document.body.classList.toggle('hide-' + k, hide);
      try { localStorage.setItem('bathroom-designer:hide-' + k, hide ? '1' : '0'); } catch { /* ignore */ }
      requestAnimationFrame(() => { onShow(); draw(); });
    }
    syncPanels();
  };
  panels.lib.onclick = () => togglePanel('lib');
  panels.props.onclick = () => togglePanel('props');
  $('#drawerShade').onclick = () => { document.body.classList.remove('show-lib', 'show-props'); syncPanels(); };
  // after adding a product on a phone, close the drawer so you can see it
  $('#libList').addEventListener('click', (e) => { if (isPhone() && e.target.closest('.card')) setTimeout(() => togglePanel('lib', false), 150); });
  window.matchMedia('(max-width: 820px)').addEventListener('change', () => { document.body.classList.remove('show-lib', 'show-props'); syncPanels(); requestAnimationFrame(() => { onShow(); draw(); }); });
  syncPanels();
  window.__togglePanel = togglePanel;

  // tools
  const tools = { toolSelect: 'select', toolRoom: 'room', toolMeasure: 'measure', toolDraw: 'draw' };
  // Edit room / Measure / Draw room work on the 2D plan: from 3D-only, switch to Split so you can see them.
  const useTool = (t) => {
    const next = plan.tool === t && t !== 'select' ? (t === 'draw' ? 'room' : 'select') : t;
    if (next !== 'select' && layout.classList.contains('mode-3d')) setMode('split');
    setTool(next); syncTools();
  };
  for (const [id, t] of Object.entries(tools)) $('#' + id).addEventListener('click', () => useTool(t));
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
  $('#reflections').checked = reflectionsOn();
  $('#reflections').onchange = (e) => setReflections(e.target.checked);
  $('#cam3dReset').onclick = resetCamera;
  $('#camEye').onclick = eyeLevel;
  vrSupported().then((ok) => { $('#enterVR').hidden = !ok; });
  $('#enterVR').onclick = () => enterVR().catch((err) => toast(`Couldn't start VR: ${err.message || err}`));

  // file menu
  const fm = $('#fileMenu');
  $('#fileBtn').onclick = (e) => { e.stopPropagation(); fm.classList.toggle('open'); };
  document.addEventListener('click', (e) => { if (!fm.contains(e.target)) fm.classList.remove('open'); });
  $('#newBtn').onclick = () => {
    fm.classList.remove('open');
    const name = prompt('Name for the new project (your current one stays in Projects)', 'New project'); if (!name) return;
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
    try { const p = asProject(JSON.parse(await f.text()), f.name.replace(/\.json$/i, '')); if (!p) throw new Error('bad'); loadProject(p); fit(); resetCamera(); toast(`Opened as a new project: ${p.rooms.length} room${p.rooms.length > 1 ? 's' : ''}`); }
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
    if (store.readOnly && !['Escape', 'f', 'F', 'v', 'V', 'm', 'M', 'e', 'E'].includes(e.key) && e.code !== 'Space') return;
    if (e.code === 'Space') { plan.spaceDown = true; }
    if (drawKey(e)) { e.preventDefault(); return; }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    const it = store.sel?.type === 'item' ? itemById(store.sel.id) : null;
    if (mod && e.key.toLowerCase() === 'd' && it) { e.preventDefault(); duplicateItem(it); return; }
    if (mod && e.key.toLowerCase() === 'c' && it) { e.preventDefault(); copyItem(it); return; }
    if (mod && e.key.toLowerCase() === 'v') { if (hasClip()) { e.preventDefault(); pasteClip(); } return; }
    if (e.key === 'Escape' && document.body.matches('.show-lib, .show-props')) { document.body.classList.remove('show-lib', 'show-props'); return; }
    if (e.key === 'Escape') { if (store.sel) select(null); else if (plan.tool !== 'select') useTool('select'); return; }
    if (e.key === 'v' || e.key === 'V') useTool('select');
    if (e.key === 'e' || e.key === 'E') useTool(plan.tool === 'room' ? 'select' : 'room');
    if (e.key === 'm' || e.key === 'M') useTool('measure');
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
const RO_HIDE = ['#undoBtn', '#redoBtn', '#roomBtn', '#projBtn', '#toolDraw', '#newBtn', '#saveBtn', '#tplMenu'];
function syncReadOnly() {
  const ro = store.readOnly;
  document.body.classList.toggle('readonly', ro);
  document.body.classList.toggle('shared', ro);
  $('#sharedBar').hidden = !ro;
  // "I have the edit key" only for live short links you don't already hold the key for
  const t = sharedToken();
  $('#sharedClaim').hidden = !ro || t?.kind !== 's' || !!liveLinks()[t.key];
  $('#sharedClaim').disabled = false; $('#sharedClaim').textContent = 'I have the edit key';
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
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slug = (s) => String(s || 'design').trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'design';

function syncUndo() {
  $('#undoBtn').disabled = !store.undo.length;
  $('#redoBtn').disabled = !store.redo.length;
}

function download(name, href) {
  const a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

main().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:60px;left:20px;background:#fff;padding:10px;border:1px solid #c00;z-index:999">${e.stack || e}</pre>`); });
