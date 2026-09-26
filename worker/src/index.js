/**
 * DownloadAja Proxy — Cloudflare Worker
 * ---------------------------------------------------------------------------
 * Tugasnya cuma satu: meneruskan (stream) file media dari CDN platform ke browser,
 * dengan header yang dibutuhkan (Referer/Cookie/User-Agent) + CORS + nama file.
 *
 *   GET /f/<nama-file>?t=TOKEN[&u=URL][&dl=1]   -> file (dukung Range/resume)
 *   GET /m3u8?t=TOKEN[&u=URL]                   -> playlist HLS yang sudah di-rewrite
 *
 * TOKEN dibuat & ditandatangani (HMAC-SHA256) oleh API Python di Vercel, jadi Worker
 * ini tidak bisa dipakai sebagai open proxy. Worker tidak menyimpan apa pun.
 */

const VERSION = '1.0.0';
const enc = new TextEncoder();
let cachedKey = null;
let cachedKeySource = null;

const ALLOWED_ORIGINS = new Set([
  'https://dlaja.xyverse.my.id',
  'https://dlaja.projectkal.my.id',
  'https://xydl.vercel.app',
  'http://127.0.0.1:8000',
  'http://localhost:8000',
]);

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allow = ALLOWED_ORIGINS.has(origin) || (origin.endsWith('.vercel.app') && origin.includes('xydl') || origin.includes('dlaja'))
    ? origin : '';
  const h = {
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'Range, Content-Type',
    'access-control-expose-headers': 'Content-Length, Content-Range, Content-Disposition, Accept-Ranges, Content-Type',
    'vary': 'Origin',
    'x-robots-tag': 'noindex',
  };
  if (allow) h['access-control-allow-origin'] = allow;
  return h;
}

// ---------------------------------------------------------------- helpers
function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 0x8000) bin += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function streamToBytes(stream) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateRaw(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(await streamToBytes(s));
}

async function deflateRaw(text) {
  const s = new Blob([enc.encode(text)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return streamToBytes(s);
}

async function hmacKey(env) {
  if (!env.SIGNING_KEY) throw new HttpError(500, 'SIGNING_KEY belum di-set');
  if (cachedKey && cachedKeySource === env.SIGNING_KEY) return cachedKey;
  cachedKey = await crypto.subtle.importKey('raw', enc.encode(env.SIGNING_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  cachedKeySource = env.SIGNING_KEY;
  return cachedKey;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function verifyToken(token, env) {
  if (!token || token.indexOf('.') < 0) throw new HttpError(400, 'token tidak ada / rusak');
  const [body, sig] = token.split('.', 2);
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(env), b64urlToBytes(sig), enc.encode(body));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    ok = false;
  }
  if (!ok) throw new HttpError(403, 'tanda tangan token tidak valid');
  let payload;
  try { payload = JSON.parse(await inflateRaw(b64urlToBytes(body))); } catch { throw new HttpError(400, 'payload rusak'); }
  if (payload.x && Date.now() / 1000 > payload.x) throw new HttpError(410, 'link kadaluarsa — proses ulang link-nya di DownloadAja');
  return payload;
}

async function signPayload(payload, env) {
  const body = bytesToB64url(await deflateRaw(JSON.stringify(payload)));
  const sig = bytesToB64url(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(body)));
  return `${body}.${sig}`;
}

function isPrivateHost(host) {
  host = host.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (host.includes(':')) return true; // IPv6 literal: tolak saja
  return false;
}

function hostAllowed(host, payload) {
  host = host.toLowerCase();
  return (payload.a || []).some((s) => host === s || host.endsWith('.' + s));
}

function resolveTarget(url, payload) {
  const override = url.searchParams.get('u');
  const target = new URL(override || payload.u);
  if (!/^https?:$/.test(target.protocol)) throw new HttpError(400, 'skema URL tidak didukung');
  if (isPrivateHost(target.hostname)) throw new HttpError(403, 'host tidak diizinkan');
  if (override && !hostAllowed(target.hostname, payload)) throw new HttpError(403, 'host tidak diizinkan untuk token ini');
  return target.href;
}

function upstreamHeaders(payload, request) {
  const h = new Headers();
  for (const [k, v] of Object.entries(payload.h || {})) {
    try { h.set(k, v); } catch { /* header tidak valid, lewati */ }
  }
  if (!h.has('user-agent')) h.set('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36');
  h.set('accept-encoding', 'identity');
  const range = request.headers.get('range');
  if (range) h.set('range', range);
  return h;
}

function contentDisposition(filename) {
  const clean = String(filename || 'download').replace(/[\r\n"\\]/g, '_');
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

function json(status, data, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(request ? corsHeaders(request) : { 'x-robots-tag': 'noindex' }),
    },
  });
}

// ---------------------------------------------------------------- handlers
async function handleFile(request, env, url) {
  const payload = await verifyToken(url.searchParams.get('t'), env);
  const target = resolveTarget(url, payload);
  const upstream = await fetch(target, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: upstreamHeaders(payload, request),
    redirect: 'follow',
  });

  const headers = new Headers(corsHeaders(request));
  for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const v = upstream.headers.get(k);
    if (v) headers.set(k, v);
  }
  const ct = headers.get('content-type') || '';
  if (payload.ct && (!ct || /octet-stream|text\/plain|binary/i.test(ct))) headers.set('content-type', payload.ct);
  if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');
  if (url.searchParams.get('dl') === '1' && upstream.ok) {
    headers.set('content-disposition', contentDisposition(payload.f));
    if (/^text\//i.test(headers.get('content-type') || '')) headers.set('content-type', 'application/octet-stream');
  }
  headers.set('cache-control', payload.ct && payload.ct.startsWith('image/') ? 'public, max-age=86400' : 'no-store');
  headers.set('x-xydl-upstream-status', String(upstream.status));
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers });
}

