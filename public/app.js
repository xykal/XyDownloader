// XyDownloader — web client (Built in XyVerse)
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
  if (total > BROWSER_LIMIT) throw new Error('File terlalu besar untuk diproses di browser. Pakai aplikasi Android XyDownloader.');
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
    if (total > BROWSER_LIMIT) throw new Error('File terlalu besar untuk diproses di browser. Pakai aplikasi Android XyDownloader.');
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
      if ((vs.size || 0) + (as.size || 0) > BROWSER_LIMIT) throw new Error('File terlalu besar untuk diproses di browser. Pakai aplikasi Android XyDownloader.');
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

async function downloadAllImages(card, entry) {
  if (card._task) { toast('Tunggu proses sebelumnya selesai dulu'); return; }
  const imgs = entry.images || [];
  const task = new Task(card, `Mengunduh ${imgs.length} gambar…`);
  try {
    const files = [];
    const used = new Set();
    for (let i = 0; i < imgs.length; i++) {
      const im = imgs[i];
      const blob = await fetchDirect(im.url, task, `Gambar ${i + 1}/${imgs.length}`, i / imgs.length, (i + 1) / imgs.length, im.size);
      let name = im.filename;
      while (used.has(name)) name = name.replace(/(\.\w+)$/, `_${i + 1}$1`);
      used.add(name);
      files.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    task.stage('Membuat ZIP…');
    const base = (entry.title || 'gambar').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80).trim() || 'gambar';
    saveBlob(zipStore(files), `${base}.zip`);
    task.done('Selesai', `${files.length} gambar tersimpan dalam ${base}.zip`);
  } catch (e) {
    console.error(e);
    if (e.name === 'AbortError') task.fail('Dibatalkan');
    else task.fail('Gagal', e.message || String(e));
  }
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

function optionRow(card, entry, opt, isAudio) {
  const row = el('div', 'opt');
  const main = el('div', 'opt-main');
  const bits = [];
  if (isAudio) {
    main.append(el('span', 'q', opt.kind === 'mp3' ? 'MP3' : (opt.ext || '').toUpperCase()));
    bits.push(opt.kind === 'mp3' ? `${opt.bitrate} kbps` : opt.label);
  } else {
    main.append(el('span', 'q', opt.label));
    bits.push((opt.ext || '').toUpperCase());
    if (opt.codec) bits.push(opt.codec);
  }
  if (opt.size) bits.push(`${opt.mode === 'mp3' ? '±' : ''}${fmtBytes(opt.size)}`);
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

function renderImages(card, entry, panel) {
  const imgs = entry.images || [];
  const head = el('div', 'gallery-head');
  head.append(el('span', 'muted small', `${imgs.length} gambar · resolusi asli`));
  if (imgs.length > 1) {
    const all = btn(`Download semua (ZIP)`, 'archive');
    all.onclick = () => downloadAllImages(card, entry);
    head.append(all);
  }
  panel.append(head);
  const grid = el('div', 'gallery');
  imgs.forEach((im, i) => {
    const fig = el('figure', 'gimg');
    const ph = el('div', 'ph');
    if (im.thumb) {
      const img = el('img');
      img.src = im.thumb;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => img.remove();
      ph.append(img);
    }
    fig.append(ph);
    const cap = el('figcaption');
    const dims = im.width && im.height ? `${im.width}×${im.height}` : '';
    cap.append(el('span', '', [imgs.length > 1 ? `p${i + 1}` : '', dims, (im.ext || '').toUpperCase()].filter(Boolean).join(' · ')));
    const dl = el('button', 'icon-btn');
    dl.type = 'button';
    dl.title = 'Download';
    dl.append(icon('download'));
    dl.onclick = () => { navDownload(`${im.url}&dl=1`); toast('Download gambar dimulai'); };
    cap.append(dl);
    fig.append(cap);
    grid.append(fig);
  });
  panel.append(grid);
}

function renderResult(data) {
  clearInterval(renderSkeleton.timer);
  resultEl.innerHTML = '';
  resultEl.classList.remove('hidden');
  const tpl = $('#tpl-entry');
  data.entries.forEach((entry, idx) => {
    const card = tpl.content.firstElementChild.cloneNode(true);
    const img = $('.thumb img', card);
    if (entry.thumbnail) {
      img.src = entry.thumbnail;
      img.onerror = () => img.remove();
    } else img.remove();
    $('.dur', card).textContent = entry.ugoira ? '' : fmtDur(entry.duration);
    const pf = $('.platform', card);
    const p = data.platform || {};
    pf.append(logoImg(p), document.createTextNode(p.name || entry.extractor || 'Web'));
    if (data.count > 1) pf.append(el('span', 'count', `${idx + 1} / ${data.count}`));
    $('.title', card).textContent = entry.title || 'Tanpa judul';
    $('.uploader', card).textContent = entry.uploader ? `oleh ${entry.uploader}` : '';

    const panels = { video: $('[data-panel="video"]', card), audio: $('[data-panel="audio"]', card), images: $('[data-panel="images"]', card) };
    entry.video.forEach((o) => panels.video.append(optionRow(card, entry, o, false)));
    entry.audio.forEach((o) => panels.audio.append(optionRow(card, entry, o, true)));
    if ((entry.images || []).length) renderImages(card, entry, panels.images);

    const available = {
      video: entry.video.length > 0,
      audio: entry.audio.length > 0,
      images: (entry.images || []).length > 0,
    };
    const tabs = card.querySelectorAll('.tab');
    tabs.forEach((t) => {
      if (!available[t.dataset.tab]) t.classList.add('hidden');
      t.onclick = () => {
        tabs.forEach((x) => x.classList.toggle('active', x === t));
        Object.entries(panels).forEach(([k, pnl]) => pnl.classList.toggle('hidden', k !== t.dataset.tab));
      };
    });
    const first = ['video', 'images', 'audio'].find((k) => available[k]) || 'video';
    card.querySelector(`.tab[data-tab="${first}"]`).click();
    if (Object.values(available).filter(Boolean).length < 2) $('.tabs', card).classList.add('hidden');
    resultEl.append(card);
  });
  if (data.entries.some((e) => [...e.video, ...e.audio].some((o) => (o.sources || []).some((s) => s.via === 'server')))) {
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
fetch('https://api.github.com/repos/xykal/XyDownloader/releases/latest')
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
