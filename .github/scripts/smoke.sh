#!/usr/bin/env bash
# Smoke test DownloadAja di emulator (API 34, x86_64):
#  1. pasang v1.1.0 lalu upgrade ke APK baru (uji migrasi + popup "yang baru")
#  2. share link foto slide TikTok -> galeri, viewer, unduh foto terpilih (HTTP langsung)
#  3. video TikTok -> pratinjau (ExoPlayer) + unduh MP3 (yt-dlp --load-info-json + FFmpeg minimal)
#  4. halaman Tentang, Pembaruan & Lisensi
set -u
APK_DIR=$1
OUT=$2
mkdir -p "$OUT"
PKG=id.my.xyverse.xydownloader
UI="python3 .github/scripts/ui.py"
APK=$(ls "$APK_DIR"/*x86_64.apk | head -1)
shot() { sleep "$2"; adb exec-out screencap -p > "$OUT/$1.png"; echo "== screenshot $1"; }
share() { adb shell am start -W -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "'$1'" -n $PKG/.MainActivity >/dev/null; }
tab() { adb shell am start -W -n $PKG/.MainActivity --ei tab "$1" >/dev/null; }
top() { for i in 1 2 3; do adb shell input swipe 540 700 540 1900 250; done; }

echo "== pasang versi lama (v1.1.0)"
curl -fsSL --retry 3 -o /tmp/old.apk https://github.com/xykal/XyDownloader/releases/download/v1.1.0/DownloadAja-1.1.0-x86_64.apk \
  && adb install -g /tmp/old.apk && adb shell am start -W -n $PKG/.MainActivity >/dev/null && sleep 25 \
  && adb shell am force-stop $PKG || echo "versi lama dilewati"

echo "== upgrade ke APK baru: $APK"
adb install -r -g "$APK" || { echo "::error::install gagal"; exit 1; }
adb logcat -c
adb shell am start -W -n $PKG/.MainActivity >/dev/null
shot 01-whats-new-popup 25
$UI "ketuk untuk melihat" 0
shot 02-update-screen 6
adb shell input keyevent KEYCODE_BACK

share "https://www.tiktok.com/@velocitydrawing/photo/7266832970353233185"
shot 03-tiktok-photo 30
$UI "^Lihat$" 3
shot 04-gallery-viewer 6
adb shell input keyevent KEYCODE_BACK
sleep 1
$UI "Unduh [0-9]+ file|^Unduh$" 4
shot 05-gallery-after-download 3
sleep 15
tab 1
shot 06-downloads-photos 4
tab 0
top

share "https://www.tiktok.com/@scout2015/video/6718335390845095173"
shot 07-tiktok-video 25
$UI "Putar pratinjau" 0
shot 08-preview 10
adb shell input keyevent KEYCODE_BACK
sleep 1
$UI "MP3 · 192 kbps" 5
sleep 45
tab 1
shot 09-downloads-mp3 4

share "https://x.com/TheEllenShow/status/440322224407314432"
shot 10-x-photo 20

tab 2
shot 11-about 3
$UI "Lisensi open source" 2
shot 12-licenses 3
adb shell input keyevent KEYCODE_BACK

echo "== status"
{ adb shell pidof $PKG && echo "PROSES HIDUP" || echo "PROSES MATI"
  echo "--- /sdcard/Download/DownloadAja"
  adb shell ls -la /sdcard/Download/DownloadAja/
} | tee "$OUT/status.txt"
adb logcat -d > "$OUT/logcat.txt"
grep -E "XyDaemon|XyEngine|XyYtDlp|XyPyEnv|XyUpdater|WM-WorkerWrapper|FATAL|AndroidRuntime: (FATAL|java)" "$OUT/logcat.txt" > "$OUT/logcat-xy.txt" || true
tail -n 40 "$OUT/logcat-xy.txt" || true
if grep -q "FATAL EXCEPTION" "$OUT/logcat.txt"; then
  grep -n "FATAL EXCEPTION" -A 40 "$OUT/logcat.txt" | head -80
  echo "::error::aplikasi crash (lihat logcat)"
fi
exit 0
