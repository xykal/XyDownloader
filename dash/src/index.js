/**
 * DownloadAja Admin — dash.dlaja.xyverse.my.id
 * Auth: username + password (HMAC) + Cloudflare Turnstile
 * Gate path: /g/<GATE_PATH>/…  (obscure entry; not real security)
 * Data: KV CONFIG (remote flags + analytics aggregates)
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

const COOKIE = 'dlaja_admin_sess';
const SESSION_TTL = 60 * 60 * 12; // 12h
const STATS_DAYS_KEEP = 90;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      ...extra,
    },
  });
}

function corsPublic(extra = {}) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    ...extra,
  };
}

function b64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSign(keyRaw, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(keyRaw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

async function hmacVerify(keyRaw, msg, sigBytes) {
  const key = await crypto.subtle.importKey('raw', enc.encode(keyRaw), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(msg));
}

function timingSafeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(keyRaw, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(keyRaw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
  return [...sig].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, stored, env) {
  const s = String(stored || '');
  if (s.startsWith('hmac-sha256$')) {
    const want = s.slice('hmac-sha256$'.length);
    const pepper = env.PASS_PEPPER || env.SESSION_SECRET || '';
    if (!pepper) return false;
    const got = await hmacHex(pepper, password);
    return timingSafeEqualHex(got, want);
  }
  const parts = s.split('$');
  if (parts.length === 4 && parts[0] === 'pbkdf2') {
    try {
      const iter = parseInt(parts[1], 10);
      const salt = b64urlToBytes(parts[2]);
      const want = b64urlToBytes(parts[3]);
      const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: Math.min(iter, 100000) },
        key,
        want.length * 8,
      );
      const got = new Uint8Array(bits);
      if (got.length !== want.length) return false;
      let diff = 0;
      for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
      return diff === 0;
    } catch {
      return false;
    }
  }
  return false;
}

function parseCookies(req) {
  const raw = req.headers.get('Cookie') || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

async function makeSession(env, username) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const payload = b64url(enc.encode(JSON.stringify({ u: username, exp })));
  const sig = b64url(await hmacSign(env.SESSION_SECRET, payload));
  return `${payload}.${sig}`;
}

async function readSession(env, req) {
  const c = parseCookies(req)[COOKIE];
  if (!c || !env.SESSION_SECRET) return null;
  const [payload, sig] = c.split('.');
  if (!payload || !sig) return null;
  const ok = await hmacVerify(env.SESSION_SECRET, payload, b64urlToBytes(sig));
  if (!ok) return null;
  try {
    const data = JSON.parse(dec.decode(b64urlToBytes(payload)));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

function sessionCookie(value, maxAge) {
  return [
    `${COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return { ok: false, error: 'turnstile_not_configured' };
  if (!token) return { ok: false, error: 'turnstile_missing' };
  const body = new URLSearchParams();
  body.set('secret', env.TURNSTILE_SECRET);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  const data = await res.json();
  return { ok: !!data.success, error: data['error-codes']?.join(',') };
}

const DEFAULT_CONFIG = {
  maintenance_mode: false,
  maintenance_message: '',
  min_android_version: '',
  youtube_web_policy: 'warn',
  default_autoplay: true,
  default_filename_template: 'brand-title-id',
  default_video_tier: 'normal',
  default_audio_kbps: 192,
  announce_banner: null,
  disabled_platforms: [],
  recommend_apk_url: '',
  updated_at: null,
  updated_by: null,
};

async function getConfig(env) {
  try {
    const raw = await env.CONFIG.get('remote_config', 'json');
    return { ...DEFAULT_CONFIG, ...(raw || {}) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function putConfig(env, next, user) {
  const cfg = {
    ...DEFAULT_CONFIG,
    ...next,
    updated_at: new Date().toISOString(),
    updated_by: user || 'admin',
  };
  await env.CONFIG.put('remote_config', JSON.stringify(cfg));
  return cfg;
}

function gateOk(env, url) {
  const gate = env.GATE_PATH;
  if (!gate) return true;
  if (url.pathname.startsWith('/api/public/')) return true;
  if (url.pathname === '/api/login' || url.pathname === '/api/logout' || url.pathname === '/api/me') return true;
  if (url.pathname === '/' || url.pathname === '/login' || url.pathname === '/app' || url.pathname === '/index.html') {
    return false;
  }
  if (url.pathname.startsWith(`/g/${gate}`)) return true;
  return false;
}

function rewriteGatePath(url, env) {
  const gate = env.GATE_PATH;
  if (!gate) return url.pathname;
  const prefix = `/g/${gate}`;
  if (url.pathname === prefix || url.pathname === prefix + '/') return '/login.html';
  if (url.pathname.startsWith(prefix + '/')) {
    let rest = url.pathname.slice(prefix.length);
    if (rest === '' || rest === '/') return '/login.html';
    if (rest === '/app' || rest === '/app/') return '/app.html';
    if (rest === '/login' || rest === '/login/') return '/login.html';
    return rest;
  }
  return url.pathname;
}

// ---------------- analytics ----------------

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10); // UTC
}

function emptyDay(day) {
  return {
    day,
    pageviews: 0,
    sessions: 0,
    extracts: 0,
    downloads: 0,
    clients: { web: 0, apk: 0 },
    devices: { mobile: 0, desktop: 0, tablet: 0, bot: 0, apk: 0, other: 0 },
    browsers: { chrome: 0, safari: 0, firefox: 0, edge: 0, samsung: 0, opera: 0, other: 0 },
    os: { android: 0, ios: 0, windows: 0, macos: 0, linux: 0, chromeos: 0, other: 0 },
    platforms: {},
    events: { session: 0, extract: 0, download: 0, hit: 0 },
  };
}

function emptyTotal() {
  return {
    pageviews: 0,
    sessions: 0,
    extracts: 0,
    downloads: 0,
    unique_all_approx: 0,
    clients: { web: 0, apk: 0 },
    devices: { mobile: 0, desktop: 0, tablet: 0, bot: 0, apk: 0, other: 0 },
    browsers: { chrome: 0, safari: 0, firefox: 0, edge: 0, samsung: 0, opera: 0, other: 0 },
    os: { android: 0, ios: 0, windows: 0, macos: 0, linux: 0, chromeos: 0, other: 0 },
    platforms: {},
    first_seen: null,
    last_seen: null,
  };
}

function bump(map, key, n = 1) {
  if (!key) key = 'other';
  map[key] = (map[key] || 0) + n;
}

function classifyUa(uaRaw, clientHint) {
  const ua = String(uaRaw || '').toLowerCase();
  const client = String(clientHint || '').toLowerCase();

  // APK first
  if (client === 'apk' || ua.includes('downloadaja') || ua.includes('xydownloader') || ua.includes('xyverse-android')) {
    return {
      client: 'apk',
      device: 'apk',
      browser: 'apk',
      os: ua.includes('android') ? 'android' : 'android',
      kind: 'apk',
    };
  }

  const botRe =
    /bot|crawl|spider|slurp|scrapy|wget|curl\/|python-requests|python-urllib|httpclient|libwww|bytespider|gptbot|ccbot|anthropic|claude|petalbot|semrush|ahrefs|mj12bot|dotbot|facebookexternalhit|twitterbot|linkedinbot|discordbot|telegrambot|preview|headless|phantom|selenium|puppeteer|playwright|lighthouse|pagespeed|pingdom|uptimerobot|statuscake|monitor|scanner|archiver/;
  if (!ua || ua === 'mozilla/5.0' || botRe.test(ua)) {
    return { client: 'web', device: 'bot', browser: 'other', os: 'other', kind: 'bot' };
  }

  let os = 'other';
  if (/android/.test(ua)) os = 'android';
  else if (/iphone|ipad|ipod|ios/.test(ua)) os = 'ios';
  else if (/windows/.test(ua)) os = 'windows';
  else if (/mac os x|macintosh/.test(ua)) os = 'macos';
  else if (/cros/.test(ua)) os = 'chromeos';
  else if (/linux/.test(ua)) os = 'linux';

  let device = 'desktop';
  if (/ipad|tablet|kindle|silk/.test(ua) || (os === 'android' && !/mobile/.test(ua))) device = 'tablet';
  else if (/mobi|iphone|ipod|android.*mobile|windows phone/.test(ua)) device = 'mobile';
  else if (os === 'android' || os === 'ios') device = 'mobile';

  let browser = 'other';
  if (/edg\//.test(ua)) browser = 'edge';
  else if (/opr\/|opera/.test(ua)) browser = 'opera';
  else if (/samsungbrowser/.test(ua)) browser = 'samsung';
  else if (/firefox|fxios/.test(ua)) browser = 'firefox';
  else if (/chrome|crios|chromium/.test(ua) && !/edg\//.test(ua)) browser = 'chrome';
  else if (/safari/.test(ua) && !/chrome|crios|chromium|android/.test(ua)) browser = 'safari';

  return { client: 'web', device, browser, os, kind: device };
}

function normalizePlatform(p) {
  let s = String(p || 'unknown').toLowerCase().trim().replace(/\s+/g, '');
  if (!s) s = 'unknown';
  // collapse common aliases
  const map = {
    youtu: 'youtube',
    'youtube-nocookie': 'youtube',
    wwwyoutube: 'youtube',
    myoutube: 'youtube',
    youtubeshorts: 'youtube',
    tiktokweb: 'tiktok',
    vtiktiktok: 'tiktok',
    instagramreels: 'instagram',
    ig: 'instagram',
    fb: 'facebook',
    fbwatch: 'facebook',
    x: 'twitter',
    twitterx: 'twitter',
  };
  if (map[s]) return map[s];
  if (s.includes('youtube')) return 'youtube';
  if (s.includes('tiktok')) return 'tiktok';
  if (s.includes('instagram') || s === 'ig') return 'instagram';
  if (s.includes('facebook') || s.includes('fb.')) return 'facebook';
  if (s.includes('twitter') || s === 'x') return 'twitter';
  if (s.includes('bilibili')) return 'bilibili';
  if (s.includes('pixiv')) return 'pixiv';
  if (s.includes('reddit')) return 'reddit';
  if (s.includes('vimeo')) return 'vimeo';
  if (s.includes('twitch')) return 'twitch';
  if (s.includes('soundcloud')) return 'soundcloud';
  if (s.length > 32) s = s.slice(0, 32);
  return s;
}

async function shaShort(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(String(text || '')));
  return b64url(buf).slice(0, 22);
}


async function listDayEvents(env, day) {
  // Event keys: stats:evt:{day}:{id}  value = compact json
  const prefix = `stats:evt:${day}:`;
  const out = [];
  let cursor;
  try {
    do {
      const page = await env.CONFIG.list({ prefix, cursor, limit: 1000 });
      for (const k of page.keys || []) {
        out.push(k.name);
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
  } catch {
    return [];
  }
  return out;
}

async function readEvents(env, keys) {
  // batch get in chunks
  const events = [];
  const chunk = 50;
  for (let i = 0; i < keys.length; i += chunk) {
    const slice = keys.slice(i, i + chunk);
    const parts = await Promise.all(slice.map(async (k) => {
      try {
        return await env.CONFIG.get(k, 'json');
      } catch {
        return null;
      }
    }));
    for (const e of parts) if (e) events.push(e);
  }
  return events;
}

function foldEvents(day, events) {
  const d = emptyDay(day);
  const uniqSess = new Set();
  for (const e of events) {
    const type = e.t || e.type || 'session';
    const cls = {
      client: e.c || 'web',
      device: e.d || 'other',
      browser: e.b || 'other',
      os: e.o || 'other',
    };
    const platform = e.p || null;
    const cid = e.u || null;
    const n = Math.max(1, Math.min(50, parseInt(e.n, 10) || 1));

    bump(d.events, type === 'pageview' ? 'session' : type);
    if (type === 'session' || type === 'pageview' || type === 'hit') {
      d.pageviews += 1;
      applyClassOnly(d, cls);
      if (cid) uniqSess.add(cid);
    } else if (type === 'extract') {
      d.extracts += 1;
      applyClassOnly(d, cls);
      if (platform) bump(d.platforms, platform);
      if (cid) uniqSess.add(cid);
    } else if (type === 'download') {
      d.downloads += n;
      applyClassOnly(d, cls);
      if (platform) bump(d.platforms, platform, n);
      if (cid) uniqSess.add(cid);
    }
  }
  d.sessions = uniqSess.size;
  return d;
}

function applyClassOnly(day, cls) {
  bump(day.clients, cls.client);
  bump(day.devices, cls.device);
  bump(day.browsers, cls.browser);
  bump(day.os, cls.os);
}

async function loadDay(env, day) {
  const keys = await listDayEvents(env, day);
  if (!keys.length) {
    // fallback legacy aggregate if present
    try {
      const raw = await env.CONFIG.get(`stats:day:${day}`, 'json');
      if (raw) {
        const base = emptyDay(day);
        return {
          ...base,
          ...raw,
          clients: { ...base.clients, ...(raw.clients || {}) },
          devices: { ...base.devices, ...(raw.devices || {}) },
          browsers: { ...base.browsers, ...(raw.browsers || {}) },
          os: { ...base.os, ...(raw.os || {}) },
          platforms: { ...(raw.platforms || {}) },
          events: { ...base.events, ...(raw.events || {}) },
        };
      }
    } catch { /* */ }
    return emptyDay(day);
  }
  const events = await readEvents(env, keys);
  return foldEvents(day, events);
}

