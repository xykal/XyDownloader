/**
 * DownloadAja Admin — dash.dlaja.xyverse.my.id
 * Auth: username + password (HMAC) + Cloudflare Turnstile
 * Gate path: /g/<GATE_PATH>/…  (obscure entry; not real security)
 * Data: KV CONFIG (remote flags + analytics aggregates)
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

const COOKIE = 'dlaja_admin_sess';
// App ID OneSignal DownloadAja (bukan rahasia — ikut di APK).
const ONESIGNAL_APP_ID = '8d66b3fd-06ea-4df6-aa39-0487d1cf85aa';
// Jeda minimal antar kirim pengumuman per admin.
const notifyLast = new Map();
const SESSION_TTL = 60 * 60 * 12; // 12h
const STATS_DAYS_KEEP = 90;
// Kunci 'lifetime unique' dulu umur 800 hari per client-id: ruang kuncinya dikontrol orang luar (cid
// itu input klien), jadi KV bisa digembungkan seenak hati. 90 hari cukup buat angka
// 'pengguna unik' di dashboard dan kuncinya kedaluwarsa sendiri.
const LIFETIME_UNIQ_TTL_DAYS = 90;

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

// ---------------------------------------------------------------- batas tulis KV
// /api/public/beacon itu PUBLIK, tanpa auth. Satu POST yang lolos bisa jadi ±6 operasi KV:
//   stats:evt (1 put) + recent:devices (get+put) + uniq:sess (get+put) +
//   uniq:life (get+put) + stats:total (get+put, sampai 5x retry)
// Di free plan Cloudflare kuota tulis KV itu terbatas dan yang kena limit adalah account
// kita, bukan yang nge-script. /api/public/config juga nulis 1 event tiap GET.
//
// Remnya: budget per IP + budget global per isolate. Nol operasi tulis saat lewat batas,
// klien tetap dibalas 200 supaya dia tidak retry-storm. Ini pembatas kerugian, bukan
// filter presisi (limit per-isolate, Worker bisa punya banyak isolate) — gabungan sama
// Cloudflare rate-limit rule di dashboard kalau nanti kena flood beneran.
const WRITE_BUDGET = new Map();
const BUDGET_EVENTS_PER_IP_MIN = 40;
const BUDGET_PROBES_PER_IP_MIN = 12;
const BUDGET_EVENTS_GLOBAL_MIN = 600;

function budgetOk(key, limit, windowMs = 60_000) {
  const now = Date.now();
  if (WRITE_BUDGET.size > 20_000) {
    for (const [k, v] of WRITE_BUDGET) if (now > v.reset) WRITE_BUDGET.delete(k);
    if (WRITE_BUDGET.size > 20_000) WRITE_BUDGET.clear();
  }
  const cur = WRITE_BUDGET.get(key);
  if (!cur || now > cur.reset) {
    WRITE_BUDGET.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  if (cur.n >= limit) return false;
  cur.n += 1;
  return true;
}

function writeAllowed(ip, kind) {
  const who = `${kind}:${ip || '?'}`;
  const limit = kind === 'probe' ? BUDGET_PROBES_PER_IP_MIN : BUDGET_EVENTS_PER_IP_MIN;
  return budgetOk(who, limit) && budgetOk('evt:*', BUDGET_EVENTS_GLOBAL_MIN);
}

/**
 * Siapa IP yang harus dicatat?
 *   - Beacon dari browser/APK  -> IP asli dari header Cloudflare.
 *   - Laporan probe dari API produk -> API-lah yang lihat IP pengguna (Worker lihat IP
 *     function Vercel), jadi body.ip dipakai HANYA kalau bawa HMAC dari XYDL_PROBE_SECRET.
 * Sebelumnya `body.ip || ip` bikin siapa pun bisa nulis IP karangan ke tabel device/probe
 * admin (log poisoning: nimpun noise, nutupin jejak asli, atau naruh string aneh di UI).
 */
async function probeIdentity(env, request, bodyIp, bodyCc) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const cc = request.headers.get('CF-IPCountry') || '';
  const secret = env.PROBE_REPORT_SECRET;
  const ts = request.headers.get('X-Xydl-Probe-Ts') || '';
  const sig = request.headers.get('X-Xydl-Probe-Sig') || '';
  const want = String(bodyIp || '').slice(0, 64);
  if (secret && want && ts && sig && /^\d{10}$/.test(ts) && Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) <= 300) {
    try {
      const got = await hmacHex(secret, `${ts}.${want}`);
      if (timingSafeEqualHex(got, sig)) {
        return { ip: want, cc: String(bodyCc || '').slice(0, 8).toUpperCase() || cc };
      }
    } catch { /* signature rusak -> pakai header */ }
  }
  return { ip, cc };
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
    bots: {},
    models: {},
    countries: {},
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

