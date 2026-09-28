"""Tes keamanan lapisan HTTP API (offline, tanpa jaringan).

Yang dijaga:
  1. Allowlist origin CORS — regresi bug presedensi `'dlaja' in origin` yang bikin
     https://dlaja.evil.com dikasih Access-Control-Allow-Origin di produksi (Sept 2026).
  2. Kunci rate-limit: IP klien tidak boleh bisa dipilih sendiri lewat X-Forwarded-For.
  3. Lapor probe ke dash tidak boleh menahan event loop (yang lama: 2 x 2.5s urlopen
     sinkron di dalam coroutine).
  4. Budget lapor probe (kita yang jadi attacker ke dash sendiri kalau tidak dibatasi).
"""
import asyncio
import hashlib
import hmac as hmac_mod
import json
import os
import time
import urllib.parse
import urllib.request
from collections import deque

import pytest

os.environ.setdefault('XYDL_SIGNING_KEY', 'test-key')

from api.index import (  # noqa: E402
    _cors_for, _post_probe, _probe_budget_ok, _probe_headers, _ua_blocked, app, report_probe,
)
from xydl import netpolicy  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), 'fixtures', 'origin_policy.json')


def _headers_dict(resp_headers):
    return {k.decode().lower(): v.decode() for k, v in resp_headers}


