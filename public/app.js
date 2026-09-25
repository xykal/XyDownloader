// XyDownloader — web client (by XyVerse)
// Semua proses berat (merge video+audio, remux HLS, konversi MP3) berjalan di browser.

const API = '/api';
const FFMPEG_CORE_BASES = [
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm',
  'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm',
];
const RANGE_CHUNK = 32 * 1024 * 1024; // untuk /api/stream (tiap request < batas waktu function)
const BROWSER_LIMIT = 1.6 * 1024 * 1024 * 1024;

const $ = (s, el = document) => el.querySelector(s);
const form = $('#form');
const input = $('#url');
const goBtn = $('#go');
const resultEl = $('#result');
const detectedEl = $('#detected');
let platformList = [];
let busy = false;

// ------------------------------------------------------------------ utils
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
function mimeFor(ext) {
  return ({ mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mp3: 'audio/mpeg', m4a: 'audio/mp4', ts: 'video/mp2t', opus: 'audio/ogg' })[ext] || 'application/octet-stream';
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

async function fetchRetry(url, opts = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.ok || res.status === 206) return res;
      last = new Error(`HTTP ${res.status}`);
      last.status = res.status;
      if (res.status === 403 || res.status === 404 || res.status === 410) break;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      last = e;
    }
    await sleep(600 * (i + 1));
  }
  throw last;
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
  stage(text) {
    this.labelEl.textContent = text;
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
  finish(cls, text, sub = '') {
    this.bar.classList.remove('indeterminate');
    this.el.classList.add(cls);
    $('b', this.bar).style.width = '100%';
    this.labelEl.textContent = text;
    this.pctEl.textContent = '';
    this.subEl.textContent = sub;
    this.cancelBtn.classList.add('hidden');
    this.card._task = null;
  }
  done(text, sub) { this.finish('done', text, sub); }
  fail(text, sub) { this.finish('error', text, sub); }
}

// ------------------------------------------------------------------ fetching sources
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
  if (total > BROWSER_LIMIT) throw new Error('File terlalu besar untuk diproses di browser. Pakai aplikasi Android XyDownloader ya.');
  return readWithProgress(res, (l) => {
    task.progress(total ? p0 + (p1 - p0) * (l / total) : p0, `${label} · ${fmtBytes(l)}${total ? ' / ' + fmtBytes(total) : ''}`);
  }, task.signal);
}