function botName(ua) {
  const u = ua;
  const rules = [
    ['googlebot', /googlebot/],
    ['bingbot', /bingbot|msnbot/],
    ['yandex', /yandex/],
    ['baidu', /baiduspider/],
    ['duckduck', /duckduckbot/],
    ['bytespider', /bytespider/],
    ['gptbot', /gptbot|chatgpt/],
    ['claudebot', /claude|anthropic/],
    ['semrush', /semrush/],
    ['ahrefs', /ahrefs/],
    ['petalbot', /petalbot/],
    ['scrapy', /scrapy/],
    ['curl', /\bcurl\//],
    ['wget', /\bwget/],
    ['python', /python-requests|python-urllib|aiohttp|httpx/],
    ['java', /\bjava\//],
    ['go-http', /go-http-client/],
    ['headless', /headless|puppeteer|playwright|selenium|phantom/],
    ['lighthouse', /lighthouse|pagespeed/],
    ['uptime', /pingdom|uptimerobot|statuscake|monitor/],
    ['facebook', /facebookexternalhit/],
    ['twitter', /twitterbot/],
    ['discord', /discordbot/],
    ['telegram', /telegrambot/],
    ['scanner', /scanner|nikto|sqlmap|nmap|masscan|zgrab|nuclei/],
    ['archive', /archive\.org|ia_archiver/],
    ['generic-bot', /bot|crawl|spider|slurp/],
  ];
  for (const [name, re] of rules) if (re.test(u)) return name;
  return 'bot';
}

function classifyUa(uaRaw, clientHint) {
  const uaOrig = String(uaRaw || '');
  const ua = uaOrig.toLowerCase();
  const client = String(clientHint || '').toLowerCase();

  if (client === 'apk' || ua.includes('downloadaja') || ua.includes('xydownloader') || ua.includes('xyverse-android')) {
    let model = '';
    const m = uaOrig.match(/DownloadAja\/[^\s]+ \(Android [^;]+; ([^)]+)\)/i);
    if (m) model = m[1].trim().slice(0, 40);
    return {
      client: 'apk',
      device: 'apk',
      browser: 'apk',
      os: 'android',
      kind: 'apk',
      bot: null,
      model: model || 'Android app',
      label: model ? `APK · ${model}` : 'APK Android',
    };
  }

  const botRe =
    /bot|crawl|spider|slurp|scrapy|wget|curl\/|python-requests|python-urllib|httpclient|libwww|bytespider|gptbot|ccbot|anthropic|claude|petalbot|semrush|ahrefs|mj12bot|dotbot|facebookexternalhit|twitterbot|linkedinbot|discordbot|telegrambot|preview|headless|phantom|selenium|puppeteer|playwright|lighthouse|pagespeed|pingdom|uptimerobot|statuscake|monitor|scanner|archiver|sqlmap|nikto|nmap|masscan|zgrab|nuclei|aiohttp|httpx/;
  if (!ua || ua === 'mozilla/5.0' || botRe.test(ua)) {
    const bn = botName(ua || 'empty');
    return {
      client: 'web',
      device: 'bot',
      browser: 'other',
      os: 'other',
      kind: 'bot',
      bot: bn,
      model: bn,
      label: `Bot · ${bn}`,
    };
  }

  let os = 'other';
  if (/android/.test(ua)) os = 'android';
  else if (/iphone|ipod/.test(ua)) os = 'ios';
  else if (/ipad/.test(ua)) os = 'ios';
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
  else if (/safari/.test(ua) && !/chrome|crios|chromium/.test(ua)) browser = 'safari';

  // brand / model hints
  let model = '';
  if (/iphone/.test(ua)) model = 'iPhone';
  else if (/ipad/.test(ua)) model = 'iPad';
  else if (/pixel[^;)\s]*/.test(ua)) model = (uaOrig.match(/Pixel[^;)\s]*/i) || ['Pixel'])[0];
  else if (/sm-[a-z0-9]+/i.test(uaOrig)) model = (uaOrig.match(/SM-[A-Z0-9]+/i) || [''])[0];
  else if (/xiaomi|redmi|poco/i.test(ua)) model = (uaOrig.match(/(Redmi|POCO|Mi)[^;)\s]*/i) || ['Xiaomi'])[0];
  else if (/huawei|honor/i.test(ua)) model = 'Huawei';
  else if (/oppo|cph[0-9]/i.test(ua)) model = 'OPPO';
  else if (/vivo/i.test(ua)) model = 'vivo';
  else if (/realme/i.test(ua)) model = 'realme';
  else if (/oneplus/i.test(ua)) model = 'OnePlus';
  else if (/macintosh|mac os x/.test(ua)) model = 'Mac';
  else if (/windows nt 10/.test(ua)) model = 'Windows 10/11';
  else if (/windows/.test(ua)) model = 'Windows';
  else if (/android/.test(ua)) model = 'Android';
  else if (/linux/.test(ua)) model = 'Linux';

  const label = [device, os, browser, model].filter(Boolean).join(' · ');
  return { client: 'web', device, browser, os, kind: device, bot: null, model, label };
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
  d.bots = {};
  d.models = {};
  d.countries = {};
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
    if (e.bt) bump(d.bots, e.bt);
    if (e.m) bump(d.models, e.m);
    if (e.cc) bump(d.countries, e.cc);

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


