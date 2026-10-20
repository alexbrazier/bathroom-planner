// Share links: the project is deflate-compressed and base64url-encoded (a "p1.…" token).
//  - short links (#s=<key>): the token is stored by the share Worker (worker/) under a key
//  - long links  (#p=<token>): the token itself is in the URL fragment — used when the Worker can't be reached
const PREFIX = 'p1.';
// Short-link Worker (live links + snapshots). Set to '' to always make long links. For local testing with `wrangler dev`, run
// localStorage.setItem('bathroom-designer:shortApi', 'http://localhost:8787') in the console.
const SHORT_API_DEFAULT = 'https://bathroom-designer-share.aejbrazier.workers.dev';
const shortApi = () => { try { return localStorage.getItem('bathroom-designer:shortApi') ?? SHORT_API_DEFAULT; } catch { return SHORT_API_DEFAULT; } };

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
function toB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

// Keep links short: round coordinates and drop nothing the viewer needs.
function compact(project) {
  return JSON.parse(JSON.stringify(project, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 10) / 10 : v)));
}

export async function encodeProject(project) {
  const json = JSON.stringify(compact(project));
  const bytes = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return PREFIX + toB64url(bytes);
}

export async function decodeProject(token) {
  if (!token.startsWith(PREFIX)) throw new Error('Unknown share link version');
  const bytes = await pipe(fromB64url(token.slice(PREFIX.length)), new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Snapshot link (never changes). Returns { url, short } — short is false when it fell back to a long link.
export async function shareUrl(project) {
  const token = await encodeProject(project);
  const u = new URL(location.href);
  const api = shortApi();
  if (api) {
    try {
      // text/plain keeps this a "simple" CORS request (no preflight)
      const r = await fetch(api.replace(/\/$/, '') + '/', { method: 'POST', body: token, headers: { 'Content-Type': 'text/plain' }, signal: AbortSignal.timeout(6000) });
      if (r.ok) {
        const { key } = await r.json();
        if (key) { u.hash = 's=' + key; return { url: u.toString(), short: true }; }
      }
    } catch (e) { console.warn('Short link failed, using a long link', e); }
  }
  u.hash = 'p=' + token;
  return { url: u.toString(), short: false };
}

// ---- live links: a fixed short link whose design can be replaced by whoever has its edit key.
// The edit keys you hold are kept in this browser only: { [key]: { edit, rooms: [roomId…], name, updated } }.
const LINKS_KEY = 'bathroom-designer:links';
export function liveLinks() { try { return JSON.parse(localStorage.getItem(LINKS_KEY) || '{}'); } catch { return {}; } }
function saveLinks(all) { try { localStorage.setItem(LINKS_KEY, JSON.stringify(all)); } catch { /* storage unavailable */ } }
export function rememberLink(key, rec) { const all = liveLinks(); all[key] = { ...(all[key] || {}), ...rec }; saveLinks(all); }
export function forgetLink(key) { const all = liveLinks(); delete all[key]; saveLinks(all); }
// The live link that publishes exactly this set of rooms, if you have one.
export function linkFor(roomIds) {
  const want = [...roomIds].sort().join(',');
  return Object.entries(liveLinks()).map(([key, r]) => ({ key, ...r })).find((r) => [...(r.rooms || [])].sort().join(',') === want) || null;
}
const api = () => (shortApi() || '').replace(/\/$/, '');
const urlFor = (key) => { const u = new URL(location.href); u.hash = 's=' + key; return u.toString(); };

// Create a live link, or update the existing one for these rooms. Returns { url, key, edit, updated, created }.
// Throws if the share server can't be reached (callers fall back to shareUrl()).
export async function publishLive(project, roomIds, name) {
  if (!api()) throw new Error('Short links are not set up');
  const token = await encodeProject(project);
  const rec = linkFor(roomIds);
  if (rec) {
    const r = await fetch(`${api()}/${rec.key}`, { method: 'PUT', body: token, headers: { 'Content-Type': 'text/plain', 'X-Edit-Key': rec.edit }, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const { updated } = await r.json();
      rememberLink(rec.key, { updated, name });
      return { url: urlFor(rec.key), key: rec.key, edit: rec.edit, updated, created: false };
    }
    // the link is gone or the key no longer matches: make a fresh one
    if (r.status === 403 || r.status === 404 || r.status === 409) forgetLink(rec.key);
    else throw new Error(`Share server error ${r.status}`);
  }
  const r = await fetch(`${api()}/live`, { method: 'POST', body: token, headers: { 'Content-Type': 'text/plain' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Share server error ${r.status}`);
  const { key, edit, updated } = await r.json();
  rememberLink(key, { edit, rooms: [...roomIds], name, updated });
  return { url: urlFor(key), key, edit, updated, created: true };
}

// Check an edit key for a live link (true / false); throws if the server can't be reached.
export async function checkEditKey(key, edit) {
  const r = await fetch(`${api()}/${key}/check`, { method: 'POST', headers: { 'X-Edit-Key': edit }, signal: AbortSignal.timeout(8000) });
  if (r.ok) return true;
  if (r.status === 403) return false;
  const msg = r.status === 409 ? 'That link is a snapshot and can\'t be updated' : r.status === 404 ? 'That link no longer exists' : `Share server error ${r.status}`;
  throw new Error(msg);
}

// The share link in the current URL, if any: { kind: 'p', token } or { kind: 's', key }.
export function sharedToken() {
  const m = location.hash.match(/^#([ps])=(.+)$/);
  if (!m) return null;
  return m[1] === 'p' ? { kind: 'p', token: m[2] } : { kind: 's', key: m[2] };
}

// Fetch (for short links) and decode a shared project.
export async function resolveShared(ref) {
  if (ref.kind === 'p') return decodeProject(ref.token);
  const api = shortApi() || SHORT_API_DEFAULT;
  if (!api) throw new Error('Short links are not set up');
  const r = await fetch(api.replace(/\/$/, '') + '/' + encodeURIComponent(ref.key), { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(r.status === 404 ? 'That share link has expired or does not exist' : `Share server error ${r.status}`);
  return decodeProject((await r.text()).trim());
}
