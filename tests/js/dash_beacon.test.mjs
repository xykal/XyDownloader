/**
 * Tes endpoint publik dash (/api/public/beacon + /api/public/config) dengan KV tiruan.
 *
 * Kenapa perlu: beacon itu satu-satunya endpoint publik yang MENULIS ke KV. Sebelum
 * ada batas tulis, satu loop `curl` cukup buat ngabisin kuota tulis KV bulanan dan
 * nulis angka/IP karangan ke log admin. Yang diuji di sini jalur Worker aslinya
 * (dash/src/index.js), bukan reimplementasi.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import dash from '../../dash/src/index.js';

const SECRET = 'rahasia-laporan-probe';
const HOST = 'https://dash.dlaja.xyverse.my.id';

function fakeKv() {
  const store = new Map();
  const writes = [];
  return {
    store,
    writes,
    async get(k, type) {
      if (!store.has(k)) return null;
      const v = store.get(k);
      // KV asli: type 'json' sudah di-parse di edge. Jangan kembalikan string mentah,
      // nanti {...string} nyebar jadi 40.000 key numerik dan tes jadi super lambat.
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) {
      store.set(k, String(v));
      writes.push(k);
    },
    async delete(k) {
      store.delete(k);
      writes.push(`del:${k}`);
    },
    async list() {
      return { keys: [], list_complete: true };
    },
  };
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

function makeEnv() {
  const CONFIG = fakeKv();
  return { CONFIG, env: { CONFIG, GATE_PATH: '', SESSION_SECRET: 'sess', PROBE_REPORT_SECRET: SECRET } };
}

const probeSig = (ts, ip) => createHmac('sha256', SECRET).update(`${ts}.${ip}`).digest('hex');

test('IP yang dicatat = IP dari Cloudflare, bukan dari body (anti log poisoning)', async () => {
  const { CONFIG, env } = makeEnv();
  const res = await dash.fetch(
    req({
      headers: { 'CF-Connecting-IP': '198.51.100.77', 'Content-Type': 'application/json' },
      body: { type: 'session', cid: 'w_testclient0001', ua: 'Mozilla/5.0 (iPhone) Chrome/139', ip: '8.8.8.8', cc: 'US' },
    }),
    env,
    ctx,
  );
  assert.equal(res.status, 200);
  const recent = JSON.parse(CONFIG.store.get('stats:recent:devices'))[0];
  assert.equal(recent.ip, '198.51.100.77', 'body.ip tidak boleh nimpa IP asli kalau tak bertanda tangan');
  assert.equal(CONFIG.writes.filter((k) => k.startsWith('stats:evt:')).length, 1);
});

test('laporan probe dari API produk dipercaya, TAPI harus lolos HMAC', async () => {
  const { CONFIG, env } = makeEnv();
  const ts = Math.floor(Date.now() / 1000);

  const forged = await dash.fetch(
    req({
      headers: { 'CF-Connecting-IP': '203.0.113.10', 'Content-Type': 'application/json' },
      body: { type: 'probe', ip: '1.1.1.1', reason: 'ua_blocked', path: '/api/extract', ua: 'scrapy/1.0' },
    }),
    env,
    ctx,
  );
  assert.equal(forged.status, 200);
  let row = JSON.parse(CONFIG.store.get('stats:recent:probes'))[0];
  assert.equal(row.ip, '203.0.113.10', 'tanpa signature: pakai IP pengirim');

  const signed = await dash.fetch(
    req({
      headers: {
        'CF-Connecting-IP': '203.0.113.10', 'Content-Type': 'application/json',
        'X-Xydl-Probe-Ts': String(ts), 'X-Xydl-Probe-Sig': probeSig(ts, '198.51.100.42'),
      },
      body: { type: 'probe', ip: '198.51.100.42', cc: 'id', reason: 'rate_limit', path: '/api/extract', ua: 'scrapy/1.0' },
    }),
    env,
    ctx,
  );
  assert.equal(signed.status, 200);
  row = JSON.parse(CONFIG.store.get('stats:recent:probes'))[0];
  assert.equal(row.ip, '198.51.100.42', 'signature sah: IP dari API produk dipakai');
  assert.equal(row.cc, 'ID');
});

test('signature kadaluarsa ditolak (cuma jendelanya 5 menit)', async () => {
  const { CONFIG, env } = makeEnv();
  const old = Math.floor(Date.now() / 1000) - 3600;
  await dash.fetch(
    req({
      headers: {
        'CF-Connecting-IP': '203.0.113.11',
        'X-Xydl-Probe-Ts': String(old), 'X-Xydl-Probe-Sig': probeSig(old, '1.1.1.1'),
      },
      body: { type: 'probe', ip: '1.1.1.1', reason: 'ua_blocked' },
    }),
    env,
    ctx,
  );
  const row = JSON.parse(CONFIG.store.get('stats:recent:probes'))[0];
  assert.equal(row.ip, '203.0.113.11');
});

test('beacon kebanjiran: tulis KV berhenti di budget, klien tetap dibalas 200', async () => {
  const { CONFIG, env } = makeEnv();
  const ip = '198.51.100.99'; // IP khusus buat test ini (budget per IP = 40/menit)
  let statuses = new Set();
  for (let i = 0; i < 120; i++) {
    const res = await dash.fetch(
      req({
        headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' },
        body: { type: 'download', cid: 'w_floodclient001', ua: 'Mozilla/5.0 (Linux; Android 15)', platform: 'tiktok', count: 1 },
      }),
      env,
      ctx,
    );
    statuses.add(res.status);
  }
  const evtWrites = CONFIG.writes.filter((k) => k.startsWith('stats:evt:')).length;
  assert.equal(evtWrites, 40, `harusnya berhenti di 40 tulis event, dapat ${evtWrites}`);
  assert.deepEqual([...statuses], [200], 'menyedihkan kalau klien dibalas error -> dia retry');
});

test('satu orang yang banyak unduh tidak bikin unique dobel dihitung', async () => {
  const { CONFIG, env } = makeEnv();
  const ip = '198.51.100.123';
  const send = async (type) => {
    const r = await dash.fetch(
      req({ headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' }, body: { type, cid: 'w_satuclient0001', ua: 'Mozilla/5.0' } }),
      env, ctx,
    );
    assert.equal(r.status, 200);
  };
  await send('session');
  const afterSession = CONFIG.writes.length;
  await send('download');
  await send('extract');
  const uniq = CONFIG.writes.filter((k) => k.startsWith('stats:uniq:')).length;
  assert.equal(uniq, 2, 'cuma session yang menandai unique (2 kunci: harian + lifetime)');
  assert.ok(afterSession < CONFIG.writes.length, 'download/extract tetap dihitung, cuma lebih murah');
});

test('body gendut ditolak sebelum di-parse', async () => {
  const { env } = makeEnv();
  const res = await dash.fetch(
    req({ headers: { 'CF-Connecting-IP': '198.51.100.5', 'Content-Length': '2000000' }, body: { type: 'session' } }),
    env, ctx,
  );
  assert.equal(res.status, 413);
});

test('tipe sampah tidak bikin panic dan tidak ditulis jadi probe tanpa henti', async () => {
  const { env } = makeEnv();
  const res = await dash.fetch(
    req({ headers: { 'CF-Connecting-IP': '198.51.100.6' }, body: { type: 'eval', cid: 'x' } }),
    env, ctx,
  );
  assert.equal(res.status, 400);
  const bad = await dash.fetch(req({ headers: { 'CF-Connecting-IP': '198.51.100.6' }, body: 'bukan objek' }), env, ctx);
  assert.ok([400, 500].includes(bad.status), `status tak terduga: ${bad.status}`);
});

test('/api/public/config: tetap 200 + cache publik, tidak ada kebocoran secret', async () => {
  const { env } = makeEnv();
  const res = await dash.fetch(req({ method: 'GET', path: '/api/public/config' }), env, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const text = await res.text();
  for (const leak of ['ADMIN_PASS_HASH', 'SESSION_SECRET', 'PROBE_REPORT_SECRET', 'TURNSTILE_SECRET']) {
    assert.ok(!text.includes(leak), `config publik tidak boleh menyentuh ${leak}`);
  }
  const cfg = JSON.parse(text);
  assert.ok('maintenance_mode' in cfg && 'youtube_web_policy' in cfg, 'app butuh field-field ini');
});