/* ---------------- rollup total: akumulasi per isolate, bukan rebutan satu kunci ----
   Dulu tiap event manggil bumpTotal(): baca stats:total, tambahin, tulis balik, retry 3x.
   KV tidak punya atomic add dan konsistensinya eventual, jadi dua isolate yang nulis
   barengan saling nimpa -> angka "all-time" bocor ke bawah dan makin lama makin
   ngelenceng dari log event. Sekarang tiap isolate nyimpen rollupnya sendiri di
   stats:tot:<hari>:<id-isolate> (satu penulis per kunci = tidak ada yang ke-nimpa),
   ditulis sekaligus beberapa event, dan total dibaca dengan ngejumlahin shard.
   stats:evt:* tetap satu-satunya sumber kebenaran; kalau ada ekor yang ikut mati bareng
   isolate, /api/stats/rebuild nyusun ulang dari event. */

// crypto.getRandomValues nggak boleh dipanggil di global scope (Cloudflare error 10021
// waktu deploy), jadi id isolate dibikin malas — pas pertama dibutuhkan di dalam handler.
let ISOLATE_ID = null;
function isolateId() {
  if (!ISOLATE_ID) ISOLATE_ID = b64url(crypto.getRandomValues(new Uint8Array(6)));
  return ISOLATE_ID;
}
const TOTAL_FLUSH_EVENTS = 8;
const TOTAL_FLUSH_MS = 10_000;
let pendingTotal = null;

function addMapNums(dst, src) {
  for (const [k, v] of Object.entries(src || {})) dst[k] = (dst[k] || 0) + v;
}

/** Tambahin satu event ke struktur rollup. Murni, bisa dites tanpa KV. */
function addTotalEvent(total, evt) {
  const type = evt.type;
  const n = Math.max(1, evt.n || 1);
  if (type === 'session' || type === 'pageview' || type === 'hit') total.pageviews += 1;
  else if (type === 'extract') { total.extracts += 1; if (evt.platform) bump(total.platforms, evt.platform); }
  else if (type === 'download') { total.downloads += n; if (evt.platform) bump(total.platforms, evt.platform, n); }
  const cls = evt.cls || {};
  // nama bucket di total != nama field di hasil classifyUa (clients <- cls.client, dst)
  for (const [field, key] of [['clients', 'client'], ['devices', 'device'], ['browsers', 'browser'], ['os', 'os']]) {
    if (cls[key]) bump(total[field], cls[key]);
  }
  if (evt.newLifetime) total.unique_all_approx += 1;
  if (evt.newSessionDay) total.sessions += 1;
  const now = new Date().toISOString();
  if (!total.first_seen) total.first_seen = now;
  total.last_seen = now;
  return total;
}

