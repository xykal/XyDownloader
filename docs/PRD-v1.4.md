# PRD DownloadAja v1.4 — "unduh semua" + riwayat di web

Status: **draft, bahan mutusin**. Semua klaim di dokumen ini dicek ke kode di commit
`600e620` = `main` (2026-09-28) dan ada `file:line`-nya (nomor baris = kondisi `main`, bukan branch PR mana pun). Yang tidak ada rujukannya = asumsi, dan
ditulis sebagai pertanyaan, bukan fakta.

Draf pertama dokumen ini gua buang: isinya nganggap "pilih kualitas", "merge 1080p",
"parse playlist", "yt-dlp auto-update" belum dibuat. Setelah dibaca kodenya, **semua itu
udah ada**. Ini versi yang bener — dan justru karena itu skopnya jadi lebih kecil dan lebih
mahal dari yang kira-kira.

---

## 1. Yang udah jadi (biar tidak ada yang ngerjain ulang)

| Di daftar "mau dibangun" | Kenyataannya |
|---|---|
| pilih kualitas | udah. `quality_tier()` (`xydl/engine.py:142`) nge-label hemat/normal/tinggi/maksimal, UI manggilnya lewat `pickDefaultVideoOpt()` (`public/app.js:123`, label `tier` dipasang di `xydl/engine.py:694`), preferensi disimpen (`saveSettings()`, `public/app.js:97`) dan ada di APK juga (`AppSettings.kt:29`) |
| 1080p butuh ffmpeg di server | nggak. Merge dibikin di browser: `ffMerge`/`ffRemux` (`public/app.js:664`, `:676`) + fallback "Gagal mengemas ulang, file disimpan dalam format asli" (`:793`) |
| parse playlist | udah. `entries[]` dibangun di `xydl/engine.py:829`, dibatasi `MAX_ENTRIES = 12` (`:44`), dan UI nge-render semua entri (`public/app.js:1490`) |
| gallery / Live Photo | udah, termasuk ZIP di klien (`zipStore` `public/app.js:346`, dipakai `downloadGallery` `:858`) |
| mode hemat data | udah, di web (`preferCellularDataSaver` `:104`) dan APK (`AppSettings.kt:26`) |
| yt-dlp auto-update | udah. `requirements.txt` sengaja tidak dikunci + `deploy.yml` jalan tiap Senin ("redeploy supaya yt-dlp selalu versi terbaru") |
| artwork "yang baru" basi | ternyata nggak. `public/whats-new.webp` (terakhir diganti 2026-09-26) itu hero banner generik — "Satu link. Semua platform.", chip 720p/576p, tanpa label versi. Aman dipakai lagi |
| angka versi nggak sinkron | udah dibenerin di #3: `VERSION='1.3.2'`, `WEB_VERSION='1.3.2'`, `BASE_VERSION: '1.3.2'` |

**Yang masih jadi PRD ini tinggal 3 biji.** Dua fitur user + satu tumpukan operasional yang
nerima akibatnya.

---

## 2. G1 — "Unduh semua" lintas entri + antrian (P0, M–L: 3–4 hari)

### Masalahnya, yang konkret

Playlist 12 entri di-render jadi 12 kartu, dan **tiap kartu punya tombol Download sendiri**
(`renderResult` `public/app.js:1490` → `dl.onclick` per kartu). Buat orang yang mau nyimpen
satu playlist, artinya 12x klik, sambil nunggu, sambil jaga tab nggak di-kill. Bulk yang
sudah ada cuman di **dalam satu entri** (`downloadGallery` `:858` — itu buat carousel/Live
Photo), bukan antar entri.

`unzip`/`zipStore` (`:309`, `:346`) ngebuktiin ZIP di klien udah bisa dipakai buat file
banyak. Yang belum ada cuma **state antrian** dan penjaga konkurensi.

### Yang diminta

