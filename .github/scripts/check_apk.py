"""Cek isi APK hasil build: native lib ramping terpasang, FFmpeg lama tidak ikut, ringkasan ukuran."""
import glob
import os
import sys
import zipfile

out_dir, jni_dir, ytdlp = sys.argv[1:4]
failed = False
ytdlp_size = os.path.getsize(ytdlp) if os.path.exists(ytdlp) else -1
for apk in sorted(glob.glob(os.path.join(out_dir, '*.apk'))):
    abi = next(a for a in ('arm64-v8a', 'armeabi-v7a', 'x86_64') if a in apk)
    z = zipfile.ZipFile(apk)
    infos = z.infolist()
    names = {i.filename: i for i in infos}
    print(f'\n== {os.path.basename(apk)}: {os.path.getsize(apk) / 1e6:.2f} MB')
    checks = []
    py = names.get(f'lib/{abi}/libpython.zip.so')
    slim = os.path.join(jni_dir, abi, 'libpython.zip.so')
    checks.append(('libpython.zip.so ramping', py is not None and os.path.exists(slim) and py.file_size == os.path.getsize(slim)))
    ff = names.get(f'lib/{abi}/libffmpeg.so')
    ff_src = os.path.join(jni_dir, abi, 'libffmpeg.so')
    checks.append(('libffmpeg.so minimal', ff is not None and os.path.exists(ff_src) and ff.file_size == os.path.getsize(ff_src)))
    checks.append(('tanpa libffmpeg.zip.so lama', f'lib/{abi}/libffmpeg.zip.so' not in names))
    checks.append(('libqjs.so (QuickJS)', f'lib/{abi}/libqjs.so' in names))
    checks.append(('yt-dlp terbaru dibundel', any(i.file_size == ytdlp_size for i in infos if i.filename.startswith('res/'))))
    checks.append(('skrip daemon', 'assets/py/xydl_daemon.py' in names))
    checks.append(('lisensi', 'assets/licenses/components.json' in names))
    for label, ok in checks:
        print(f"  [{'OK' if ok else 'GAGAL'}] {label}")
        failed |= not ok
    groups = {}
    for i in infos:
        key = i.filename if i.filename.startswith('lib/') else ('dex' if i.filename.endswith('.dex') else i.filename.split('/')[0])
        groups[key] = groups.get(key, 0) + i.compress_size
    for k, v in sorted(groups.items(), key=lambda kv: -kv[1])[:8]:
        print(f'  {v / 1e6:7.2f} MB  {k}')
sys.exit(1 if failed else 0)
