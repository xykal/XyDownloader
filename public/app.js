// DownloadAja — web client (Built in XyVerse)
// Proses berat (merge video+audio, remux HLS, ugoira, konversi MP3) berjalan di browser.

const API = '/api';
const FFMPEG_CORE_BASES = [
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm',
  'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm',
];
const RANGE_CHUNK = 32 * 1024 * 1024; // untuk /api/stream (tiap request tetap di bawah batas waktu function)
const BROWSER_LIMIT = 1.6 * 1024 * 1024 * 1024;
const FLAGGED_REGIONS = new Set(['id', 'cn', 'jp', 'sg', 'us']);
const STRIP = ['tiktok', 'youtube', 'instagram', 'facebook', 'twitter', 'douyin', 'bilibili', 'kuaishou',
  'threads', 'pixiv', 'xiaohongshu', 'weibo', 'vidio', 'reddit', 'pinterest', 'soundcloud'];

const $ = (s, el = document) => el.querySelector(s);

// ------------------------------------------------------------------ pengaturan pengguna
const SETTINGS_KEY = 'dlaja-settings-v1';
const SETTINGS_DEFAULTS = {
  autoplayVideo: true,     // muted autoplay
  autoplayMusic: true,
  previewSize: 'comfortable', // compact | comfortable | large
  dataSaver: false,
  openMusicPlayer: true,
  defaultVideoTier: 'normal', // hemat | normal | tinggi | maksimal | auto | last
  defaultAudioKbps: 192,      // 128 | 192 | 320 | original
  livePhotoMode: 'both',      // photo | video | both
};

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...SETTINGS_DEFAULTS, ...raw };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}
function saveSettings(next) {
  const s = { ...loadSettings(), ...next };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* privat */ }
  return s;
}
let settings = loadSettings();

function preferCellularDataSaver() {
  try {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (c && (c.saveData || /^(slow-2g|2g|3g)$/i.test(c.effectiveType || ''))) return true;
  } catch { /* abaikan */ }
  return false;
}
function effectiveSettings() {
  const s = { ...settings };
  if (s.dataSaver || preferCellularDataSaver()) {
    s.autoplayVideo = false;
    s.autoplayMusic = false;
  }
  return s;
}

function tierRank(t) {
  return ({ hemat: 1, normal: 2, tinggi: 3, maksimal: 4, auto: 2 })[t] || 2;
}
function pickDefaultVideoOpt(opts) {
  if (!opts || !opts.length) return null;
  const s = effectiveSettings();
  const want = s.defaultVideoTier || 'normal';
  if (want === 'auto') {
    // 720p-ish preferred
    return opts.find((o) => (o.quality || 0) >= 700 && (o.quality || 0) <= 800)
      || opts.find((o) => (o.tier || '') === 'normal')
      || opts[Math.min(1, opts.length - 1)]
      || opts[0];
  }
  // exact tier first
  const exact = opts.filter((o) => o.tier === want);
  if (exact.length) return exact[0];
  // nearest by rank
  const target = tierRank(want);
  return opts.slice().sort((a, b) => Math.abs(tierRank(a.tier) - target) - Math.abs(tierRank(b.tier) - target)
    || Math.abs((a.quality || 0) - (want === 'maksimal' ? 9999 : want === 'tinggi' ? 1080 : want === 'normal' ? 720 : 480))
      - Math.abs((b.quality || 0) - (want === 'maksimal' ? 9999 : want === 'tinggi' ? 1080 : want === 'normal' ? 720 : 480)))[0];
}
function pickDefaultAudioOpt(opts) {
  if (!opts || !opts.length) return null;
  const s = effectiveSettings();
  const kbps = s.defaultAudioKbps;
  if (kbps === 'original' || kbps === 0) {
    return opts.find((o) => o.kind === 'original') || opts[0];
  }
  return opts.find((o) => o.kind === 'mp3' && o.bitrate === kbps)
    || opts.find((o) => o.kind === 'mp3')
    || opts[0];
}


const form = $('#form');
const input = $('#url');
const goBtn = $('#go');
const resultEl = $('#result');
const detectedEl = $('#detected');
let platformList = [];
let busy = false;

// ------------------------------------------------------------------ util
function fmtBytes(n) {
  if (!n && n !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}
function fmtDur(s) {
  if (!s) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
let toastTimer;
function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function findUrl(text) {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s<>"'\u3000-\u303f\uff00-\uffef]+/i);
  if (m) return m[0].replace(/[.,;:!?)\]}>'"]+$/, '');
  const t = text.trim();
  if (/^[\w-]+(\.[\w-]+)+\/\S*$/.test(t)) return 'https://' + t;
  return null;
}
function detectPlatform(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return platformList.find((p) => (p.domains || []).some((d) => host === d || host.endsWith('.' + d))) || null;
  } catch { return null; }
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function icon(name, cls = 'icon') {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVGNS, 'use');
  u.setAttribute('href', `#i-${name}`);
  s.append(u);
  return s;
}
function btn(label, iconName, cls = 'btn btn-primary btn-sm') {
  const b = el('button', cls);
  b.type = 'button';
  if (iconName) b.append(icon(iconName));
  b.append(document.createTextNode(label));
  return b;
}
function logoImg(p, cls = 'plogo') {
  if (p && p.logo) {
    const img = el('img', cls);
    img.src = p.logo;
    img.alt = '';
    img.width = 20;
    img.height = 20;
    img.loading = 'lazy';
    return img;
  }
  return icon('globe', `icon ${cls}`);
}
function mimeFor(ext) {
  return ({
    mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mp3: 'audio/mpeg', m4a: 'audio/mp4',
    ts: 'video/mp2t', gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    zip: 'application/zip',
  })[ext] || 'application/octet-stream';
}
function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 120000);
}
function navDownload(url) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Gabungkan sinyal batal pengguna + batas waktu (tanpa AbortSignal.any agar kompatibel browser lama)
function withTimeout(signal, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return { signal: ctrl.signal, clear: () => clearTimeout(timer) };
}

// Timeout hanya sampai header respons diterima; body besar tetap boleh lama
async function fetchRetry(url, opts = {}, tries = 3, headerTimeout = 25000) {
  let last;
  for (let i = 0; i < tries; i++) {
    const tm = withTimeout(opts.signal, headerTimeout);
    try {
      const res = await fetch(url, { ...opts, signal: tm.signal });
      tm.clear();
      if (res.ok || res.status === 206) return res;
      last = new Error(`HTTP ${res.status}`);
      last.status = res.status;
      if (res.status === 403 || res.status === 404 || res.status === 410) break;
    } catch (e) {
      tm.clear();
      if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      last = e.name === 'AbortError' ? new Error('Server tidak merespons (timeout)') : e;
    }
    await sleep(600 * (i + 1));
  }
  throw last;
}

// ------------------------------------------------------------------ ZIP (baca ugoira, tulis galeri)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function unzip(blob) {
  const buf = await blob.arrayBuffer();
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('File ZIP rusak');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const out = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nameLen));
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    // slice() = salinan buffer sendiri (ffmpeg.wasm men-transfer buffer saat writeFile)
    let data = u8.slice(start, start + csize);
    if (method === 8) {
      const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(ds).arrayBuffer());
    } else if (method !== 0) {
      throw new Error('Format kompresi ZIP tidak didukung');
    }
    out.set(name, data);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

// ------------------------------------------------------------------ task UI
class Task {
  constructor(card, label) {
    this.card = card;
    this.el = $('.task', card);
    this.ctrl = new AbortController();
    this.el.classList.remove('hidden', 'done', 'error');
    this.labelEl = $('.task-label', this.el);
    this.pctEl = $('.task-pct', this.el);
    this.subEl = $('.task-sub', this.el);
    this.bar = $('.bar', this.el);
    this.cancelBtn = $('.task-cancel', this.el);
    this.cancelBtn.classList.remove('hidden');
    this.cancelBtn.onclick = () => this.ctrl.abort();
    card._task = this;
    this.stage(label);
  }
  get signal() { return this.ctrl.signal; }
  setLabel(text, iconName) {
    this.labelEl.textContent = '';
    if (iconName) this.labelEl.append(icon(iconName));
    this.labelEl.append(document.createTextNode(text));
  }
  stage(text) {
    this.setLabel(text);
    this.pctEl.textContent = '';
    this.subEl.textContent = '';
    this.bar.classList.add('indeterminate');
  }
  progress(frac, sub) {
    this.bar.classList.remove('indeterminate');
    const p = Math.max(0, Math.min(1, frac || 0));
    $('b', this.bar).style.width = `${(p * 100).toFixed(1)}%`;
    this.pctEl.textContent = `${Math.round(p * 100)}%`;
    if (sub !== undefined) this.subEl.textContent = sub;
  }
  finish(cls, text, sub, iconName) {
    this.bar.classList.remove('indeterminate');
    this.el.classList.add(cls);
    $('b', this.bar).style.width = '100%';
    this.setLabel(text, iconName);
    this.pctEl.textContent = '';
    this.subEl.textContent = sub || '';
    this.cancelBtn.classList.add('hidden');
    this.card._task = null;
  }
  done(text, sub) { this.finish('done', text, sub, 'check-circle'); }
  fail(text, sub) { this.finish('error', text, sub, 'alert'); }
}

// ------------------------------------------------------------------ mengambil sumber
async function readWithProgress(res, onBytes, signal) {
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    if (signal?.aborted) { reader.cancel(); throw new DOMException('aborted', 'AbortError'); }
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onBytes(loaded);
  }
  return new Blob(chunks);
}