/** Gabung dua rollup (dipakai buat njumlahin shard). Murni. */
function mergeTotals(a, b) {
  const out = { ...emptyTotal(), ...(a || {}) };
  out.clients = { ...(a && a.clients) || {} };
  out.devices = { ...(a && a.devices) || {} };
  out.browsers = { ...(a && a.browsers) || {} };
  out.os = { ...(a && a.os) || {} };
  out.platforms = { ...(a && a.platforms) || {} };
  const src = b || {};
  for (const k of ['pageviews', 'sessions', 'extracts', 'downloads', 'unique_all_approx']) {
    out[k] = (out[k] || 0) + (src[k] || 0);
  }
  for (const field of ['clients', 'devices', 'browsers', 'os', 'platforms']) addMapNums(out[field], src[field]);
  if (src.first_seen && (!out.first_seen || src.first_seen < out.first_seen)) out.first_seen = src.first_seen;
  if (src.last_seen && (!out.last_seen || src.last_seen > out.last_seen)) out.last_seen = src.last_seen;
  return out;
}

async function accumulateTotal(env, evt) {
  const now = Date.now();
  const windowHidup = pendingTotal && pendingTotal.day === dayKey()
    && pendingTotal.events < TOTAL_FLUSH_EVENTS && now - pendingTotal.started < TOTAL_FLUSH_MS;
  if (pendingTotal && !windowHidup) {
    await flushTotal(env, true);  // window lama (penuh / beda hari / kedaluwarsa) ditulis dulu,
                                  // jangan dibuang: dulu inikehilangan ekor angka tiap ganti window
  }
  if (!pendingTotal) pendingTotal = { day: dayKey(), started: Date.now(), events: 0, total: emptyTotal() };
  addTotalEvent(pendingTotal.total, evt);
  pendingTotal.events += 1;
  if (pendingTotal.events >= TOTAL_FLUSH_EVENTS || Date.now() - pendingTotal.started >= TOTAL_FLUSH_MS) {
    await flushTotal(env, true);
  }
}

/** Tulis (dan kosongin) window yang lagi jalan. force=true dipakai pas admin baca. */
async function flushTotal(env, force = false) {
  const win = pendingTotal;
  if (!win) return null;
  if (!force && win.events < TOTAL_FLUSH_EVENTS && Date.now() - win.started < TOTAL_FLUSH_MS) return null;
  pendingTotal = null;
  const key = `stats:tot:${win.day}:${isolateId()}`;
  let prev = null;
  try { prev = await env.CONFIG.get(key, 'json'); } catch { prev = null; }
  const merged = mergeTotals(prev, win.total);
  merged.shard_events = (prev && prev.shard_events || 0) + win.events;
  try {
    await env.CONFIG.put(key, JSON.stringify(merged), { expirationTtl: 60 * 60 * 24 * (STATS_DAYS_KEEP + 30) });
  } catch { pendingTotal = win; }  // tulis gagal -> jangan buang angkanya, tunggu window berikutnya
  return merged;
}

const TOTAL_SHARD_LIMIT = 500;

async function listTotalShards(env) {
  const keys = [];
  let cursor;
  try {
    do {
      const page = await env.CONFIG.list({ prefix: 'stats:tot:', cursor, limit: 1000 });
      for (const k of page.keys || []) keys.push(k.name);
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor && keys.length < TOTAL_SHARD_LIMIT);
  } catch { return []; }
  return keys.slice(0, TOTAL_SHARD_LIMIT);
}

async function sumTotalShards(env) {
  const keys = await listTotalShards(env);
  let out = emptyTotal();
  if (keys.length) {
    for (let i = 0; i < keys.length; i += 50) {
      const chunk = keys.slice(i, i + 50);
      const parts = await Promise.all(chunk.map(async (k) => {
        try { return await env.CONFIG.get(k, 'json'); } catch { return null; }
      }));
      for (const p of parts) if (p && typeof p === 'object') out = mergeTotals(out, p);
    }
  }
  return out;
}

async function loadTotal(env) {
  // Sengaja TIDAK di-cache per isolate: UI admin auto-refresh tiap 60 detik, jadi cache
  // 45 detik tidak pernah ketemu request berikutnya (cuma bikin angka tab kedua basi).
  await flushTotal(env, true);            // ekor window isolate ini ikut kehitung
  let total = await sumTotalShards(env);
  try {
    const legacy = await env.CONFIG.get('stats:total', 'json');  // data sebelum skema shard
    // first_seen/last_seen dari rollup lama ikut dibawa: itu jangkar sejarah angka
    // sebelum ada shard, kalau dibuang 'sejak' di API jadi meleset ke hari ini.
    if (legacy && typeof legacy === 'object') total = mergeTotals(total, legacy);
  } catch { /* */ }
  return total;
}