async function loadTotal(env) {
  // Rebuild from last 90 days of event folds + optional legacy total
  const days = [];
  for (let i = 0; i < STATS_DAYS_KEEP; i++) {
    days.push(dayKey(new Date(Date.now() - i * 86400000)));
  }
  // Only fold recent 14 for speed in overview; for total use cached rollup + today
  let total = emptyTotal();
  try {
    const raw = await env.CONFIG.get('stats:total', 'json');
    if (raw) {
      total = {
        ...total,
        ...raw,
        clients: { ...total.clients, ...(raw.clients || {}) },
        devices: { ...total.devices, ...(raw.devices || {}) },
        browsers: { ...total.browsers, ...(raw.browsers || {}) },
        os: { ...total.os, ...(raw.os || {}) },
        platforms: { ...(raw.platforms || {}) },
      };
    }
  } catch { /* */ }
  return total;
}

async function bumpTotal(env, evt) {
  // Best-effort total rollup with simple retry to reduce lost updates
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const total = await loadTotal(env);
      const nowIso = new Date().toISOString();
      if (!total.first_seen) total.first_seen = nowIso;
      total.last_seen = nowIso;
      const type = evt.type;
      const cls = evt.cls;
      const platform = evt.platform;
      const n = evt.n || 1;
      if (type === 'session' || type === 'pageview' || type === 'hit') {
        total.pageviews += 1;
      } else if (type === 'extract') {
        total.extracts += 1;
        if (platform) bump(total.platforms, platform);
      } else if (type === 'download') {
        total.downloads += n;
        if (platform) bump(total.platforms, platform, n);
      }
      bump(total.clients, cls.client);
      bump(total.devices, cls.device);
      bump(total.browsers, cls.browser);
      bump(total.os, cls.os);
      if (evt.newLifetime) total.unique_all_approx += 1;
      if (evt.newSessionDay) total.sessions += 1;
      await env.CONFIG.put('stats:total', JSON.stringify(total));
      return total;
    } catch {
      // retry
    }
  }
  return null;
}