async function fetchDirect(url, task, label, p0, p1, sizeHint) {
  const res = await fetchRetry(url, { signal: task.signal });
  const total = +res.headers.get('content-length') || sizeHint || 0;
  if (total > BROWSER_LIMIT) throw new Error('File terlalu besar untuk diproses di browser. Pakai aplikasi Android DownloadAja.');
  return readWithProgress(res, (l) => {
    task.progress(total ? p0 + (p1 - p0) * (l / total) : p0, `${label} · ${fmtBytes(l)}${total ? ' / ' + fmtBytes(total) : ''}`);
  }, task.signal);
}

// Sumber lewat server (/api/stream): diambil per potongan dengan header Range
async function fetchRanged(url, task, label, p0, p1, sizeHint) {
  const parts = [];
  let start = 0;
  let total = sizeHint || null;
  let loadedAll = 0;
  while (total === null || start < total) {
    const end = total ? Math.min(start + RANGE_CHUNK, total) - 1 : start + RANGE_CHUNK - 1;
    const res = await fetchRetry(url, { headers: { Range: `bytes=${start}-${end}` }, signal: task.signal });
    if (res.status === 200) {
      const t = +res.headers.get('content-length') || total || 0;
      return readWithProgress(res, (l) => task.progress(t ? p0 + (p1 - p0) * (l / t) : p0, `${label} · ${fmtBytes(l)}`), task.signal);
    }
    const t = parseInt((res.headers.get('content-range') || '').split('/')[1], 10);
    if (t) total = t;
    if (total > BROWSER_LIMIT) throw new Error('File terlalu besar untuk diproses di browser. Pakai aplikasi Android DownloadAja.');
    const blob = await readWithProgress(res, (l) => {
      const now = loadedAll + l;
      task.progress(total ? p0 + (p1 - p0) * (now / total) : p0, `${label} · ${fmtBytes(now)}${total ? ' / ' + fmtBytes(total) : ''}`);
    }, task.signal);
    if (!blob.size) break;
    parts.push(blob);
    loadedAll += blob.size;
    start += blob.size;
    if (!total) break;
  }
  return new Blob(parts);
}

function hlsAttr(line, name) {
  const m = line.match(new RegExp(`${name}=("([^"]*)"|[^,]*)`));
  return m ? (m[2] !== undefined ? m[2] : m[1]) : null;
}