async def _call(path, headers=None, method='GET', query=b'', body=b''):
    scope = {
        'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1',
        'method': method, 'path': path, 'raw_path': path.encode(), 'query_string': query,
        'scheme': 'https', 'client': ('203.0.113.9', 5555), 'server': ('testserver', 443),
        'headers': [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
    }
    queue = [{'type': 'http.request', 'body': body, 'more_body': False}]

    async def receive():
        return queue.pop(0) if queue else {'type': 'http.disconnect'}

    out = {'status': None, 'headers': {}, 'body': b''}

    async def send(msg):
        if msg['type'] == 'http.response.start':
            out['status'] = msg['status']
            out['headers'] = _headers_dict(msg['headers'])
        else:
            out['body'] += msg.get('body', b'')

    await app(scope, receive, send)
    out['json'] = json.loads(out['body']) if out['body'][:1] in (b'{', b'[') else None
    return out


# ------------------------------------------------------------------ 1. origin allowlist
def _cases():
    with open(FIXTURE, encoding='utf-8') as f:
        return json.load(f)


@pytest.mark.parametrize('case', _cases(), ids=lambda c: c['origin'] or '(kosong)')
def test_origin_policy_fixture(case):
    got = netpolicy.origin_allowed(case['origin'])
    assert got == case['expect'], f"{case['origin']!r} -> {got!r}, harusnya {case['expect']!r} ({case['why']})"


def test_acao_hanya_untuk_origin_didaftarkan():
    assert ('access-control-allow-origin', 'https://dlaja.xyverse.my.id') in [
        (k.decode(), v.decode()) for k, v in _cors_for('https://dlaja.xyverse.my.id')]
    for h in _cors_for('https://dlaja.evil.com'):
        assert h[0] != b'access-control-allow-origin'
    assert all(h[0] != b'access-control-allow-origin' for h in _cors_for(None))
    assert all(h[0] != b'access-control-allow-origin' for h in _cors_for('https://attacker.test/x#dlaja'))
    # Vary selalu ada, kalau tidak CDN bisa nyimpen satu respons buat semua origin
    assert any(h[0] == b'vary' for h in _cors_for('https://evil.test'))


def test_extract_ditolak_silang_aslinya_403_tanpa_acao(monkeypatch):
    monkeypatch.delenv('XYDL_EXTRA_ORIGINS', raising=False)
    r = asyncio.run(_call('/api/extract', headers={
        'Origin': 'https://dlaja.evil.com', 'User-Agent': 'scrapy/2.11',
        'X-Real-Ip': '198.51.100.77',
    }, query=urllib.parse.urlencode({'url': 'https://vt.tiktok.com/xyz'}).encode()))
    assert r['status'] == 403
    assert 'access-control-allow-origin' not in r['headers']
    assert r['json']['code'] == 'forbidden'


def test_extra_origins_env_buat_staging(monkeypatch):
    monkeypatch.setenv('XYDL_EXTRA_ORIGINS', 'https://staging.dlaja.test , https://x.dlaja.test')
    assert netpolicy.origin_allowed('https://staging.dlaja.test') == 'https://staging.dlaja.test'
    assert netpolicy.origin_allowed('https://staging.dlaja.evil.com') == ''
    # spasi di sekeliling nilai env jangan bikin origin jadi tak cocok
    assert netpolicy.origin_allowed('https://x.dlaja.test') == 'https://x.dlaja.test'


# ------------------------------------------------------------------ 2. IP klien
def test_client_ip_pakai_hop_terakhir():
    # klien mengirim XFF palsu; hop terakhir = yang ditambahkan proxy di depan app
    assert netpolicy.client_ip({'x-forwarded-for': '1.2.3.4, 203.0.113.5'}) == '203.0.113.5'
    assert netpolicy.client_ip({'x-real-ip': '203.0.113.6'}) == '203.0.113.6'
    assert netpolicy.client_ip({'x-real-ip': '203.0.113.6', 'x-forwarded-for': '9.9.9.9'}) == '203.0.113.6'
    # bukan IP (header di-spam) -> jangan dipakai jadi kunci
    assert netpolicy.client_ip({'x-forwarded-for': 'not-an-ip'}) == '?'
    assert netpolicy.client_ip({}, '10.0.0.1') == '10.0.0.1'


def test_rate_limit_tetap_keikat_walau_klien_ganti_ganti_xff():
    """Regresi: dengan XFF kiri yang dikontrol klien, tiap request dapat 'IP' baru."""
    a = netpolicy.client_ip({'x-forwarded-for': '10.1.1.1'})
    b = netpolicy.client_ip({'x-forwarded-for': '10.1.1.2'})
    assert a != b  # dulu inilah kunci rate limit -> tidak ada gunanya
    assert netpolicy.client_ip({'x-real-ip': '10.9.9.9', 'x-forwarded-for': '10.1.1.9'}) == '10.9.9.9'


def test_rate_limit_reset_tidak_menghapus_kunci_orang_lain():
    api = __import__('api.index', fromlist=['app'])
    api._hits.clear()
    monkey = '198.51.100.200'
    for _ in range(api.RATE_LIMIT):
        assert not api._rate_limited(monkey)
    assert api._rate_limited(monkey)  # kena limit
    lain = '198.51.100.201'
    assert not api._rate_limited(lain)  # orang lain tidak boleh kebetulan ke-reset
    assert api._rate_limited(monkey)
    api._hits.clear()


# ------------------------------------------------------------------ 3. probe tidak memblokir
def test_lapor_probe_tidak_menahan_event_loop(monkeypatch):
    """Inti bug: urlopen sinkron di dalam coroutine mengunci instance buat semua pengguna."""
    api = __import__('api.index', fromlist=['app'])
    monkeypatch.setattr(api, 'PROBE_BUDGET_PER_MIN', 500)
    monkeypatch.setattr(api, '_probe_times', deque(maxlen=500))

    def slow_open(req, timeout=None, **kw):  # pura-pura dash tidak merespons
        time.sleep(2)
        raise OSError('connection reset')

    monkeypatch.setattr(urllib.request, 'urlopen', slow_open)

    ticks = {'n': 0}

    async def heartbeat(stop):
        while not stop.is_set():
            ticks['n'] += 1
            await asyncio.sleep(0.02)

    async def scenario():
        stop = asyncio.Event()
        hb = asyncio.ensure_future(heartbeat(stop))
        t0 = time.monotonic()
        r = await _call('/api/extract', headers={
            'Origin': 'https://dlaja.xyverse.my.id', 'User-Agent': 'python-requests/2.32',
            'X-Real-Ip': '198.51.100.7',
        }, query=urllib.parse.urlencode({'url': 'https://vt.tiktok.com/xyz'}).encode())
        elapsed = time.monotonic() - t0
        stop.set()
        await hb
        return r, elapsed

    r, elapsed = asyncio.run(scenario())
    assert r['status'] == 403
    # kode lama: >= 2s (2 endpoint x timeout) DAN heartbeat mati. kode baru: <= ~0.6s.
    assert elapsed < 1.2, f'respons 403 butuh {elapsed:.2f}s — event loop keblokir'
    assert ticks['n'] >= 5, f'event loop macet, heartbeat cuma {ticks["n"]} tick'


def test_budget_probe_membatasi_amplicification(monkeypatch):
    api = __import__('api.index', fromlist=['app'])
    calls = {'n': 0}

    def fake_post(payload, deadline):
        calls['n'] += 1
        return True

    monkeypatch.setattr(api, '_post_probe', fake_post)
    monkeypatch.setattr(api, 'PROBE_BUDGET_PER_MIN', 3)
    monkeypatch.setattr(api, '_probe_times', deque(maxlen=10))

    async def many():
        for _ in range(10):
            await report_probe('198.51.100.1', 'scrapy/1.0', 'ua_blocked', '/api/extract')

    asyncio.run(many())
    assert calls['n'] == 3, f'harusnya cuma 3 laporan (budget), dapat {calls["n"]}'
    assert not _probe_budget_ok()  # masih habis


def test_post_probe_patuh_deadline(monkeypatch):
    def never_opens(req, timeout=None, **kw):
        raise AssertionError('tidak boleh dicoba setelah deadline')

    monkeypatch.setattr(urllib.request, 'urlopen', never_opens)
    ok = _post_probe({'type': 'probe'}, time.monotonic() - 1)  # deadline sudah lewat
    assert ok is False


def test_header_probe_signed_dan_verifiable(monkeypatch):
    """Dash memvalidasi HMAC ini (probeIdentity) sebelum percaya body.ip."""
    monkeypatch.setenv('XYDL_PROBE_SECRET', 'rahasia-berbagi')
    ts0 = int(time.time())
    h = _probe_headers('198.51.100.7')
    assert set(h) == {'X-Xydl-Probe-Ts', 'X-Xydl-Probe-Sig'}
    want = hmac_mod.new(b'rahasia-berbagi', f"{h['X-Xydl-Probe-Ts']}.198.51.100.7".encode(),
                        hashlib.sha256).hexdigest()
    assert hmac_mod.compare_digest(want, h['X-Xydl-Probe-Sig'])
    assert abs(int(h['X-Xydl-Probe-Ts']) - ts0) <= 5
    monkeypatch.delenv('XYDL_PROBE_SECRET')
    assert _probe_headers('1.1.1.1') == {}  # tanpa secret: jangan kirim yang tak terverifikasi


# ------------------------------------------------------------------ 4. kesehatan path lain
def test_health_tanpa_origin_tetap_200():
    r = asyncio.run(_call('/api/health'))
    assert r['status'] == 200 and r['json']['ok'] is True
    assert 'access-control-allow-origin' not in r['headers']


def test_options_preflight_hanya_echo_origin_sah():
    r = asyncio.run(_call('/api/extract', method='OPTIONS', headers={'Origin': 'https://dlaja.evil.com'}))
    assert r['status'] == 204
    assert 'access-control-allow-origin' not in r['headers']
    r2 = asyncio.run(_call('/api/extract', method='OPTIONS', headers={'Origin': 'https://dlaja.xyverse.my.id'}))
    assert r2['headers'].get('access-control-allow-origin') == 'https://dlaja.xyverse.my.id'


def test_ua_policy_masuk_akal():
    assert _ua_blocked('curl/8.4.0')
    assert _ua_blocked('')
    assert not _ua_blocked('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/139.0 Safari/537.36')
    assert not _ua_blocked('DownloadAja/1.3.1 (Android 15; SM-A556B) XyVerse')
