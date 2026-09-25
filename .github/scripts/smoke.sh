#!/usr/bin/env bash
# Smoke test XyDownloader di emulator (API 34, x86_64):
#  1. pasang v1.1.0 lalu upgrade ke APK baru (uji migrasi + popup "yang baru")
#  2. share link foto slide TikTok, foto X, video TikTok -> screenshot hasil
#  3. uji pratinjau, viewer galeri, unduh file terpilih, halaman Pembaruan & Lisensi
set -u
APK_DIR=$1
OUT=$2
mkdir -p "$OUT"
PKG=id.my.xyverse.xydownloader
UI="python3 .github/scripts/ui.py"
APK=$(ls "$APK_DIR"/*x86_64.apk | head -1)
shot() { sleep "$2"; adb exec-out screencap -p > "$OUT/$1.png"; echo "== screenshot $1"; }
share() { adb shell am start -W -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "'$1'" -n $PKG/.MainActivity >/dev/null; }

echo "== pasang versi lama (v1.1.0)"
curl -fsSL --retry 3 -o /tmp/old.apk https://github.com/xykal/XyDownloader/releases/download/v1.1.0/XyDownloader-1.1.0-x86_64.apk \
  && adb install -g /tmp/old.apk && adb shell am start -W -n $PKG/.MainActivity >/dev/null && sleep 25 \
  && adb shell am force-stop $PKG || echo "versi lama dilewati"

echo "== upgrade ke APK baru: $APK"
adb install -r -g "$APK" || { echo "::error::install gagal"; exit 1; }
adb logcat -c
adb shell am start -W -n $PKG/.MainActivity >/dev/null
shot 01-whats-new-popup 30
$UI "ketuk untuk melihat"
shot 02-update-screen 8
adb shell input keyevent KEYCODE_BACK

share "https://www.tiktok.com/@velocitydrawing/photo/7266832970353233185"
shot 03-tiktok-photo 40
$UI "^Lihat item 2|Lihat"
shot 04-gallery-viewer 8
adb shell input keyevent KEYCODE_BACK
sleep 2
$UI "Unduh [0-9]+ file|^Unduh $"
sleep 20
adb shell am start -W -n $PKG/.MainActivity --ei tab 1 >/dev/null
shot 05-downloads 5
adb shell am start -W -n $PKG/.MainActivity --ei tab 0 >/dev/null

share "https://x.com/TheEllenShow/status/440322224407314432"
shot 06-x-photo 30

share "https://www.tiktok.com/@scout2015/video/6718335390845095173"
shot 07-tiktok-video 30
$UI "Putar pratinjau"
shot 08-preview 12
adb shell input keyevent KEYCODE_BACK

adb shell am start -W -n $PKG/.MainActivity --ei tab 2 >/dev/null
shot 09-about 4
$UI "Lisensi open source"
shot 10-licenses 4
adb shell input keyevent KEYCODE_BACK

echo "== status proses"
adb shell pidof $PKG && echo "PROSES HIDUP" || echo "PROSES MATI"
adb shell ls -la /sdcard/Download/XyDownloader/ || true
adb shell run-as $PKG ls -la no_backup/youtubedl-android/packages no_backup/xydl files/py 2>/dev/null || true
adb logcat -d > "$OUT/logcat.txt"
grep -E "XyDaemon|XyEngine|XyYtDlp|XyPyEnv|XyUpdater|AndroidRuntime" "$OUT/logcat.txt" > "$OUT/logcat-xy.txt" || true
tail -n 40 "$OUT/logcat-xy.txt" || true
if grep -q "FATAL EXCEPTION" "$OUT/logcat.txt"; then
  grep -n "FATAL EXCEPTION" -A 40 "$OUT/logcat.txt" | head -80
  echo "::error::aplikasi crash (lihat logcat)"
fi
exit 0