async function fetchHls(url, task, label, p0, p1) {
  let text = await (await fetchRetry(url, { signal: task.signal })).text();
  if (text.includes('#EXT-X-STREAM-INF')) {
    const lines = text.split(/\r?\n/);
    const variants = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
      let j = i + 1;
      while (j < lines.length && (!lines[j].trim() || lines[j].startsWith('#'))) j++;
      if (lines[j]) variants.push({ bw: +(hlsAttr(lines[i], 'BANDWIDTH') || 0), uri: lines[j].trim() });
    }
    variants.sort((a, b) => b.bw - a.bw);
    if (!variants.length) throw new Error('Playlist HLS tidak valid');
    url = new URL(variants[0].uri, url).href;
    text = await (await fetchRetry(url, { signal: task.signal })).text();
  }
  const segs = [];
  let key = null;
  let map = null;
  let seq = +(text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/) || [])[1] || 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-KEY')) {
      const method = hlsAttr(line, 'METHOD');
      if (!method || method === 'NONE') key = null;
      else if (method === 'AES-128') key = { uri: new URL(hlsAttr(line, 'URI'), url).href, iv: hlsAttr(line, 'IV') };
      else throw new Error('Video ini terenkripsi DRM — tidak didukung.');
    } else if (line.startsWith('#EXT-X-MAP')) {
      map = new URL(hlsAttr(line, 'URI'), url).href;
    } else if (!line.startsWith('#')) {
      segs.push({ uri: new URL(line, url).href, key, seq: seq++ });
    }
  }
  if (!segs.length) throw new Error('Playlist HLS kosong');
  const keyCache = new Map();
  const getKey = (k) => {
    if (!keyCache.has(k.uri)) {
      keyCache.set(k.uri, fetchRetry(k.uri, { signal: task.signal })
        .then((r) => r.arrayBuffer())
        .then((raw) => crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['decrypt'])));
    }
    return keyCache.get(k.uri);
  };
  const results = new Array(segs.length);
  let next = 0, done = 0, bytes = 0;
  const worker = async () => {
    while (next < segs.length) {
      const i = next++;
      const s = segs[i];
      let data = new Uint8Array(await (await fetchRetry(s.uri, { signal: task.signal })).arrayBuffer());
      if (s.key) {
        let iv;
        if (s.key.iv) {
          const hex = s.key.iv.replace(/^0x/i, '').padStart(32, '0');
          iv = new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
        } else {
          iv = new Uint8Array(16);
          new DataView(iv.buffer).setUint32(12, s.seq);
        }
        data = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, await getKey(s.key), data));
      }
      results[i] = data;
      done++;
      bytes += data.length;
      if (bytes > BROWSER_LIMIT) throw new Error('Video terlalu besar untuk diproses di browser. Pakai aplikasi Android.');
      task.progress(p0 + (p1 - p0) * (done / segs.length), `${label} · ${done}/${segs.length} segmen · ${fmtBytes(bytes)}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, segs.length) }, worker));
  const parts = map ? [new Uint8Array(await (await fetchRetry(map, { signal: task.signal })).arrayBuffer()), ...results] : results;
  const b0 = results[0];
  let container = 'ts';
  if (map) container = 'mp4';
  else if (b0[0] === 0xff && (b0[1] & 0xf0) === 0xf0) container = 'aac';
  else if (b0[0] === 0x49 && b0[1] === 0x44 && b0[2] === 0x33) container = 'aac';
  return { blob: new Blob(parts), container };
}

async function probeOk(url, signal) {
  const tm = withTimeout(signal, 8000);
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: tm.signal });
    try { res.body?.cancel(); } catch { /* abaikan */ }
    return res.ok || res.status === 206;
  } catch (e) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return false; // error / timeout -> pakai jalur cadangan server
  } finally {
    tm.clear();
  }
}

async function getSource(src, task, label, p0, p1) {
  if (src.proto === 'hls') return fetchHls(src.url, task, label, p0, p1);
  if (src.via === 'server') return { blob: await fetchRanged(src.url, task, label, p0, p1, src.size), container: src.ext || 'mp4' };
  try {
    return { blob: await fetchDirect(src.url, task, label, p0, p1, src.size), container: src.ext || 'mp4' };
  } catch (e) {
    if (e.name === 'AbortError' || !src.alt) throw e;
    task.stage(`${label} (jalur cadangan server)…`);
    return { blob: await fetchRanged(src.alt, task, label, p0, p1, src.size), container: src.ext || 'mp4' };
  }
}

// ------------------------------------------------------------------ ffmpeg.wasm
let ffPromise = null;
let ffQueue = Promise.resolve();

async function blobURLWithProgress(url, mime, onProgress, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
  const total = +res.headers.get('content-length') || 0;
  const blob = await readWithProgress(res, (l) => onProgress && onProgress(l, total), signal);
  return URL.createObjectURL(new Blob([blob], { type: mime }));
}

function getFFmpeg(task) {
  if (!ffPromise) {
    ffPromise = (async () => {
      const { FFmpeg } = await import('./vendor/ffmpeg/index.js');
      let lastErr;
      for (const base of FFMPEG_CORE_BASES) {
        try {
          task?.stage('Memuat engine ffmpeg (±31 MB, cukup sekali)…');
          const coreURL = await blobURLWithProgress(`${base}/ffmpeg-core.js`, 'text/javascript');
          const wasmURL = await blobURLWithProgress(`${base}/ffmpeg-core.wasm`, 'application/wasm', (l, t) => {
            if (t) task?.progress(l / t, `Memuat engine ffmpeg · ${fmtBytes(l)} / ${fmtBytes(t)}`);
          });
          const ff = new FFmpeg();
          await ff.load({ coreURL, wasmURL });
          return ff;
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error('ffmpeg gagal dimuat');
    })().catch((e) => {
      ffPromise = null;
      throw new Error(`Gagal memuat ffmpeg: ${e.message || e}`);
    });
  }
  return ffPromise;
}

function withFFmpeg(task, fn) {
  const run = ffQueue.then(async () => fn(await getFFmpeg(task)));
  ffQueue = run.catch(() => {});
  return run;
}

async function ffRun(ff, task, args, inputs, output, durationHint, label) {
  const names = [];
  try {
    for (const [name, data] of inputs) {
      await ff.writeFile(name, data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data));
      names.push(name);
    }
    const onProgress = ({ progress, time }) => {
      let p = progress;
      if ((!p || p < 0 || p > 1) && durationHint) p = time / 1e6 / durationHint;
      if (p > 0 && p <= 1) task.progress(p, label);
    };
    ff.on('progress', onProgress);
    task.stage(label);
    const code = await ff.exec(args);
    ff.off('progress', onProgress);
    if (code !== 0) throw new Error(`ffmpeg keluar dengan kode ${code}`);
    const data = await ff.readFile(output);
    names.push(output);
    return data;
  } finally {
    for (const n of names) { try { await ff.deleteFile(n); } catch { /* abaikan */ } }
  }
}

function inName(prefix, src) {
  const ext = src.container === 'ts' ? 'ts' : src.container === 'aac' ? 'aac' : (src.container || 'mp4');
  return `${prefix}.${ext}`;
}

function ffMerge(task, v, a, ext, duration) {
  return withFFmpeg(task, async (ff) => {
    const vn = inName('v', v), an = inName('a', a);
    const out = `out.${ext}`;
    const args = ['-i', vn, '-i', an, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy'];
    if (ext === 'mp4' && (a.container === 'ts' || a.container === 'aac')) args.push('-bsf:a', 'aac_adtstoasc');
    args.push(out);
    const data = await ffRun(ff, task, args, [[vn, v.blob], [an, a.blob]], out, duration, 'Menggabungkan video + audio…');
    return new Blob([data.buffer], { type: mimeFor(ext) });
  });
}

function ffRemux(task, src, ext, duration) {
  return withFFmpeg(task, async (ff) => {
    const n = inName('in', src);
    const out = `out.${ext}`;
    const args = ['-i', n, '-c', 'copy'];
    if (ext === 'mp4' || ext === 'm4a') args.push('-bsf:a', 'aac_adtstoasc');
    args.push(out);
    const data = await ffRun(ff, task, args, [[n, src.blob]], out, duration, 'Mengemas ulang file…');
    return new Blob([data.buffer], { type: mimeFor(ext) });
  });
}

function ffMp3(task, src, kbps, duration) {
  return withFFmpeg(task, async (ff) => {
    const n = inName('in', src);
    const data = await ffRun(ff, task, ['-i', n, '-vn', '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, 'out.mp3'],
      [[n, src.blob]], 'out.mp3', duration, `Konversi ke MP3 ${kbps} kbps…`);
    return new Blob([data.buffer], { type: 'audio/mpeg' });
  });
}

// Ugoira pixiv: ZIP frame + delay -> MP4 (H.264) / GIF
async function ugoiraConvert(task, zipBlob, frames, ext) {
  task.stage('Membuka frame ugoira…');
  const files = await unzip(zipBlob);
  const total = frames.reduce((a, f) => a + Math.max(f.delay || 100, 20), 0) / 1000;
  return withFFmpeg(task, async (ff) => {
    const inputs = [];
    const seen = new Set();
    for (const fr of frames) {
      if (seen.has(fr.file) || !files.has(fr.file)) continue;
      seen.add(fr.file);
      inputs.push([fr.file, files.get(fr.file)]);
    }
    let list = 'ffconcat version 1.0\n';
    for (const fr of frames) list += `file '${fr.file}'\nduration ${(Math.max(fr.delay || 100, 20) / 1000).toFixed(3)}\n`;
    list += `file '${frames[frames.length - 1].file}'\n`;
    inputs.push(['list.txt', new TextEncoder().encode(list)]);
    const out = `out.${ext}`;
    const src = ['-f', 'concat', '-safe', '0', '-i', 'list.txt'];
    const args = ext === 'gif'
      ? [...src, '-vf', 'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', '-loop', '0', out]
      : [...src, '-fps_mode', 'vfr', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast',
        '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out];
    const data = await ffRun(ff, task, args, inputs, out, total, ext === 'gif' ? 'Membuat GIF…' : 'Membuat video MP4…');
    return new Blob([data.buffer], { type: mimeFor(ext) });
  });
}

// ------------------------------------------------------------------ MP3 (lamejs untuk audio pendek)
function lameEncode(audioBuffer, kbps, task) {
  return new Promise((resolve, reject) => {
    const w = new Worker('mp3-worker.js');
    const chans = [];
    for (let c = 0; c < Math.min(2, audioBuffer.numberOfChannels); c++) chans.push(audioBuffer.getChannelData(c).slice());
    w.onmessage = (e) => {
      if (e.data.progress !== undefined) task.progress(e.data.progress, `Konversi ke MP3 ${kbps} kbps…`);
      if (e.data.done) { w.terminate(); resolve(e.data.blob); }
      if (e.data.error) { w.terminate(); reject(new Error(e.data.error)); }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'mp3 worker error')); };
    task.signal.addEventListener('abort', () => { w.terminate(); reject(new DOMException('aborted', 'AbortError')); });
    w.postMessage({ channels: chans, sampleRate: audioBuffer.sampleRate, kbps }, chans.map((c) => c.buffer));
  });
}

async function toMp3(task, src, kbps, duration) {
  const small = src.blob.size < 60 * 1024 * 1024 && (!duration || duration <= 15 * 60);
  if (small && src.container !== 'ts') {
    try {
      task.stage('Mendekode audio…');
      const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const ctx = new Ctx(2, 44100, 44100);
      const audio = await ctx.decodeAudioData(await src.blob.arrayBuffer());
      return await lameEncode(audio, kbps, task);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      console.warn('decodeAudioData gagal, pakai ffmpeg:', e);
    }
  }
  return ffMp3(task, src, kbps, duration);
}

// ------------------------------------------------------------------ orkestrasi download
async function startDownload(card, entry, opt) {
  if (card._task) { toast('Tunggu proses sebelumnya selesai dulu'); return; }
  const task = new Task(card, `Menyiapkan ${opt.label}…`);
  const duration = entry.duration;
  try {
    const srcs = opt.sources || [];
    if (opt.mode === 'direct') {
      const src = srcs[0];
      task.stage('Mengecek link…');
      if (await probeOk(src.url, task.signal)) {
        navDownload(`${src.url}&dl=1`);
        task.done('Download dimulai', 'Cek notifikasi atau folder Download di perangkat kamu.');
        return;
      }
      if (!src.alt) throw new Error('Link download ditolak oleh platform. Coba proses ulang link-nya.');
      const got = await getSource({ ...src, via: 'server', url: src.alt }, task, 'Mengunduh (jalur server)', 0, 1);
      saveBlob(got.blob, opt.filename);
    } else if (opt.mode === 'fetch') {
      const got = await getSource(srcs[0], task, 'Mengunduh', 0, 1);
      saveBlob(got.blob, opt.filename);
    } else if (opt.mode === 'hls') {
      const got = await getSource(srcs[0], task, 'Mengunduh', 0, 0.9);
      let blob = got.blob;
      let name = opt.filename;
      if (got.container === 'ts' || got.container === 'aac') {
        const target = opt.kind === 'original' ? 'm4a' : 'mp4';
        try {
          blob = await ffRemux(task, got, target, duration);
          name = name.replace(/\.\w+$/, `.${target}`);
        } catch (e) {
          console.warn(e);
          name = name.replace(/\.\w+$/, got.container === 'aac' ? '.aac' : '.ts');
          toast('Gagal mengemas ulang, file disimpan dalam format asli');
        }
      }
      saveBlob(blob, name);
    } else if (opt.mode === 'merge') {
      const [vs, as] = srcs;
      if ((vs.size || 0) + (as.size || 0) > BROWSER_LIMIT) throw new Error('File terlalu besar untuk diproses di browser. Pakai aplikasi Android DownloadAja.');
      const v = await getSource(vs, task, 'Mengunduh video', 0, 0.82);
      const a = await getSource(as, task, 'Mengunduh audio', 0.82, 0.97);
      saveBlob(await ffMerge(task, v, a, opt.ext, duration), opt.filename);
    } else if (opt.mode === 'mp3') {
      const src = await getSource(srcs[0], task, 'Mengunduh audio', 0, 1);
      saveBlob(await toMp3(task, src, opt.bitrate || 192, duration), opt.filename);
    } else if (opt.mode === 'ugoira') {
      const frames = (entry.ugoira || {}).frames || [];
      if (!frames.length) throw new Error('Data frame ugoira tidak ada');
      const zip = await getSource(srcs[0], task, 'Mengunduh frame', 0, 1);
      saveBlob(await ugoiraConvert(task, zip.blob, frames, opt.ext), opt.filename);
    } else {
      throw new Error(`Mode tidak dikenal: ${opt.mode}`);
    }
    task.done('Selesai', `${opt.filename} tersimpan di folder Download.`);
  } catch (e) {
    console.error(e);
    if (e.name === 'AbortError') task.fail('Dibatalkan');
    else task.fail('Gagal', e.message || String(e));
  }
}

// ------------------------------------------------------------------ galeri (foto slide · Live Photo · carousel)
function safeName(name, fallback = 'galeri') {
  return (name || fallback).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').slice(0, 80).trim() || fallback;
}

// File yang akan diunduh untuk item terpilih. liveMode: 'photo' | 'video' | 'both'
function galleryFiles(entry, liveMode) {
  const out = [];
  for (const it of entry.gallery || []) {
    if (!entry._sel || !entry._sel.has(it.index)) continue;
    if (it.type === 'image') out.push(it.image);
    else if (it.type === 'live') {
      if (liveMode !== 'video') out.push(it.image);
      if (liveMode !== 'photo' && it.video) out.push(it.video);
    } else if (it.video) out.push(it.video);
  }
  return out.filter(Boolean);
}

async function fetchFile(task, f, label, p0, p1) {
  const got = await getSource({ url: f.url, alt: f.alt, via: f.via, proto: f.proto, ext: f.ext, size: f.size }, task, label, p0, p1);
  let blob = got.blob;
  let name = f.filename;
  if (f.proto === 'hls' && (got.container === 'ts' || got.container === 'aac')) {
    try {
      blob = await ffRemux(task, got, 'mp4');
      name = name.replace(/\.\w+$/, '.mp4');
    } catch (e) {
      console.warn(e);
      name = name.replace(/\.\w+$/, '.ts');
    }
  }
  return { blob, name };
}

async function downloadGallery(card, entry, files) {
  if (card._task) { toast('Tunggu proses sebelumnya selesai dulu'); return; }
  if (!files.length) { toast('Pilih minimal satu item'); return; }
  const task = new Task(card, files.length === 1 ? 'Menyiapkan…' : `Mengunduh ${files.length} file…`);
  try {
    if (files.length === 1) {
      const f = files[0];
      if (f.proto !== 'hls' && f.via !== 'server') {
        task.stage('Mengecek link…');
        if (await probeOk(f.url, task.signal)) {
          navDownload(`${f.url}&dl=1`);
          task.done('Download dimulai', f.filename);
          return;
        }
      }
      const got = await fetchFile(task, f, 'Mengunduh', 0, 1);
      saveBlob(got.blob, got.name);
      task.done('Selesai', `${got.name} tersimpan di folder Download.`);
      return;
    }
    const known = files.reduce((sum, f) => sum + (f.size || 0), 0);
    if (known > BROWSER_LIMIT) throw new Error('Total ukuran terlalu besar untuk browser. Pakai aplikasi Android DownloadAja.');
    const out = [];
    const used = new Set();
    for (let i = 0; i < files.length; i++) {
      const got = await fetchFile(task, files[i], `File ${i + 1}/${files.length}`, i / files.length, (i + 1) / files.length);
      let name = got.name;
      while (used.has(name)) name = name.replace(/(\.\w+)$/, `_${i + 1}$1`);
      used.add(name);
      out.push({ name, data: new Uint8Array(await got.blob.arrayBuffer()) });
    }
    task.stage('Membuat ZIP…');
    const base = `DownloadAja-${safeName(entry.title)}`;
    saveBlob(zipStore(out), `${base}.zip`);
    task.done('Selesai', `${out.length} file tersimpan dalam ${base}.zip`);
  } catch (e) {
    console.error(e);
    if (e.name === 'AbortError') task.fail('Dibatalkan');
    else task.fail('Gagal', e.message || String(e));
  }
}

// ------------------------------------------------------------------ pratinjau video
let hlsJsPromise = null;
function loadHlsJs() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsJsPromise) {
    hlsJsPromise = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js';
      sc.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error('hls.js')));
      sc.onerror = () => { hlsJsPromise = null; reject(new Error('hls.js gagal dimuat')); };
      document.head.append(sc);
    });
  }
  return hlsJsPromise;
}

async function attachSource(video, url, isHls) {
  if (!isHls || video.canPlayType('application/vnd.apple.mpegurl')) { video.src = url; return; }
  const Hls = await loadHlsJs();
  if (!Hls.isSupported()) throw new Error('HLS tidak didukung browser ini');
  const hls = new Hls({ maxBufferLength: 20 });
  hls.loadSource(url);
  hls.attachMedia(video);
  video._hls = hls;
}

function syncAudio(video, audioUrl) {
  const a = new Audio(audioUrl);
  a.preload = 'auto';
  const sync = () => { if (Math.abs(a.currentTime - video.currentTime) > 0.3) a.currentTime = video.currentTime; };
  video.addEventListener('play', () => { a.currentTime = video.currentTime; a.play().catch(() => {}); });
  video.addEventListener('playing', () => { sync(); a.play().catch(() => {}); });
  video.addEventListener('pause', () => a.pause());
  video.addEventListener('waiting', () => a.pause());
  video.addEventListener('seeking', () => { a.currentTime = video.currentTime; });
  video.addEventListener('timeupdate', sync);
  video.addEventListener('ratechange', () => { a.playbackRate = video.playbackRate; });
  video.addEventListener('volumechange', () => { a.volume = video.volume; a.muted = video.muted; });
  return a;
}

function stopMedia(root) {
  if (!root) return;
  if (root._stop) { try { root._stop(); } catch { /* */ } }
  if (root._audioEl) {
    try { root._audioEl.pause(); root._audioEl.removeAttribute('src'); root._audioEl.load(); } catch { /* */ }
  }
  root.querySelectorAll('video').forEach((v) => {
    try { v.pause(); } catch { /* abaikan */ }
    if (v._hls) { v._hls.destroy(); v._hls = null; }
    if (v._audio) { v._audio.pause(); v._audio.src = ''; }
    v.removeAttribute('src');
    v.load();
  });
  root.querySelectorAll('audio').forEach((a) => {
    try { a.pause(); a.removeAttribute('src'); a.load(); } catch { /* */ }
  });
}

function openPlayer(card, entry, opts = {}) {
  const pv = entry.preview;
  if (!pv) return;
  const old = $('.player', card);
  if (old) { stopMedia(old); old.remove(); }
  const s = effectiveSettings();
  const size = opts.size || s.previewSize || 'comfortable';
  const box = el('div', `player hero${size === 'compact' ? ' compact' : ''}${size === 'large' ? ' hero' : ''}`);
  if (size === 'large') box.classList.add('hero');
  if (size === 'compact') box.classList.add('compact');
  const v = el('video');
  v.controls = true;
  v.playsInline = true;
  v.preload = s.dataSaver ? 'none' : 'metadata';
  // muted autoplay = policy browser; user bisa unmute
  const wantAuto = opts.autoplay !== false && s.autoplayVideo && !s.dataSaver;
  v.autoplay = wantAuto;
  v.muted = wantAuto; // start muted if autoplay
  if (entry.thumbnail) v.poster = entry.thumbnail;
  if (pv.width && pv.height && pv.height > pv.width) box.classList.add('portrait');
  const close = el('button', 'player-close');
  close.type = 'button';
  close.title = 'Tutup pratinjau';
  close.setAttribute('aria-label', 'Tutup pratinjau');
  close.append(icon('x'));
  box.append(v, close);
  const anchor = $('.entry-head', card);
  if (anchor) anchor.after(box);
  else card.prepend(box);
  const fail = (msg) => {
    stopMedia(box);
    box.classList.add('failed');
    box.textContent = '';
    box.append(el('p', 'player-msg', msg), close);
  };
  let triedAlt = false;
  v.addEventListener('error', () => {
    if (!triedAlt && pv.alt && pv.type === 'av') { triedAlt = true; v.src = pv.alt; return; }
    fail('Pratinjau tidak bisa diputar (platform menolak atau format tidak didukung browser). Download tetap bisa dicoba.');
  });
  if (pv.type === 'pair' && pv.audio) v._audio = syncAudio(v, pv.audio);
  attachSource(v, pv.url, pv.type === 'hls').catch(() => fail('Browser ini belum bisa memutar stream HLS. Langsung download saja.'));
  if (wantAuto) v.play().catch(() => { /* butuh gesture */ });
  close.onclick = () => { stopMedia(box); box.remove(); };
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function openMusicPlayer(card, entry, audioOpt) {
  const old = $('.music-player', card) || $('.player', card);
  if (old) { stopMedia(old); old.remove(); }
  // pick stream source: prefer original audio / music track for preview quality, else first
  const opt = audioOpt || pickDefaultAudioOpt(entry.audio) || (entry.audio || [])[0];
  if (!opt || !(opt.sources || []).length) {
    toast('Tidak ada audio untuk dipratinjau');
    return;
  }
  // For MP3 convert options, source is still original audio stream — OK for preview
  const src = opt.sources[0];
  const s = effectiveSettings();
  const box = el('div', 'music-player');
  const art = el('div', 'art');
  if (entry.thumbnail) {
    const img = el('img');
    img.src = entry.thumbnail;
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => { img.remove(); art.append(icon('music', 'icon art-fallback')); };
    art.append(img);
  } else {
    art.append(icon('music', 'icon art-fallback'));
  }
  const meta = el('div', 'meta');
  meta.append(el('p', 'mtitle', entry.title || 'Audio'));
  const subBits = [entry.uploader, opt.label || 'Audio'].filter(Boolean);
  meta.append(el('p', 'msub', subBits.join(' · ')));
  const controls = el('div', 'controls');
  const playBtn = el('button', 'play-main');
  playBtn.type = 'button';
  playBtn.setAttribute('aria-label', 'Putar');
  playBtn.append(icon('play'));
  const seekwrap = el('div', 'seekwrap');
  const range = el('input');
  range.type = 'range';
  range.min = '0';
  range.max = '1000';
  range.value = '0';
  range.step = '1';
  range.setAttribute('aria-label', 'Posisi');
  const times = el('div', 'times');
  const t0 = el('span', '', '0:00');
  const t1 = el('span', '', entry.duration ? fmtDur(entry.duration) : '–:––');
  times.append(t0, t1);
  seekwrap.append(range, times);
  controls.append(playBtn, seekwrap);
  meta.append(controls);
  const close = el('button', 'player-close');
  close.type = 'button';
  close.title = 'Tutup';
  close.setAttribute('aria-label', 'Tutup pratinjau musik');
  close.append(icon('x'));
  close.style.position = 'absolute';
  close.style.top = '8px';
  close.style.right = '8px';
  box.style.position = 'relative';
  box.append(art, meta, close);

  const audio = new Audio();
  audio.preload = s.dataSaver ? 'none' : 'metadata';
  audio.crossOrigin = 'anonymous';
  box._audioEl = audio;
  // stopMedia looks for video; extend cleanup
  box.querySelectorAll = box.querySelectorAll.bind(box);

  let url = src.url;
  // Prefer direct playable; alt as fallback
  audio.src = url;
  let usingAlt = false;
  audio.addEventListener('error', () => {
    if (!usingAlt && src.alt) {
      usingAlt = true;
      audio.src = src.alt;
      audio.load();
      audio.play().catch(() => {});
      return;
    }
    toast('Pratinjau musik gagal diputar — coba unduh saja');
  });
  audio.addEventListener('loadedmetadata', () => {
    if (audio.duration && isFinite(audio.duration)) t1.textContent = fmtDur(Math.round(audio.duration));
  });
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration || !isFinite(audio.duration)) return;
    range.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
    t0.textContent = fmtDur(Math.round(audio.currentTime));
  });
  range.addEventListener('input', () => {
    if (!audio.duration || !isFinite(audio.duration)) return;
    audio.currentTime = (range.value / 1000) * audio.duration;
  });

  const setPlaying = (on) => {
    playBtn.textContent = '';
    playBtn.append(icon(on ? 'pause' : 'play'));
    playBtn.setAttribute('aria-label', on ? 'Jeda' : 'Putar');
  };
  playBtn.onclick = () => {
    if (audio.paused) audio.play().then(() => setPlaying(true)).catch(() => toast('Browser memblokir autoplay — ketuk lagi'));
    else { audio.pause(); setPlaying(false); }
  };
  audio.addEventListener('play', () => setPlaying(true));
  audio.addEventListener('pause', () => setPlaying(false));
  audio.addEventListener('ended', () => setPlaying(false));

  const shut = () => {
    try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch { /* */ }
    box.remove();
  };
  close.onclick = shut;

  // patch stopMedia for this box via custom
  box._stop = shut;

  const anchor = $('.entry-head', card);
  if (anchor) anchor.after(box);
  else card.prepend(box);

  if (s.autoplayMusic && !s.dataSaver) {
    audio.play().then(() => setPlaying(true)).catch(() => { /* butuh gesture */ });
  }
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// enhance stopMedia to also kill music players

// ------------------------------------------------------------------ viewer galeri
function openViewer(card, entry, start, onChange) {
  const items = entry.gallery || [];
  let i = start;
  let showPhoto = false;
  const ov = el('div', 'viewer');
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', 'Pratinjau');
  const top = el('div', 'viewer-top');
  const counter = el('span', 'viewer-count');
  const liveSwitch = el('button', 'viewer-chip hidden');
  liveSwitch.type = 'button';
  const close = el('button', 'viewer-btn');
  close.type = 'button';
  close.setAttribute('aria-label', 'Tutup');
  close.append(icon('x'));
  top.append(counter, liveSwitch, close);
  const stage = el('div', 'viewer-stage');
  const prev = el('button', 'viewer-nav prev');
  prev.type = 'button';
  prev.setAttribute('aria-label', 'Sebelumnya');
  prev.append(icon('chevron-left'));
  const next = el('button', 'viewer-nav next');
  next.type = 'button';
  next.setAttribute('aria-label', 'Berikutnya');
  next.append(icon('chevron-right'));
  const bottom = el('div', 'viewer-bottom');
  const sel = el('button', 'btn btn-secondary btn-sm');
  sel.type = 'button';
  const one = btn('Unduh item ini', 'download', 'btn btn-primary btn-sm');
  bottom.append(sel, one);
  ov.append(top, stage, prev, next, bottom);
  document.body.append(ov);
  document.body.classList.add('noscroll');

  function render() {
    const it = items[i];
    stopMedia(stage);
    stage.textContent = '';
    counter.textContent = `${i + 1} / ${items.length}${it.type === 'live' ? ' · Live Photo' : it.type === 'video' ? ' · Video' : ''}`;
    liveSwitch.classList.toggle('hidden', it.type !== 'live');
    liveSwitch.textContent = showPhoto ? 'Putar Live' : 'Lihat foto';
    const asImage = it.type === 'image' || (it.type === 'live' && showPhoto) || !it.video;
    if (asImage) {
      const img = el('img');
      img.alt = it.title || '';
      img.src = (it.image || {}).url || it.thumb;
      img.onerror = () => { if (it.image && it.image.alt && img.src !== it.image.alt) img.src = it.image.alt; };
      stage.append(img);
    } else {
      const v = el('video');
      v.controls = true;
      v.playsInline = true;
      v.autoplay = true;
      v.loop = it.type === 'live';
      v.muted = it.type === 'live';
      if (it.thumb) v.poster = it.thumb;
      let triedAlt = false;
      v.addEventListener('error', () => {
        if (!triedAlt && it.video.alt) { triedAlt = true; v.src = it.video.alt; return; }
        stage.textContent = '';
        stage.append(el('p', 'player-msg', 'Video tidak bisa diputar di browser ini, tapi tetap bisa diunduh.'));
      });
      stage.append(v);
      attachSource(v, it.video.url, it.video.proto === 'hls').catch(() => {
        stage.textContent = '';
        stage.append(el('p', 'player-msg', 'Stream ini tidak bisa diputar di browser ini.'));
      });
    }
    const on = entry._sel && entry._sel.has(it.index);
    sel.textContent = '';
    sel.append(icon(on ? 'check-circle' : 'circle'), document.createTextNode(on ? 'Terpilih' : 'Pilih'));
    sel.classList.toggle('is-on', !!on);
    prev.disabled = i === 0;
    next.disabled = i === items.length - 1;
  }
  const go = (d) => { const n = i + d; if (n >= 0 && n < items.length) { i = n; showPhoto = false; render(); } };
  const shut = () => {
    stopMedia(stage);
    ov.remove();
    document.body.classList.remove('noscroll');
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') shut();
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  };
  document.addEventListener('keydown', onKey);
  prev.onclick = () => go(-1);
  next.onclick = () => go(1);
  close.onclick = shut;
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target === stage) shut(); });
  liveSwitch.onclick = () => { showPhoto = !showPhoto; render(); };
  sel.onclick = () => {
    const it = items[i];
    if (entry._sel.has(it.index)) entry._sel.delete(it.index); else entry._sel.add(it.index);
    onChange && onChange();
    render();
  };
  one.onclick = () => {
    const it = items[i];
    const files = it.type === 'image' ? [it.image] : it.type === 'live' ? [showPhoto ? it.image : it.video] : [it.video];
    shut();
    downloadGallery(card, entry, files.filter(Boolean));
  };
  let x0 = null;
  stage.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  stage.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  });
  render();
  close.focus();
}

// ------------------------------------------------------------------ rendering
function renderSkeleton() {
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = `
    <div class="card loading-card"><div class="sk sk-thumb"></div>
      <div class="sk-lines"><div class="sk" style="height:12px;width:28%"></div>
      <div class="sk" style="height:16px;width:88%"></div><div class="sk" style="height:16px;width:64%"></div>
      <div class="sk" style="height:40px;margin-top:10px"></div><div class="sk" style="height:40px"></div></div></div>
    <p class="loading-tip" id="tip">Membaca link dan mencari semua kualitas…</p>`;
  const tips = ['Membaca link dan mencari semua kualitas…', 'Menghubungi server platform…', 'Mencari versi tanpa watermark…', 'Hampir selesai…'];
  let i = 0;
  clearInterval(renderSkeleton.timer);
  renderSkeleton.timer = setInterval(() => {
    const t = $('#tip');
    if (!t) return clearInterval(renderSkeleton.timer);
    i = Math.min(i + 1, tips.length - 1);
    t.textContent = tips[i];
  }, 3500);
}

function renderError(err) {
  clearInterval(renderSkeleton.timer);
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = '';
  const card = el('div', 'error-card');
  const h = el('h3');
  h.append(icon('alert'), document.createTextNode('Gagal memproses link'));
  card.append(h, el('p', '', err.error || err.message || 'Terjadi kesalahan.'));
  if (err.code === 'blocked' || err.code === 'private') {
    const cta = el('a', 'btn btn-secondary btn-sm');
    cta.href = '#android';
    cta.append(icon('phone'), document.createTextNode('Pakai aplikasi Android'));
    card.append(cta);
  }
  if (err.detail) {
    const d = el('details');
    d.append(el('summary', '', 'Detail teknis'), el('div', '', err.detail));
    card.append(d);
  }
  resultEl.append(card);
}

function optionRow(card, entry, opt, isAudio, recommended) {
  const row = el('div', `opt${recommended ? ' recommended' : ''}`);
  const main = el('div', 'opt-main');
  const bits = [];
  if (isAudio) {
    main.append(el('span', 'q', opt.kind === 'mp3' ? 'MP3' : (opt.ext || '').toUpperCase()));
    bits.push(opt.kind === 'mp3' ? `${opt.bitrate} kbps` : opt.label);
    if (opt.kind === 'mp3' && opt.bitrate === 192) bits.push('Normal');
    if (opt.kind === 'mp3' && opt.bitrate === 320) bits.push('Tinggi');
    if (opt.kind === 'mp3' && opt.bitrate === 128) bits.push('Hemat');
  } else {
    if (opt.tier) main.append(el('span', 'tier-pill', opt.tier));
    main.append(el('span', 'q', opt.label));
    bits.push((opt.ext || '').toUpperCase());
    if (opt.codec) bits.push(opt.codec);
  }
  if (opt.size) bits.push(`${opt.mode === 'mp3' ? '±' : ''}${fmtBytes(opt.size)}`);
  if (recommended) bits.push('disarankan');
  main.append(el('span', 'desc', bits.join(' · ')));
  row.append(main);
  const badges = [];
  if (opt.no_audio) badges.push(['Tanpa audio', '']);
  if (opt.mode === 'merge') badges.push(['Merge di browser', 'accent']);
  if (opt.mode === 'ugoira') badges.push(['Animasi', 'accent']);
  if ((opt.sources || []).some((s) => s.via === 'server')) badges.push(['Jalur server', '']);
  for (const [text, cls] of badges) row.append(el('span', `badge ${cls}`.trim(), text));
  const b = btn('Download', 'download');
  b.onclick = () => startDownload(card, entry, opt);
  row.append(b);
  return row;
}

function renderQualityChips(card, entry, panel, kind) {
  const opts = kind === 'audio' ? entry.audio : entry.video;
  if (!opts || opts.length < 2) return;
  const chips = el('div', 'qchips');
  const rec = kind === 'audio' ? pickDefaultAudioOpt(opts) : pickDefaultVideoOpt(opts);
  if (kind === 'video') {
    // group by tier unique order
    const order = ['hemat', 'normal', 'tinggi', 'maksimal'];
    const byTier = new Map();
    for (const o of opts) {
      const t = o.tier || 'auto';
      if (!byTier.has(t)) byTier.set(t, o);
    }
    const list = order.filter((t) => byTier.has(t)).map((t) => byTier.get(t));
    // if no tiers, fall back to top few raw
    const show = list.length ? list : opts.slice(0, 4);
    for (const o of show) {
      const c = el('button', `qchip${rec && rec.id === o.id ? ' active' : ''}`);
      c.type = 'button';
      const name = (o.tier || 'auto');
      c.append(document.createTextNode(name === 'auto' ? o.label : name.charAt(0).toUpperCase() + name.slice(1)));
      if (o.quality) {
        const sub = el('span', 'sub', o.quality > 0 && o.quality < 9000 ? `${o.quality}p` : '');
        if (sub.textContent) c.append(sub);
      }
      c.onclick = () => {
        chips.querySelectorAll('.qchip').forEach((x) => x.classList.remove('active'));
        c.classList.add('active');
        // scroll to matching row
        const rows = panel.querySelectorAll('.opt');
        const idx = opts.indexOf(o);
        if (rows[idx]) rows[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        startDownload(card, entry, o);
      };
      chips.append(c);
    }
  } else {
    for (const o of opts) {
      const c = el('button', `qchip${rec && rec.id === o.id ? ' active' : ''}`);
      c.type = 'button';
      c.textContent = o.kind === 'mp3' ? `MP3 ${o.bitrate}` : (o.label || o.ext || 'Audio');
      c.onclick = () => {
        chips.querySelectorAll('.qchip').forEach((x) => x.classList.remove('active'));
        c.classList.add('active');
        startDownload(card, entry, o);
      };
      chips.append(c);
    }
  }
  panel.prepend(chips);
}


function renderGallery(card, entry, panel) {
  const items = entry.gallery || [];
  entry._sel = new Set(items.map((it) => it.index));
  let liveMode = (effectiveSettings().livePhotoMode || 'both');
  const counts = { image: 0, live: 0, video: 0 };
  items.forEach((it) => { counts[it.type] = (counts[it.type] || 0) + 1; });

  const head = el('div', 'gallery-head');
  const summary = [counts.image && `${counts.image} foto`, counts.live && `${counts.live} Live Photo`, counts.video && `${counts.video} video`]
    .filter(Boolean).join(' · ');
  head.append(el('span', 'muted small', `${summary} · ketuk untuk memilih`));
  const toggleAll = el('button', 'link-btn');
  toggleAll.type = 'button';
  head.append(toggleAll);
  panel.append(head);

  if (counts.live) {
    const row = el('div', 'live-row');
    row.append(el('span', 'small muted', 'Live Photo diunduh sebagai'));
    const seg = el('div', 'seg');
    [['photo', 'Foto'], ['video', 'Video'], ['both', 'Foto + Video']].forEach(([k, label]) => {
      const b = el('button', `seg-btn${k === liveMode ? ' active' : ''}`, label);
      b.type = 'button';
      b.onclick = () => {
        liveMode = k;
        seg.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
        update();
      };
      seg.append(b);
    });
    row.append(seg);
    panel.append(row);
  }

  const grid = el('div', 'gallery');
  const tiles = [];
  items.forEach((it, i) => {
    const tile = el('div', 'gtile');
    tile.tabIndex = 0;
    tile.setAttribute('role', 'checkbox');
    const ph = el('div', 'ph');
    if (it.thumb) {
      const img = el('img');
      img.src = it.thumb;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => img.remove();
      ph.append(img);
    }
    tile.append(ph);
    const check = el('span', 'gcheck');
    check.append(icon('check'));
    tile.append(check, el('span', 'gnum', String(i + 1)));
    if (it.type !== 'image') {
      const badge = el('span', 'gbadge');
      if (it.type === 'live') badge.textContent = 'LIVE';
      else badge.append(icon('play'), document.createTextNode(fmtDur(it.duration) || 'Video'));
      tile.append(badge);
    }
    const zoom = el('button', 'gzoom');
    zoom.type = 'button';
    zoom.title = 'Lihat';
    zoom.setAttribute('aria-label', `Lihat item ${i + 1}`);
    zoom.append(icon('expand'));
    zoom.onclick = (ev) => { ev.stopPropagation(); openViewer(card, entry, i, update); };
    tile.append(zoom);
    tile.onclick = () => toggle(it.index);
    tile.onkeydown = (ev) => { if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); toggle(it.index); } };
    grid.append(tile);
    tiles.push([it, tile]);
  });
  panel.append(grid);

  const bar = el('div', 'gallery-bar');
  const dl = btn('Unduh', 'download', 'btn btn-primary');
  const note = el('span', 'muted small');
  bar.append(note, dl);
  panel.append(bar);

  function toggle(idx) {
    if (entry._sel.has(idx)) entry._sel.delete(idx); else entry._sel.add(idx);
    update();
  }
  function update() {
    tiles.forEach(([it, t]) => {
      const on = entry._sel.has(it.index);
      t.classList.toggle('selected', on);
      t.setAttribute('aria-checked', String(on));
    });
    const n = entry._sel.size;
    const files = galleryFiles(entry, liveMode);
    dl.lastChild.textContent = !n ? 'Pilih item dulu' : files.length > 1 ? `Unduh ${files.length} file (ZIP)` : 'Unduh';
    dl.disabled = !n;
    note.textContent = `${n} dari ${items.length} dipilih`;
    toggleAll.textContent = n === items.length ? 'Batal pilih semua' : 'Pilih semua';
  }
  toggleAll.onclick = () => {
    if (entry._sel.size === items.length) entry._sel.clear(); else items.forEach((it) => entry._sel.add(it.index));
    update();
  };
  dl.onclick = () => downloadGallery(card, entry, galleryFiles(entry, liveMode));
  update();
}

function renderResult(data) {
  clearInterval(renderSkeleton.timer);
  resultEl.innerHTML = '';
  resultEl.classList.remove('hidden');
  const tpl = $('#tpl-entry');
  const s = effectiveSettings();
  data.entries.forEach((entry, idx) => {
    const card = tpl.content.firstElementChild.cloneNode(true);
    const img = $('.thumb img', card);
    if (entry.thumbnail) {
      img.src = entry.thumbnail;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.onerror = () => img.remove();
    } else img.remove();
    const gallery = entry.gallery || [];
    $('.dur', card).textContent = gallery.length ? `${gallery.length} item` : entry.ugoira ? '' : fmtDur(entry.duration);
    const isAudioOnly = entry.media_kind === 'audio' || ((!entry.video || !entry.video.length) && entry.audio && entry.audio.length && !gallery.length && !entry.ugoira);

    if (entry.preview && !isAudioOnly) {
      const thumb = $('.thumb', card);
      const play = el('button', 'play-btn');
      play.type = 'button';
      play.title = 'Putar pratinjau';
      play.setAttribute('aria-label', 'Putar pratinjau');
      play.append(icon('play'));
      play.onclick = () => openPlayer(card, entry);
      thumb.append(play);
      thumb.classList.add('has-preview');
      thumb.addEventListener('click', (ev) => {
        if (ev.target.closest('.play-btn')) return;
        openPlayer(card, entry);
      });
    }
    if (isAudioOnly || (entry.audio && entry.audio.length && s.openMusicPlayer && !entry.preview && !gallery.length)) {
      const thumb = $('.thumb', card);
      thumb.classList.add('has-preview');
      const play = el('button', 'play-btn');
      play.type = 'button';
      play.title = 'Putar musik';
      play.setAttribute('aria-label', 'Putar musik');
      play.append(icon('music'));
      play.onclick = (e) => { e.stopPropagation(); openMusicPlayer(card, entry); };
      thumb.append(play);
    }

    const pf = $('.platform', card);
    const plat = data.platform || {};
    pf.append(logoImg(plat), document.createTextNode(plat.name || entry.extractor || 'Web'));
    if (data.count > 1) pf.append(el('span', 'count', `${idx + 1} / ${data.count}`));
    $('.title', card).textContent = entry.title || 'Tanpa judul';
    $('.uploader', card).textContent = entry.uploader ? `oleh ${entry.uploader}` : '';

    const panels = { video: $('[data-panel="video"]', card), audio: $('[data-panel="audio"]', card), images: $('[data-panel="images"]', card) };
    const recV = pickDefaultVideoOpt(entry.video);
    const recA = pickDefaultAudioOpt(entry.audio);
    if (entry.video && entry.video.length) {
      renderQualityChips(card, entry, panels.video, 'video');
      entry.video.forEach((o) => panels.video.append(optionRow(card, entry, o, false, recV && recV.id === o.id)));
    }
    if (entry.audio && entry.audio.length) {
      renderQualityChips(card, entry, panels.audio, 'audio');
      // quick listen button on audio panel
      const listen = el('button', 'btn btn-secondary btn-sm');
      listen.type = 'button';
      listen.style.marginBottom = '10px';
      listen.append(icon('music'), document.createTextNode(' Putar pratinjau'));
      listen.onclick = () => openMusicPlayer(card, entry, recA);
      panels.audio.prepend(listen);
      entry.audio.forEach((o) => panels.audio.append(optionRow(card, entry, o, true, recA && recA.id === o.id)));
    }
    if (gallery.length) renderGallery(card, entry, panels.images);

    const available = {
      video: entry.video && entry.video.length > 0,
      audio: entry.audio && entry.audio.length > 0,
      images: gallery.length > 0,
    };
    const tabs = card.querySelectorAll('.tab');
    tabs.forEach((tab) => {
      if (!available[tab.dataset.tab]) tab.classList.add('hidden');
      tab.onclick = () => {
        tabs.forEach((x) => x.classList.toggle('active', x === tab));
        Object.entries(panels).forEach(([k, pnl]) => pnl.classList.toggle('hidden', k !== tab.dataset.tab));
        // open music player when switching to audio if setting on
        if (tab.dataset.tab === 'audio' && s.openMusicPlayer && !card.querySelector('.music-player')) {
          openMusicPlayer(card, entry, recA);
        }
      };
    });
    let first = ['images', 'video', 'audio'].find((k) => available[k]) || 'video';
    if (isAudioOnly && available.audio) first = 'audio';
    card.querySelector(`.tab[data-tab="${first}"]`).click();
    if (Object.values(available).filter(Boolean).length < 2) $('.tabs', card).classList.add('hidden');
    resultEl.append(card);

    // Auto open preview
    requestAnimationFrame(() => {
      if (isAudioOnly && s.openMusicPlayer && available.audio) {
        openMusicPlayer(card, entry, recA);
      } else if (entry.preview && s.autoplayVideo && !s.dataSaver) {
        openPlayer(card, entry);
      }
    });
  });
  if (data.entries.some((e) => [...(e.video || []), ...(e.audio || [])].some((o) => (o.sources || []).some((s) => s.via === 'server')))) {
    toast('Konten ini diproses lewat jalur server — bisa sedikit lebih lambat.');
  }
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


// ------------------------------------------------------------------ alur proses link
function setBusy(v) {
  busy = v;
  goBtn.disabled = v;
  $('.spinner', goBtn).classList.toggle('hidden', !v);
  $('.go-text', goBtn).textContent = v ? 'Memproses' : 'Proses';
}

async function processLink(text) {
  if (busy) return;
  const url = findUrl(text);
  if (!url) {
    toast('Tempel link yang valid dulu (diawali https://)');
    input.focus();
    return;
  }
  setBusy(true);
  renderSkeleton();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 150000);
  try {
    const res = await fetch(`${API}/extract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: ctrl.signal,
    });
    let data;
    try { data = await res.json(); } catch { throw { error: `Server sedang sibuk (HTTP ${res.status}). Coba lagi sebentar lagi.` }; }
    if (!data.ok) throw data;
    renderResult(data);
  } catch (e) {
    if (e && e.name === 'AbortError') renderError({ error: 'Kelamaan menunggu respon server. Coba lagi.' });
    else renderError(e || {});
  } finally {
    clearTimeout(timer);
    setBusy(false);
  }
}

