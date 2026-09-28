## DownloadAja — built in XyVerse

Download video, MP3, **foto slide & Live Photo** dari TikTok, Douyin, Instagram, YouTube, Bilibili, Kuaishou, Xiaohongshu, X, Facebook, Threads, pixiv, Vidio & 1.700+ situs lainnya — langsung dari HP.

### Yang baru di versi 1.3.2
- **Pratinjau HLS di web kembali jalan di semua browser** — hls.js sekarang ikut dibundel di situs; sebelumnya script-nya diblokir Content-Security-Policy jadi di Chrome/Firefox/Edge pratinjau video HLS (mis. Vidio, Dailymotion) gagal tanpa pesan.
- **API & proxy lebih tertutup** — hasil proses cuma bisa dibaca dari domain resmi (sebelumnya domain palsu berakhiran/berawalan "dlaja" ikut diizinkan), link unduhan dijaga dari penyalahgunaan jadi open proxy, dan rantai redirect link diperiksa supaya tidak bisa nyasar ke jaringan internal.
- **Kuota lebih aman** — batas unduh per IP per menit di jalur stream, dan statistik admin dibatasi penulisannya (satu skrip iseng dulu cukup buat ngabisin kuota tulis KV).
- Versi APK sekarang ditentukan dari tag rilis, jadi nomor versi & urutan pembaruan lebih bisa dipercaya.

### Yang baru di versi 1.3.1
- Pratinjau video adaptif (ukuran sesuai layar) + pemutar musik untuk link audio.
- Pengaturan di aplikasi: autoplay, kualitas & bitrate default, buka pratinjau otomatis.
- Nama file rapi: `DownloadAja-<judul>-<id>[-kualitas].ext` di web dan Android.
- Kualitas video per tingkatan (Hemat / Normal / Tinggi / Maksimal) dengan chip rekomendasi.

### Yang baru di versi 1.2
- APK jauh lebih kecil: FFmpeg dibangun ulang khusus kebutuhan aplikasi (dari 35 MB jadi sekitar 2 MB), runtime Python dirampingkan, kode dikecilkan dengan R8.
- Proses mencari link lebih cepat: engine yt-dlp tetap "hangat" di latar belakang, bytecode Python di-cache, dan download memakai ulang info yang sudah dibaca.
- Pratinjau sebelum download: putar video langsung di aplikasi, lihat foto satu per satu.
- Foto slide & Live Photo: TikTok (mode foto), Douyin, Xiaohongshu, Kuaishou, X, Instagram, Threads, Bluesky, Weibo & pixiv. Pilih foto satu per satu; Live Photo bisa diunduh sebagai foto, video, atau keduanya. Musik latar slide bisa diunduh sebagai MP3.
- Popup pembaruan + tombol Perbarui yang mengunduh dan memasang versi terbaru otomatis.
- Halaman Lisensi open source lengkap (Tentang > Lisensi open source).
- YouTube lebih stabil: runtime JavaScript QuickJS kini aktif.

### Pilih APK sesuai HP
| File | Untuk |
|---|---|
| `...-arm64-v8a.apk` | Kebanyakan HP Android (2017 ke atas) |
| `...-armeabi-v7a.apk` | HP lama / 32-bit |
| `...-x86_64.apk` | Emulator / Chromebook |

Cara pakai: buka TikTok/IG/YouTube, tekan **Bagikan**, pilih **DownloadAja**. File tersimpan di `Download/DownloadAja`.

Versi web: https://dlaja.xyverse.my.id
