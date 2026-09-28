/**
 * Tes antrian "Unduh semua" (docs/PRD-v1.4.md §G1).
 *
 * Yang dijaga: nggak lebih dari 2 berjalan bareng, jeda 300 ms antar mulai,
 * batal cuma nahan yang belum mulai, 1 item gagal nggak bikin antrian mati,
 * dan snapshot bisa dipulihkan setelah refresh.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createBatchQueue } from '../../public/batch-queue.js';

const flush = () => new Promise((r) => setImmediate(r));

function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms) => { t += ms; },
    advance: (ms) => { t += ms; },
  };
}

function deferredRun() {
  const calls = [];
  const run = (item) => new Promise((resolve, reject) => {
    calls.push({ item, resolve, reject });
  });
  return { calls, run };
}

test('maksimal 2 berjalan bareng, sisanya antre', async () => {
  const c = clock();
  const { calls, run } = deferredRun();
  const q = createBatchQueue({ max: 2, gapMs: 300, run, now: c.now, sleep: c.sleep });
  q.add([1, 2, 3, 4, 5].map((i) => ({ id: String(i), url: `u${i}` })));
  q.start();
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(q.counts().running, 2);
  calls[0].resolve(true);
  await flush();
  assert.equal(calls.length, 3, 'slot kosong langsung diisi');
  assert.equal(q.counts().done, 1);
});

test('jeda minimal 300 ms antar mulai', async () => {
  const c = clock();
  const starts = [];
  const q = createBatchQueue({
    max: 2,
    gapMs: 300,
    now: c.now,
    sleep: async (ms) => { starts.push({ at: c.now(), asked: ms }); await c.sleep(ms); },
    run: async () => true,
  });
  q.add([1, 2, 3, 4].map((i) => ({ id: String(i) })));
  q.start();
  for (let i = 0; i < 300 && !q.finished; i += 1) await flush();
  // run-nya instan; mulai pertama bebas, sisanya harus nunggu sisa gap-nya
  assert.ok(starts.length >= 3, 'item setelah pertama minta nunggu dulu');
  assert.ok(starts.slice(1).every((s) => s.asked > 0 && s.asked <= 300),
    'yang diminta = sisa jeda, bukan lebih');
});

test('batal: yang belum mulai dihentikan, yang jalan tetap selesai', async () => {
  const c = clock();
  const { calls, run } = deferredRun();
  const q = createBatchQueue({ max: 2, gapMs: 0, run, now: c.now, sleep: c.sleep });
  q.add([1, 2, 3, 4].map((i) => ({ id: String(i) })));
  q.start();
  await flush();
  q.cancel();
  assert.equal(q.counts().cancelled, 2);
  assert.equal(q.counts().running, 2);
  calls[0].resolve(true);
  calls[1].resolve(true);
  await flush();
  assert.equal(q.counts().done, 2, 'yang jalan diselesaikan, bukan dibuang');
  assert.equal(calls.length, 2, 'tidak ada yang mulai lagi setelah batal');
  assert.equal(q.finished, true);
});

test('satu item gagal/reject tidak mematikan antrian', async () => {
  const c = clock();
  let n = 0;
  const q = createBatchQueue({
    max: 1,
    gapMs: 0,
    now: c.now,
    sleep: c.sleep,
    run: async () => {
      n += 1;
      if (n === 2) throw new Error('jaringan putus');
      return n === 3 ? false : true; // gagal "halus"
    },
  });
  q.add([1, 2, 3, 4].map((i) => ({ id: String(i) })));
  q.start();
  for (let i = 0; i < 300 && !q.finished; i += 1) await flush();
  const c2 = q.counts();
  assert.equal(c2.done, 2);
  assert.equal(c2.failed, 2, 'lempar error dan return false sama-sama gagal');
});

test('snapshot & restore: item "running" dianggap belum mulai', () => {
  const q1 = createBatchQueue({ run: async () => true });
  q1.add([{ id: 'a', url: 'u-a', title: 'A' }, { id: 'b', url: 'u-b' }]);
  const snap = {
    v: 1,
    items: [
      { id: 'a', status: 'done', url: 'u-a', title: 'A' },
      { id: 'b', status: 'running', url: 'u-b' },
      { id: 'c', status: 'queued', url: 'u-c' },
    ],
  };
  q1.restore(snap);
  const byId = Object.fromEntries(q1.items.map((i) => [i.id, i.status]));
  assert.equal(byId.a, 'done', 'yang selesai nggak diulang');
  assert.equal(byId.b, 'queued', 'keputus di tengah = ulang dari awal');
  assert.equal(byId.c, 'queued');
  const round = q1.snapshot();
  assert.equal(round.items.length, 3);
  assert.ok(round.items.every((i) => 'url' in i && 'title' in i), 'snapshot bawa url buat extract ulang');
});

test('restore id dobel tidak menumpuk', () => {
  const q = createBatchQueue({ run: async () => true });
  q.restore({ items: [{ id: 'x', status: 'queued' }] });
  q.restore({ items: [{ id: 'x', status: 'queued' }] });
  q.add([{ id: 'x' }, { id: 'y' }]);
  assert.equal(q.items.length, 2);
});
