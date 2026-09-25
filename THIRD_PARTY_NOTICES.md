# Third-party notices — XyDownloader

XyDownloader (Built in XyVerse) dirilis dengan lisensi **GPL-3.0-or-later** dan memakai komponen open source berikut. Teks lisensi lengkap ada di folder [`licenses/texts`](licenses/texts) dan juga bisa dibuka dari aplikasi Android (Tentang → Lisensi open source) serta web (footer → Lisensi).

## Aplikasi Android

| Komponen | Lisensi | Hak cipta | Keterangan |
|---|---|---|---|
| [XyDownloader](https://github.com/xykal/XyDownloader) | [GPL-3.0-or-later](licenses/texts/GPL-3.0-only.txt) | Copyright (c) 2026 XyVerse | Aplikasi, plugin extractor & engine |
| [youtubedl-android](https://github.com/JunkFood02/youtubedl-android) | [GPL-3.0](licenses/texts/GPL-3.0-only.txt) | Copyright (c) yausername, JunkFood02 & kontributor | Menjalankan Python + yt-dlp di Android |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | [Unlicense](licenses/texts/Unlicense.txt) | yt-dlp contributors (public domain) | Engine pembaca link (diperbarui otomatis dari GitHub) |
| [yt-dlp-ejs](https://github.com/yt-dlp/ejs) | [Unlicense](licenses/texts/Unlicense.txt) | yt-dlp contributors (public domain) | Skrip JavaScript tantangan YouTube |
| [Python 3.12](https://www.python.org/) | [PSF-2.0](licenses/texts/PSF-2.0.txt) | Copyright (c) 2001-2024 Python Software Foundation. All Rights Reserved. | Runtime (build Termux, dibundel youtubedl-android; versi ramping) |
| [FFmpeg 8.0 (build minimal XyDownloader)](https://ffmpeg.org/) | [LGPL-2.1-or-later](licenses/texts/LGPL-2.1-only.txt) | Copyright (c) 2000-2026 the FFmpeg developers | Merge video + audio, MP3/M4A, ugoira. Dibangun tanpa komponen GPL; skrip build & daftar komponen: android/ffmpeg/build.sh |
| [LAME 3.100](https://lame.sourceforge.io/) | [LGPL-2.0-or-later](licenses/texts/LGPL-2.0-only.txt) | Copyright (c) 1999-2017 The LAME Project | Encoder MP3 (terhubung statis ke FFmpeg) |
| [QuickJS](https://bellard.org/quickjs/) | [MIT](licenses/texts/MIT.txt) | Copyright (c) 2017-2021 Fabrice Bellard, Charlie Gordon | Runtime JavaScript untuk YouTube |
| [OpenSSL 3](https://www.openssl.org/) | [Apache-2.0](licenses/texts/Apache-2.0.txt) | Copyright (c) 1998-2025 The OpenSSL Project Authors | TLS/HTTPS untuk Python |
| [zlib](https://zlib.net/) | [Zlib](licenses/texts/Zlib.txt) | Copyright (C) 1995-2024 Jean-loup Gailly and Mark Adler | Kompresi |
| [bzip2](https://sourceware.org/bzip2/) | [bzip2-1.0.6](licenses/texts/bzip2-1.0.6.txt) | Copyright (C) 1996-2019 Julian R Seward | Kompresi |
| [XZ Utils (liblzma)](https://tukaani.org/xz/) | [0BSD](licenses/texts/0BSD.txt) | Copyright (C) The XZ Utils authors and contributors | Kompresi |
| [Expat](https://libexpat.github.io/) | [MIT](licenses/texts/MIT.txt) | Copyright (c) 1998-2000 Thai Open Source Software Center Ltd and Clark Cooper; Copyright (c) 2001-2025 Expat maintainers | Parser XML |
| [libffi](https://sourceware.org/libffi/) | [MIT](licenses/texts/MIT.txt) | Copyright (c) 1996-2024 Anthony Green, Red Hat, Inc and others | ctypes |
| [PyCryptodome (Cryptodome)](https://www.pycryptodome.org/) | [BSD-2-Clause](licenses/texts/BSD-2-Clause.txt) | Copyright (c) 2014, Legrandin; sebagian kode berstatus public domain | Dekripsi AES untuk stream HLS |
| [Mutagen](https://github.com/quodlibet/mutagen) | [GPL-2.0-or-later](licenses/texts/GPL-2.0-only.txt) | Copyright (c) 2005-2024 Joe Wreschnig, Michael Urman, Christoph Reiter & kontributor | Metadata audio |
| [Termux packages](https://github.com/termux/termux-packages) | [Apache-2.0](licenses/texts/Apache-2.0.txt) | Copyright (c) Termux developers | Resep build runtime Python untuk Android |
| [AndroidX (Core, Activity, Lifecycle, WorkManager, SplashScreen)](https://developer.android.com/jetpack/androidx) | [Apache-2.0](licenses/texts/Apache-2.0.txt) | Copyright (c) The Android Open Source Project |  |
| [Jetpack Compose & Material 3](https://developer.android.com/jetpack/compose) | [Apache-2.0](licenses/texts/Apache-2.0.txt) | Copyright (c) The Android Open Source Project | Antarmuka aplikasi |
| [AndroidX Media3 (ExoPlayer)](https://github.com/androidx/media) | [Apache-2.0](licenses/texts/Apache-2.0.txt) | Copyright (c) The Android Open Source Project | Pratinjau video |
| [Kotlin & kotlinx.coroutines](https://kotlinlang.org/) | [Apache-2.0](licenses/texts/Apache-2.0.txt) | Copyright (c) JetBrains s.r.o. and Kotlin Programming Language contributors |  |
| [Coil](https://github.com/coil-kt/coil) | [Apache-2.0](licenses/texts/Apache-2.0.txt) | Copyright (c) 2025 Coil Contributors | Memuat gambar/thumbnail |
| [OkHttp & Okio](https://square.github.io/okhttp/) | [Apache-2.0](licenses/texts/Apache-2.0.txt) | Copyright (c) Square, Inc. |  |
| [Jackson](https://github.com/FasterXML/jackson) | [Apache-2.0](licenses/texts/Apache-2.0.txt) | Copyright (c) 2007- Tatu Saloranta & FasterXML | Dipakai youtubedl-android |
| [Apache Commons IO & Compress](https://commons.apache.org/) | [Apache-2.0](licenses/texts/Apache-2.0.txt) | Copyright (c) The Apache Software Foundation | Dipakai youtubedl-android |

## Web (xydl.vercel.app)

| Komponen | Lisensi | Hak cipta | Keterangan |
|---|---|---|---|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | [Unlicense](licenses/texts/Unlicense.txt) | yt-dlp contributors (public domain) | Extractor di server |
| [Python](https://www.python.org/) | [PSF-2.0](licenses/texts/PSF-2.0.txt) | Copyright (c) 2001-2025 Python Software Foundation | Runtime server |
| [ffmpeg.wasm core (FFmpeg)](https://github.com/ffmpegwasm/ffmpeg.wasm) | [GPL-2.0-or-later](licenses/texts/GPL-2.0-only.txt) | Copyright (c) the FFmpeg developers & ffmpeg.wasm contributors | Merge, remux HLS & ugoira di browser (dimuat dari CDN) |
| [@ffmpeg/ffmpeg & @ffmpeg/util](https://github.com/ffmpegwasm/ffmpeg.wasm) | [MIT](licenses/texts/MIT.txt) | Copyright (c) 2019 Jerome Wu |  |
| [lamejs](https://github.com/zhuker/lamejs) | [LGPL-3.0](licenses/texts/LGPL-3.0-only.txt) | Copyright (c) 2015 Alex Zhukov | Encoder MP3 di browser |
| [hls.js](https://github.com/video-dev/hls.js) | [Apache-2.0](licenses/texts/Apache-2.0.txt) | Copyright (c) 2017 Dailymotion; hls.js contributors | Pratinjau stream HLS (dimuat dari CDN saat dibutuhkan) |
| [flag-icons](https://github.com/lipis/flag-icons) | [MIT](licenses/texts/MIT.txt) | Copyright (c) 2013 Panayiotis Lipiridis | Bendera negara |
| [Lucide (gaya ikon)](https://lucide.dev/) | [ISC](licenses/texts/ISC.txt) | Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022. | Ikon garis |

## Kode sumber komponen (L)GPL

- FFmpeg & LAME dibangun ulang dari sumber resmi dengan skrip [`android/ffmpeg/build.sh`](android/ffmpeg/build.sh) (versi, checksum, dan daftar komponen tercantum di sana).
- Runtime Python/yt-dlp berasal dari [youtubedl-android](https://github.com/JunkFood02/youtubedl-android) (GPL-3.0); versi ramping dibuat dengan [`android/tools/prepare_native.py`](android/tools/prepare_native.py).
- Seluruh kode XyDownloader tersedia di repositori ini.

## Merek dagang

Logo dan nama platform (TikTok, Douyin, Instagram, YouTube, dll) adalah merek dagang milik pemiliknya masing-masing, hanya dipakai untuk menunjukkan kompatibilitas. XyDownloader tidak berafiliasi dengan platform mana pun.
