// Antrian "Unduh semua" lintas entri (docs/PRD-v1.4.md §G1).
//
// Keputusan PRD §10.3: simpan satu-satu ke Downloads (ZIP opsional belakangan),
// maksimal 2 unduhan berjalan, jeda 300 ms antar mulai biar nggak kayak serbuan,
// batal = yang belum mulai dihentikan, yang jalan diselesaikan dulu.
//
// Pure: nggak nyentuh DOM/fetch/storage. `now`/`sleep` bisa disuntik buat tes.

export function createBatchQueue(opts = {}) {
  const max = opts.max > 0 ? opts.max : 2;
  const gapMs = opts.gapMs >= 0 ? opts.gapMs : 300;
  const run = opts.run || (async () => true);
  const onChange = opts.onChange || (() => {});
  const now = opts.now || (() => Date.now());
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  const items = [];
  let pumping = false;
  let cancelled = false;
  let running = 0;
  let lastStart = -Infinity;

  function set(item, status) {
    item.status = status;
    onChange(snapshot());
  }

  function snapshot() {
    return {
      v: 1,
      items: items.map(({ id, status, url, title }) => ({ id, status, url, title })),
    };
  }

  function kick() {
    if (!pumping && !cancelled) pump();
  }

  async function pump() {
    pumping = true;
    try {
      while (running < max && !cancelled) {
        const next = items.find((i) => i.status === 'queued');
        if (!next) return;
        const wait = Math.max(0, lastStart + gapMs - now());
        if (wait > 0) await sleep(wait);
        if (cancelled) return;
        if (next.status !== 'queued') continue; // berubah pas nunggu
        lastStart = now();
        running += 1;
        set(next, 'running');
        Promise.resolve()
          .then(() => run(next))
          .then((ok) => { set(next, ok === false ? 'failed' : 'done'); },
            () => { set(next, 'failed'); })
          .finally(() => {
            running -= 1;
            kick();
          });
      }
    } finally {
      pumping = false;
    }
  }

  return {
    add(list) {
      for (const it of list || []) {
        if (!items.some((x) => x.id === it.id)) items.push({ status: 'queued', ...it });
      }
      onChange(snapshot());
    },
    start() {
      cancelled = false;
      kick();
    },
    cancel() {
      cancelled = true;
      for (const it of items) if (it.status === 'queued') set(it, 'cancelled');
    },
    restore(snap) {
      for (const it of (snap && snap.items) || []) {
        if (!it || it.id == null) continue;
        // running/aneh = dianggap belum mulai (file setengah = anggapan gagal)
        const mapped = it.status === 'done' || it.status === 'failed' || it.status === 'cancelled'
          ? it.status
          : 'queued';
        const existing = items.find((x) => x.id === it.id);
        if (existing) {
          if (existing.status === 'queued') existing.status = mapped;
        } else {
          items.push({ ...it, status: mapped });
        }
      }
      onChange(snapshot());
    },
    counts() {
      const c = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0 };
      for (const it of items) c[it.status] = (c[it.status] || 0) + 1;
      return c;
    },
    get finished() {
      return items.length > 0 && items.every((i) => i.status !== 'queued' && i.status !== 'running');
    },
    get cancelled() { return cancelled; },
    items,
    snapshot,
  };
}
