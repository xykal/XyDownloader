// Kuota unduh harian per IP di proxy streaming.
//
// Keputusan PRD v1.4 §10.2: 500 MB/user/hari untuk user gratis. Tanpa batas ini,
// fitur "Unduh semua" (G1) = tombol yang ngabisin tagihan Worker sendirian.
//
// Sumber kebenaran: KV `QUOTA`, kunci `q:<YYYY-MM-DD>:<ip>` (UTC) -> byte terpakai.
// Cache per isolate supaya Range request nggak baca KV terus; ditulis ke KV tiap
// kelipatan FLUSH_STEP (5 MB) dan begitu menembus batas — sisa <5 MB bisa lolos
// kalau isolate ke-recycle, itu sengaja: undercount lebih aman daripada angka
// yang nutup unduhan orang.
//
// Kill switch: `XYDL_QUOTA_MB=0` (atau tanpa binding KV) = tanpa batas.

export const MB = 1048576;
export const FLUSH_STEP = 5 * MB;
export const DEFAULT_QUOTA_MB = 500;
const KV_TTL_SECONDS = 2 * 24 * 3600;

export function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function secondsUntilDayEnd(ts = Date.now()) {
  const d = new Date(ts);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((end - ts) / 1000));
}

export function clientIp(request) {
  const h = request.headers;
  return (h.get('cf-connecting-ip')
    || h.get('x-real-ip')
    || (h.get('x-forwarded-for') || '').split(',')[0].trim()
    || 'anon').slice(0, 64);
}

export function createQuota(env = {}, opts = {}) {
  const now = opts.now || (() => Date.now());
  const kv = env.QUOTA || null;
  const raw = Number(env.XYDL_QUOTA_MB);
  const capMb = Number.isFinite(raw) ? raw : DEFAULT_QUOTA_MB;
  const cap = capMb > 0 ? capMb * MB : 0; // 0 / negatif = tanpa batas
  const unlimited = !kv || cap === 0;
  const mem = new Map(); // ip -> { day, used, flushed }

  function slot(ip) {
    const day = dayKey(now());
    let s = mem.get(ip);
    if (!s || s.day !== day) {
      s = { day, key: `q:${day}:${ip}`, used: null, flushed: 0 };
      mem.set(ip, s);
    }
    return s;
  }

  async function load(ip) {
    const s = slot(ip);
    if (s.used === null) {
      let got = 0;
      if (kv) {
        try { got = Number(await kv.get(`q:${s.day}:${ip}`)) || 0; } catch { got = 0; }
      }
      s.used = got;
      s.flushed = got;
    }
    return s;
  }

  async function writeKv(s) {
    if (!kv) return;
    try {
      await kv.put(s.key, String(Math.round(s.used)), { expirationTtl: KV_TTL_SECONDS });
      s.flushed = s.used;
    } catch { /* kuota kalah penting daripada unduhan yang lagi jalan */ }
  }

  return {
    unlimited,
    capBytes: cap,
    capMb: capMb > 0 ? capMb : 0,
    async check(ip) {
      if (unlimited) return { ok: true, unlimited: true };
      const s = await load(ip);
      if (s.used >= cap) {
        return { ok: false, used: s.used, cap, retryAfter: secondsUntilDayEnd(now()) };
      }
      return { ok: true, used: s.used, cap, remaining: cap - s.used };
    },
    async add(ip, bytes) {
      if (unlimited || !(bytes > 0)) return;
      const s = await load(ip);
      s.used += bytes;
      if (s.used >= cap || s.used - s.flushed >= FLUSH_STEP) await writeKv(s);
    },
    async flush(ip) {
      const s = mem.get(ip);
      if (s && s.used !== null) await writeKv(s);
    },
  };
}

// Satu instance per isolate (env object identity stabil di Workers).
const shared = new WeakMap();
export function quotaFor(env) {
  let q = shared.get(env);
  if (!q) {
    q = createQuota(env);
    shared.set(env, q);
  }
  return q;
}

// Hitung byte yang benar-benar keluar ke klien tanpa buffering body utuh.
export function countBody(body, onBytes) {
  if (!body) return null;
  const ts = new TransformStream({
    transform(chunk, controller) {
      try { onBytes(chunk.byteLength); } catch { /* jangan ganggu stream */ }
      controller.enqueue(chunk);
    },
  });
  return body.pipeThrough(ts);
}
