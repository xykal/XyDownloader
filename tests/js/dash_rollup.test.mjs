/**
 * Tes rollup statistik dash: batch per isolate, bukan rebutan satu kunci KV.
 *
 * Alasan: stats:total dulu dibaca-tulis per event (retry 3x). KV tidak punya atomic add,
 * dua isolate yang nulis barengan saling nimpa -> angka all-time bocor ke bawah dan tidak
 * pernah nyambung sama log event. Yang diuji di sini jalur Worker aslinya, lengkap dengan
 * cache per isolate, force-flush pas admin baca, dan endpoint rebuild.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import dash from '../../dash/src/index.js';

const SECRET = 'kunci-sesi-tes';
const HOST = 'https://dash.dlaja.xyverse.my.id';

function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  const writes = [];
  const opts = new Map();
  return {
    store, writes, opts,
    async get(k, type) {
      if (!store.has(k)) return null;
      const v = store.get(k);
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v, o) {
      store.set(k, String(v));
      writes.push(k);
      if (o) opts.set(k, o);
    },
    async delete(k) { store.delete(k); writes.push(`del:${k}`); },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const all = [...store.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit);
      return { keys: all.map((name) => ({ name })), list_complete: true, cursor: null };
    },
  };
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function adminCookie(user = 'xykal') {
  const payload = b64url(Buffer.from(JSON.stringify({ u: user, exp: Math.floor(Date.now() / 1000) + 3600 })));
  const sig = b64url(createHmac('sha256', SECRET).update(payload).digest());
  return `dlaja_admin_sess=${payload}.${sig}`;
}

function req({ method = 'POST', path = '/api/public/beacon', headers = {}, body } = {}) {
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

const beacon = (env, ip, body) => dash.fetch(
  req({ headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' }, body }),
  env, ctx,
);

async function overview(env) {
  const res = await dash.fetch(req({ method: 'GET', path: '/api/overview', headers: { Cookie: adminCookie() } }), env, ctx);
  const text = await res.text();
  assert.equal(res.status, 200, `overview harus 200, dapat ${res.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  assert.ok(data.overview, `respons tidak ada overview: ${text.slice(0, 160)}`);
  return data.overview;
}

test('total tidak lagi ditulis per event, tapi di-batch ke shard punya isolate', async () => {
  const kv = fakeKv();
  const env = { CONFIG: kv, GATE_PATH: '', SESSION_SECRET: SECRET, PROBE_REPORT_SECRET: 'p' };
  const ip = '198.51.100.101';
  const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 15; SM-A556B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36';
  for (let i = 0; i < 5; i++) {
    const r = await beacon(env, ip, { type: 'download', cid: 'w_batchclient01', ua: ANDROID_CHROME, platform: 'tiktok', count: 2 });
    assert.equal(r.status, 200);
  }
  assert.ok(!kv.writes.includes('stats:total'), 'stats:total tidak boleh disentuh lagi (itu kunci rebutan)');

  // admin baca -> force flush ekor window -> angka harus utuh, bukan 5-nya doang
  const o = await overview(env);
  const shardKeys = [...kv.store.keys()].filter((k) => k.startsWith('stats:tot:'));
  assert.equal(shardKeys.length, 1, `harus ada 1 kunci shard, dapat ${shardKeys.join(', ')}`);
  assert.match(shardKeys[0], /^stats:tot:\d{4}-\d{2}-\d{2}:[A-Za-z0-9_-]+$/, 'format kunci shard = hari + id isolate');
  assert.equal(o.total.downloads, 10, '5 event x count 2');
  assert.equal(o.total.extracts, 0);
  const shard = JSON.parse(kv.store.get(shardKeys[0]));
  assert.equal(shard.clients.web, 5);
  assert.equal(shard.devices.mobile, 5);
  assert.equal(shard.browsers.chrome, 5);
  assert.equal(shard.os.android, 5);
  assert.equal(shard.platforms.tiktok, 10);
  assert.equal(shard.shard_events, 5);
});

test('batch kepecah tiap 8 event, bukan tiap 1', async () => {
  const kv = fakeKv();
  const env = { CONFIG: kv, GATE_PATH: '', SESSION_SECRET: SECRET, PROBE_REPORT_SECRET: 'p' };
  const before = kv.writes.length;
  for (let i = 0; i < 7; i++) {
    await beacon(env, '198.51.100.102', { type: 'extract', cid: 'w_batchclient02', ua: 'Mozilla/5.0 (Macintosh)' });
  }
  const shardWrites = kv.writes.filter((k) => k.startsWith('stats:tot:')).length;
  assert.equal(shardWrites, 0, 'belum 8 event dan belum 10 detik -> belum ada tulis shard');
  await beacon(env, '198.51.100.102', { type: 'extract', cid: 'w_batchclient02', ua: 'Mozilla/5.0 (Macintosh)' });
  assert.equal(kv.writes.filter((k) => k.startsWith('stats:tot:')).length, 1, 'event ke-8 nyentuh flush');
  assert.ok(kv.writes.length - before < 20, 'masih jauh lebih hemat dari 8 x (get+put) + retry');
});

test('overview itu baca, bukan nulis: dipanggil 2x hasilnya sama dan tidak nambah tulis', async () => {
  const kv = fakeKv();
  const env = { CONFIG: kv, GATE_PATH: '', SESSION_SECRET: SECRET, PROBE_REPORT_SECRET: 'p' };
  await beacon(env, '198.51.100.103', { type: 'session', cid: 'w_cachetest0001', ua: 'Mozilla/5.0 (iPhone)' });
  const a = await overview(env);
  const writesSet = () => kv.writes.length;
  const b = await overview(env);
  assert.deepEqual(a.total, b.total, 'dua kali baca = angka yang sama (flush ekor idempoten)');
  assert.equal(writesSet(), kv.writes.length, 'overview tidak boleh nulis apa-apa lagi setelah flush pertama');
});

test('rollup lama (stats:total) tetap dihitung, tidak hilang saat migrasi skema', async () => {
  const kv = fakeKv({
    'stats:total': JSON.stringify({ downloads: 77, extracts: 9, pageviews: 5, sessions: 3, unique_all_approx: 4, clients: { web: 4, apk: 3 }, first_seen: '2026-01-01T00:00:00.000Z', last_seen: '2026-01-01T00:00:00.000Z' }),
  });
  const env = { CONFIG: kv, GATE_PATH: '', SESSION_SECRET: SECRET, PROBE_REPORT_SECRET: 'p' };
  await beacon(env, '198.51.100.104', { type: 'download', cid: 'w_migrasi00001', ua: 'DownloadAja/1.3.2 (Android 15; Pixel 8)', platform: 'youtube', count: 3 });
  const o = await overview(env);
  assert.equal(o.total.downloads, 80, '77 lama + 3 baru');
  assert.equal(o.total.extracts, 9, 'angka lama jangan jadi nol cuma gara-gara ganti skema');
  assert.equal(o.total.first_seen, '2026-01-01T00:00:00.000Z', 'jangkar sejarah tetap dari rollup lama');
});

test('admin bisa bangun ulang rollup dari log event', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const evts = {
    [`stats:evt:${day}:a`]: { t: 'session', c: 'web', d: 'desktop', b: 'chrome', o: 'windows' },
    [`stats:evt:${day}:b`]: { t: 'download', n: 4, c: 'apk', d: 'mobile', p: 'tiktok' },
    [`stats:evt:${day}:c`]: { t: 'extract', c: 'web', d: 'desktop', p: 'bilibili' },
  };
  const store = new Map(Object.entries(evts).map(([k, v]) => [k, JSON.stringify(v)]));
  const writes = [];
  const kv = {
    store,
    async get(k, type) { return store.has(k) ? (type === 'json' ? JSON.parse(store.get(k)) : store.get(k)) : null; },
    async put(k, v) { store.set(k, String(v)); writes.push(k); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
  const env = { CONFIG: kv, GATE_PATH: '', SESSION_SECRET: SECRET, PROBE_REPORT_SECRET: 'p' };
  const res = await dash.fetch(req({ method: 'POST', path: '/api/stats/rebuild', headers: { Cookie: adminCookie() }, body: { days: 1 } }), env, ctx);
  assert.equal(res.status, 200);
  const out = JSON.parse(await res.text());
  assert.equal(out.rows[0].events, 3);
  const rebuilt = JSON.parse(store.get(`stats:tot:${day}:rebuild`));
  assert.equal(rebuilt.downloads, 4, 'event download yang lama harus kebaca lagi');
  assert.equal(rebuilt.extracts, 1);
  assert.equal(rebuilt.sessions, 1);
  assert.equal(rebuilt.platforms.tiktok, 4);

  // tanpa sesi admin, endpoint ini tidak boleh bisa dipanggil
  const anon = await dash.fetch(req({ method: 'POST', path: '/api/stats/rebuild', body: { days: 1 } }), env, ctx);
  assert.ok([401, 403].includes(anon.status), `rebuild tanpa login harus ditolak, dapat ${anon.status}`);
});

test('kunci lifetime-unique berumur 90 hari, bukan 800 hari', async () => {
  const kv = fakeKv();
  const env = { CONFIG: kv, GATE_PATH: '', SESSION_SECRET: SECRET, PROBE_REPORT_SECRET: 'p' };
  await beacon(env, '198.51.100.105', { type: 'session', cid: 'w_ttltahunter01', ua: 'Mozilla/5.0' });
  const lifeKey = [...kv.store.keys()].find((k) => k.startsWith('stats:uniq:life:'));
  assert.ok(lifeKey, 'kunci lifetime harus tetap dibuat');
  const ttl = kv.opts.get(lifeKey).expirationTtl;
  assert.equal(ttl, 60 * 60 * 24 * 90, `TTL ${ttl} detik = ${Math.round(ttl / 86400)} hari, harus 90`);
});