const M3U8_RE = /\.m3u8?($|\?)/i;

async function handleM3u8(request, env, url) {
  const token = url.searchParams.get('t');
  const payload = await verifyToken(token, env);
  const target = resolveTarget(url, payload);
  const h = upstreamHeaders(payload, request);
  h.delete('range');
  const upstream = await fetch(target, { headers: h, redirect: 'follow' });
  if (!upstream.ok) return json(upstream.status, { ok: false, error: `upstream HTTP ${upstream.status}` }, request);
  const text = await upstream.text();
  if (!text.trimStart().startsWith('#EXTM3U')) return json(502, { ok: false, error: 'bukan playlist HLS' }, request);
  const base = upstream.url || target;
  const origin = url.origin;
  const tokenCache = new Map();

  async function tokenFor(abs) {
    const host = new URL(abs).hostname;
    if (hostAllowed(host, payload)) return token;
    if (isPrivateHost(host)) throw new HttpError(403, 'host tidak diizinkan');
    if (!tokenCache.has(host)) tokenCache.set(host, await signPayload({ ...payload, u: abs, a: [host] }, env));
    return tokenCache.get(host);
  }
  async function rewrite(ref, asPlaylist) {
    const abs = new URL(ref, base).href;
    const t = await tokenFor(abs);
    return asPlaylist
      ? `${origin}/m3u8?t=${t}&u=${encodeURIComponent(abs)}`
      : `${origin}/f/seg?t=${t}&u=${encodeURIComponent(abs)}`;
  }

  const out = [];
  let nextIsPlaylist = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) { out.push(''); continue; }
    if (line.startsWith('#')) {
      if (line.startsWith('#EXT-X-STREAM-INF')) nextIsPlaylist = true;
      const m = line.match(/URI="([^"]+)"/);
      if (m) {
        const asPlaylist = /^#EXT-X-(MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT)/.test(line);
        out.push(line.replace(m[0], `URI="${await rewrite(m[1], asPlaylist)}"`));
      } else {
        out.push(line);
      }
      continue;
    }
    out.push(await rewrite(line, nextIsPlaylist || M3U8_RE.test(line)));
    nextIsPlaylist = false;
  }
  return new Response(out.join('\n'), {
    headers: { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store', ...corsHeaders(request) },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...corsHeaders(request), 'access-control-max-age': '86400' } });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json(405, { ok: false, error: 'method not allowed' }, request);
    }
    try {
      if (url.pathname === '/' || url.pathname === '/health') {
        return json(200, {
          ok: true, service: 'DownloadAja Proxy', version: VERSION, by: 'XyVerse', key: Boolean(env.SIGNING_KEY),
        }, request);
      }
      if (url.pathname === '/f' || url.pathname.startsWith('/f/')) return await handleFile(request, env, url);
      if (url.pathname === '/m3u8') return await handleM3u8(request, env, url);
      return json(404, { ok: false, error: 'not found' }, request);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 502;
      return json(status, { ok: false, error: e.message || String(e) }, request);
    }
  },
};
