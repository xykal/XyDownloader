/**
 * Kebijakan origin (CORS) untuk proxy DownloadAja.
 *
 * Ini cerminan JS dari xydl/netpolicy.py (Python, jalan di Vercel). Dua implementasi,
 * SATU tabel kasus (tests/fixtures/origin_policy.json) yang diuji pytest dan node --test,
 * supaya tidak bisa drift. Kalau nambah origin, ubah dua file itu + fixture.
 *
 * Bug lama (identik di Python & JS): `A && B || C` bikin SATU substring 'dlaja' di Origin
 * cukup untuk lolos -> https://dlaja.evil.com dapat Access-Control-Allow-Origin.
 * Sekarang pencocokan host eksak.
 */

export const ALLOWED_EXACT = new Set([
  'https://dlaja.xyverse.my.id',
  'https://dlaja.projectkal.my.id',
  'https://xydl.vercel.app',
  'http://127.0.0.1:8000',
  'http://localhost:8000',
]);

export const PREVIEW_SUFFIX = '.vercel.app';
export const PREVIEW_PREFIXES = ['xydl', 'dlaja'];

function parseOrigin(origin) {
  const o = String(origin || '').trim();
  if (!o || o.toLowerCase() === 'null') return null;
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#@]*)$/.exec(o);
  if (!m) return null;
  const host = m[2].toLowerCase();
  if (!host) return null;
  return { scheme: m[1].toLowerCase(), host, origin: `${m[1].toLowerCase()}://${host}` };
}

export function extraOrigins(env) {
  const raw = (env && env.XYDL_EXTRA_ORIGINS) || '';
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

/** Origin yang boleh dicerminkan ke Access-Control-Allow-Origin ('' = tolak). */
export function originAllowed(origin, env) {
  const p = parseOrigin(origin);
  if (!p) return '';
  if (ALLOWED_EXACT.has(p.origin)) return p.origin;
  if (extraOrigins(env).has(p.origin)) return p.origin;
  if (p.scheme === 'https' && p.host.endsWith(PREVIEW_SUFFIX)) {
    const first = p.host.split('.')[0];
    if (PREVIEW_PREFIXES.some((pre) => first === pre || first.startsWith(pre + '-'))) return p.origin;
  }
  return '';
}

/** IP klien (hop terakhirlah yang ditambahkan proxy tepercaya, bukan yang dikirim klien). */
export function clientIp(headers) {
  for (const name of ['x-real-ip', 'cf-connecting-ip', 'x-forwarded-for']) {
    const raw = headers.get(name) || '';
    const last = raw.includes(',') ? raw.split(',').pop() : raw;
    const ip = String(last || '').trim();
    if (ip && !/[^\dA-Fa-f:.]/.test(ip) && (ip.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(ip))) return ip.slice(0, 64);
  }
  return '';
}
