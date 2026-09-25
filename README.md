<p align="center">
  <img src="public/logo.svg" width="96" alt="XyDownloader">
</p>

<h1 align="center">XyDownloader</h1>
<p align="center"><b>Download video & MP3 dari semua platform — Web + Android native</b><br>
TikTok · Douyin · Instagram · YouTube · Bilibili · Kuaishou · X/Twitter · Facebook · Threads · Vidio · Weibo · 1.700+ situs</p>

<p align="center">
  <a href="https://xydl.vercel.app"><b>🌐 Buka versi web</b></a> ·
  <a href="https://github.com/xykal/XyDownloader/releases/latest"><b>📱 Download APK</b></a> ·
  <a href="#-cara-kerjanya">⚙️ Cara kerja</a>
</p>

<p align="center"><sub>Built with 💜 by <b>XyVerse</b></sub></p>

---

## ✨ Fitur

- **Semua platform, satu tempat** — engine [yt-dlp](https://github.com/yt-dlp/yt-dlp) (1.700+ situs) + plugin buatan sendiri untuk platform yang belum didukung / sering rusak.
- **Video sampai 4K** (tergantung sumber) — video & audio yang terpisah (YouTube, Bilibili, FB DASH) digabung otomatis.
- **MP3 320/192/128 kbps** + audio asli (M4A).
- **Tanpa watermark** untuk TikTok & Douyin.
- **Web:** tanpa install, proses merge/MP3 jalan di browser (ffmpeg.wasm + lamejs) — file tidak disimpan di server.
- **Android native:** Kotlin + Jetpack Compose, engine Python/yt-dlp/FFmpeg jalan **langsung di HP** (paling stabil untuk YouTube), share-to-download, notifikasi progress, update engine dari aplikasi.

## 🌏 Platform per negara

| Region | Platform unggulan |
|---|---|
| 🇮🇩 Indonesia | Vidio (konten gratis), SnackVideo, RCTI+, Liputan6, detik, Kompas, CNN Indonesia |
| 🇨🇳 China | **Douyin** (plugin), **Kuaishou** (plugin), Bilibili (plugin fallback), Xiaohongshu, Weibo, Youku, Tencent Video, Zhihu, AcFun, Toutiao, Xigua, NetEase Music, Huya, Douyu |
| 🇸🇬 Singapura & SEA | Likee, Bigo Live, meWATCH, Kwai, Shopee Video |
| 🇺🇸 US | YouTube, Instagram, Facebook, X/Twitter, **Threads** (plugin), Reddit, Pinterest, Snapchat, Twitch, Vimeo, SoundCloud, LinkedIn, Bluesky, Tumblr, Rumble, Imgur, Streamable |
| 🌍 Global | TikTok, Dailymotion, Kick, 9GAG + semua situs lain yang didukung yt-dlp |

> Daftar hasil uji nyata ada di bagian [Status & keterbatasan](#-status--keterbatasan).

---

## ⚙️ Cara kerjanya

Intinya downloader "all platform" itu **bukan satu scraper raksasa**, tapi 3 lapisan:

1. **Extractor** — membaca halaman/API platform lalu menemukan URL file video/audio asli (+ header/cookie yang dibutuhkan). Ini bagian tersulit karena tiap platform beda dan sering berubah → kita pakai **yt-dlp** (dirawat ratusan kontributor, 1.700+ extractor) + **plugin sendiri** untuk yang belum ada.
2. **Pengantar file (proxy/streaming)** — URL CDN platform biasanya butuh `Referer`/cookie khusus, tidak boleh diakses lintas domain (CORS), atau terikat IP. Jadi file dialirkan lewat proxy yang menambahkan header yang benar.
3. **Pengolah** — menggabungkan video+audio terpisah (DASH), mengemas ulang HLS (`.m3u8` → `.mp4`), dan konversi ke MP3 → **FFmpeg**.

### Arsitektur XyDownloader

```
                         ┌────────────────────────────── Vercel (Python) ─────────────────────────────┐
  Browser  ── POST ──▶   │  /api/extract   yt-dlp + plugin XyDownloader  ──▶ JSON: judul, thumbnail,    │
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


  Android: Kotlin + Compose ──▶ youtubedl-android (Python + yt-dlp + FFmpeg + QuickJS di HP)
           ──▶ plugin XyDownloader yang sama (--plugin-dirs) ──▶ Download/XyDownloader
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
xydl/platforms.py       Katalog platform per region
plugins/yt_dlp_plugins/ Plugin extractor yt-dlp XyDownloader (dipakai web DAN Android)
public/                 Web UI (HTML/CSS/JS murni) + vendor ffmpeg.wasm loader & lamejs
worker/                 Cloudflare Worker proxy streaming
android/                Aplikasi Android (Kotlin, Jetpack Compose, WorkManager, youtubedl-android)
tests/                  Tes offline logika pemilihan format & token
.github/workflows/      CI (tes), deploy (Vercel + Cloudflare), build & release APK
```

### Plugin extractor buatan XyDownloader

| Plugin | Masalah di yt-dlp | Solusi |
|---|---|---|
| `xy:douyin` | "Fresh cookies needed" | Membuat cookie `ttwid` otomatis, dukung short link `v.douyin.com` & teks share, retry dengan parameter ala browser |
| `xy:kuaishou` | Belum ada extractor | Ambil `INIT_STATE` dari halaman share mobile |
| `xy:threads` | Belum ada extractor | Ambil JSON SSR halaman post (termasuk carousel) |
| `xy:bilibili` | HTTP 412 dari IP tertentu | Fallback ke API resmi `x/player/playurl` (MP4 720p + DASH) |

---

## 🚀 Deploy sendiri

### 1. Cloudflare Worker (proxy)

```bash
cd worker
npx wrangler deploy
openssl rand -base64 32 | npx wrangler secret put SIGNING_KEY   # simpan nilainya!
```

### 2. Vercel (web + API)

Buat project Vercel dari repo ini (framework: *Other*), lalu set Environment Variables:

| Variabel | Isi |
|---|---|
| `XYDL_SIGNING_KEY` | **Sama persis** dengan `SIGNING_KEY` di Worker |
| `XYDL_PROXY_BASE` | URL Worker, mis. `https://xydl-proxy.<akun>.workers.dev` |
| `XYDL_EXTRACT_PROXY` | *(opsional)* proxy `http://`/`socks5://` (mis. residensial) untuk platform yang memblokir IP cloud |
| `XYDL_PROXY_DOMAINS` | *(opsional)* domain yang lewat proxy di atas (default: youtube, bilibili, douyin, reddit) |

Region default `sin1` (Singapura, paling dekat ke Indonesia) — ubah di `vercel.json`.

### 3. CI/CD (GitHub Actions)

Secrets repo yang dipakai workflow:

| Secret | Untuk |
|---|---|
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | Deploy web |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Deploy Worker |
| `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` | Tanda tangan APK release |

- Push ke `main` → tes + deploy otomatis. Tiap Senin redeploy supaya yt-dlp selalu versi terbaru.
- Push tag `v1.2.3` → build APK & buat GitHub Release.

### Development lokal

```bash
pip install -r requirements.txt uvicorn pytest
pytest -q                                   # tes offline
XYDL_PROXY_BASE=https://<worker>.workers.dev XYDL_SIGNING_KEY=<key> uvicorn dev_server:app --port 8000
# buka http://localhost:8000
```

Android: buka folder `android/` di Android Studio (JDK 17), atau `cd android && ./gradlew assembleDebug`.

---

## 📊 Status & keterbatasan

Hasil uji nyata dari server produksi (Vercel `sin1`) — September 2026:

| Status | Platform |
|---|---|
| ✅ Web lancar | TikTok, Instagram, Facebook, X/Twitter, Threads, Kuaishou, Weibo, Vidio (HLS), Pinterest, Bluesky, SoundCloud, Dailymotion |
| ⚠️ Web tidak stabil | Douyin (kadang ditolak dari IP cloud), Xiaohongshu (wajib link share asli ber-`xsec_token`) |
| 📱 Pakai Android | **YouTube**, **Bilibili**, Reddit, Vimeo — memblokir semua IP cloud (Vercel/AWS & Cloudflare). Di aplikasi Android berjalan normal karena memakai IP pengguna. |
| ❌ Tidak didukung | Konten DRM/berbayar (Vidio Premier, iQIYI VIP, Netflix, dsb) & konten privat |

Catatan lain:
- Merge/MP3 di browser memakai RAM perangkat — untuk file > ±1,5 GB gunakan aplikasi Android.
- Vercel Hobby hanya untuk penggunaan non-komersial. Untuk skala besar pindah ke plan berbayar atau server sendiri.
- Kalau punya proxy residensial, set `XYDL_EXTRACT_PROXY` → YouTube/Bilibili di web ikut jalan (jalur `/api/stream` sudah siap).

## ⚖️ Disclaimer

Gunakan hanya untuk konten milik sendiri atau yang kamu punya izin untuk mengunduhnya, dan patuhi ketentuan layanan tiap platform. XyDownloader tidak berafiliasi dengan platform mana pun dan tidak membobol DRM.

## 📜 Lisensi & kredit

**GPL-3.0** (mengikuti youtubedl-android). Dibangun di atas: [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense), [youtubedl-android](https://github.com/JunkFood02/youtubedl-android) (GPL-3.0), [FFmpeg](https://ffmpeg.org) / [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm), [lamejs](https://github.com/zhuker/lamejs) (LGPL), Jetpack Compose, Cloudflare Workers, Vercel.

<p align="center"><img src="public/xyverse.svg" width="40" alt="XyVerse"><br><sub>Built with 💜 by <b>XyVerse</b></sub></p>