function updateDetected() {
  const url = findUrl(input.value);
  $('#clear').classList.toggle('hidden', !input.value);
  detectedEl.innerHTML = '';
  if (!url) return;
  const p = detectPlatform(url);
  if (p) {
    const pill = el('span', 'pill');
    pill.append(logoImg(p), document.createTextNode(p.name));
    detectedEl.append(pill);
    if (p.note) detectedEl.append(el('span', 'small', p.note));
  } else {
    const pill = el('span', 'pill');
    pill.append(icon('globe', 'icon plogo'), document.createTextNode('Situs lain — dicoba dengan engine universal'));
    detectedEl.append(pill);
  }
}

function regionHead(r) {
  const h = el('div', 'region-head');
  if (FLAGGED_REGIONS.has(r.id)) {
    const f = el('img', 'flag');
    f.src = `flags/${r.id}.svg`;
    f.alt = '';
    h.append(f);
  } else {
    h.append(icon('globe', 'icon globe'));
  }
  h.append(document.createTextNode(r.name), el('small', '', `${r.platforms.length} platform`));
  return h;
}

async function loadPlatforms() {
  try {
    const data = await (await fetch(`${API}/platforms`)).json();
    const wrap = $('#regions');
    wrap.innerHTML = '';
    platformList = [];
    for (const r of data.regions) {
      platformList.push(...r.platforms);
      const box = el('div', 'card region');
      box.append(regionHead(r));
      const chips = el('div', 'chips');
      for (const p of r.platforms) {
        const c = el('span', 'chip');
        c.append(logoImg(p), document.createTextNode(p.name));
        if (p.note) c.title = p.note;
        chips.append(c);
      }
      box.append(chips);
      wrap.append(box);
    }
    const strip = $('#strip');
    strip.innerHTML = '';
    for (const id of STRIP) {
      const p = platformList.find((x) => x.id === id);
      if (!p) continue;
      const img = el('img');
      img.src = p.logo;
      img.alt = p.name;
      img.title = p.name;
      img.width = 28;
      img.height = 28;
      strip.append(img);
    }
    updateDetected();
  } catch (e) {
    $('#regions').innerHTML = '<p class="muted">Gagal memuat daftar platform.</p>';
  }
}

