// Short share links for the bathroom designer.
//   POST /        body: the share token ("p1.…", the compressed project) → { key }
//   GET  /<key>   → the token (text/plain)
// Keys are derived from a hash of the token, so sharing the same design twice gives the same link and
// nothing is stored twice. Only pages on ALLOWED_ORIGINS can create links; anyone with a key can read it.
const MAX_BYTES = 1024 * 1024; // KV values can be up to 25 MB; designs are a few KB
const KEY_LEN = 8;
const KEY_RE = /^[0-9A-Za-z]{6,16}$/;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const reply = (body, status = 200, headers = {}) => new Response(body, { status, headers: { ...cors, ...headers } });
    const json = (obj, status = 200) => reply(JSON.stringify(obj), status, { 'Content-Type': 'application/json' });

    if (req.method === 'OPTIONS') return reply(null, 204);

    if (req.method === 'POST' && url.pathname === '/') {
      if (!okOrigin) return json({ error: 'origin not allowed' }, 403);
      const len = Number(req.headers.get('Content-Length') || 0);
      if (len > MAX_BYTES) return json({ error: 'too large' }, 413);
      const token = (await req.text()).trim();
      if (token.length > MAX_BYTES) return json({ error: 'too large' }, 413);
      if (!/^p1\.[0-9A-Za-z_-]+$/.test(token)) return json({ error: 'not a share token' }, 400);
      const key = await keyFor(token);
      const ttl = Number(env.EXPIRE_DAYS || 0);
      if (!(await env.SHARES.get(key))) await env.SHARES.put(key, token, ttl > 0 ? { expirationTtl: ttl * 86400 } : undefined);
      return json({ key });
    }

    const key = url.pathname.slice(1);
    if (req.method === 'GET' && KEY_RE.test(key)) {
      const token = await env.SHARES.get(key);
      if (!token) return json({ error: 'not found' }, 404);
      // content-addressed, so a key always means the same design
      return reply(token, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' });
    }

    if (req.method === 'GET' && url.pathname === '/') return reply('Bathroom designer share links', 200, { 'Content-Type': 'text/plain' });
    return json({ error: 'not found' }, 404);
  },
};

// First KEY_LEN base62 digits of SHA-256(token): 62^8 ≈ 2·10^14 keys.
async function keyFor(token) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  let n = 0n;
  for (const b of h.subarray(0, 12)) n = (n << 8n) | BigInt(b);
  let s = '';
  for (let i = 0; i < KEY_LEN; i++) { s += ALPHABET[Number(n % 62n)]; n /= 62n; }
  return s;
}
