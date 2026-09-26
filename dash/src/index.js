/**
 * DownloadAja Admin — dash.dlaja.xyverse.my.id
 * Auth: username + password (PBKDF2) + Cloudflare Turnstile
 * Gate path: /g/<GATE_PATH>/…  (obscure entry; not real security)
 * Data: KV CONFIG (remote flags) + Analytics Engine (optional metrics)
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

const COOKIE = 'dlaja_admin_sess';
const SESSION_TTL = 60 * 60 * 12; // 12h

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

async function pbkdf2Verify(password, stored) {
  // pbkdf2$iter$salt$b64hash
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iter = parseInt(parts[1], 10);
  const salt = b64urlToBytes(parts[2]);
  const want = b64urlToBytes(parts[3]);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, want.length * 8);
  const got = new Uint8Array(bits);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
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
  const parts = [
    `${COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ];
  return parts.join('; ');
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
  youtube_web_policy: 'warn', // hide | warn | allow
  default_autoplay: true,
  default_filename_template: 'brand-title-id',
  default_video_tier: 'normal',
  default_audio_kbps: 192,
  announce_banner: null, // { title, image, link, version }
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
  if (!gate) return true; // no gate configured
  // allow /api/public/* without gate
  if (url.pathname.startsWith('/api/public/')) return true;
  // login APIs need gate? allow /api/login from gate pages only via Origin check soft
  if (url.pathname === '/api/login' || url.pathname === '/api/logout' || url.pathname === '/api/me') return true;
  // HTML entry must be under /g/<gate>/
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // robots
    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nDisallow: /\n', {
        headers: { 'content-type': 'text/plain', 'x-robots-tag': 'noindex' },
      });
    }

    // Public config for main app (CORS limited)
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
      return json(publicCfg, 200, {
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=60, s-maxage=300',
      });
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
        if (user !== env.ADMIN_USER) return json({ ok: false, error: 'invalid_credentials' }, 401);
        const ok = await pbkdf2Verify(pass, env.ADMIN_PASS_HASH);
        if (!ok) return json({ ok: false, error: 'invalid_credentials' }, 401);

        const sess = await makeSession(env, user);
        return json(
          { ok: true, user },
          200,
          { 'set-cookie': sessionCookie(sess, SESSION_TTL) },
        );
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

      if (url.pathname === '/api/overview' && request.method === 'GET') {
        const cfg = await getConfig(env);
        // Metrics: placeholder until AE queries wired; show config health
        return json({
          ok: true,
          overview: {
            note: 'Unique analytics beacon menyusul. Ringkasan saat ini dari remote config + health.',
            maintenance_mode: cfg.maintenance_mode,
            youtube_web_policy: cfg.youtube_web_policy,
            default_video_tier: cfg.default_video_tier,
            updated_at: cfg.updated_at,
            product: 'https://dlaja.xyverse.my.id',
            api_health: 'https://dlaja.xyverse.my.id/api/health',
          },
        });
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
        // CF Workers Assets: fetch with URL path
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
  },
};
