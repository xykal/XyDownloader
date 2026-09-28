"""Tes anggaran /api/stream + penjaga redirect SSRF (P0 dari audit 2026-09-28)."""
import asyncio
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

os.environ.setdefault('XYDL_SIGNING_KEY', 'test-key')

from api import index as api  # noqa: E402
from xydl import engine, signer  # noqa: E402


# ------------------------------------------------------------------ fake ASGI caller
async def _call(path, headers=None, query=b'', method='GET'):
    scope = {'type': 'http', 'method': method, 'path': path, 'query_string': query,
             'headers': [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
             'client': ('203.0.113.9', 5555)}

    async def receive():
        return {'type': 'http.disconnect'}

    out = {'status': None, 'headers': {}, 'body': b''}

    async def send(msg):
        if msg['type'] == 'http.response.start':
            out['status'] = msg['status']
            out['headers'] = {k.decode().lower(): v.decode() for k, v in msg['headers']}
        else:
            out['body'] += msg.get('body', b'')

    await api.app(scope, receive, send)
    return out


# ------------------------------------------------------------------ 1. anggaran stream
@pytest.fixture(autouse=True)
def _fresh_counters(monkeypatch):
    """Batas di-test lewat konstanta modul, jadi wajib dibalikin setelah tiap tes --
    kalau tidak, STREAM_RATE_LIMIT = 0 dari satu tes nyeret tes sebelah (pernah terjadi)."""
    saved = (api.STREAM_RATE_LIMIT, api.STREAM_BYTE_BUDGET, api.RATE_LIMIT)
    api._stream_flow.clear()
    api._hits.clear()
    yield
    api._stream_flow.clear()
    api._hits.clear()
    api.STREAM_RATE_LIMIT, api.STREAM_BYTE_BUDGET, api.RATE_LIMIT = saved


def test_budget_request_per_ip():
    api.STREAM_RATE_LIMIT = 3
    ip = '198.51.100.11'
    for _ in range(3):
        assert api._stream_allowed(ip)
        api._stream_charge(ip, 1024)
    assert not api._stream_allowed(ip), 'request ke-4 dari IP yang sama harus ditahan'


def test_budget_byte_dulu_habis_sebelum_jumlah_request_habis():
    """File 4 GB cuma 1 request — kalau yang dihitung cuma jumlah request, tidak kena apa-apa."""
    api.STREAM_RATE_LIMIT = 1000
    api.STREAM_BYTE_BUDGET = 5 * 1024 * 1024
    ip = '198.51.100.12'
    assert api._stream_allowed(ip)
    api._stream_charge(ip, 4 * 1024 * 1024)
    assert api._stream_allowed(ip), 'masih ada sisa 1 MB'
    api._stream_charge(ip, 2 * 1024 * 1024)
    assert not api._stream_allowed(ip), 'lewat anggaran byte harus ditolak'


def test_budget_ip_lain_tidak_terkena():
    api.STREAM_RATE_LIMIT = 1
    api._stream_charge('198.51.100.13', 10)
    assert not api._stream_allowed('198.51.100.13')
    assert api._stream_allowed('198.51.100.14')


class _FakeBody:
    def __init__(self, data):
        self.data, self.i = data, 0

    def read(self, n=-1):
        chunk = self.data[self.i:self.i + n]
        self.i += len(chunk)
        return chunk

    def close(self):
        pass


class _FakeResp:
    def __init__(self, data, status=200, headers=None):
        self.body, self.status = _FakeBody(data), status
        self.headers = headers or {}

    def read(self, n=-1):
        return self.body.read(n)

    def close(self):
        pass

    @property
    def _h(self):
        return self.headers


class _FakeYdl:
    def close(self):
        pass


def _stream_headers(nbytes, filename='DownloadAja-tiktok-abcd1234.mp4'):
    meta = {'s': 'https://example.com/post/1', 'fid': '18', 'f': filename, 'k': 'av', 'h': 1080, 'e': 'mp4'}
    return 't=' + signer.sign(meta)


def test_handle_stream_pakai_anggaran_dan_ngecat_byte(monkeypatch):
    payload = b'x' * 4096

    def fake_resolve(page_url, format_id, meta=None):
        return _FakeYdl(), {'url': 'https://cdn.example/f.mp4', 'filesize': len(payload), 'format_id': format_id}, {}

    monkeypatch.setattr(engine, 'resolve_stream_format', fake_resolve)
    monkeypatch.setattr(engine, 'open_stream', lambda ydl, url, headers, range_header=None: _FakeResp(payload))
    monkeypatch.setattr(api, 'READ_SIZE', 1024)
    api.STREAM_RATE_LIMIT = 2
    api.STREAM_BYTE_BUDGET = 10 * 1024 * 1024
    ip = '198.51.100.21'
    h = {'X-Real-Ip': ip, 'Origin': 'https://dlaja.xyverse.my.id'}

    r = asyncio.run(_call('/api/stream', headers=h, query=_stream_headers(len(payload)).encode()))
    assert r['status'] == 200, r['body'][:200]
    assert r['headers'].get('content-length') == str(len(payload))
    assert r['headers'].get('access-control-allow-origin') == 'https://dlaja.xyverse.my.id'
    charged = sum(n for _, n in api._stream_flow[ip])
    assert charged == len(payload), f'byte yang dikirim harus dicatat, tercatat {charged}'

    asyncio.run(_call('/api/stream', headers=h, query=_stream_headers(len(payload)).encode()))
    r3 = asyncio.run(_call('/api/stream', headers=h, query=_stream_headers(len(payload)).encode()))
    assert r3['status'] == 429 and json.loads(r3['body'])['code'] == 'stream_limit'
    assert r3['headers'].get('retry-after') == '60'


def test_handle_stream_ditolak_sebelum_ekstrak_ulang(monkeypatch):
    """Penolakan harus murah: jangan sampai kita extract ulang halaman cuma buat nolak."""
    def boom(*a, **k):
        raise AssertionError('resolve_stream_format tidak boleh dipanggil kalau sudah lewat batas')

    monkeypatch.setattr(engine, 'resolve_stream_format', boom)
    api.STREAM_RATE_LIMIT = 0
    r = asyncio.run(_call('/api/stream', headers={'X-Real-Ip': '198.51.100.22'},
                          query=_stream_headers(10).encode()))
    assert r['status'] == 429


def test_bad_token_masih_403_bukan_kena_budget():
    r = asyncio.run(_call('/api/stream', headers={'X-Real-Ip': '198.51.100.23'}, query=b't=aaaa.bbbb'))
    assert r['status'] == 403 and json.loads(r['body'])['code'] == 'token'


# ------------------------------------------------------------------ 2. SSRF redirect
class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == '/jump':
            self.send_response(302)
            self.send_header('Location', f'http://localhost:{self.server.server_address[1]}/admin')
            self.end_headers()
        elif self.path == '/chain':
            self.send_response(302)
            self.send_header('Location', f'http://127.0.0.1:{self.server.server_address[1]}/jump')
            self.end_headers()
        elif self.path == '/ok':
            self.send_response(302)
            self.send_header('Location', 'http://cdn-public.test/f.mp4')
            self.end_headers()
        else:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'ok')