async function markUnique(env, day, scope, cidHash) {
  if (!cidHash) return false;
  const key = `stats:uniq:${scope}:${day}:${cidHash}`;
  try {
    const existed = await env.CONFIG.get(key);
    if (existed) return false;
    await env.CONFIG.put(key, '1', { expirationTtl: 60 * 60 * 48 });
    return true;
  } catch {
    return false;
  }
}

async function markLifetimeUnique(env, cidHash) {
  if (!cidHash) return false;
  const key = `stats:uniq:life:${cidHash}`;
  try {
    const existed = await env.CONFIG.get(key);
    if (existed) return false;
    await env.CONFIG.put(key, '1', { expirationTtl: 60 * 60 * 24 * 800 });
    return true;
  } catch {
    return false;
  }
}

async function recordEvent(env, evt) {
  const day = dayKey();
  const type = evt.type || 'session';
  const cls = classifyUa(evt.ua, evt.client);
  const platform = evt.platform ? normalizePlatform(evt.platform) : null;
  const n = Math.max(1, Math.min(50, parseInt(evt.count, 10) || 1));
  const id = b64url(crypto.getRandomValues(new Uint8Array(10)));

  // Compact event record (append-only — no lost updates under concurrency)
  const row = {
    t: type === 'pageview' ? 'session' : type,
    c: cls.client,
    d: cls.device,
    b: cls.browser,
    o: cls.os,
    p: platform || undefined,
    u: evt.cidHash || undefined,
    n: type === 'download' ? n : undefined,
    ts: Date.now(),
  };
  const exp = 60 * 60 * 24 * (STATS_DAYS_KEEP + 5);
  await env.CONFIG.put(`stats:evt:${day}:${id}`, JSON.stringify(row), { expirationTtl: exp });

  let newSessionDay = false;
  let newLifetime = false;
  if (evt.cidHash) {
    if (type === 'session' || type === 'pageview' || type === 'extract' || type === 'download') {
      newSessionDay = await markUnique(env, day, 'sess', evt.cidHash);
    }
    if (type === 'session' || type === 'pageview') {
      newLifetime = await markLifetimeUnique(env, evt.cidHash);
    }
  }

  // Best-effort totals (race-tolerant enough for dashboard)
  await bumpTotal(env, {
    type: row.t,
    cls,
    platform,
    n: type === 'download' ? n : 1,
    newSessionDay,
    newLifetime,
  });

  return { ok: true, day, id };
}