// ------------------------------------------------------------------ event
form.addEventListener('submit', (e) => { e.preventDefault(); processLink(input.value); });
input.addEventListener('input', updateDetected);
input.addEventListener('paste', () => setTimeout(() => {
  updateDetected();
  if (findUrl(input.value)) processLink(input.value);
}, 50));
$('#clear').onclick = () => { input.value = ''; updateDetected(); input.focus(); };
$('#paste').onclick = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) { toast('Clipboard kosong'); return; }
    input.value = text.trim();
    updateDetected();
    processLink(input.value);
  } catch {
    toast('Izin clipboard ditolak — tekan lama kolom lalu pilih Tempel');
    input.focus();
  }
};

// ?url=... atau share target PWA (?text=...)
const qs = new URLSearchParams(location.search);
const shared = qs.get('url') || qs.get('text') || qs.get('title');
loadPlatforms().then(() => {
  if (shared && findUrl(shared)) {
    input.value = findUrl(shared);
    updateDetected();
    processLink(input.value);
  }
});

// Link APK terbaru langsung dari GitHub Releases
fetch('https://api.github.com/repos/xykal/XyDownloader/releases/latest', {
  headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'DownloadAja-Web' },
})
  .then((r) => (r.ok ? r.json() : null))
  .then((rel) => {
    if (!rel || !rel.assets) return;
    const apk = rel.assets.find((a) => /arm64-v8a.*\.apk$/i.test(a.name)) || rel.assets.find((a) => /\.apk$/i.test(a.name));
    if (!apk) return;
    const link = $('#apk-link');
    link.href = apk.browser_download_url;
    $('span', link).textContent = `Download APK ${rel.tag_name} · ${fmtBytes(apk.size)}`;
    const hint = $('#apk-hint');
    hint.textContent = 'Versi untuk kebanyakan HP (arm64). ';
    const all = el('a', '', 'Lihat semua versi');
    all.href = rel.html_url;
    all.target = '_blank';
    all.rel = 'noopener';
    hint.append(all, document.createTextNode(' — armeabi-v7a untuk HP lama, x86_64 untuk emulator.'));
  })
  .catch(() => {});