/** Susun ulang rollup hari ini (atau N hari) dari log event. Penyelamat kalau angka
 *  pernah bocor / isolate mati bawa window yang belum di-flush. */
async function rebuildTotals(env, days = 1) {
  const rebuilt = [];
  for (let i = 0; i < Math.max(1, Math.min(Number(days) || 1, STATS_DAYS_KEEP)); i++) {
    const day = dayKey(new Date(Date.now() - i * 86400000));
    const keys = await listDayEvents(env, day);
    const events = await readEvents(env, keys);
    const total = emptyTotal();
    const uniqSess = new Set();
    events.forEach((e, i) => {
      addTotalEvent(total, {
        type: e.t || 'session',
        n: e.n || 1,
        platform: e.p || null,
        cls: { client: e.c, device: e.d, browser: e.b, os: e.o },
      });
      if ((e.t || 'session') === 'session') uniqSess.add(e.u || `noname:${i}`);
    });
    total.sessions = uniqSess.size;
    total.pageviews = Math.max(total.pageviews, uniqSess.size);
    const key = `stats:tot:${day}:rebuild`;
    await env.CONFIG.put(key, JSON.stringify(total), { expirationTtl: 60 * 60 * 24 * (STATS_DAYS_KEEP + 30) });
    rebuilt.push({ day, events: keys.length, downloads: total.downloads, sessions: total.sessions });
  }
  return rebuilt;
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
    await env.CONFIG.put(key, '1', { expirationTtl: 60 * 60 * 24 * LIFETIME_UNIQ_TTL_DAYS });
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
  const ip = String(evt.ip || '').slice(0, 64) || undefined;
  const cc = String(evt.cc || evt.country || '').slice(0, 8).toUpperCase() || undefined;

  const row = {
    t: type === 'pageview' ? 'session' : type,
    c: cls.client,
    d: cls.device,
    b: cls.browser,
    o: cls.os,
    p: platform || undefined,
    u: evt.cidHash || undefined,
    n: type === 'download' ? n : undefined,
    ip: ip,
    cc: cc,
    bt: cls.bot || undefined,
    m: (cls.model || '').slice(0, 48) || undefined,
    lb: (cls.label || '').slice(0, 80) || undefined,
    ts: Date.now(),
  };
  const exp = 60 * 60 * 24 * (STATS_DAYS_KEEP + 5);
  await env.CONFIG.put(`stats:evt:${day}:${id}`, JSON.stringify(row), { expirationTtl: exp });

  // Keep a short recent-device feed (admin UI)
  if (type === 'session' || type === 'extract' || type === 'download') {
    try {
      await pushRecent(env, 'stats:recent:devices', {
        ts: row.ts,
        ip,
        cc,
        client: cls.client,
        device: cls.device,
        browser: cls.browser,
        os: cls.os,
        model: cls.model,
        label: cls.label,
        platform: platform || null,
        type: row.t,
      }, 40);
    } catch { /* */ }
  }

  // Unique diambil dari event 'session' saja (web & APK kirim session tiap dibuka —
  // lihat public/app.js dan XyApp.kt). Dulu extract/download ikut nendang markUnique:
  // 2 operasi KV tambahan per file yang diunduh orang, tanpa menambah informasi.
  let newSessionDay = false;
  let newLifetime = false;
  if (evt.cidHash && (type === 'session' || type === 'pageview')) {
    newSessionDay = await markUnique(env, day, 'sess', evt.cidHash);
    newLifetime = await markLifetimeUnique(env, evt.cidHash);
  }

  await accumulateTotal(env, {
    type: row.t,
    cls,
    platform,
    n: type === 'download' ? n : 1,
    newSessionDay,
    newLifetime,
  });

  return { ok: true, day, id };
}

async function pushRecent(env, key, item, limit = 40) {
  let list = [];
  try {
    list = (await env.CONFIG.get(key, 'json')) || [];
    if (!Array.isArray(list)) list = [];
  } catch {
    list = [];
  }
  list.unshift(item);
  if (list.length > limit) list = list.slice(0, limit);
  await env.CONFIG.put(key, JSON.stringify(list), { expirationTtl: 60 * 60 * 24 * 30 });
}

