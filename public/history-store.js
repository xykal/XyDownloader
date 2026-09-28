// DownloadAja — riwayat unduhan di web (IndexedDB, perangkat ini saja).
//
// Aturan keras (lihat docs/PRD-v1.4.md §G2):
// - TIDAK menyimpan media_url / fid / sources: token signed cuma 6 jam dan
//   media_url adalah jejak host asal. "Unduh lagi" = extract ulang dari webpage_url.
// - Maksimal 100 entri, FIFO. Cuma di perangkat ini, tanpa sinkron apa pun.
// - Nggak ada satu pun event analytics yang naik dari sini.

export const HISTORY_MAX = 100;
const DB_NAME = 'xydl-history';
const STORE = 'items';
const ROW_KEY = 'list';

// Whitelist ketat: field lain (media_url, fid, sources, dst) dibuang di sini,
// bukan di pemanggil — jadi nggak ada jalan bocor lewat objek entry yang gemuk.
export function sanitizeRecord(r) {
  const src = (r && typeof r === 'object') ? r : {};
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    id: str(src.id, 64) || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    date: Number.isFinite(src.date) && src.date > 0 ? Math.round(src.date) : Date.now(),
    url: str(src.url, 2048),
    title: str(src.title, 200) || 'Tanpa judul',
    thumb: str(src.thumb, 2048),
    platform: str(src.platform, 40) || 'unknown',
    label: str(src.label, 60),
    size: Number.isFinite(src.size) && src.size > 0 ? Math.round(src.size) : 0,
  };
}

// Entri baru di depan; id yang sama nggak diduplikasi; kelebihan dibuang ekornya.
export function pushCapped(list, rec, max = HISTORY_MAX) {
  const next = [rec, ...list.filter((x) => x && x.id !== rec.id)];
  return next.slice(0, max);
}

// Backend bawaan: satu baris JSON di IndexedDB ({key: 'items', list: [...]}).
// 100 entri metadata kecil = satu put/get, atomis, tanpa skema migrasi.
function idbBackend(idbFactory) {
  const open = () => new Promise((resolve, reject) => {
    const req = idbFactory.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = (db, mode, fn) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  return {
    async load() {
      try {
        const db = await open();
        const row = await tx(db, 'readonly', (s) => s.get(ROW_KEY));
        db.close();
        return Array.isArray(row && row.list) ? row.list : [];
      } catch {
        return [];
      }
    },
    async save(list) {
      try {
        const db = await open();
        await tx(db, 'readwrite', (s) => s.put({ key: ROW_KEY, list }, ROW_KEY));
        db.close();
      } catch { /* mode privat / penuh: riwayat kalah penting dari unduhan */ }
    },
  };
}

function memoryBackend() {
  let list = [];
  return {
    async load() { return list.slice(); },
    async save(next) { list = next.slice(); },
  };
}

export function createHistoryStore(opts = {}) {
  const max = Number.isFinite(opts.max) && opts.max > 0 ? opts.max : HISTORY_MAX;
  const factory = opts.idbFactory || (typeof indexedDB !== 'undefined' ? indexedDB : null);
  const backend = opts.backend || (factory ? idbBackend(factory) : memoryBackend());
  return {
    async add(partial) {
      const rec = sanitizeRecord(partial);
      const list = pushCapped(await backend.load(), rec, max);
      await backend.save(list);
      return rec;
    },
    async list() {
      return (await backend.load()).map(sanitizeRecord);
    },
    async remove(id) {
      const list = (await backend.load()).filter((x) => x && x.id !== id);
      await backend.save(list);
    },
    async clear() {
      await backend.save([]);
    },
  };
}
