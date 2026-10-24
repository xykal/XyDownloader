#!/usr/bin/env bash
# Smoke test DownloadAja di emulator (API 34, x86_64):
#  1. pasang v1.1.0 lalu upgrade ke APK baru (uji migrasi + popup "yang baru")
#  2. share link foto slide TikTok -> galeri, viewer, unduh foto terpilih (HTTP langsung)
#  3. video TikTok -> pratinjau (ExoPlayer) + unduh MP3 (yt-dlp --load-info-json + FFmpeg minimal)
#  4. halaman Tentang, Pembaruan & Lisensi
set -euo pipefail
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

# Always retain diagnostics and real saved-file evidence, even when a UI step fails.
collect_evidence() {
  adb exec-out screencap -p > "$OUT/final-screen.png" 2>/dev/null || true
  { adb shell pidof "$PKG" || true; adb shell ls -la /sdcard/Download/DownloadAja/ || true; } > "$OUT/status.txt" 2>&1
  adb logcat -d > "$OUT/logcat.txt" 2>&1 || true
  adb shell 'find /sdcard/Download/DownloadAja -type f -size +0c' > "$OUT/downloaded-files.txt" 2> "$OUT/file-errors.txt" || true
  grep -E "XyDaemon|XyEngine|XyYtDlp|XyPyEnv|XyUpdater|WM-WorkerWrapper|FATAL|AndroidRuntime: (FATAL|java)" "$OUT/logcat.txt" > "$OUT/logcat-xy.txt" || true
}
trap 'code=$?; collect_evidence; exit "$code"' EXIT


echo "== pasang versi lama (v1.1.0)"
curl -fsSL --retry 3 -o /tmp/old.apk https://github.com/xykal/XyDownloader/releases/download/v1.1.0/DownloadAja-1.1.0-x86_64.apk \
  && adb install -g /tmp/old.apk && adb shell am start -W -n $PKG/.MainActivity >/dev/null && sleep 25 \
  && adb shell am force-stop $PKG || echo "versi lama dilewati"

echo "== upgrade ke APK baru: $APK"
adb install -r -g "$APK" || { echo "::error::install gagal"; exit 1; }
adb logcat -c
adb shell am start -W -n $PKG/.MainActivity >/dev/null
shot 01-whats-new-popup 25
$UI "ketuk untuk melihat" 0 || true
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
# All actual video variants can span many screens; do not assume the old 8-row cap.
$UI "MP3 · 192 kbps" 30
sleep 45
tab 1
shot 09-downloads-mp3 4

share "https://x.com/TheEllenShow/status/440322224407314432"
shot 10-x-photo 20

tab 3
shot 11-about 3
$UI "Lisensi open source" 2
shot 12-licenses 3
adb shell input keyevent KEYCODE_BACK

python3 .github/scripts/audio_test.py "$APK_DIR" "$OUT/audio-audit"

collect_evidence
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
  exit 1
fi
adb shell pidof "$PKG" >/dev/null || { echo "::error::aplikasi tidak hidup"; exit 1; }
# A live process does not prove downloads worked. Check actual non-empty files.
adb shell 'find /sdcard/Download/DownloadAja -type f -size +0c' > "$OUT/downloaded-files.txt"
test -s "$OUT/downloaded-files.txt" || { echo "::error::tidak ada bukti file unduhan"; exit 1; }
grep -Ei '\.(mp3)$' "$OUT/downloaded-files.txt" >/dev/null || { echo "::error::MP3 belum terbukti tersimpan"; exit 1; }
grep -Ei '\.(jpg|jpeg|png|webp)$' "$OUT/downloaded-files.txt" >/dev/null || { echo "::error::foto belum terbukti tersimpan"; exit 1; }
exit 0
