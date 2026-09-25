"""DownloadAja — siapkan native lib ramping untuk APK (dipanggil CI sebelum Gradle). Built in XyVerse.

1. libpython.zip.so (runtime Python dari youtubedl-android) di-repack TANPA file yang tidak pernah dipakai
   yt-dlp: static lib QuickJS (6 MB!), ncurses/readline/gdbm, SQLite, libc++ (tak dipakai), modul tes, lib2to3,
   kurva ECC pycryptodomex, dll. Symlink & permission di dalam zip dipertahankan.
2. FFmpeg minimal hasil android/ffmpeg/build.sh disalin sebagai libffmpeg.so.

Hasil: <out>/<abi>/{libpython.zip.so, libffmpeg.so} -> dipakai Gradle sebagai folder jniLibs tambahan
(lihat app/build.gradle.kts, packaging.jniLibs.pickFirsts).

    python android/tools/prepare_native.py --out android/app/build/xy-jni --ffmpeg android/ffmpeg/out
"""
import argparse
import hashlib
import io
import os
import re
import shutil
import sys
import urllib.request
import zipfile

YTDL_VERSION = '0.18.1'
AAR_URL = ('https://repo1.maven.org/maven2/io/github/junkfood02/youtubedl-android/library/'
           f'{YTDL_VERSION}/library-{YTDL_VERSION}.aar')
AAR_SHA256 = '579b5fb480892b1abc2b218c2089699d52759cc8d7ba256bf876453f0365faef'
ABIS = ('arm64-v8a', 'armeabi-v7a', 'x86_64')

PY = r'usr/lib/python3\.\d+'
DROP = [re.compile(p) for p in (
    r'^usr/lib/quickjs/',                                   # libquickjs.a (static lib untuk build)
    r'^usr/lib/lib(n?cursesw?|formw?|menuw?|panelw?|tinfo|tic|termcap|readline|history|gdbm(_compat)?)\.so',
    r'^usr/lib/libsqlite3\.so', r'^usr/lib/libcrypt\.so', r'^usr/lib/libc\+\+_shared\.so', r'^usr/etc/inputrc$',
    r'^usr/lib/engines-3/', r'^usr/lib/pkgconfig/', r'^usr/include/', r'\.a$', r'/__pycache__/',
    PY + r'/lib-dynload/(_curses|_curses_panel|readline|_dbm|_gdbm|_sqlite3|_crypt|_test\w*|_ctypes_test|'
         r'_xxtestfuzz|xxlimited\w*|xxsubtype|_xxinterpchannels|_xxsubinterpreters|audioop|ossaudiodev|nis|spwd)'
         r'\.cpython',
    PY + r'/(lib2to3|sqlite3|curses|dbm|venv|ensurepip|idlelib|tkinter|turtledemo|pydoc_data|test|__phello__|'
         r'config-3\.\d+[^/]*)/',
    PY + r'/(antigravity|this|turtle|crypt|doctest|pydoc|__hello__)\.py$', PY + r'/[^/]+\.orig$',
    PY + r'/site-packages/Cryptodome/(SelfTest/|PublicKey/_(ec_ws|ed25519|ed448|curve25519|curve448)\.)',
)]


def fetch_aar(path):
    if path and os.path.exists(path):
        data = open(path, 'rb').read()
    else:
        print(f'download {AAR_URL}')
        with urllib.request.urlopen(AAR_URL, timeout=120) as r:
            data = r.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != AAR_SHA256:
        sys.exit(f'checksum AAR tidak cocok: {digest}')
    return zipfile.ZipFile(io.BytesIO(data))


def slim_zip(raw):
    src = zipfile.ZipFile(io.BytesIO(raw))
    out = io.BytesIO()
    dropped = kept = 0
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as dst:
        for info in src.infolist():
            if any(p.search(info.filename) for p in DROP):
                dropped += info.file_size
                continue
            data = src.read(info)
            ni = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            ni.external_attr = info.external_attr      # mode unix + flag symlink (dibaca commons-compress)
            ni.create_system = info.create_system
            ni.compress_type = zipfile.ZIP_STORED if info.is_dir() else zipfile.ZIP_DEFLATED
            dst.writestr(ni, data)
            kept += info.file_size
    return out.getvalue(), dropped, kept


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--aar', help='library-%s.aar lokal (default: unduh dari Maven Central)' % YTDL_VERSION)
    ap.add_argument('--ffmpeg', help='folder hasil android/ffmpeg/build.sh (<abi>/libffmpeg.so)')
    ap.add_argument('--abis', default=','.join(ABIS))
    a = ap.parse_args()

    aar = fetch_aar(a.aar)
    for abi in a.abis.split(','):
        raw = aar.read(f'jni/{abi}/libpython.zip.so')
        slim, dropped, kept = slim_zip(raw)
        os.makedirs(os.path.join(a.out, abi), exist_ok=True)
        with open(os.path.join(a.out, abi, 'libpython.zip.so'), 'wb') as f:
            f.write(slim)
        print(f'{abi}: libpython.zip.so {len(raw) / 1e6:.2f} MB -> {len(slim) / 1e6:.2f} MB '
              f'(buang {dropped / 1e6:.1f} MB data mentah, sisa {kept / 1e6:.1f} MB)')
        if a.ffmpeg:
            ff = os.path.join(a.ffmpeg, abi, 'libffmpeg.so')
            if not os.path.exists(ff):
                sys.exit(f'FFmpeg untuk {abi} tidak ada: {ff}')
            shutil.copy2(ff, os.path.join(a.out, abi, 'libffmpeg.so'))
            os.chmod(os.path.join(a.out, abi, 'libffmpeg.so'), 0o755)
            print(f'{abi}: libffmpeg.so {os.path.getsize(ff) / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
