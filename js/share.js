// Share links: the project is deflate-compressed and base64url-encoded into the URL fragment
// (#p=…). Fragments are never sent to the server, so the design only lives in the link.
const PREFIX = 'p1.';

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

export async function shareUrl(project) {
  const u = new URL(location.href);
  u.hash = 'p=' + (await encodeProject(project));
  return u.toString();
}

export function sharedToken() {
  const m = location.hash.match(/^#p=(.+)$/);
  return m ? m[1] : null;
}