// ------------------------------------------------------------------ modal (pembaruan, lisensi) & popup "yang baru"
const WEB_VERSION = '1.3.1';
const RELEASES = 'https://github.com/xykal/XyDownloader/releases';
const CHANGES = [
  ['Pratinjau adaptif + pemutar musik', 'Video autoplay (bisa diatur), player musik untuk link audio, chip kualitas Normal/Hemat/Tinggi.'],
  ['Nama file DownloadAja-…', 'Setiap unduhan memakai nama branded yang unik dan rapi di folder Download.'],
  ['Pengaturan di web', 'Autoplay, ukuran preview, kualitas default, dan mode hemat data — tersimpan di perangkat.'],
  ['Pratinjau sebelum download', 'Putar video langsung di halaman hasil, atau lihat foto satu per satu di galeri.'],
  ['Foto slide & Live Photo', 'TikTok, Douyin, Xiaohongshu, Kuaishou, X, Instagram, Threads, Bluesky, Weibo & pixiv. Pilih foto satu per satu, Live Photo bisa diunduh sebagai foto, video, atau keduanya.'],
  ['Aplikasi Android lebih ringan & cepat', 'APK jauh lebih kecil, proses mencari link lebih cepat, dan ada tombol Perbarui yang memasang versi terbaru otomatis.'],
  ['Lisensi lengkap', 'Daftar komponen open source beserta lisensinya kini tersedia di web dan aplikasi.'],
];
const LICENSES = [
  ['yt-dlp', 'Unlicense', 'https://github.com/yt-dlp/yt-dlp', 'Extractor di server (Python)'],
  ['Python', 'PSF-2.0', 'https://www.python.org/', 'Runtime server'],
  ['ffmpeg.wasm core (FFmpeg)', 'GPL-2.0-or-later', 'https://github.com/ffmpegwasm/ffmpeg.wasm', 'Merge, remux HLS & ugoira di browser — dimuat dari CDN'],
  ['@ffmpeg/ffmpeg & @ffmpeg/util', 'MIT', 'https://github.com/ffmpegwasm/ffmpeg.wasm', 'Pembungkus ffmpeg.wasm'],
  ['lamejs', 'LGPL-3.0', 'https://github.com/zhuker/lamejs', 'Encoder MP3 di browser'],
  ['hls.js', 'Apache-2.0', 'https://github.com/video-dev/hls.js', 'Pratinjau stream HLS — dimuat dari CDN saat dibutuhkan'],
  ['flag-icons', 'MIT', 'https://github.com/lipis/flag-icons', 'Bendera negara'],
  ['Ikon gaya Lucide', 'ISC', 'https://lucide.dev/', 'Ikon garis antarmuka'],
  ['DownloadAja', 'GPL-3.0', 'https://github.com/xykal/XyDownloader', 'Kode aplikasi, engine & plugin'],
];

