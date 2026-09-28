"""Tes konsistensi CSP web + integritas aset yang divendorkan.

Kenapa test ini ada: `public/app.js` pernah nyuntik
`<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js">` sementara CSP
di vercel.json cuma ngizinin `script-src 'self' 'wasm-unsafe-eval' blob:`. Browser nolak
script-nya, `onerror` cuma dipromesin reject, dan pratinjau HLS (Vidio, Dailymotion, dsb)
mati di Chrome/Firefox/Edge tanpa suara — Safari lolos karena bisa putar m3u8 native.
Test ini bikin kelas bug itu gagal di CI, bukan dikubur di issue.
"""
import hashlib
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_JS = os.path.join(ROOT, 'public', 'app.js')
VERCEL = os.path.join(ROOT, 'vercel.json')
HLS_DIR = os.path.join(ROOT, 'public', 'vendor', 'hls')


def _read(*parts):
    with open(os.path.join(ROOT, *parts), encoding='utf-8') as f:
        return f.read()


def _csp():
    cfg = json.loads(_read('vercel.json'))
    for rule in cfg['headers']:
        if rule.get('source') == '/(.*)':
            for h in rule['headers']:
                if h['key'] == 'Content-Security-Policy':
                    d = {}
                    for part in h['value'].split(';'):
                        bits = part.strip().split()
                        if bits:
                            d[bits[0]] = set(bits[1:])
                    return d
    raise AssertionError('vercel.json tidak punya CSP untuk /(.*)')


def test_hls_js_vendored_dan_hashnya_cocok():
    """Ganti isi vendor = harus ganti NOTICE juga (bisa di-swap diam-diam kalau tidak)."""
    js = os.path.join(HLS_DIR, 'hls.min.js')
    assert os.path.isfile(js), 'public/vendor/hls/hls.min.js hilang'
    assert os.path.isfile(os.path.join(HLS_DIR, 'LICENSE')), 'LICENSE hls.js (Apache-2.0) wajib ikut'
    digest = hashlib.sha256(open(js, 'rb').read()).hexdigest()
    notice = open(os.path.join(HLS_DIR, 'NOTICE'), encoding='utf-8').read()
    m = re.search(r'^hls\.js\s+([0-9a-f]{64})', notice, re.M)
    assert m, 'baris "hls.js <sha256>" wajib ada di public/vendor/hls/NOTICE'
    assert m.group(1) == digest, f'hls.min.js berubah: NOTICE {m.group(1)[:12]}… vs file {digest[:12]}…'


def test_hls_js_di_load_dari_origin_sendiri():
    src = _read('public', 'app.js')
    m = re.search(r"loadHlsJs[\s\S]{0,900}?sc\.src\s*=\s*'([^']+)'", src)
    assert m, 'loadHlsJs() tidak ditemukan / formatnya berubah'
    url = m.group(1)
    assert url.startswith('/'), f'hls.js harus dimuat dari origin sendiri, dapat {url!r}'


def test_script_tag_tidak_boleh_nunjuk_ke_luar():
    """`X.src = 'https://host/...'` cuma jalan kalau host itu ADA di script-src.
    'self' tidak menolong: URL absolut ke host lain tetap dianggap cross-origin."""
    src = _read('public', 'app.js')
    script_src = {s.split('://', 1)[-1] for s in _csp().get('script-src', set()) if '://' in s}
    for host in re.findall(r"\.src\s*=\s*['\"]https?://([^/ '\"]+)/", src):
        assert host in script_src, (
            f'app.js nyuntik script dari {host} tapi script-src cuma {sorted(_csp().get("script-src", set()))} '
            f'-> browser nolak diam-diam. Vendorkan filenya atau daftarkan hostnya di vercel.json.'
        )


def test_setiap_tempeleng_jaringan_app_ada_di_csp():
    """Ambil host yang beneran dipakai buat ngirim/menerima data (bukan link <a href>),
    pastikan semuanya terdaftar di connect-src. Kelas bug yang sama: CSP lupa disinkronin
    waktu nambah endpoint (mis. dash beacon baru)."""
    src = _read('public', 'app.js')
    connect = _csp().get('connect-src', set())

    def allowed(host):
        for s in connect:
            if s in ('https:', 'http:'):
                return True
            if s.startswith('https://') or s.startswith('http://'):
                base = s.split('://', 1)[1]
                if host == base or host.endswith('.' + base):
                    return True
        return False

    hosts = set()
    call = re.compile(r'(?:fetch|sendBeacon|blobURLWithProgress|new Worker|new EventSource)'
                      r'\s*\(\s*[\x27\x22\x60]https://([A-Za-z0-9.-]+)')
    hosts.update(call.findall(src))
    # array daftar tautan/href (mis. LICENSES) sengaja tidak ikut: yang di sini
    # cuma konstanta basis endpoint jaringan
    for name in re.findall(r"const\s+([A-Z_][A-Z_0-9]*)\s*=\s*\[", src):
        if not re.search(r"BEACON|BASES?|ENDPOINT|API", name):
            continue
        block = re.search(rf"const\s+{name}\s*=\s*\[([\s\S]*?)\];", src)
        if block:
            hosts.update(re.findall(r"https://([A-Za-z0-9.-]+)/", block.group(1)))
    assert len(hosts) >= 2, f'tidak ada endpoint yang ketahuan: {sorted(hosts)}'
    for host in sorted(hosts):
        assert allowed(host), f'{host} dipakai app.js buat jaringan tapi tidak ada di connect-src CSP'


def test_ffmpeg_core_dimuat_ke_blob_dulu_bukan_importscripts_cdn():
    """Yang bikin jalur ffmpeg.wasm tetap jalan di bawah CSP ketat: core-nya di-fetch
    (connect-src) lalu dibungkus blob: (script-src/worker-src izinkan blob:). Kalau
    seseorang "menyederhanakan" jadi importScripts(https://cdn...), ini harus merah."""
    worker_js = _read('public', 'vendor', 'ffmpeg', 'worker.js')
    src = _read('public', 'app.js')
    assert 'importScripts' in worker_js
    assert 'blobURLWithProgress' in src, 'ffmpeg core harus lewat blob:, bukan URL CDN langsung'
    assert re.search(r"coreURL[^,\n]*blobURLWithProgress", src), 'coreURL harus hasil blobURLWithProgress(...)'
