/**
 * Tes kuota unduh harian (docs/PRD-v1.4.md §10.2: 500 MB/user/hari).
 *
 * Yang dijaga: batas benar-benar nahan saat lewat, kill switch jalan, hitungan
 * byte nggak salah, pergantian hari reset, dan kalau KV-nya nggak ada (atau
 * nulisnya gagal) unduhan tetap jalan — kuota kalah penting dari availability.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_QUOTA_MB,
  FLUSH_STEP,
  MB,
  countBody,
  createQuota,
  dayKey,
  secondsUntilDayEnd,
} from '../../worker/src/quota.js';

function fakeKv() {
  const store = new Map();
  const puts = [];
  return {
    store,
    puts,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value, opts = {}) {
      store.set(key, value);
      puts.push({ key, value, opts });
    },
  };
}

const IP = '203.0.113.9';

test('di bawah batas: lolos dengan sisa; lewat batas: 429 + retryAfter', async () => {
  const kv = fakeKv();
  const t0 = Date.parse('2026-09-28T10:00:00Z');
  const q = createQuota({ QUOTA: kv }, { now: () => t0 });

  let gate = await q.check(IP);
  assert.equal(gate.ok, true);
  assert.equal(gate.remaining, DEFAULT_QUOTA_MB * MB);

  await q.add(IP, 300 * MB);
  gate = await q.check(IP);
  assert.equal(gate.ok, true);
  assert.equal(gate.remaining, 200 * MB);

  await q.add(IP, 250 * MB); // total 550 MB
  gate = await q.check(IP);
  assert.equal(gate.ok, false);
  assert.equal(gate.error, undefined);
  assert.ok(gate.retryAfter >= 1 && gate.retryAfter <= 86400);
});

test('nembus batas langsung di-flush ke KV biar isolate lain ikut nahan', async () => {
  const kv = fakeKv();
  const q = createQuota({ QUOTA: kv }, { now: () => Date.parse('2026-09-28T10:00:00Z') });
  await q.add(IP, 520 * MB);
  const flushed = kv.puts.filter((p) => p.key === `q:2026-09-28:${IP}`);
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].value, String(520 * MB));
  assert.ok(flushed[0].opts.expirationTtl >= 3600, 'kunci dikasih TTL, nggak numpuk selamanya');

  const q2 = createQuota({ QUOTA: kv }); // "isolate lain"
  assert.equal((await q2.check(IP)).ok, false);
});

test('flush kelipatan 5 MB aja — request Range nggak bikin 1 tulis per potongan', async () => {
  const kv = fakeKv();
  const q = createQuota({ QUOTA: kv }, { now: () => Date.parse('2026-09-28T10:00:00Z') });
  for (let i = 0; i < 10; i += 1) await q.add(IP, 0.5 * MB); // total 5 MB
  assert.equal(kv.puts.length, 1, 'baru nulis pas nyentuh FLUSH_STEP');
  for (let i = 0; i < 9; i += 1) await q.add(IP, 0.5 * MB); // total 9.5 MB
  assert.equal(kv.puts.length, 1, '4,5 MB berikutnya masih di memori');
  await q.add(IP, 0.5 * MB); // 10 MB
  assert.equal(kv.puts.length, 2);
});

test('kill switch: XYDL_QUOTA_MB=0 = tanpa batas, nggak nulis KV', async () => {
  const kv = fakeKv();
  const q = createQuota({ QUOTA: kv, XYDL_QUOTA_MB: '0' });
  await q.add(IP, 10_000 * MB);
  assert.equal((await q.check(IP)).ok, true);
  assert.equal((await q.check(IP)).unlimited, true);
  assert.equal(kv.puts.length, 0);
});

test('tanpa binding KV = tanpa batas (deploy lawas tetap jalan)', async () => {
  const q = createQuota({});
  assert.equal((await q.check(IP)).ok, true);
  await q.add(IP, 10_000 * MB);
  assert.equal((await q.check(IP)).ok, true);
});

test('ganti hari UTC = hitungan baru, kunci lama nggak kebaca', async () => {
  const kv = fakeKv();
  const day1 = Date.parse('2026-09-28T23:59:00Z');
  const q1 = createQuota({ QUOTA: kv }, { now: () => day1 });
  await q1.add(IP, 600 * MB);
  assert.equal((await q1.check(IP)).ok, false);
  assert.equal(dayKey(day1), '2026-09-28');

  const day2 = Date.parse('2026-09-29T00:01:00Z');
  const q2 = createQuota({ QUOTA: kv }, { now: () => day2 });
  assert.equal((await q2.check(IP)).ok, true);
  assert.equal((await q2.check(IP)).remaining, DEFAULT_QUOTA_MB * MB);
});

test('ip beda = ember beda', async () => {
  const kv = fakeKv();
  const q = createQuota({ QUOTA: kv }, { now: () => Date.parse('2026-09-28T10:00:00Z') });
  await q.add(IP, 600 * MB);
  assert.equal((await q.check(IP)).ok, false);
  assert.equal((await q.check('198.51.100.7')).ok, true);
});

test('countBody: hitungan byte pas, stream utuh nggak keganggu', async () => {
  let counted = 0;
  const parts = [new Uint8Array(1000), new Uint8Array(500), new Uint8Array(3)];
  const src = ReadableStream.from(parts.map((p) => p));
  const out = countBody(src, (n) => { counted += n; });
  const got = new Uint8Array(await new Response(out).arrayBuffer());
  assert.equal(got.byteLength, 1503);
  assert.equal(counted, 1503);
  assert.equal(countBody(null, () => {}), null);
});

test('secondsUntilDayEnd: tengah malam UTC', () => {
  assert.equal(secondsUntilDayEnd(Date.parse('2026-09-28T00:00:00Z')), 86400);
  assert.equal(secondsUntilDayEnd(Date.parse('2026-09-28T23:59:59Z')), 1);
  assert.equal(FLUSH_STEP, 5 * MB);
});