- Tombol **"Unduh semua (N)"** di kepala hasil, muncul hanya kalau `entries.length > 1`.
- Antrian di klien: **maks 2 job paralel**, jeda 300 ms antar job. Bar progres per item +
  "N/M selesai". Batal = berhenti ngambil yang belum mulai, jangan potong yang lagi jalan.
- Hasil akhir: >1 file sukses → tawarin **"simpan sebagai ZIP"** (pakai `zipStore`), atau
  simpen satu-satu kalau user pilih itu. Jangan auto-zip di HP: 12 video = 2x I/O.
- State disimpen di `sessionStorage`, jadi refresh tab nggak ngilangin antrian yang belum
  kelar. Bukan service worker — itu pintu masuk "app jalan di background" yang nggak mau kita
  tanggung sekarang.
- Kalau server motong di 12 (`MAX_ENTRIES`), UI **wajib** bilang "12 dari N diambil", bukan
  diem-diem. Cek apakah `result` ngasih total entri; kalau nggak, itu bagian pekerjaannya
  (1 baris di payload + tes).
- Batas: 12 entri = 12 extract + 12 stream. Rate limit per IP (`api/index.py:29`, `XYDL_RATE_LIMIT`) sekarang
  25 request-extract/menit. **Satu klik "Unduh semua" bisa ngabisin kuota IP sendirian** — antrian klien
  harus dihitung sebagai 1 aksi (header `X-XY-Batch: 1` dari klien → 1 token, bukan 12), dan
  perhitungannya ditaruh di `_rate_limited` (`api/index.py:110`) biar satu tempat sama limit yang
  udah ada — bukan pembatas baru di UI.

### Kontrak API: tidak ada endpoint batch

Sengaja. `/api/batch` yang nge-extract 12 link = 1 request yang bayar 12x CPU dan 12x
`socket` timeout di Vercel; satu kegagalan di tengah = user nggak tahu yang mana. Antrian di
klien bikin tiap job bisa gagal sendiri, retry sendiri, dan **tagihannya tetap proporsional
sama yang beneran kelar**.

### Definition of done

- [ ] playlist TikTok/YouTube 12 entri: 1 klik, 12 file, tidak ada yang dobel download
- [ ] 2 job paralel, dan di-verify pakai `?debug=1` counter (bukan dipercaya dari kode)
- [ ] batal di tengah = sisanya berhenti < 1 detik, file yang udah kelar tetap ada
- [ ] refresh tab = antrian balik dari `sessionStorage`
- [ ] ZIP opsional; di iOS Safari fallback ke simpan satu-satu (uji manual)
- [ ] "12 dari N" tampil saat entri kepotong
- [ ] tes: payload 1 entri nggak nampilin tombol; `X-XY-Batch` dihitung 1 token
- [ ] README "Cara kerja" diupdate (ini perubahan perilaku, bukan kosmetik)

### Yang bikin fitur ini gagal kalau diabaikan

**Egress.** 1 klik = 12 video. Worker streaming bayarnya per-request dan per-byte, dan
yang bayarin akun lu. Pasangkan G1 sama **G3** (quota per-hari) — jangan rilis sendirian.
Kalau quota harian nggak ikut dibuat, yang pertama naik adalah tagihan, bukan retensi.

---

## 3. G2 — Riwayat unduhan di web (P1, S–M: 1 hari)

`grep -c history public/app.js` = **0**. Web hari ini tidak nyimpen apa-apa: abis refresh,
link yang barusan diunduh ilang. APK udah punya (`Downloads.kt` + `DownloadsScreen.kt`),
jadi ini murni **jarak web↔APK**, bukan fitur baru buat platform.

- Simpen 100 terakhir di **IndexedDB** (`openDB` — `idb` 4 KB, jangan tulis wrapper manual).
  Isi: url asli, judul, thumbnail, platform, tier yang dipilih, ukuran, status, tanggal.