@pytest.fixture(scope='module')
def server():
    srv = ThreadingHTTPServer(('127.0.0.1', 0), _Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f'http://127.0.0.1:{srv.server_address[1]}'
    srv.shutdown()


@pytest.fixture
def public_by_name(monkeypatch):
    """Policy IP-nya kita ganti, biar bisa bikin kasus 'host publik yang nge-redirect ke
    loopback' di mesin sendiri. Yang diuji di sini jalan rantai redirect + penolakannya,
    bukan fungsi is_public_url-nya (itu udah ditutupi tests/test_engine.py)."""
    def fake(url):
        host = (url.split('://', 1)[-1].split('/', 1)[0] or '').lower()
        # 127.0.0.1 = "host publik" palsu buat server tes kita; localhost = target terlarang
        return not host.startswith('localhost')
    monkeypatch.setattr(engine, 'is_public_url', fake)
    return fake


def test_redirect_loopback_melempar_xyerror(server, public_by_name):
    with pytest.raises(engine.XyError) as e:
        engine.guard_public_hops(server + '/jump')
    assert e.value.status == 400 and e.value.code == 'invalid'


def test_hop_kedua_juga_diperiksa(server, public_by_name):
    """/chain -> /jump -> localhost: penjaga harus tetap nangkep (bukan cuma hop pertama)."""
    with pytest.raises(engine.XyError):
        engine.guard_public_hops(server + '/chain')


def test_redirect_ke_host_publik_diteruske_extract(server, public_by_name):
    hops = engine.guard_public_hops(server + '/ok')
    assert hops == ['http://cdn-public.test/f.mp4']


def test_site_yang_gak_ajak_ngobrol_fail_open(monkeypatch):
    """Penjaga jangan jadi penyebab link valid gagal: koneksi mati -> serahkan ke yt-dlp."""
    monkeypatch.setattr(engine, 'is_public_url', lambda u: True)
    assert engine.guard_public_hops('http://127.0.0.1:1/x') == []


def test_extract_tidak_menyentuh_yt_dlp_untuk_link_jahat(server, public_by_name, monkeypatch):
    def nope(*a, **k):
        raise AssertionError('yt-dlp tidak boleh dijalankan untuk link yang belum lolos penjaga')

    monkeypatch.setattr(engine.yt_dlp, 'YoutubeDL', nope)
    with pytest.raises(engine.XyError) as e:
        engine.extract(server + '/chain', 'http://proxy.test')
    assert e.value.status == 400


def test_batch_header_tidak_makan_token_rate_limit():
    """Satu klik 'Unduh semua' = 12 request berjeda; klaim X-XY-Batch tidak
    menambah counter, tapi tetap ditahan kalau IP-nya sudah penuh."""
    api._hits.clear()
    ip = '203.0.113.50'
    for _ in range(api.RATE_LIMIT):
        assert api._rate_limited(ip) is False
    assert api._rate_limited(ip) is True                 # penuh
    assert api._rate_limited(ip, batch=True) is True     # batch pun tetap ditahan

    api._hits.clear()
    for _ in range(api.RATE_LIMIT * 2):
        api._rate_limited(ip, batch=True)                # tidak menambah counter
    assert api._rate_limited(ip) is False                # slot masih kosong
    assert api._rate_limited(ip, batch=False) is False   # 1 request biasa = 1 token
    assert api._rate_limited(ip, batch=False) is True or api.RATE_LIMIT > 2
    api._hits.clear()
