// Share links: the project is deflate-compressed and base64url-encoded (a "p1.…" token).
//  - short links (#s=<key>): the token is stored by the share Worker (worker/) under a key
//  - long links  (#p=<token>): the token itself is in the URL fragment — used when the Worker can't be reached
const PREFIX = 'p1.';
// Short-link Worker. Set to '' to always make long links. For local testing with `wrangler dev`, run
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

// Returns { url, short } — short is false when it fell back to a long link.
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
