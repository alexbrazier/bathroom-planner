// Short share links for the bathroom designer.
//   POST /             body: share token ("p1.…") → { key }            snapshot link (key = hash of the design)
//   POST /live         body: share token          → { key, edit }      live link that can be updated later
//   PUT  /<key>        body: share token, header X-Edit-Key            replace a live link's design
//   POST /<key>/check  header X-Edit-Key → 200 if the key is right     (lets another device claim a link)
//   GET  /<key>        → the token (text/plain)
// Snapshot keys are derived from a hash of the token, so the same design always gives the same link. Live links have
// a random key and a random edit key; only a SHA-256 of the edit key is stored (as KV metadata). Only pages on
// ALLOWED_ORIGINS can create or update links; anyone with a key can read it.
const MAX_BYTES = 1024 * 1024; // KV values can be up to 25 MB; designs are a few KB
const KEY_LEN = 8;
const KEY_RE = /^[0-9A-Za-z]{6,16}$/;
const TOKEN_RE = /^p1\.[0-9A-Za-z_-]+$/;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Edit-Key',
      'Access-Control-Expose-Headers': 'X-Updated',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const reply = (body, status = 200, headers = {}) => new Response(body, { status, headers: { ...cors, ...headers } });
    const json = (obj, status = 200) => reply(JSON.stringify(obj), status, { 'Content-Type': 'application/json' });
    const readToken = async () => {
      if (Number(req.headers.get('Content-Length') || 0) > MAX_BYTES) return { error: json({ error: 'too large' }, 413) };
      const token = (await req.text()).trim();
      if (token.length > MAX_BYTES) return { error: json({ error: 'too large' }, 413) };
      if (!TOKEN_RE.test(token)) return { error: json({ error: 'not a share token' }, 400) };
      return { token };
    };
    const ttl = () => { const d = Number(env.EXPIRE_DAYS || 0); return d > 0 ? { expirationTtl: d * 86400 } : {}; };
    const parts = url.pathname.split('/').filter(Boolean);

    if (req.method === 'OPTIONS') return reply(null, 204);

    // snapshot link
    if (req.method === 'POST' && parts.length === 0) {
      if (!okOrigin) return json({ error: 'origin not allowed' }, 403);
      const { token, error } = await readToken(); if (error) return error;
      const key = await hashKey(token);
      if (!(await env.SHARES.get(key))) await env.SHARES.put(key, token, ttl());
      return json({ key });
    }

    // new live link
    if (req.method === 'POST' && parts.length === 1 && parts[0] === 'live') {
      if (!okOrigin) return json({ error: 'origin not allowed' }, 403);
      const { token, error } = await readToken(); if (error) return error;
      let key;
      for (let i = 0; i < 5 && !key; i++) { const k = randomKey(KEY_LEN); if (!(await env.SHARES.get(k))) key = k; }
      if (!key) return json({ error: 'try again' }, 503);
      const edit = randomKey(22);
      const updated = Date.now();
      await env.SHARES.put(key, token, { ...ttl(), metadata: { e: await sha256(edit), u: updated } });
      return json({ key, edit, updated });
    }

    // update a live link / check an edit key
    if ((req.method === 'PUT' && parts.length === 1) || (req.method === 'POST' && parts.length === 2 && parts[1] === 'check')) {
      if (!okOrigin) return json({ error: 'origin not allowed' }, 403);
      const key = parts[0];
      if (!KEY_RE.test(key)) return json({ error: 'not found' }, 404);
      const { value, metadata } = await env.SHARES.getWithMetadata(key);
      if (value == null) return json({ error: 'not found' }, 404);
      if (!metadata?.e) return json({ error: 'this link is a snapshot and can\'t be updated' }, 409);
      const given = req.headers.get('X-Edit-Key') || '';
      if (!given || (await sha256(given)) !== metadata.e) return json({ error: 'wrong edit key' }, 403);
      if (req.method === 'POST') return json({ ok: true, updated: metadata.u });
      const { token, error } = await readToken(); if (error) return error;
      const updated = Date.now();
      await env.SHARES.put(key, token, { ...ttl(), metadata: { e: metadata.e, u: updated } });
      return json({ ok: true, updated });
    }

    if (req.method === 'GET' && parts.length === 1 && KEY_RE.test(parts[0])) {
      const { value, metadata } = await env.SHARES.getWithMetadata(parts[0]);
      if (value == null) return json({ error: 'not found' }, 404);
      // snapshots never change; live links must be re-fetched
      const cache = metadata?.e ? 'no-cache' : 'public, max-age=31536000, immutable';
      return reply(value, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': cache, ...(metadata?.u ? { 'X-Updated': String(metadata.u) } : {}) });
    }

    if (req.method === 'GET' && parts.length === 0) return reply('Bathroom designer share links', 200, { 'Content-Type': 'text/plain' });
    return json({ error: 'not found' }, 404);
  },
};

const toBase62 = (bytes, len) => {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = '';
  for (let i = 0; i < len; i++) { s += ALPHABET[Number(n % 62n)]; n /= 62n; }
  return s;
};
// First KEY_LEN base62 digits of SHA-256(token): 62^8 ≈ 2·10^14 keys.
async function hashKey(token) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return toBase62(h.subarray(0, 12), KEY_LEN);
}
function randomKey(len) {
  return toBase62(crypto.getRandomValues(new Uint8Array(Math.ceil(len * 0.75) + 2)), len);
}
async function sha256(s) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}