// Sumber lewat server (/api/stream): diambil per-potongan dengan header Range
async function fetchRanged(url, task, label, p0, p1, sizeHint) {
  const parts = [];
  let start = 0;
  let total = sizeHint || null;
  let loadedAll = 0;
  while (total === null || start < total) {
    const end = total ? Math.min(start + RANGE_CHUNK, total) - 1 : start + RANGE_CHUNK - 1;
    const res = await fetchRetry(url, { headers: { Range: `bytes=${start}-${end}` }, signal: task.signal });
    if (res.status === 200) {
      // server tidak mendukung Range: ambil sekaligus
      const t = +res.headers.get('content-length') || total || 0;
      return readWithProgress(res, (l) => task.progress(t ? p0 + (p1 - p0) * (l / t) : p0, `${label} · ${fmtBytes(l)}`), task.signal);
    }
    const cr = res.headers.get('content-range') || '';
    const t = parseInt(cr.split('/')[1], 10);
    if (t) total = t;
    if (total > BROWSER_LIMIT) throw new Error('File terlalu besar untuk diproses di browser. Pakai aplikasi Android XyDownloader ya.');
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
      else throw new Error('Video ini terenkripsi DRM/SAMPLE-AES — tidak didukung.');
    } else if (line.startsWith('#EXT-X-MAP')) {
      map = new URL(hlsAttr(line, 'URI'), url).href;
    } else if (!line.startsWith('#')) {
      segs.push({ uri: new URL(line, url).href, key, seq: seq++ });
    }
  }
  if (!segs.length) throw new Error('Playlist HLS kosong');
  const keyCache = new Map();
  async function getKey(k) {
    if (!keyCache.has(k.uri)) {
      keyCache.set(k.uri, fetchRetry(k.uri, { signal: task.signal })
        .then((r) => r.arrayBuffer())
        .then((raw) => crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['decrypt'])));
    }
    return keyCache.get(k.uri);
  }
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
      if (bytes > BROWSER_LIMIT) throw new Error('Video terlalu besar untuk diproses di browser. Pakai aplikasi Android ya.');
      task.progress(p0 + (p1 - p0) * (done / segs.length), `${label} · ${done}/${segs.length} segmen · ${fmtBytes(bytes)}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, segs.length) }, worker));
  const parts = map ? [new Uint8Array(await (await fetchRetry(map, { signal: task.signal })).arrayBuffer()), ...results] : results;
  const b0 = results[0];
  let container = 'ts';
  if (map) container = 'mp4';
  else if (b0[0] === 0xff && (b0[1] & 0xf0) === 0xf0) container = 'aac';
  else if (b0[0] === 0x49 && b0[1] === 0x44 && b0[2] === 0x33) container = 'aac'; // ID3 + ADTS
  return { blob: new Blob(parts), container };
}

async function probeOk(url, signal) {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal });
    try { res.body?.cancel(); } catch { /* ignore */ }
    return res.ok || res.status === 206;
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return false;
  }
}

// Ambil satu sumber (video / audio / av) -> {blob, container}
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

// Jalankan job ffmpeg satu per satu (instance dipakai bersama)
function withFFmpeg(task, fn) {
  const run = ffQueue.then(async () => {
    const ff = await getFFmpeg(task);
    return fn(ff);
  });
  ffQueue = run.catch(() => {});
  return run;
}

async function ffRun(ff, task, args, inputs, output, durationHint, label) {
  const names = [];
  try {
    for (const [name, blob] of inputs) {
      await ff.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
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
    for (const n of names) { try { await ff.deleteFile(n); } catch { /* ignore */ } }
  }
}

function inName(prefix, src) {
  const ext = src.container === 'ts' ? 'ts' : src.container === 'aac' ? 'aac' : (src.container || 'mp4');
  return `${prefix}.${ext}`;
}

async function ffMerge(task, v, a, ext, duration) {
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

async function ffRemux(task, src, ext, duration) {
  return withFFmpeg(task, async (ff) => {
    const n = inName('in', src);
    const out = `out.${ext}`;
    const args = ['-i', n, '-c', 'copy'];
    if (ext === 'mp4') args.push('-bsf:a', 'aac_adtstoasc');
    args.push(out);
    const data = await ffRun(ff, task, args, [[n, src.blob]], out, duration, 'Mengemas ulang ke MP4…');
    return new Blob([data.buffer], { type: mimeFor(ext) });
  });
}

async function ffMp3(task, src, kbps, duration) {
  return withFFmpeg(task, async (ff) => {
    const n = inName('in', src);
    const data = await ffRun(ff, task, ['-i', n, '-vn', '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, 'out.mp3'],
      [[n, src.blob]], 'out.mp3', duration, `Konversi ke MP3 ${kbps} kbps…`);
    return new Blob([data.buffer], { type: 'audio/mpeg' });
  });
}

// ------------------------------------------------------------------ MP3 (lamejs, cepat untuk audio pendek)
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
      console.warn('decodeAudioData gagal, fallback ffmpeg:', e);
    }
  }
  return ffMp3(task, src, kbps, duration);
}

// ------------------------------------------------------------------ download orchestration
async function startDownload(card, entry, opt) {
  if (card._task) { toast('Tunggu proses sebelumnya selesai dulu ya'); return; }
  const task = new Task(card, `Menyiapkan ${opt.label}…`);
  const duration = entry.duration;
  try {
    const srcs = opt.sources || [];
    if (opt.mode === 'direct') {
      const src = srcs[0];
      task.stage('Mengecek link…');
      if (await probeOk(src.url, task.signal)) {
        navDownload(`${src.url}&dl=1`);
        task.done('Download dimulai ✅', 'Cek notifikasi / folder Download di perangkat kamu.');
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
          toast('Gagal remux, file disimpan dalam format asli');
        }
      }
      saveBlob(blob, name);
    } else if (opt.mode === 'merge') {
      const [vs, as] = srcs;
      const total = (vs.size || 0) + (as.size || 0);
      if (total > BROWSER_LIMIT) throw new Error('File terlalu besar untuk diproses di browser. Pakai aplikasi Android XyDownloader ya.');
      const v = await getSource(vs, task, 'Mengunduh video', 0, 0.82);
      const a = await getSource(as, task, 'Mengunduh audio', 0.82, 0.97);
      const out = await ffMerge(task, v, a, opt.ext, duration);
      saveBlob(out, opt.filename);
    } else if (opt.mode === 'mp3') {
      const src = await getSource(srcs[0], task, 'Mengunduh audio', 0, 1);
      const mp3 = await toMp3(task, src, opt.bitrate || 192, duration);
      saveBlob(mp3, opt.filename);
    } else {
      throw new Error(`Mode tidak dikenal: ${opt.mode}`);
    }
    task.done('Selesai! ✅', `${opt.filename} tersimpan di folder Download.`);
  } catch (e) {
    console.error(e);
    if (e.name === 'AbortError') task.fail('Dibatalkan');
    else task.fail('Gagal ❌', e.message || String(e));
  }
}

// ------------------------------------------------------------------ rendering
function renderSkeleton() {
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = `
    <div class="skeleton"><div class="s-thumb shimmer"></div>
      <div class="s-lines"><div class="shimmer" style="height:14px;width:30%"></div>
      <div class="shimmer" style="height:18px;width:90%"></div><div class="shimmer" style="height:18px;width:70%"></div>
      <div class="shimmer" style="height:40px;margin-top:10px"></div><div class="shimmer" style="height:40px"></div></div></div>
    <p class="loading-tip" id="tip">Membaca link & mencari semua kualitas…</p>`;
  const tips = ['Membaca link & mencari semua kualitas…', 'Menghubungi server platform…', 'Mencari versi tanpa watermark…', 'Hampir selesai…'];
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
  card.append(el('h3', '', 'Waduh, gagal memproses link 😕'));
  card.append(el('p', '', err.error || err.message || 'Terjadi kesalahan.'));
  if (err.code === 'blocked' || err.code === 'private') {
    const cta = el('a', 'btn-primary', '📱 Pakai aplikasi Android XyDownloader');
    cta.href = '#android';
    cta.style.marginTop = '12px';
    card.append(cta);
  }
  if (err.detail) {
    const d = el('details');
    d.append(el('summary', '', 'Detail teknis'));
    d.append(el('div', '', err.detail));
    card.append(d);
  }
  resultEl.append(card);
}

function tag(text, cls = '') { return el('span', `tag ${cls}`.trim(), text); }

function optionRow(card, entry, opt, isAudio) {
  const row = el('div', 'opt');
  row.append(el('span', 'q', isAudio ? (opt.kind === 'mp3' ? 'MP3' : (opt.ext || '').toUpperCase()) : opt.label));
  const info = el('span', 'info');
  if (isAudio) {
    info.append(el('span', '', opt.kind === 'mp3' ? `${opt.bitrate} kbps` : opt.label));
  } else {
    info.append(tag(opt.ext.toUpperCase(), opt.quality >= 720 ? 'hd' : ''));
    if (opt.codec) info.append(tag(opt.codec));
    if (opt.no_audio) info.append(tag('tanpa audio', 'warn'));
  }
  if (opt.size) info.append(el('span', '', `${opt.mode === 'mp3' ? '±' : ''}${fmtBytes(opt.size)}`));
  if (opt.mode === 'merge') info.append(tag('merge di browser'));
  if (opt.mode === 'hls') info.append(tag('HLS'));
  if ((opt.sources || []).some((s) => s.via === 'server')) info.append(tag('jalur server'));
  row.append(info);
  const btn = el('button', 'btn-primary dl', '⬇ Download');
  btn.type = 'button';
  btn.onclick = () => startDownload(card, entry, opt);
  row.append(btn);
  return row;
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
      img.onerror = () => { img.remove(); };
    } else img.remove();
    $('.dur', card).textContent = fmtDur(entry.duration);
    const badge = $('.badge', card);
    const p = data.platform || {};
    const dot = el('i');
    dot.style.background = p.color || '#8b5cf6';
    badge.append(dot, document.createTextNode(p.name || entry.extractor || 'Web'));
    if (data.count > 1) badge.append(document.createTextNode(` · ${idx + 1}/${data.count}`));
    $('.title', card).textContent = entry.title || 'Tanpa judul';
    $('.uploader', card).textContent = entry.uploader ? `oleh ${entry.uploader}` : '';

    const vp = $('[data-panel="video"]', card);
    const ap = $('[data-panel="audio"]', card);
    if (entry.video.length) entry.video.forEach((o) => vp.append(optionRow(card, entry, o, false)));
    else vp.append(el('p', 'empty', 'Tidak ada video di postingan ini — cek tab Audio.'));
    if (entry.audio.length) entry.audio.forEach((o) => ap.append(optionRow(card, entry, o, true)));
    else ap.append(el('p', 'empty', 'Audio terpisah tidak tersedia untuk konten ini.'));

    const tabs = card.querySelectorAll('.tab');
    tabs.forEach((t) => {
      t.onclick = () => {
        tabs.forEach((x) => x.classList.toggle('active', x === t));
        vp.classList.toggle('hidden', t.dataset.tab !== 'video');
        ap.classList.toggle('hidden', t.dataset.tab !== 'audio');
      };
    });
    if (!entry.video.length && entry.audio.length) tabs[1].click();
    resultEl.append(card);
  });
  if (entryHasServer(data)) toast('Konten ini diproses lewat jalur server — bisa sedikit lebih lambat.');
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function entryHasServer(data) {
  return data.entries.some((e) => [...e.video, ...e.audio].some((o) => (o.sources || []).some((s) => s.via === 'server')));
}

// ------------------------------------------------------------------ extract flow
function setBusy(v) {
  busy = v;
  goBtn.disabled = v;
  $('.spinner', goBtn).classList.toggle('hidden', !v);
  $('.go-text', goBtn).textContent = v ? 'Memproses…' : 'Proses';
}

async function processLink(text) {
  if (busy) return;
  const url = findUrl(text);
  if (!url) {
    toast('Tempel link yang valid dulu ya (diawali https://)');
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
    if (e && e.name === 'AbortError') renderError({ error: 'Kelamaan menunggu respon server. Coba lagi ya.' });
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
    const chip = el('span', 'chip');
    const dot = el('i');
    dot.style.background = p.color;
    chip.append(dot, document.createTextNode(p.name));
    detectedEl.append(document.createTextNode('Terdeteksi:'), chip);
    if (p.note) detectedEl.append(el('span', 'muted small', `  ${p.note}`));
  } else {
    detectedEl.textContent = 'Situs lain — tetap dicoba dengan engine universal 🌍';
  }
}

async function loadPlatforms() {
  try {
    const data = await (await fetch(`${API}/platforms`)).json();
    const wrap = $('#regions');
    wrap.innerHTML = '';
    platformList = [];
    for (const r of data.regions) {
      platformList.push(...r.platforms);
      const box = el('div', 'region');
      const h = el('h3');
      h.append(document.createTextNode(`${r.flag} ${r.name} `), el('small', '', `(${r.platforms.length})`));
      box.append(h);
      const chips = el('div', 'chips');
      for (const p of r.platforms) {
        const c = el('span', 'chip');
        const dot = el('i');
        dot.style.background = p.color;
        c.append(dot, document.createTextNode(p.name));
        if (p.note) c.title = p.note;
        chips.append(c);
      }
      box.append(chips);
      wrap.append(box);
    }
    updateDetected();
  } catch (e) {
    $('#regions').innerHTML = '<p class="muted">Gagal memuat daftar platform.</p>';
  }
}

// ------------------------------------------------------------------ events
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

// Link APK terbaru langsung dari GitHub Releases (kalau API bisa diakses)
fetch('https://api.github.com/repos/xykal/XyDownloader/releases/latest')
  .then((r) => (r.ok ? r.json() : null))
  .then((rel) => {
    if (!rel || !rel.assets) return;
    const apk = rel.assets.find((a) => /arm64-v8a.*\.apk$/i.test(a.name)) || rel.assets.find((a) => /\.apk$/i.test(a.name));
    if (apk) {
      const link = $('#apk-link');
      link.href = apk.browser_download_url;
      link.textContent = `⬇️ Download APK ${rel.tag_name} (${fmtBytes(apk.size)})`;
      $('#apk-hint').innerHTML = `Versi untuk kebanyakan HP (arm64). <a href="${rel.html_url}" target="_blank" rel="noopener">Lihat semua versi</a> (armeabi-v7a untuk HP lama, x86_64 untuk emulator).`;
    }
  })
  .catch(() => {});