async function recordProbe(env, probe) {
  const day = dayKey();
  const id = b64url(crypto.getRandomValues(new Uint8Array(8)));
  const ua = String(probe.ua || '').slice(0, 300);
  const cls = classifyUa(ua, probe.client || 'web');
  const ip = String(probe.ip || '').slice(0, 64);
  const cc = String(probe.cc || '').slice(0, 8).toUpperCase();
  const reason = String(probe.reason || 'probe').slice(0, 64);
  const path = String(probe.path || '').slice(0, 120);
  const row = {
    ts: Date.now(),
    ip,
    cc: cc || undefined,
    reason,
    path: path || undefined,
    ua: ua.slice(0, 180),
    device: cls.device,
    bot: cls.bot || undefined,
    label: cls.label,
    browser: cls.browser,
    os: cls.os,
  };
  const exp = 60 * 60 * 24 * 30;
  await env.CONFIG.put(`stats:probe:${day}:${id}`, JSON.stringify(row), { expirationTtl: exp });
  await pushRecent(env, 'stats:recent:probes', row, 60);

  // Aggregate probe counts by IP (today)
  try {
    const k = `stats:probeip:${day}`;
    const map = (await env.CONFIG.get(k, 'json')) || {};
    const cur = map[ip] || { count: 0, reasons: {}, cc, last_ua: '', last_ts: 0, label: '' };
    cur.count += 1;
    cur.reasons[reason] = (cur.reasons[reason] || 0) + 1;
    cur.cc = cc || cur.cc;
    cur.last_ua = ua.slice(0, 120);
    cur.last_ts = row.ts;
    cur.label = cls.label;
    map[ip || 'unknown'] = cur;
    // cap map size
    const entries = Object.entries(map);
    if (entries.length > 200) {
      entries.sort((a, b) => (b[1].last_ts || 0) - (a[1].last_ts || 0));
      const trimmed = Object.fromEntries(entries.slice(0, 150));
      await env.CONFIG.put(k, JSON.stringify(trimmed), { expirationTtl: exp });
    } else {
      await env.CONFIG.put(k, JSON.stringify(map), { expirationTtl: exp });
    }
  } catch { /* */ }

  return row;
}

