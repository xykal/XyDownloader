/**
 * Tes riwayat unduhan web (docs/PRD-v1.4.md §G2).
 *
 * Alasan: riwayat disimpen di perangkat user, jadi yang bisa bikin kacau cuma
 * kodenya sendiri — field bocor (media_url/fid), daftar nggak terbatas, atau
 * entri dobel. Tiga itu yang dijaga di sini. Backend IndexedDB diganti tiruan;
 * logika (sanitasi + cap FIFO) diuji murni.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HISTORY_MAX,
  createHistoryStore,
  pushCapped,
  sanitizeRecord,
} from '../../public/history-store.js';

function fakeBackend(seed = []) {
  let list = seed.slice();
  return {
    loads: 0,
    async load() { this.loads += 1; return list.slice(); },
    async save(next) { list = next.slice(); },
    peek() { return list.slice(); },
  };
}

test('sanitizeRecord cuma ngambil field putih; media_url/fid/sources dibuang', () => {
  const rec = sanitizeRecord({
    id: 'abc',
    date: 1759100000000,
    url: 'https://www.tiktok.com/@x/video/123',
    title: 'Judul  ',
    thumb: 'https://cdn.example/t.jpg',
    platform: 'tiktok',
    label: '720p MP4',
    size: 12345,
    // racun yang nggak boleh pernah masuk:
    media_url: 'https://v16-web.tiktokexp.com/...&xydl_sig=rahasia',
    fid: '1234-5678',
    sources: [{ url: 'https://host-asal/jejak.mp4' }],
    extra: 'nggak dikenal',
  });
  assert.deepEqual(Object.keys(rec).sort(),
    ['date', 'id', 'label', 'platform', 'size', 'thumb', 'title', 'url'].sort());
  const dumped = JSON.stringify(rec);
  assert.ok(!dumped.includes('rahasia') && !dumped.includes('fid') && !dumped.includes('jejak'),
    'jejak media_url/fid/sources tidak boleh muncul di record');
});

test('sanitizeRecord ngasih default aman buat field kosong/rusak', () => {
  const rec = sanitizeRecord({ title: '', size: -5, date: 'bukan-angka', url: 42 });
  assert.equal(rec.title, 'Tanpa judul');
  assert.equal(rec.size, 0);
  assert.equal(rec.url, '');
  assert.ok(rec.id.length >= 4);
  assert.ok(rec.date > 0);
});

test('pushCapped: entri baru di depan, id sama nggak diduplikasi', () => {
  const a = { id: 'a', date: 1 };
  const b = { id: 'b', date: 2 };
  let list = pushCapped([], a);
  list = pushCapped(list, b);
  assert.deepEqual(list.map((x) => x.id), ['b', 'a']);
  list = pushCapped(list, { id: 'a', date: 3 });
  assert.deepEqual(list.map((x) => x.id), ['a', 'b']);
  assert.equal(list[0].date, 3, 'id yang sama = update, bukan entri ganda');
});

test('pushCapped: FIFO, ekor dibuang pas nyentuh batas', () => {
  let list = [];
  for (let i = 0; i < HISTORY_MAX + 10; i += 1) {
    list = pushCapped(list, { id: `id-${i}`, date: i }, HISTORY_MAX);
  }
  assert.equal(list.length, HISTORY_MAX);
  assert.equal(list[0].id, `id-${HISTORY_MAX + 9}`);
  assert.equal(list[list.length - 1].id, 'id-10', '10 entri paling tua kebuang');
});

test('store: add/list/remove/clear lewat backend, tetap di bawah batas', async () => {
  const backend = fakeBackend();
  const store = createHistoryStore({ backend, max: 3 });
  await store.add({ url: 'https://a', title: 'A' });
  await store.add({ url: 'https://b', title: 'B' });
  await store.add({ url: 'https://c', title: 'C' });
  await store.add({ url: 'https://d', title: 'D' });
  const items = await store.list();
  assert.deepEqual(items.map((x) => x.title), ['D', 'C', 'B']);
  await store.remove(items[0].id);
  assert.deepEqual((await store.list()).map((x) => x.title), ['C', 'B']);
  await store.clear();
  assert.deepEqual(await store.list(), []);
});

test('store: tanpa indexedDB jatuh ke memori (mode privat), nggak nge-crash', async () => {
  const store = createHistoryStore({}); // Node nggak punya indexedDB
  await store.add({ url: 'https://x', title: 'X' });
  assert.equal((await store.list()).length, 1);
  await store.clear();
  assert.deepEqual(await store.list(), []);
});

test('store: entri rusak di backend nggak bikin list() melempar', async () => {
  const backend = fakeBackend([null, { id: 'ok', url: 'https://ok', title: 'OK' }, 'junk']);
  const store = createHistoryStore({ backend });
  const items = await store.list();
  assert.equal(items.length, 3, 'semua entri lolos sanitasi ulang');
  assert.equal(items[1].title, 'OK');
  assert.equal(items[2].title, 'Tanpa judul', 'entri junk dijadikan record aman');
});