- **Jangan simpen `media_url`/`fid` untuk dipakai ulang.** Token signed umurnya
  **6 jam** (`xydl/signer.py:17` `DEFAULT_TTL`; thumbnail 24 jam, `xydl/engine.py:473`) dan `media_url` adalah URL host asal — nyimpen = nyimpen jejak
  yang kita klaim tidak kita simpen. "Unduh lagi" = panggil `POST /api/extract` ulang, titik.
- Thumbnail: dari `entry.thumbnail`, jangan simpan blob-nya (basi + makan storage).
- Menu "Riwayat" di header + hapus per item + "kosongkan" — dan catatan jujur di UI:
  "riwayat cuma di perangkat ini, tidak dikirim ke server".
- Jangan sentuh beacon: riwayat **tidak** boleh bikin event baru. Data analitik harus tetap
  1:1 sama aksi user, kalau nggak, KPI dashboard jadi sampah dan #4 jadi percuma.

DoD: refresh → riwayat ada; mode privat → aplikasi tetap jalan tanpa error (localStorage
sudah punya pola `catch {}` di `public/app.js:99`, ikutin itu); "unduh lagi" ngasih hasil
yang sama; tidak ada satu byte pun yang naik ke server kecuali extract.

---

## 4. G3 — Yang nanggung kalau dua fitur di atas jadi (P0 operasional, S: setengah hari)

Bukan fitur user, tapi ini yang nentuin G1 bisa dirilis atau tidak. Semuanya diverifikasi
hari ini:

1. **Belum ada rilis di atas v1.3.0.** `git tag` terbaru = `v1.3.0`; engine udah `1.3.2`.
   `AppUpdater` (APK) ngecek GitHub Release — jadi user 1.3.0 **tidak dikabarin ada versi baru**,
   dan popup `update-banner.webp` nganggur. Tuntasin #3: merge → tag → attach 3 APK.
