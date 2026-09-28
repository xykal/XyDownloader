<p align="center">
  <img src="public/logo.svg" width="96" alt="DownloadAja">
</p>

<h1 align="center">DownloadAja</h1>
<p align="center"><b>Download video, MP3, foto slide & Live Photo dari semua platform — Web + Android native</b><br>
TikTok · Douyin · Instagram · YouTube · Bilibili · Kuaishou · Xiaohongshu · X/Twitter · Facebook · Threads · pixiv · Vidio · Weibo · 1.700+ situs</p>

<p align="center">
  <a href="https://dlaja.xyverse.my.id"><b>Buka versi web</b></a> ·
  <a href="https://github.com/xykal/XyDownloader/releases/latest"><b>Download APK</b></a> ·
  <a href="#cara-kerjanya">Cara kerja</a>
</p>

<p align="center"><sub>Built in <b>XyVerse</b></sub></p>

---

## Fitur

- **Semua platform, satu tempat** — engine [yt-dlp](https://github.com/yt-dlp/yt-dlp) (1.700+ situs) + plugin buatan sendiri untuk platform yang belum didukung / sering rusak.
- **Video sampai 4K** (tergantung sumber) — video & audio yang terpisah (YouTube, Bilibili, FB DASH) digabung otomatis.
- **MP3 320/192/128 kbps** + audio asli (M4A). **Tanpa watermark** untuk TikTok & Douyin.
- **Foto slide & Live Photo (v1.2)** — TikTok (mode foto), Douyin, Xiaohongshu, Kuaishou, X, Instagram (carousel), Threads, Bluesky, Weibo & pixiv. **Pilih foto satu per satu**; Live Photo bisa diunduh sebagai foto, video, atau keduanya; musik latar slide bisa jadi MP3.
- **Pratinjau sebelum download (v1.2)** — putar video (web: `<video>`, Android: Media3 ExoPlayer) dan lihat foto di viewer layar penuh.
- **pixiv:** ilustrasi & manga resolusi asli + ugoira otomatis jadi **MP4/GIF**.
- **UI clean & modern:** tanpa gradasi, ikon garis (tanpa emoji), otomatis terang/gelap, **logo asli tiap platform**.
- **Web:** tanpa install, proses merge/MP3/ZIP jalan di browser (ffmpeg.wasm + lamejs) — file tidak disimpan di server.
- **Android native:** Kotlin + Jetpack Compose, engine Python/yt-dlp jalan **langsung di HP** (paling stabil untuk YouTube), share-to-download, notifikasi progress.
  - **APK ramping (v1.2):** FFmpeg dibangun ulang khusus kebutuhan aplikasi, runtime Python dirampingkan, kode dikecilkan R8 — lihat [Ukuran APK](#ukuran-apk).
  - **Lebih cepat (v1.2):** daemon Python "hangat", cache bytecode yt-dlp, download memakai ulang info yang sudah dibaca (`--load-info-json`).
  - **Pembaruan otomatis (v1.2):** popup gambar tiap ada versi baru, tombol **Perbarui** mengunduh & memasang APK terbaru (Android 12+ tanpa konfirmasi tambahan).

## Platform per negara

| Region | Platform unggulan |
|---|---|
| 🇮🇩 Indonesia | Vidio (konten gratis), SnackVideo, RCTI+, Liputan6, detik, Kompas, CNN Indonesia |
| 🇨🇳 China | **Douyin** (plugin, foto + Live Photo), **Kuaishou** (plugin, atlas foto), Bilibili (plugin fallback), **Xiaohongshu** (plugin, foto + Live Photo), **Weibo** (plugin, foto + livephoto), Youku, Tencent Video, Zhihu, AcFun, Toutiao, Xigua, NetEase Music, Huya, Douyu |
| 🇯🇵 Jepang | **pixiv** (plugin: ilustrasi, manga, ugoira), Niconico |
| 🇸🇬 Singapura & SEA | Likee, Bigo Live, meWATCH, Kwai, Shopee Video |
| 🇺🇸 US | YouTube, **Instagram** (plugin, foto carousel), Facebook, **X/Twitter** (plugin, foto), **Threads** (plugin, foto + video), Reddit, Pinterest, Snapchat, Twitch, Vimeo, SoundCloud, LinkedIn, Bluesky, Tumblr, Rumble, Imgur |
| Global | **TikTok** (plugin, mode foto), Dailymotion, Kick, 9GAG + semua situs lain yang didukung yt-dlp |

> Daftar hasil uji nyata ada di bagian [Status & keterbatasan](#-status--keterbatasan).

---

## Cara kerjanya

Intinya downloader "all platform" itu **bukan satu scraper raksasa**, tapi 3 lapisan:

1. **Extractor** — membaca halaman/API platform lalu menemukan URL file video/audio asli (+ header/cookie yang dibutuhkan). Ini bagian tersulit karena tiap platform beda dan sering berubah → kita pakai **yt-dlp** (dirawat ratusan kontributor, 1.700+ extractor) + **plugin sendiri** untuk yang belum ada.
2. **Pengantar file (proxy/streaming)** — URL CDN platform biasanya butuh `Referer`/cookie khusus, tidak boleh diakses lintas domain (CORS), atau terikat IP. Jadi file dialirkan lewat proxy yang menambahkan header yang benar.
3. **Pengolah** — menggabungkan video+audio terpisah (DASH), mengemas ulang HLS (`.m3u8` → `.mp4`), dan konversi ke MP3 → **FFmpeg**.

### Arsitektur DownloadAja

```
                         ┌────────────────────────────── Vercel (Python) ─────────────────────────────┐
  Browser  ── POST ──▶   │  /api/extract   yt-dlp + plugin DownloadAja  ──▶ JSON: judul, thumbnail,    │
  (web)                  │                 opsi video/audio + link bertanda tangan (HMAC, 6 jam)       │
     │                   │  /api/stream    cadangan untuk link yang terikat IP server (googlevideo)    │
     │                   └─────────────────────────────────────────────────────────────────────────────┘
     │  GET link bertanda tangan
     ▼
  ┌──────────── Cloudflare Worker ────────────┐          ┌──────────────┐
  │ /f/<nama>   stream file + Range/resume     │  ──────▶ │ CDN platform │
  │ /m3u8       rewrite playlist HLS           │ ◀──────  │ (TikTok, IG, │
  │ verifikasi HMAC → bukan open proxy         │          │  Douyin, dst)│
  └────────────────────────────────────────────┘          └──────────────┘
     │
     ▼
  Browser: ffmpeg.wasm (merge / remux HLS) + lamejs (MP3)  ──▶  file tersimpan di perangkat


  Android: Kotlin + Compose ──▶ daemon Python "hangat" (yt-dlp + plugin DownloadAja yang sama) ──▶ info JSON
           ──▶ download: youtubedl-android (--load-info-json) + FFmpeg minimal, atau HTTP langsung
               untuk foto/Live Photo ──▶ Download/DownloadAja
```

Kenapa dibagi begini?

| Komponen | Kenapa |
|---|---|
| **Python di Vercel** | yt-dlp adalah Python. Cloudflare Workers Python (Pyodide) tidak punya socket, jadi extractor harus di Vercel Functions. |
| **Cloudflare Worker untuk file** | Response Vercel dibatasi ukuran/durasi; Worker bisa streaming file berapa pun besarnya, dukung Range (resume), bandwidth gratis & dekat pengguna. |
| **Merge/MP3 di browser** | FFmpeg di server itu berat & mahal. ffmpeg.wasm + lamejs membuat server tetap ringan dan file pengguna tidak pernah disimpan di server. |
| **Link bertanda tangan (HMAC)** | Worker hanya mau meneruskan URL yang dibuat API kita (dan kedaluwarsa), jadi tidak bisa disalahgunakan jadi open proxy. |
| **Android native** | Banyak platform (YouTube, Bilibili, Douyin) memblokir IP cloud. Di Android engine jalan dari IP pengguna sendiri → jauh lebih stabil. |

### Struktur repo

```
api/index.py            Vercel Function (ASGI murni): /api/extract, /api/stream, /api/platforms, /api/health
xydl/engine.py          Normalisasi hasil yt-dlp → opsi video/audio, pilih format terbaik, bungkus link
xydl/signer.py          Token HMAC-SHA256 (dipakai juga oleh Worker)
xydl/netpolicy.py       Allowlist origin CORS + IP klien (dicerminkan worker/src/netpolicy.js, diuji pakai fixture yang sama)
xydl/platforms.py       Katalog platform per region
plugins/yt_dlp_plugins/ Plugin extractor + postprocessor yt-dlp DownloadAja (dipakai web DAN Android)
public/                 Web UI (HTML/CSS/JS murni) + logos/ (logo asli platform) + flags/ + vendor ffmpeg.wasm & lamejs
scripts/                fetch_logos.py · sync_android.py · make_banner.py (gambar popup) · gen_notices.py (lisensi)
worker/                 Cloudflare Worker proxy streaming
android/                Aplikasi Android (Kotlin, Jetpack Compose, WorkManager, Media3, youtubedl-android)
android/ffmpeg/         build.sh: FFmpeg 8 minimal (LGPL + LAME) untuk arm64/armv7/x86_64
android/tools/          prepare_native.py: runtime Python ramping + pasang FFmpeg minimal ke APK
android/app/src/main/assets/py/   Daemon Python (yt-dlp tetap hangat untuk "proses link")
licenses/               Daftar komponen + teks lisensi lengkap (dipakai layar Lisensi & THIRD_PARTY_NOTICES.md)
tests/                  Tes offline: pytest (engine, token, CORS/IP policy) + node:test (Worker & dash)
.github/workflows/      CI (tes), deploy (Vercel + Cloudflare), build & release APK
```

### Plugin extractor buatan DownloadAja

| Plugin | Masalah di yt-dlp | Solusi |
|---|---|---|
| `xy:douyin` | "Fresh cookies needed" | Membuat cookie `ttwid` otomatis, dukung short link `v.douyin.com` & teks share, retry dengan parameter ala browser |
| `xy:kuaishou` | Belum ada extractor | Ambil `INIT_STATE` dari halaman share mobile |
| `xy:threads` | Belum ada extractor | Ambil JSON SSR halaman post (termasuk carousel) |
| `xy:bilibili` | HTTP 412 dari IP tertentu | Fallback ke API resmi `x/player/playurl` (MP4 720p + DASH) |
| `xy:pixiv` | Belum ada extractor | API ajax pixiv: gambar asli semua halaman + ugoira (ZIP frame + delay) |
| `xy:tiktok` | Mode foto hanya diambil audionya | Ambil `imagePost` (semua foto) + musik latar; video tetap lewat parser bawaan |
| `xy:twitter` | Foto diabaikan ("No video") | Foto resolusi asli (`name=orig`) digabung dengan video dalam satu galeri |
| `xy:instagram` | Foto di carousel membuat error | Foto dari `image_versions2` ikut jadi item galeri |
| `xy:bluesky` | Hanya video | Foto `fullsize` dari postingan |
| `xy:weibo` | Hanya video | Foto `largest` + livephoto (lewat endpoint `media/play` bertanda tangan) |
| `xy:xiaohongshu` | Hanya catatan video | Catatan foto (图文) + Live Photo (实况) dari `__INITIAL_STATE__`, short link `xhslink.com` |
| `xy:douyin` / `xy:kuaishou` / `xy:threads` | — | Juga: 图文 + Live Photo (Douyin), atlas foto + musik (Kuaishou), foto & carousel (Threads) |
| `XyUgoiraPP` (postprocessor) | — | Di Android: ZIP frame ugoira → MP4 dengan FFmpeg (libx264 bila ada, selain itu encoder mpeg4). Di web dilakukan ffmpeg.wasm |

### Ukuran APK

`isMinifyEnabled = true` (R8) + `isShrinkResources = true` hanya mengecilkan **kode Kotlin/Java** (dex) dan resource. Sebagian besar isi APK DownloadAja adalah **runtime native** yang tidak bisa disentuh R8, jadi di v1.2 bagian itu dirampingkan terpisah:

| Bagian (arm64) | v1.1 | v1.2 | Caranya |
|---|---|---|---|
| FFmpeg (`libffmpeg*.so`) | ±35,6 MB | ±2 MB | Build ulang FFmpeg 8 statis hanya dengan komponen yang dipakai yt-dlp: merge (copy), MP3 (LAME), M4A, fixup HLS/DASH, ugoira (`android/ffmpeg/build.sh`) |
| Python (`libpython.zip.so`) | ±14,3 MB | ±9,8 MB | Buang static lib QuickJS, ncurses/readline/gdbm, SQLite, libc++, modul tes, lib2to3, kurva ECC (`android/tools/prepare_native.py`) |
| Kode (dex) | ±8,2 MB | ±2-3 MB | R8 + tanpa AppCompat |
| yt-dlp (res/raw) | ±3 MB | ±3 MB | Selalu versi terbaru saat build (tidak perlu update di pembukaan pertama) |

Hasil build CI tercetak di langkah *Rapikan nama file & cek isi APK*.

### Pembaruan aplikasi & popup

- Aplikasi mengecek `releases/latest` repo ini (maks. tiap 6 jam). Kalau ada versi baru, muncul **popup gambar** (tombol X; gambar ditekan → halaman Pembaruan). Tombol **Perbarui** mengunduh APK sesuai arsitektur HP lalu memasangnya lewat `PackageInstaller` (Android 12+: `USER_ACTION_NOT_REQUIRED`).
- Setelah diperbarui, popup "yang baru" tampil sekali.
- Gambar popup tiap rilis: `android/release-banner.webp` (dilampirkan workflow sebagai `update-banner.webp`). Buat yang baru dari ilustrasi dasar `android/banner/base.webp`:
  `python scripts/make_banner.py --title "DownloadAja 1.3" --sub "..." --out android/release-banner.webp`
- Catatan rilis: `android/RELEASE_NOTES.md` (ditampilkan juga di halaman Pembaruan aplikasi).

---

## Keamanan permukaan

Yang dijaga aktif oleh CI (semuanya offline, tanpa akun & tanpa jaringan):

| Aturan | Kenapa | dites di |
|---|---|---|
| `Access-Control-Allow-Origin` hanya buat host **eksak** + preview Vercel berprefix `xydl-`/`dlaja-` | Dulu ceknya pakai substring (`'dlaja' in origin`) — `https://dlaja.evil.com` lolos dan boleh baca `/api/extract` (JSON + link bertanda tangan) serta stream lewat proxy. Sekarang pencocokan host, bukan "ada di dalam string" | `tests/fixtures/origin_policy.json` diputar dua kali: `pytest tests/test_net_policy.py` (Python) dan `node --test tests/js` (JS) — fixture yang sama, jadi kedua runtime tidak bisa drift |
| Kunci rate-limit = IP dari hop **terakhir** `X-Forwarded-For` (atau `x-real-ip`) | Nilai pertama XFF itu dikontrol klien; pakai itu buat kunci "25 request/menit" = penyerang pilih sendiri limitnya tiap request | `tests/test_net_policy.py::test_client_ip_pakai_hop_terakhir` |
| Lapor probe ke dash itu fire-and-bounded (`asyncio.to_thread` + budget 0.6s + 60/menit/instance), bukan `urlopen` sinkron di coroutine | `urlopen` sinkron mengunci **event loop** function Vercel sampai 2 × 2,5 detik per request ber-UA mencurigakan — satu loop `curl` bisa bikin API nunggu buat semua orang. Dan tanpa budget, kita yang nembak dash sendiri | `test_lapor_probe_tidak_menahan_event_loop`, `test_budget_probe_membatasi_amplicification` |
| `POST /api/public/beacon` tidak percaya `body.ip` kecuali bawa HMAC `X-Xydl-Probe-Sig` | Endpoint itu publik. Tanpa tanda tangan, siapa pun bisa nulis IP karangan ke tabel device/probe admin (log poisoning) | `tests/js/dash_beacon.test.mjs` |
| Tulis KV dari beacon dibudget (40 event + 12 probe per IP per menit, 600 tulis per menit per isolate) | Satu script iseng cukup buat ngabisin kuota tulis KV — yang kena limit account kita, bukan dia | `tests/js/dash_beacon.test.mjs` |
| Proxy Worker cuma neruskan URL bertanda tangan HMAC + kadaluarsa, dan host tujuan dibatasi per token | Bukan open proxy: `/f/<nama>?u=...` harus ada di daftar host token itu | `test_tanpa_token_proxy_menolak_sebelum_menyentuh_CDN` |
| SSRF: host link ditolak kalau resolve ke IP privat, **dan tiap hop redirect ikut diperiksa** | yt-dlp ngikutin redirect sampai 30 hop, jadi `is_public_url` yang cuma lihat host awal bisa dilewati `302 -> http://127.0.0.1/`. Link dari host di katalog platform sengaja dilewati (mereka CDN publik; nambah roundtrip cuma bikin semua pengguna nunggu) | `tests/test_stream_and_ssrf.py` (server redirect lokal), `tests/test_engine.py` |
| `/api/stream` ada anggaran per IP: 120 permintaan + 6 GB per menit | `/api/extract` udah dibatasi, `/api/stream` belum sama sekali — satu token berumur 6 jam boleh dipakai narik file berkali-kali dan yang habis waktu function + bandwidth Vercel | `test_handle_stream_pakai_anggaran_dan_ngecat_byte`, `test_handle_stream_ditolak_sebelum_ekstrak_ulang` |

Yang **disengaja belum ditutup** (jujur di sini, bukan dikubur): cek `User-Agent` itu
pagar rendah — siapa pun yang ngasih UA `Mozilla/5.0` lewat. Fungsinya cuma nyaring
scraper malas; perlindungan nyata ada di allowlist origin + token HMAC + rate limit.
Turnstile cuma dipasang di login admin, belum di `/api/extract`.

## Deploy sendiri

### 1. Cloudflare Worker (proxy)

```bash
cd worker
npx wrangler deploy
openssl rand -base64 32 | npx wrangler secret put SIGNING_KEY   # simpan nilainya!
# opsional, kalau staging/preview butuh origin tambahan (variabel, bukan secret):
#   npx wrangler secret put XYDL_EXTRA_ORIGINS   -> "https://staging.dlaja.test"
```

### 2. Vercel (web + API)

Buat project Vercel dari repo ini (framework: *Other*), lalu set Environment Variables:

| Variabel | Isi |
|---|---|
| `XYDL_SIGNING_KEY` | **Sama persis** dengan `SIGNING_KEY` di Worker |
| `XYDL_PROXY_BASE` | URL Worker, mis. `https://xydl-proxy.<akun>.workers.dev` |
| `XYDL_EXTRACT_PROXY` | *(opsional)* proxy `http://`/`socks5://` (mis. residensial) untuk platform yang memblokir IP cloud |
| `XYDL_PROXY_DOMAINS` | *(opsional)* domain yang lewat proxy di atas (default: youtube, bilibili, douyin, reddit) |
| `XYDL_PROBE_SECRET` | *(opsional)* HMAC sama dengan secret `PROBE_REPORT_SECRET` di Worker dash — biar IP penyerang yang ke-blokir nyampe ke admin sebagai IP asli, bukan IP function Vercel |
| `XYDL_EXTRA_ORIGINS` | *(opsional)* origin CORS tambahan, dipisah koma (staging/preview) — tidak perlu ubah kode |
| `XYDL_STREAM_RATE_LIMIT` | *(opsional)* permintaan `/api/stream` per menit per IP (default 120) |
| `XYDL_STREAM_BYTE_BUDGET` | *(opsional)* byte per menit per IP di `/api/stream` (default 6442450944 = 6 GB) |
| `XYDL_GUARD_TIMEOUT` | *(opsional)* detik batas probe redirect SSRF (default 2.5) |

Region default `sin1` (Singapura, paling dekat ke Indonesia) — ubah di `vercel.json`.

### 3. CI/CD (GitHub Actions)

Secrets repo yang dipakai workflow:

| Secret | Untuk |
|---|---|
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | Deploy web |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Deploy Worker |
| `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` | Tanda tangan APK release |

- Push ke `main` → tes + deploy otomatis. Tiap Senin redeploy supaya yt-dlp selalu versi terbaru.
- Push ke `main` (bagian Android) → build APK + **smoke test di emulator** (screenshot & logcat sebagai artifact).
- Push tag `v1.2.3` → build APK & buat GitHub Release (APK per ABI + `update-banner.webp`).
- FFmpeg minimal di-cache per hash `android/ffmpeg/build.sh` (build pertama ±10 menit).

### Development lokal

```bash
pip install -r requirements.txt uvicorn pytest pyflakes
pytest -q                                   # tes engine + kebijakan origin/IP (offline)
node --test tests/js                        # tes Worker + dash (butuh Node 20, tanpa npm install)
python -m pyflakes api xydl plugins tests scripts dev_server.py  # lint
XYDL_PROXY_BASE=https://<worker>.workers.dev XYDL_SIGNING_KEY=<key> uvicorn dev_server:app --port 8000
# buka http://localhost:8000
# cek CORS cepat dari terminal (harus TIDAK ada access-control-allow-origin):
curl -sD- -o/dev/null http://127.0.0.1:8000/api/health -H 'Origin: https://dlaja.evil.com' | grep -i allow-origin
```

Android: buka folder `android/` di Android Studio (JDK 17), atau `cd android && ./gradlew assembleDebug`.
Untuk APK ramping seperti rilis: `ANDROID_NDK_HOME=... bash android/ffmpeg/build.sh android/ffmpeg/out arm64-v8a` lalu `python3 android/tools/prepare_native.py --out android/app/build/xy-jni --ffmpeg android/ffmpeg/out --abis arm64-v8a`.

---

## Status & keterbatasan

Hasil uji nyata dari server produksi (Vercel `sin1`) — September 2026:

| Status | Platform |
|---|---|
| Web lancar | TikTok (video + foto), Instagram, Facebook, X/Twitter (video + foto), Threads (foto + video), Kuaishou, Weibo (foto + livephoto), Vidio (HLS), Pinterest, Bluesky, SoundCloud, Dailymotion, pixiv |
| Web tidak stabil | Douyin (kadang ditolak dari IP cloud), Xiaohongshu (wajib link share asli ber-`xsec_token`) |
| Pakai Android | **YouTube**, **Bilibili**, Reddit, Vimeo — memblokir semua IP cloud (Vercel/AWS & Cloudflare). Di aplikasi Android berjalan normal karena memakai IP pengguna. |
| Tidak didukung | Konten DRM/berbayar (Vidio Premier, iQIYI VIP, Netflix, dsb), konten privat, karya pixiv R-18 (butuh login) |

Catatan lain:
- Merge/MP3 di browser memakai RAM perangkat — untuk file > ±1,5 GB gunakan aplikasi Android.
- Vercel Hobby hanya untuk penggunaan non-komersial. Untuk skala besar pindah ke plan berbayar atau server sendiri.
- Kalau punya proxy residensial, set `XYDL_EXTRACT_PROXY` → YouTube/Bilibili di web ikut jalan (jalur `/api/stream` sudah siap).

## Disclaimer

Gunakan hanya untuk konten milik sendiri atau yang kamu punya izin untuk mengunduhnya, dan patuhi ketentuan layanan tiap platform. DownloadAja tidak berafiliasi dengan platform mana pun dan tidak membobol DRM.

## Lisensi & kredit

**GPL-3.0** (mengikuti youtubedl-android). Daftar lengkap komponen pihak ketiga + teks lisensinya: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) (juga ada di aplikasi: Tentang → Lisensi open source, dan di web: footer → Lisensi). Dibangun di atas: [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense), [youtubedl-android](https://github.com/JunkFood02/youtubedl-android) (GPL-3.0), [FFmpeg](https://ffmpeg.org) (build minimal LGPL + [LAME](https://lame.sourceforge.io)) / [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm), [Media3 ExoPlayer](https://github.com/androidx/media), [hls.js](https://github.com/video-dev/hls.js), [lamejs](https://github.com/zhuker/lamejs) (LGPL), [flag-icons](https://github.com/lipis/flag-icons) (MIT), ikon garis gaya [Lucide](https://lucide.dev) (ISC), Jetpack Compose, Cloudflare Workers, Vercel.

**Logo platform** di `public/logos/` adalah ikon aplikasi resmi (App Store / situs resmi, lihat `scripts/fetch_logos.py`) dan merupakan merek milik pemiliknya masing-masing — dipakai hanya untuk menunjukkan kompatibilitas. Tambah platform baru: edit `xydl/platforms.py` → `python scripts/fetch_logos.py <id>` → `python scripts/sync_android.py`.

<p align="center"><img src="public/xyverse.svg" width="40" alt="XyVerse"><br><sub>Built in <b>XyVerse</b></sub></p>