function openModal(titleText, build) {
  const ov = el('div', 'modal');
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  const box = el('div', 'modal-box card');
  const head = el('div', 'modal-head');
  head.append(el('h3', '', titleText));
  const x = el('button', 'icon-btn');
  x.type = 'button';
  x.setAttribute('aria-label', 'Tutup');
  x.append(icon('x'));
  head.append(x);
  const body = el('div', 'modal-body');
  box.append(head, body);
  ov.append(box);
  build(body);
  document.body.append(ov);
  document.body.classList.add('noscroll');
  const shut = () => { ov.remove(); document.body.classList.remove('noscroll'); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') shut(); };
  document.addEventListener('keydown', onKey);
  x.onclick = shut;
  ov.addEventListener('click', (e) => { if (e.target === ov) shut(); });
  x.focus();
  return shut;
}

function openUpdates() {
  openModal(`Yang baru di DownloadAja ${WEB_VERSION}`, (body) => {
    const img = el('img', 'modal-banner');
    img.src = 'whats-new.webp';
    img.alt = '';
    img.onerror = () => img.remove();
    body.append(img);
    const list = el('ul', 'changes');
    for (const [t, d] of CHANGES) {
      const li = el('li');
      li.append(icon('check'));
      const txt = el('div');
      txt.append(el('b', '', t), el('p', 'muted small', d));
      li.append(txt);
      list.append(li);
    }
    body.append(list);
    const acts = el('div', 'actions');
    const apk = el('a', 'btn btn-primary');
    apk.href = $('#apk-link').href;
    apk.target = '_blank';
    apk.rel = 'noopener';
    apk.append(icon('download'), document.createTextNode('Download APK terbaru'));
    const notes = el('a', 'btn btn-secondary');
    notes.href = `${RELEASES}/latest`;
    notes.target = '_blank';
    notes.rel = 'noopener';
    notes.append(icon('github'), document.createTextNode('Catatan rilis'));
    acts.append(apk, notes);
    body.append(acts);
    body.append(el('p', 'muted small', 'Aplikasi Android versi 1.2+ akan menawarkan pembaruan otomatis setiap ada versi baru.'));
  });
}

function openLicenses() {
  openModal('Lisensi & atribusi', (body) => {
    body.append(el('p', 'muted small', 'DownloadAja dibangun di atas software open source berikut. Terima kasih kepada semua pengembangnya.'));
    const list = el('div', 'lic-list');
    for (const [name, lic, url, what] of LICENSES) {
      const row = el('a', 'lic');
      row.href = url;
      row.target = '_blank';
      row.rel = 'noopener';
      const left = el('div');
      left.append(el('b', '', name), el('span', 'muted small', what));
      row.append(left, el('span', 'badge', lic));
      list.append(row);
    }
    body.append(list);
    const more = el('p', 'muted small');
    const a = el('a', '', 'THIRD_PARTY_NOTICES.md');
    a.href = 'https://github.com/xykal/XyDownloader/blob/main/THIRD_PARTY_NOTICES.md';
    a.target = '_blank';
    a.rel = 'noopener';
    more.append(document.createTextNode('Teks lisensi lengkap (termasuk komponen aplikasi Android): '), a, document.createTextNode('. Logo platform adalah merek dagang milik pemiliknya masing-masing dan hanya dipakai untuk menunjukkan kompatibilitas.'));
    body.append(more);
    const built = el('p', 'built-line');
    built.append(el('span', '', 'Built in '), el('b', '', 'XyVerse'));
    body.append(built);
  });
}


function openSettings() {
  settings = loadSettings();
  openModal('Pengaturan DownloadAja', (body) => {
    const grid = el('div', 'settings-grid');

    function block(title) {
      const b = el('div', 'settings-block card');
      b.style.padding = '12px 14px';
      b.append(el('h4', '', title));
      grid.append(b);
      return b;
    }
    function rowCheck(parent, key, label, hint) {
      const row = el('div', 'settings-row');
      const lab = el('label');
      lab.append(document.createTextNode(label));
      if (hint) lab.append(el('span', '', hint));
      const inp = el('input');
      inp.type = 'checkbox';
      inp.checked = !!settings[key];
      inp.onchange = () => { settings = saveSettings({ [key]: inp.checked }); };
      row.append(lab, inp);
      parent.append(row);
    }
    function rowSelect(parent, key, label, hint, options) {
      const row = el('div', 'settings-row');
      const lab = el('label');
      lab.append(document.createTextNode(label));
      if (hint) lab.append(el('span', '', hint));
      const sel = el('select');
      for (const [val, text] of options) {
        const o = el('option', '', text);
        o.value = val;
        if (String(settings[key]) === String(val)) o.selected = true;
        sel.append(o);
      }
      sel.onchange = () => {
        let v = sel.value;
        if (key === 'defaultAudioKbps') v = (v === 'original' ? 'original' : parseInt(v, 10));
        settings = saveSettings({ [key]: v });
      };
      row.append(lab, sel);
      parent.append(row);
    }

    const prev = block('Pratinjau');
    rowCheck(prev, 'autoplayVideo', 'Autoplay video', 'Mulai diputar otomatis (awal tanpa suara)');
    rowCheck(prev, 'autoplayMusic', 'Autoplay musik', 'Putar lagu otomatis saat link audio');
    rowCheck(prev, 'openMusicPlayer', 'Buka pemutar musik otomatis', 'Tampilkan player di hasil audio');
    rowSelect(prev, 'previewSize', 'Ukuran pratinjau video', 'Sesuaikan layar', [
      ['compact', 'Ringkas'], ['comfortable', 'Normal'], ['large', 'Besar'],
    ]);
    rowCheck(prev, 'dataSaver', 'Mode hemat data', 'Matikan autoplay & kurangi preload');

    const dl = block('Download default');
    rowSelect(dl, 'defaultVideoTier', 'Kualitas video', 'Dipakai chip “disarankan”', [
      ['hemat', 'Hemat (~480p)'], ['normal', 'Normal (~720p)'], ['tinggi', 'Tinggi (~1080p)'],
      ['maksimal', 'Maksimal'], ['auto', 'Otomatis'],
    ]);
    rowSelect(dl, 'defaultAudioKbps', 'Kualitas audio / MP3', '', [
      ['128', 'Hemat · 128 kbps'], ['192', 'Normal · 192 kbps'], ['320', 'Tinggi · 320 kbps'], ['original', 'Asli (tanpa convert)'],
    ]);
    rowSelect(dl, 'livePhotoMode', 'Live Photo default', 'Saat unduh galeri', [
      ['photo', 'Foto saja'], ['video', 'Video saja'], ['both', 'Foto + Video'],
    ]);

    body.append(grid);
    body.append(el('p', 'muted small', 'Nama file unduhan memakai pola DownloadAja-judul-id (contoh DownloadAja-Scramble-a8f2c1-720p.mp4). Pengaturan disimpan di perangkat ini saja.'));
  });
}

function whatsNewPopup() {
  let seen = null;
  try { seen = localStorage.getItem('xy-seen-version'); } catch { /* mode privat */ }
  if (seen === WEB_VERSION) return;
  const remember = () => { try { localStorage.setItem('xy-seen-version', WEB_VERSION); } catch { /* abaikan */ } };
  const probe = new Image();
  probe.onload = () => {
    const ov = el('div', 'promo');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', `Yang baru di DownloadAja ${WEB_VERSION}`);
    const box = el('div', 'promo-box');
    const img = el('img');
    img.src = probe.src;
    img.alt = `Yang baru di DownloadAja ${WEB_VERSION} — ketuk untuk detail`;
    img.tabIndex = 0;
    const x = el('button', 'promo-x');
    x.type = 'button';
    x.setAttribute('aria-label', 'Tutup');
    x.append(icon('x'));
    box.append(img, x);
    ov.append(box);
    document.body.append(ov);
    const shut = () => { remember(); ov.remove(); };
    x.onclick = (e) => { e.stopPropagation(); shut(); };
    img.onclick = () => { shut(); openUpdates(); };
    img.onkeydown = (e) => { if (e.key === 'Enter') { shut(); openUpdates(); } };
    ov.addEventListener('click', (e) => { if (e.target === ov) shut(); });
  };
  probe.src = 'whats-new.webp';
}

$('#btn-settings')?.addEventListener('click', () => openSettings());
$('#open-updates')?.addEventListener('click', (e) => { e.preventDefault(); openUpdates(); });
$('#open-licenses')?.addEventListener('click', (e) => { e.preventDefault(); openLicenses(); });


// Remote config (admin dash) — non-blocking
(async () => {
  const endpoints = [
    'https://dash.dlaja.xyverse.my.id/api/public/config',
    'https://dlaja-dash.akuntiktok76y.workers.dev/api/public/config',
  ];
  let cfg = null;
  for (const u of endpoints) {
    try {
      const r = await fetch(u);
      if (r.ok) { cfg = await r.json(); break; }
    } catch { /* try next */ }
  }
  if (!cfg) return;
  window.__dlajaRemote = cfg;
  if (cfg.maintenance_mode) {
    toast(cfg.maintenance_message || 'Sedang maintenance. Coba lagi nanti.', 6000);
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      const patch = {};
      if (cfg.default_video_tier) patch.defaultVideoTier = cfg.default_video_tier;
      if (cfg.default_audio_kbps != null) patch.defaultAudioKbps = cfg.default_audio_kbps;
      if (typeof cfg.default_autoplay === 'boolean') patch.autoplayVideo = cfg.default_autoplay;
      if (Object.keys(patch).length) settings = saveSettings(patch);
    }
  } catch { /* */ }
})();

if (!shared) setTimeout(whatsNewPopup, 900);