2. **`main` tidak diproteksi.** CI-nya udah bener (`ci.yml:4` + `:6` = `push` **dan**
   `pull_request`, jadi PR #1–#4 ikut dites). Yang belum: ruleset branch. Diverifikasi
   hari ini — `GET /repos/xykal/XyDownloader/branches/main/protection` → `404 Branch not
   protected`. Aktifin "Require CI to pass before merging" + larang force-push di `main`:
   gratis, dan nutup pintu "merge langsung ke main" yang bikin bug CORS minggu ini bisa
   hidup tiga rilis tanpa ada yang ngecek.
3. **Kuota harian global tidak ada.** `_hits` di `api/index.py:107` itu per-instance (25 x jumlah
   isolate). Perbaiki di level yang bener: **Cloudflare rate-limit rule** di depan
   `dlaja.xyverse.my.id` (mis. 60 request/menit/IP, plus 500 MB/jam/IP lewat Rule +
   `Bot Fight Mode` off dulu buat QA). Itu yang bikin G1 (12 file per klik) aman, bukan angka
   25 di dalam kode.

Gue sengaja naruh G3 di PRD dan bukan "nanti gue kerjain diem-diem": dua butir pertama itu
keputusan lu (protected branch + nge-tag release), bukan keputusan teknis.

---

## 5. Yang sadar-sadaran tidak digarap

| Idea | Alasan |
|---|---|
| `/api/batch` di server | timeout xN, CPU xN, 1 token habis buat 12 URL, gagal satu = tidak jelas yang mana |
| antrian di service worker / "lanjut pas tab ditutup" | fitur yang bikin orang demen, dan yang bikin lu penanggung jawab over baterai + notifikasi orang. Bukan sekarang |
| nyimpen `media_url` di riwayat | ngebuka jejak host asal yang kita klaim tidak disimpen, plus expired-link bug report |
| 4K/1440p | merge 4K di HP = 5 menit + panas; egress ~8x 720p; permintaannya belum ada buktinya |
| nge-naikin `MAX_ENTRIES` 12 → 50 | yang 50 entri pertama tetap 12 extract + 12 stream + 38 gagal; tidak nambah user yang seneng |

---

## 6. Prioritas kalau tenaga cuma buat satu

**G3 dulu (setengah hari), terus G2 (1 hari), baru G1 (3–4 hari).**
Alasan: G3.nomer1 itu bug bagi user 1.3.0 sekarang (bukan kosmetik), G2 murah dan nurunin
retry, G1 naikin biaya — G1 nggak seharusnya hidup sebelum kuota harian di Cloudflare nyala.

## 7. Metrik keberhasilan (bukan cuma "fitur udah lahir")

- G1: % hasil multi-entri yang diunduh >1 file; median file per "Unduh semua"; **MB per user
  per hari** (guardrail: kalau naik >2,5x, matiin lewat flag); % antrian yang selesai tanpa batal
- G2: % sesi dengan ≥1 download yang balik dalam 7 hari (bandingkan sebelum/sesudah)
- G3: jumlah user di APK < 1.3.2 harus menuju nol; request/IP/hari di Cloudflare dashboard

## 8. Pertanyaan yang sudah dijawab (lihat §10)

1. G1 mau di-web dulu (jangkauan besar, tab bisa di-kill) atau di APK dulu (antrian tahan
   layar, jangkauan kecil)? Kalau APK dulu, `Downloads.kt` udah punya sebagian infra-nya.
2. Kuota harian: angka berapa di kepala lu buat "user gratis per hari"? G1 nggak bisa
   dianggap selesai tanpa angka ini — 12 video x berapa user = tagihan lu.
3. "Unduh semua" sekalian ZIP (1 file, I/O 2x di HP) atau simpen satu-satu ke Downloads?
4. Riwayat web: boleh kebagi 1 device doang (IndexedDB) — atau lu mau sekalian bikin
   "sinkron tanpa akun" (yang itu artinya storage server, dan `STORAGE_DIR=None` dilanggar)?
   Gua rekomendasikan: nggak.
5. G3.nomer2 (protected branch + wajib CI) — gua aktifin via API, atau lu mau atur sendiri?


## 9. Status implementasi (2026-09-28)

- **G3** — beres: release `v1.3.2` + 3 APK + banner, `main` diproteksi (wajib PR + check
  "Test engine & lint"), job `dash` masuk `deploy.yml` (diputuskan setelah bug 10021:
  `crypto.getRandomValues` di global scope bikin `wrangler deploy` gagal dan nggak ada
  CI yang nangkep).
- **G2** — beres: `public/history-store.js` (whitelist field, cap FIFO 100, fallback
  tanpa IndexedDB) + `tests/js/history_store.test.mjs` (7 tes) + tombol "Riwayat" di nav
  dengan "Unduh lagi" = `processLink(url)` ulang. Nol event analytics baru.
- **G1** — belum, sesuai urutan di §6. Mulai setelah kuota di §10.2 dipatok di edge.

## 10. Keputusan (2026-09-28 — "gas, gue ikut lu aja")

Jawaban atas §8, dipilih lead, bukan buat selama-lamanya — kalau ada yang salah, revisi di sini.

1. **Web dulu** (bukan APK). Web tempat sakitnya (antrian, ZIP, hemat data) dan semua
   infrastruktur kliennya sudah ada; APK nyusul pakai logika antrian yang sama.
2. **500 MB/user/hari** untuk user gratis (≈ 6-10 video 720p). Guardrail kill-switch
   2.5x median di §7 tetap berlaku. Angka ini syarat G1 mulai dikerjakan.
3. **"Unduh semua" tetap simpan satu-satu ke Downloads**, ZIP opsional di belakang
   checkbox. ZIP = I/O 2x di HP dan nggak semua browser kuat merge blob gede di memori.
4. **Riwayat perangkat saja (IndexedDB)**. "Sinkron tanpa akun" = storage server =
   `STORAGE_DIR=None` dilanggar = gue nolak. Sudah begitu implementasinya.
5. **Protected branch aktifin lewat API** (sudah jalan). `enforce_admins: false` biar lu
   tetap bisa nekan dari atas saat kepepet.
