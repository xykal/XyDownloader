# Refactor engine per platform

## Yang berubah

- 48 platform unggulan punya folder sendiri di `plugins/yt_dlp_plugins/engines/<id>/`.
- Setiap folder memiliki `platform.json`: domain, branding, catatan dukungan, dan kebijakan runtime opsional.
- 11 extractor custom dipisah menjadi `extractor.py`: TikTok, Douyin, Kuaishou, Threads, Bilibili, pixiv, Twitter, Instagram, Bluesky, Weibo, dan Xiaohongshu.
- Platform lainnya tetap menggunakan extractor upstream yt-dlp; folder konfigurasi **bukan** janji bahwa ada implementasi custom baru atau situs selalu bisa diakses.
- `shared.py` menyimpan helper galeri/Live Photo. `registry.py` membaca metadata tanpa memuat extractor.
- Entry point lama `extractor/xydl_extractors.py` dipertahankan untuk discovery yt-dlp dan kompatibilitas Android. Identitas modul diekspor ulang agar loader yt-dlp tetap mendaftarkan seluruh 11 extractor.
- `xydl/platforms.py` mengambil katalog dari folder engine, bukan lagi daftar duplikat.
- Strategi percobaan API Twitter dan kebutuhan JS YouTube diambil dari konfigurasi foldernya. Pencocokan domain eksak/subdomain menolak `evilyoutube.com` dan `notx.com`.
- Cache hasil ekstraksi sekarang memasukkan `proxy_base` ke kuncinya agar link dari satu tujuan proxy tidak tertukar dengan tujuan lain.
- Dev server memuat `.env` lokal dengan `override=False` dan memperketat pemeriksaan batas folder statis dengan `commonpath`.

## Struktur

```text
plugins/yt_dlp_plugins/
├── engines/
│   ├── registry.py
│   ├── shared.py
│   ├── tiktok/
│   │   ├── __init__.py
│   │   ├── platform.json
│   │   └── extractor.py
│   ├── youtube/
│   │   ├── __init__.py
│   │   └── platform.json
│   └── ... (seluruh 48 platform)
├── extractor/xydl_extractors.py  # entry point kompatibel
└── postprocessor/xydl_postprocessors.py
xydl/engine.py                   # orkestrasi, format, galeri, streaming bersama
```

Logika pemilihan format, signing dan streaming sengaja tetap bersama. Menyalinnya ke tiap platform akan menciptakan duplikasi dan membuat perbaikan keamanan sulit konsisten.

## Menjalankan lokal

```sh
python -m pip install -r requirements-dev.txt pytest
cp .env.example .env  # HANYA jika belum punya .env; jangan timpa konfigurasi asli
python -m uvicorn dev_server:app --host 0.0.0.0 --port 8000
```

Buka `/`, `/api/health`, dan `/api/platforms`. `python-dotenv` hanya dependensi development; Vercel membaca environment dari pengaturan deployment.

Unggahan `env.txt` telah disalin menjadi `.env` privat di workspace dengan hanya assignment valid dan komentar. Baris instruksi serta token tanpa nama variabel tidak dimuat. `.env` tidak dilacak Git dan tidak masuk ZIP. Kredensial layanan lain tidak digunakan untuk deploy/push. Rotasi kredensial yang pernah dibagikan tetap dianjurkan.

## Produksi: masih perlu dikonfigurasi

Unggahan env belum mengandung dua pengaturan utama downloader:

1. `XYDL_SIGNING_KEY`: buat rahasia acak; nilainya harus identik pada API dan secret Cloudflare Worker.
2. `XYDL_PROXY_BASE`: alamat Worker streaming milik deployment sendiri.

Kunci GitHub, Vercel, Cloudinary, dan layanan lain bukan pengganti dua pengaturan tersebut. Jangan gunakan kunci signing fallback development pada produksi. Sesuaikan allowlist origin pada API/Worker atau `XYDL_EXTRA_ORIGINS` untuk domain baru. Proxy ekstraksi opsional bisa dikonfigurasi bila platform menolak IP cloud; pool publik tetap off.

## Validasi yang sudah dijalankan

- Python: **115 passed** (108 tes lama + 7 tes refactor).
- JavaScript unit: **56 passed**.
- Playwright Chromium: **9 passed**, termasuk layar HP, batch, download, history, settings dan error UI. Dependensi sistem Chromium sempat belum tersedia; setelah diinstal, suite berhasil.
- Pyflakes: bersih untuk cakupan yang sama dengan CI repo.
- Discovery plugin: seluruh **11** extractor custom terdaftar.

Tes browser menggunakan mock layanan/platform eksternal. Ini **bukan** pembuktian download live seluruh platform. Tidak dilakukan deploy, push GitHub, build APK/Gradle, atau pengujian unduhan live 48 platform. Android menggunakan copy rekursif folder plugin yang sudah ada di build script, tetapi APK hasil refactor belum dibangun/diuji di perangkat. Pembatasan login, geo, DRM dan anti-bot situs tetap berlaku.

## Menambah atau memperbaiki engine

1. Edit/buat `engines/<id>/platform.json` dengan field mengikuti platform yang ada.
2. Jika perlu extractor custom, tambah `extractor.py` di folder itu, lalu ekspor kelasnya dari entry point `xydl_extractors.py` dan `__all__`.
3. Tambah tes fixture offline, jalankan `pytest -q` dan tes browser.
4. Jika katalog/logo berubah, jalankan `python scripts/sync_android.py`; tambahkan logo `public/logos/<id>.webp` dahulu bila platform baru.
5. Saat mengubah jumlah platform, sesuaikan assertion katalog pada `tests/test_engine_modules.py`.
