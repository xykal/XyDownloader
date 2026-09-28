/**
 * Tes kebijakan origin Cloudflare Worker (proxy) — dijalankan dengan `node --test`.
 *
 * Tabel kasus dibaca dari fixture yang sama dengan pytest (tests/fixtures/origin_policy.json).
 * Bukan tes gaya "panggil ulang logikanya di test": yang diuji implementasi Worker
 * sungguhan (netpolicy.js) + handler HTTP Worker sungguhan (src/index.js), jadi bug
 * presedensi `A && B || C` yang bikin https://dlaja.evil.com dapat ACAO di produksi
 * tidak bisa balik lagi tanpa CI teriak.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import worker from '../../worker/src/index.js';
import { clientIp, originAllowed } from '../../worker/src/netpolicy.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(readFileSync(join(HERE, '..', 'fixtures', 'origin_policy.json'), 'utf8'));
const ENV = { SIGNING_KEY: 'kunci-tes', };

test('tabel origin: netpolicy.js dan pytest pakai hasil yang sama', () => {
  for (const c of CASES) {
    assert.equal(originAllowed(c.origin, {}), c.expect, `${c.origin} -> ${c.why}`);
  }
});

test('origin asing tidak dapat Access-Control-Allow-Origin', async () => {
  for (const origin of ['https://dlaja.evil.com', 'https://attacker.tld/dlaja', 'https://evil.com', 'null']) {
    const res = await worker.fetch(new Request('https://xydl-proxy.example.workers.dev/', { headers: { Origin: origin } }), ENV);
    assert.equal(res.status, 200, `health ${origin}`);
    assert.equal(res.headers.get('access-control-allow-origin'), null, `${origin} tidak boleh dicerminkan`);
    assert.equal(res.headers.get('vary'), 'Origin', 'tanpa Vary, cache CDN bisa membocorkan ke semua origin');
  }
});

test('origin terdaftar tetap jalan (tidak ada regresi fungsional)', async () => {
  for (const origin of ['https://dlaja.xyverse.my.id', 'http://127.0.0.1:8000', 'https://xydl-git-main-xykal.vercel.app']) {
    const res = await worker.fetch(new Request('https://xydl-proxy.example.workers.dev/', { headers: { Origin: origin } }), ENV);
    assert.equal(res.headers.get('access-control-allow-origin'), origin, origin);
  }
});

test('preflight OPTIONS ikut allowlist', async () => {
  const evil = await worker.fetch(new Request('https://xydl-proxy.example.workers.dev/f/a.mp4', {
    method: 'OPTIONS', headers: { Origin: 'https://dlaja.evil.com' },
  }), ENV);
  assert.equal(evil.status, 204);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);

  const good = await worker.fetch(new Request('https://xydl-proxy.example.workers.dev/f/a.mp4', {
    method: 'OPTIONS', headers: { Origin: 'https://dlaja.xyverse.my.id' },
  }), ENV);
  assert.equal(good.headers.get('access-control-allow-origin'), 'https://dlaja.xyverse.my.id');
  assert.equal(good.headers.get('access-control-max-age'), '86400');
});

test('XYDL_EXTRA_ORIGINS menambah origin tanpa ubah kode', async () => {
  const env = { ...ENV, XYDL_EXTRA_ORIGINS: 'https://staging.dlaja.test' };
  const res = await worker.fetch(new Request('https://xydl-proxy.example.workers.dev/', {
    headers: { Origin: 'https://staging.dlaja.test' },
  }), env);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://staging.dlaja.test');
  const nope = await worker.fetch(new Request('https://xydl-proxy.example.workers.dev/', {
    headers: { Origin: 'https://staging.dlaja.evil.com' },
  }), env);
  assert.equal(nope.headers.get('access-control-allow-origin'), null);
});

test('tanpa token, proxy menolak sebelum menyentuh CDN', async () => {
  const res = await worker.fetch(new Request('https://xydl-proxy.example.workers.dev/f/DownloadAja-x-1.mp4?t=', {
    headers: { Origin: 'https://dlaja.xyverse.my.id' },
  }), ENV);
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://dlaja.xyverse.my.id');
  const bad = await worker.fetch(new Request('https://xydl-proxy.example.workers.dev/f/a.mp4?t=aaaa.bbbb', {}), ENV);
  assert.equal(bad.status, 403, 'tanda tangan palsu -> 403');
});

test('method lain ditolak, respons error tetap bawa CORS yang benar', async () => {
  const res = await worker.fetch(new Request('https://xydl-proxy.example.workers.dev/f/a.mp4', {
    method: 'POST', headers: { Origin: 'https://dlaja.xyverse.my.id' },
  }), ENV);
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://dlaja.xyverse.my.id');
});

test('clientIp: hop terakhir XFF yang dipercaya', () => {
  const h = (o) => ({ get: (n) => o[String(n).toLowerCase()] ?? null });
  assert.equal(clientIp(h({ 'x-forwarded-for': '1.2.3.4, 203.0.113.5' })), '203.0.113.5');
  assert.equal(clientIp(h({ 'cf-connecting-ip': '203.0.113.9' })), '203.0.113.9');
  assert.equal(clientIp(h({ 'x-real-ip': '203.0.113.6', 'cf-connecting-ip': '203.0.113.9' })), '203.0.113.6');
  assert.equal(clientIp(h({})), '');
});
