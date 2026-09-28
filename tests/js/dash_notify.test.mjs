/**
 * Tes route kirim pengumuman push (OneSignal) di dash admin.
 *
 * Yang dijaga: cuma admin yang bisa kirim, pesan kosong ditolak, key yang belum
 * disetel bikin 503 (bukan 500), ada jeda 60 detik antar kirim, dan payload ke
 * OneSignal berisi app_id yang bener — bukan app tetangga.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import dash from '../../dash/src/index.js';

const SECRET = 'kunci-sesi-tes';
const HOST = 'https://dash.dlaja.xyverse.my.id';
const APP_ID = '8d66b3fd-06ea-4df6-aa39-0487d1cf85aa';

function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(k, type) {
      if (!store.has(k)) return null;
      const v = store.get(k);
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) {
      return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true, cursor: null };
    },
  };
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function adminCookie(user = 'xykal') {
  const payload = b64url(Buffer.from(JSON.stringify({ u: user, exp: Math.floor(Date.now() / 1000) + 3600 })));
  const sig = b64url(createHmac('sha256', SECRET).update(payload).digest());
  return `dlaja_admin_sess=${payload}.${sig}`;
}

function req({ method = 'POST', path = '/api/notify', headers = {}, body } = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), String(v)]));
  return {
    method,
    url: HOST + path,
    headers: { get: (n) => (h.has(String(n).toLowerCase()) ? h.get(String(n).toLowerCase()) : null) },
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  };
}

const ctx = { waitUntil: () => {} };

function mkEnv(extra = {}) {
  return {
    CONFIG: fakeKv(),
    SESSION_SECRET: SECRET,
    ONESIGNAL_REST_API_KEY: 'kunci-rest-tes',
    ...extra,
  };
}

function withFakeFetch(fn) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'notif-tes-1', recipients: 0 }),
    };
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => { globalThis.fetch = orig; })
    .then(() => calls);
}

test('admin kirim pengumuman: payload OneSignal lengkap, app_id DownloadAja', async () => {
  const env = mkEnv();
  const calls = await withFakeFetch(async () => {
    const res = await dash.fetch(req({
      headers: { Cookie: adminCookie() },
      body: { heading: 'Rilis 1.3.3', message: 'Sudah tersedia, ketuk untuk memperbarui.' },
    }), env, ctx);
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.ok, true);
    assert.equal(d.id, 'notif-tes-1');
    assert.equal(d.by, 'xykal');
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.onesignal.com/notifications');
  assert.equal(calls[0].init.headers.Authorization, 'Key kunci-rest-tes');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.app_id, APP_ID, 'app_id harus punya DownloadAja, bukan app lain');
  assert.deepEqual(body.included_segments, ['Total Subscriptions']);
  assert.equal(body.contents.en, 'Sudah tersedia, ketuk untuk memperbarui.');
  assert.equal(body.headings.en, 'Rilis 1.3.3');
});

test('pesan kosong ditolak tanpa menyentuh OneSignal', async () => {
  const calls = await withFakeFetch(async () => {
    const res = await dash.fetch(req({ headers: { Cookie: adminCookie() }, body: { message: '   ' } }), mkEnv(), ctx);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'message_required');
  });
  assert.equal(calls.length, 0);
});

test('tanpa sesi admin: 401, tanpa fetch', async () => {
  const calls = await withFakeFetch(async () => {
    const res = await dash.fetch(req({ body: { message: 'halo' } }), mkEnv(), ctx);
    assert.equal(res.status, 401);
  });
  assert.equal(calls.length, 0);
});

test('secret belum disetel: 503 not_configured, bukan 500', async () => {
  const calls = await withFakeFetch(async () => {
    const env = mkEnv({ ONESIGNAL_REST_API_KEY: undefined });
    const res = await dash.fetch(req({ headers: { Cookie: adminCookie() }, body: { message: 'halo' } }), env, ctx);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'not_configured');
  });
  assert.equal(calls.length, 0);
});

test('cooldown 60 detik: kirim beruntun ditahan', async () => {
  const env = mkEnv();
  await withFakeFetch(async () => {
    const first = await dash.fetch(req({ headers: { Cookie: adminCookie('cool-user') }, body: { message: 'satu' } }), env, ctx);
    assert.equal(first.status, 200);
    const second = await dash.fetch(req({ headers: { Cookie: adminCookie('cool-user') }, body: { message: 'dua' } }), env, ctx);
    assert.equal(second.status, 429);
    assert.equal((await second.json()).error, 'cooldown');
  });
});

test('gagal dari OneSignal diteruskan sebagai 502 dengan detail', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ errors: ['invalid app_id'] }) });
  try {
    const res = await dash.fetch(req({ headers: { Cookie: adminCookie('err-user') }, body: { message: 'halo' } }), mkEnv(), ctx);
    assert.equal(res.status, 502);
    const d = await res.json();
    assert.equal(d.error, 'onesignal_failed');
    assert.deepEqual(d.detail, ['invalid app_id']);
  } finally {
    globalThis.fetch = orig;
  }
});