async function loadRecentProbes(env) {
  try {
    const list = (await env.CONFIG.get('stats:recent:probes', 'json')) || [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function loadRecentDevices(env) {
  try {
    const list = (await env.CONFIG.get('stats:recent:devices', 'json')) || [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function loadProbeIps(env, day) {
  try {
    return (await env.CONFIG.get(`stats:probeip:${day}`, 'json')) || {};
  } catch {
    return {};
  }
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
  const [total, recentDevices, recentProbes, probeIps, ...dayObjs] = await Promise.all([
    loadTotal(env),
    loadRecentDevices(env),
    loadRecentProbes(env),
    loadProbeIps(env, today),
    ...days.map((d) => loadDay(env, d)),
  ]);
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
  const bots7 = mergeMaps(last7, 'bots');
  const models7 = mergeMaps(last7, 'models');
  const countries7 = mergeMaps(last7, 'countries');

  const probeTop = Object.entries(probeIps || {})
    .map(([ip, v]) => ({
      ip,
      count: v.count || 0,
      cc: v.cc || '',
      label: v.label || '',
      last_ua: v.last_ua || '',
      last_ts: v.last_ts || 0,
      reasons: v.reasons || {},
    }))
    .sort((a, b) => b.count - a.count || b.last_ts - a.last_ts)
    .slice(0, 30);

  return {
    product: 'https://dlaja.xyverse.my.id',
    api_health: 'https://dlaja.xyverse.my.id/api/health',
    maintenance_mode: cfg.maintenance_mode,
    youtube_web_policy: cfg.youtube_web_policy,
    default_video_tier: cfg.default_video_tier,
    updated_at: cfg.updated_at,
    generated_at: new Date().toISOString(),
    realtime: true,
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
    bots: {
      last7: topMap(bots7, 15),
      today: topMap(todayObj.bots || {}, 15),
    },
    models: {
      last7: topMap(models7, 15),
    },
    countries: {
      last7: topMap(countries7, 15),
      today: topMap(todayObj.countries || {}, 15),
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
    recent_devices: (recentDevices || []).slice(0, 25),
    probes: {
      recent: (recentProbes || []).slice(0, 40),
      top_ips_today: probeTop,
      today_count: probeTop.reduce((a, x) => a + (x.count || 0), 0),
    },
    note: 'Data real-time dari beacon web + APK (event append-only di KV). Unique = client-id per hari. IP probe = percobaan menembus (UA terlarang, login gagal, path gelap, flood).',
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
        if (writeAllowed(request.headers.get('CF-Connecting-IP') || '', 'hit')) {
          ctx.waitUntil(
            recordEvent(env, { type: 'hit', ua, client: 'web' }).catch(() => {}),
          );
        }
        return json(publicCfg, 200, {
          ...corsPublic(),
          'cache-control': 'public, max-age=60, s-maxage=300',
        });
      }

      // Public analytics beacon (+ probe reports from product API)
      if (url.pathname === '/api/public/beacon' && request.method === 'POST') {
        // Body kecil doang (beacon). Tanpa batas, satu POST 10 MB cukup buat bikin
        // JSON.parse + classify regex di isolate kita.
        const len = Number(request.headers.get('content-length') || 0);
        if (len > 16_384) return json({ ok: false, error: 'payload_too_large' }, 413, corsPublic());
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, error: 'invalid_json' }, 400, corsPublic());
        }
        if (!body || typeof body !== 'object') {
          // request.json() bisa sukses buat 'null' / '"string"' — jangan dihitung session
          return json({ ok: false, error: 'invalid_json' }, 400, corsPublic());
        }
        // body.ip HANYA dipercaya kalau laporan itu ditandatangani API produk (HMAC),
        // bukan kalau browser asing ngirim { ip: '8.8.8.8' } biar log admin kotor.
        const ident = await probeIdentity(env, request, body.ip, body.cc || body.country);
        const ip = ident.ip;
        const cc = ident.cc;
        const type = String(body.type || body.event || 'session').toLowerCase();
        const ua = String(body.ua || request.headers.get('user-agent') || '').slice(0, 400);
        const client = String(body.client || '').toLowerCase() === 'apk' ? 'apk' : 'web';

        if (type === 'probe') {
          if (!writeAllowed(ip, 'probe')) return json({ ok: true, limited: true }, 200, corsPublic());
          try {
            await recordProbe(env, {
              ip,
              cc,
              ua: body.ua || ua,
              reason: body.reason || 'probe',
              path: body.path || '',
              client,
            });
          } catch (e) {
            return json({ ok: false, error: 'probe_write', detail: String(e && e.message || e) }, 500, corsPublic());
          }
          return json({ ok: true }, 200, corsPublic());
        }

        if (!['session', 'pageview', 'extract', 'download'].includes(type)) {
          if (writeAllowed(ip, 'probe')) {
            ctx.waitUntil(recordProbe(env, { ip, cc, ua, reason: 'bad_type', path: '/api/public/beacon', client }).catch(() => {}));
          }
          return json({ ok: false, error: 'bad_type' }, 400, corsPublic());
        }
        const cidRaw = String(body.cid || body.client_id || '').slice(0, 80);
        if (cidRaw && !/^[A-Za-z0-9._:-]{8,80}$/.test(cidRaw)) {
          if (writeAllowed(ip, 'probe')) {
            ctx.waitUntil(recordProbe(env, { ip, cc, ua, reason: 'bad_cid', path: '/api/public/beacon', client }).catch(() => {}));
          }
          return json({ ok: false, error: 'bad_cid' }, 400, corsPublic());
        }
        const cidHash = cidRaw ? await shaShort(cidRaw) : null;
        const platform = body.platform ? String(body.platform).slice(0, 64) : null;
        const count = body.count;

        // Flag obvious bots hitting beacon as probe too (still count event)
        const cls = classifyUa(ua, client);
        if (cls.device === 'bot' && writeAllowed(ip, 'probe')) {
          ctx.waitUntil(recordProbe(env, { ip, cc, ua, reason: 'bot_beacon', path: '/api/public/beacon', client }).catch(() => {}));
        }

        // Pintu masuk tulis KV: event ke-41 dari IP yang sama dalam 1 menit tidak ditulis.
        if (!writeAllowed(ip, 'event')) {
          return json({ ok: true, limited: true }, 200, corsPublic());
        }

        try {
          await recordEvent(env, { type, ua, client, cidHash, platform, count, ip, cc });
        } catch (e) {
          return json({ ok: false, error: 'stats_write', detail: String(e && e.message || e) }, 500, corsPublic());
        }
        return json({ ok: true }, 200, corsPublic());
      }

      // Gate check for document navigations
      if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
        if (!gateOk(env, url) && url.pathname !== '/robots.txt') {
          const ip = request.headers.get('CF-Connecting-IP') || '';
          const cc = request.headers.get('CF-IPCountry') || '';
          const ua = request.headers.get('user-agent') || '';
          // path scanning / dark gate probe
          if (url.pathname === '/' || url.pathname === '/login' || url.pathname === '/app'
              || url.pathname.startsWith('/g/') || url.pathname.includes('admin')
              || url.pathname.includes('.env') || url.pathname.includes('wp-')) {
            ctx.waitUntil(recordProbe(env, {
              ip, cc, ua, reason: 'path_scan', path: url.pathname.slice(0, 120),
            }).catch(() => {}));
          }
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
            if (!ts.ok) {
              ctx.waitUntil(recordProbe(env, {
                ip, cc: request.headers.get('CF-IPCountry') || '',
                ua: request.headers.get('user-agent') || '',
                reason: 'login_turnstile',
                path: '/api/login',
              }).catch(() => {}));
              return json({ ok: false, error: 'turnstile_failed', detail: ts.error }, 403);
            }

            const user = String(body.username || '');
            const pass = String(body.password || '');
            if (!env.ADMIN_USER || !env.ADMIN_PASS_HASH) {
              return json({ ok: false, error: 'server_misconfigured', detail: 'admin secrets missing' }, 500);
            }
            if (user !== env.ADMIN_USER) {
              ctx.waitUntil(recordProbe(env, {
                ip, cc: request.headers.get('CF-IPCountry') || '',
                ua: request.headers.get('user-agent') || '',
                reason: 'login_user',
                path: '/api/login',
              }).catch(() => {}));
              return json({ ok: false, error: 'invalid_credentials' }, 401);
            }
            const ok = await verifyPassword(pass, env.ADMIN_PASS_HASH, env);
            if (!ok) {
              ctx.waitUntil(recordProbe(env, {
                ip, cc: request.headers.get('CF-IPCountry') || '',
                ua: request.headers.get('user-agent') || '',
                reason: 'login_pass',
                path: '/api/login',
              }).catch(() => {}));
              return json({ ok: false, error: 'invalid_credentials' }, 401);
            }
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

        if (url.pathname === '/api/notify' && request.method === 'POST') {
          // Kirim pengumuman push (OneSignal) ke semua subscriber. REST API key hidup
          // di secret ONESIGNAL_REST_API_KEY — nggak pernah nyentuh repo.
          let body = {};
          try { body = (await request.json()) || {}; } catch { /* kosong */ }
          const heading = String(body.heading || '').trim().slice(0, 100);
          const message = String(body.message || '').trim().slice(0, 500);
          const target = String(body.url || 'https://github.com/xykal/XyDownloader/releases/latest').slice(0, 500);
          if (!message) return json({ ok: false, error: 'message_required' }, 400);
          const key = env.ONESIGNAL_REST_API_KEY;
          if (!key) {
            return json({ ok: false, error: 'not_configured', detail: 'Secret ONESIGNAL_REST_API_KEY belum disetel' }, 503);
          }
          const now = Date.now();
          const last = notifyLast.get(sess.u) || 0;
          if (now - last < 60_000) return json({ ok: false, error: 'cooldown', detail: 'Tunggu 1 menit sebelum kirim berikutnya' }, 429);
          notifyLast.set(sess.u, now);
          const sent = await fetch('https://api.onesignal.com/notifications', {
            method: 'POST',
            headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              app_id: env.ONESIGNAL_APP_ID || ONESIGNAL_APP_ID,
              headings: { en: heading || 'DownloadAja' },
              contents: { en: message },
              included_segments: ['Total Subscriptions'],
              url: target,
              large_icon: 'https://dlaja.xyverse.my.id/icon-192.png',
            }),
          });
          const out = await sent.json().catch(() => ({}));
          if (!sent.ok) {
            return json({ ok: false, error: 'onesignal_failed', detail: out.errors || out || `HTTP ${sent.status}` }, 502);
          }
          return json({ ok: true, id: out.id || null, recipients: out.recipients ?? null, by: sess.u });
        }

        if (url.pathname === '/api/stats/rebuild' && request.method === 'POST') {
          // Nyusun ulang rollup dari log event (stats:evt:*). Dipakai kalau angka "all-time"
          // pernah bocor, atau sesudah pindah skema shard.
          let days = 1;
          try {
            const body = await request.json();
            days = parseInt((body && body.days), 10) || 1;
          } catch { /* tanpa body: 1 hari */ }
          const rows = await rebuildTotals(env, days);
          return json({ ok: true, rows, by: sess.u });
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
