# Engine per platform — sumber utama

Semua **48 platform unggulan** memiliki folder dan entry point engine sendiri di sini.
Bukan sekadar folder kosong atau JSON katalog.

```text
engines/
├── tiktok/
│   ├── __init__.py
│   ├── engine.py           # entry point runtime TikTok
│   ├── extractor.py        # parser/fallback custom TikTok
│   └── platform.json
├── youtube/
│   ├── __init__.py
│   ├── engine.py           # entry point YouTube + kebutuhan JS
│   └── platform.json
├── twitter/
│   ├── engine.py           # strategi API & opsi daemon Twitter
│   ├── extractor.py
│   ├── AndroidPolicy.kt    # opsi CLI & retry khusus Android
│   └── platform.json
├── pixiv/
│   ├── engine.py
│   ├── extractor.py
│   ├── web.py              # payload ugoira API/library hanya milik Pixiv
│   ├── AndroidPolicy.kt    # konfigurasi unduhan ugoira
│   ├── postprocessor.py    # konversi ugoira hanya milik Pixiv
│   └── platform.json
├── instagram/ ...          # dan seluruh platform unggulan lainnya
├── _common/
│   ├── runtime.py          # validasi domain, kontrak & mekanisme umum
│   ├── gallery.py          # helper format galeri/Live Photo lintas platform
│   └── AndroidPolicy.kt    # dispatcher kebijakan; bukan parser situs
└── registry.py             # temukan folder & pilih engine, tanpa parser situs
```

## Aturan pemisahan

- Perbaikan TikTok hanya masuk `tiktok/`; YouTube hanya `youtube/`; demikian seterusnya.
- Aturan DASH/CDN terikat IP YouTube, domain proxy default, serta marker ugoira ditentukan folder platform pemiliknya, bukan if/else nama situs dalam engine bersama.
- Binding upstream TikTok/Douyin/Bilibili/dll berada di extractor masing-masing, tidak ditumpuk dalam helper bersama.
- Jangan mengimpor engine platform lain dari folder suatu platform. Gunakan `_common` untuk mekanisme yang benar-benar sama.
- Tidak menyalin seluruh library yt-dlp ke repo. **37 platform memakai backend upstream yt-dlp**, dengan entry point lokal masing-masing untuk routing dan pengembangan khusus situs. **11 platform memiliki extractor custom lokal.** Ini bukan klaim menulis ulang 48 parser dari nol.
- Platform di luar 48 katalog tetap dicoba melalui fallback yt-dlp umum; tidak dibuat folder kosong untuk ribuan situs tanpa implementasi lokal.

## Jalur runtime

- Python web/library: `xydl/engine.py` → `registry.resolve(url)` → `<platform>/engine.py` → backend yt-dlp/plugin milik platform.
- Daemon Android: `xydl_daemon.py` → registry yang sama → entry point platform yang sama.
- CLI fallback Android: `Engine.kt` tetap mengurus proses, cache dan file. Opsi khusus Twitter dipindah ke `twitter/AndroidPolicy.kt`; dispatcher umum memilih melalui katalog domain.
- `plugins/yt_dlp_plugins/extractor/xydl_extractors.py` dan `postprocessor/xydl_postprocessors.py` hanya shim discovery yt-dlp, bukan tempat implementasi.
- `plugins/yt_dlp_plugins/engines/__init__.py` hanya jembatan import untuk repo. Tidak ada salinan engine kedua di sana.
- Gradle menyalin sumber folder ini ke namespace plugin dalam APK. Di APK, bridge digantikan sumber sebenarnya; tidak memerlukan akses ke folder repo. Kotlin policy dikompilasi sebagai source, bukan disalin sebagai aset Python.

## Menguji / menambah platform

1. Ubah `platform.json` dan `engine.py` dalam folder pemiliknya. `ENGINE.platform_id` wajib cocok dengan metadata.
2. Bila butuh parser custom, tambahkan `extractor.py` dan ekspor dari shim discovery.
3. Tambahkan tes perubahan situs. Kontrak semua folder dan simulasi bundle Android diuji di `tests/test_engine_modules.py`.
4. Jalankan `python -m pytest -q` dan `python -m pyflakes engines plugins xydl tests scripts android/tools .github/scripts android/app/src/main/assets/py`.
5. Jalankan `python scripts/sync_android.py` bila metadata katalog/domain berubah.

Pemisahan ini tidak menjamin semua situs selalu bisa diakses: login, DRM, wilayah,
anti-bot, perubahan situs dan kompatibilitas yt-dlp tetap harus diperiksa.