function topMap(map, limit = 12) {
  return Object.entries(map || {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function sumMap(map) {
  return Object.values(map || {}).reduce((a, b) => a + (b || 0), 0);
}

async function buildOverview(env) {
  const cfg = await getConfig(env);
  const today = dayKey();
  const days = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.now() - i * 86400000);
    days.push(dayKey(d));
  }
  const [total, ...dayObjs] = await Promise.all([loadTotal(env), ...days.map((d) => loadDay(env, d))]);
  const todayObj = dayObjs[0];
  const last7 = dayObjs.slice(0, 7);
  const sumField = (arr, f) => arr.reduce((a, x) => a + (x[f] || 0), 0);
  const mergeMaps = (arr, key) => {
    const out = {};
    for (const d of arr) {
      const m = d[key] || {};
      for (const [k, v] of Object.entries(m)) bump(out, k, v);
    }
    return out;
  };

  const platforms7 = mergeMaps(last7, 'platforms');
  const devices7 = mergeMaps(last7, 'devices');
  const browsers7 = mergeMaps(last7, 'browsers');
  const os7 = mergeMaps(last7, 'os');
  const clients7 = mergeMaps(last7, 'clients');

  return {
    product: 'https://dlaja.xyverse.my.id',
    api_health: 'https://dlaja.xyverse.my.id/api/health',
    maintenance_mode: cfg.maintenance_mode,
    youtube_web_policy: cfg.youtube_web_policy,
    default_video_tier: cfg.default_video_tier,
    updated_at: cfg.updated_at,
    generated_at: new Date().toISOString(),
    today: {
      day: today,
      pageviews: todayObj.pageviews,
      unique_users: todayObj.sessions,
      extracts: todayObj.extracts,
      downloads: todayObj.downloads,
    },
    last7: {
      pageviews: sumField(last7, 'pageviews'),
      unique_users: sumField(last7, 'sessions'),
      extracts: sumField(last7, 'extracts'),
      downloads: sumField(last7, 'downloads'),
    },
    total: {
      pageviews: total.pageviews,
      unique_users_approx: total.unique_all_approx || total.sessions,
      extracts: total.extracts,
      downloads: total.downloads,
      first_seen: total.first_seen,
      last_seen: total.last_seen,
    },
    clients: {
      today: todayObj.clients,
      last7: clients7,
      total: total.clients,
    },
    devices: {
      today: todayObj.devices,
      last7: devices7,
      total: total.devices,
      top_last7: topMap(devices7),
    },
    browsers: {
      today: todayObj.browsers,
      last7: browsers7,
      total: total.browsers,
      top_last7: topMap(browsers7),
    },
    os: {
      today: todayObj.os,
      last7: os7,
      total: total.os,
      top_last7: topMap(os7),
    },
    platforms: {
      today: topMap(todayObj.platforms),
      last7: topMap(platforms7),
      total: topMap(total.platforms, 20),
      top: topMap(platforms7, 1)[0] || topMap(total.platforms, 1)[0] || null,
    },
    series: dayObjs
      .slice()
      .reverse()
      .map((d) => ({
        day: d.day,
        pageviews: d.pageviews,
        unique_users: d.sessions,
        extracts: d.extracts,
        downloads: d.downloads,
      })),
    note: 'Unique user = client-id unik per hari (web localStorage / APK install id). Bot/crawl dilacak dari User-Agent.',
  };
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (url.pathname === '/robots.txt') {
        return new Response('User-agent: *\nDisallow: /\n', {
          headers: { 'content-type': 'text/plain', 'x-robots-tag': 'noindex' },
        });
      }

      // Public CORS preflight
      if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/public/')) {
        return new Response(null, { status: 204, headers: corsPublic({ 'access-control-max-age': '86400' }) });
      }

      // Public config for main app
      if (url.pathname === '/api/public/config' && request.method === 'GET') {
        const cfg = await getConfig(env);
        const publicCfg = {
          maintenance_mode: cfg.maintenance_mode,
          maintenance_message: cfg.maintenance_message,
          min_android_version: cfg.min_android_version,
          youtube_web_policy: cfg.youtube_web_policy,
          default_autoplay: cfg.default_autoplay,
          default_filename_template: cfg.default_filename_template,
          default_video_tier: cfg.default_video_tier,
          default_audio_kbps: cfg.default_audio_kbps,
          announce_banner: cfg.announce_banner,
          disabled_platforms: cfg.disabled_platforms,
          recommend_apk_url: cfg.recommend_apk_url,
          updated_at: cfg.updated_at,
        };
        // Soft passive hit (bot visibility) — don't block response
        const ua = request.headers.get('user-agent') || '';
        ctx.waitUntil(
          recordEvent(env, { type: 'hit', ua, client: 'web' }).catch(() => {}),
        );
        return json(publicCfg, 200, {
          ...corsPublic(),
          'cache-control': 'public, max-age=60, s-maxage=300',
        });
      }

      // Public analytics beacon
      if (url.pathname === '/api/public/beacon' && request.method === 'POST') {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, error: 'invalid_json' }, 400, corsPublic());
        }
        const type = String(body.type || body.event || 'session').toLowerCase();
        if (!['session', 'pageview', 'extract', 'download'].includes(type)) {
          return json({ ok: false, error: 'bad_type' }, 400, corsPublic());
        }
        const ua = String(body.ua || request.headers.get('user-agent') || '').slice(0, 400);
        const client = String(body.client || '').toLowerCase() === 'apk' ? 'apk' : 'web';
        const cidRaw = String(body.cid || body.client_id || '').slice(0, 80);
        // reject obvious garbage flood
        if (cidRaw && !/^[A-Za-z0-9._:-]{8,80}$/.test(cidRaw)) {
          return json({ ok: false, error: 'bad_cid' }, 400, corsPublic());
        }
        const cidHash = cidRaw ? await shaShort(cidRaw) : null;
        const platform = body.platform ? String(body.platform).slice(0, 64) : null;
        const count = body.count;

        // Fire-and-forget-ish but await for consistency (cheap KV)
        try {
          await recordEvent(env, { type, ua, client, cidHash, platform, count });
        } catch (e) {
          return json({ ok: false, error: 'stats_write', detail: String(e && e.message || e) }, 500, corsPublic());
        }
        return json({ ok: true }, 200, corsPublic());
      }

      // Gate check for document navigations
      if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
        if (!gateOk(env, url) && url.pathname !== '/robots.txt') {
          return new Response('Not Found', { status: 404, headers: { 'x-robots-tag': 'noindex' } });
        }
      }

      // --- API ---

      if (url.pathname === '/api/ping') {
        return json({ ok: true, has_gate: !!env.GATE_PATH, has_user: !!env.ADMIN_USER, has_assets: !!env.ASSETS });
      }

      if (url.pathname.startsWith('/api/')) {
        if (request.method === 'OPTIONS') {
          return new Response(null, {
            headers: {
              'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
              'access-control-allow-headers': 'content-type',
              'access-control-allow-credentials': 'true',
            },
          });
        }

        if (url.pathname === '/api/login' && request.method === 'POST') {
          try {
            let body;
            try {
              body = await request.json();
            } catch {
              return json({ ok: false, error: 'invalid_json' }, 400);
            }
            const ip = request.headers.get('CF-Connecting-IP') || '';
            const ts = await verifyTurnstile(env, body.turnstile_token, ip);
            if (!ts.ok) return json({ ok: false, error: 'turnstile_failed', detail: ts.error }, 403);

            const user = String(body.username || '');
            const pass = String(body.password || '');
            if (!env.ADMIN_USER || !env.ADMIN_PASS_HASH) {
              return json({ ok: false, error: 'server_misconfigured', detail: 'admin secrets missing' }, 500);
            }
            if (user !== env.ADMIN_USER) return json({ ok: false, error: 'invalid_credentials' }, 401);
            const ok = await verifyPassword(pass, env.ADMIN_PASS_HASH, env);
            if (!ok) return json({ ok: false, error: 'invalid_credentials' }, 401);
            if (!env.SESSION_SECRET) {
              return json({ ok: false, error: 'server_misconfigured', detail: 'SESSION_SECRET missing' }, 500);
            }

            const sess = await makeSession(env, user);
            return json(
              { ok: true, user },
              200,
              { 'set-cookie': sessionCookie(sess, SESSION_TTL) },
            );
          } catch (e) {
            return json({ ok: false, error: 'login_exception', detail: String(e && e.message || e) }, 500);
          }
        }

        if (url.pathname === '/api/logout' && request.method === 'POST') {
          return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
        }

        const sess = await readSession(env, request);

        if (url.pathname === '/api/me' && request.method === 'GET') {
          if (!sess) return json({ ok: false }, 401);
          return json({ ok: true, user: sess.u, exp: sess.exp });
        }

        if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);

        if (url.pathname === '/api/config' && request.method === 'GET') {
          return json({ ok: true, config: await getConfig(env) });
        }

        if (url.pathname === '/api/config' && request.method === 'PUT') {
          let body;
          try {
            body = await request.json();
          } catch {
            return json({ ok: false, error: 'invalid_json' }, 400);
          }
          const allowed = [
            'maintenance_mode', 'maintenance_message', 'min_android_version',
            'youtube_web_policy', 'default_autoplay', 'default_filename_template',
            'default_video_tier', 'default_audio_kbps', 'announce_banner',
            'disabled_platforms', 'recommend_apk_url',
          ];
          const patch = {};
          for (const k of allowed) {
            if (k in (body || {})) patch[k] = body[k];
          }
          const cfg = await putConfig(env, { ...(await getConfig(env)), ...patch }, sess.u);
          return json({ ok: true, config: cfg });
        }

        if ((url.pathname === '/api/overview' || url.pathname === '/api/stats') && request.method === 'GET') {
          try {
            const overview = await buildOverview(env);
            return json({ ok: true, overview });
          } catch (e) {
            return json({ ok: false, error: 'overview_failed', detail: String(e && e.message || e) }, 500);
          }
        }

        return json({ ok: false, error: 'not_found' }, 404);
      }

      // Static assets via Workers assets
      if (env.ASSETS) {
        let path = rewriteGatePath(url, env);
        if (!path || path === '/') path = '/login.html';
        if (!path.split('/').pop().includes('.')) {
          if (path.endsWith('/')) path = path.slice(0, -1);
          path = path + '.html';
        }
        try {
          let res = await env.ASSETS.fetch(new URL(path, 'https://assets.local'));
          if (res.status === 404) {
            res = await env.ASSETS.fetch(new URL(path, url.origin));
          }
          if (res && res.status !== 404) {
            const headers = new Headers(res.headers);
            headers.set('x-robots-tag', 'noindex, nofollow');
            headers.set('referrer-policy', 'no-referrer');
            headers.set('x-frame-options', 'DENY');
            headers.set('cache-control', 'no-store');
            return new Response(res.body, { status: res.status, headers });
          }
        } catch (e) {
          return json({ ok: false, error: 'asset_fetch', detail: String(e), path }, 500);
        }
      }

      return new Response('Not Found', { status: 404, headers: { 'x-robots-tag': 'noindex' } });
    } catch (e) {
      return json({ ok: false, error: 'worker_exception', detail: String(e && e.message || e) }, 500);
    }
  },
};
