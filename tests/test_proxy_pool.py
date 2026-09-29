"""Tes penjaga rotasi proxy — xydl/proxy_pool.py + integrasi engine."""

import io

import pytest

from xydl import proxy_pool
from xydl import engine


# ---------------------------------------------------------------- _norm

def test_norm_plain_ip_port_diangkat_jadi_http():
    assert proxy_pool._norm('1.2.3.4:8080') == 'http://1.2.3.4:8080'


def test_norm_protokol_dari_sumber_socks5():
    assert proxy_pool._norm('1.2.3.4:1080', 'socks5') == 'socks5://1.2.3.4:1080'


def test_norm_skema_valid_diteruskan():
    assert proxy_pool._norm('socks5://1.2.3.4:1080') == 'socks5://1.2.3.4:1080'
    assert proxy_pool._norm('http://1.2.3.4:80') == 'http://1.2.3.4:80'


@pytest.mark.parametrize('sampah', [
    '', '# komentar', 'bukan proxy', '1.2.3.4', '1.2.3.4:abc',
    'ftp://1.2.3.4:21', '1.2.3.4:8080 extra', 'javascript:alert(1)',
])
def test_norm_sampah_ditolak(sampah):
    assert proxy_pool._norm(sampah) is None


# ---------------------------------------------------------------- pool

class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _fake_urlopen(isi_per_sumber):
    def fake(req, timeout=0):
        url = req.full_url if hasattr(req, 'full_url') else req
        return _Resp(isi_per_sumber.get(url, b'').encode())
    return fake


def test_refill_multi_sumber_dedup_dan_tag_protokol(monkeypatch):
    monkeypatch.setattr(proxy_pool.urllib.request, 'urlopen', _fake_urlopen({
        'https://a/http.txt': '1.1.1.1:8080\n2.2.2.2:8080\n1.1.1.1:8080\n',
        'https://a/socks5.txt': '3.3.3.3:1080\n',
    }))
    monkeypatch.setattr(proxy_pool.random, 'shuffle', lambda x: None)  # deterministik
    p = proxy_pool.ProxyPool(explicit=['http://9.9.9.9:80'],
                             sources=['https://a/http.txt', 'https://a/socks5.txt'])
    kandidat = p.candidates()
    assert kandidat[0] == 'http://9.9.9.9:80', 'proxy eksplisit selalu di depan'
    assert set(kandidat[1:]) == {'http://1.1.1.1:8080', 'http://2.2.2.2:8080', 'socks5://3.3.3.3:1080'}
    assert len(kandidat) == 4, 'dedup: 1.1.1.1 cuma sekali'


def test_blacklist_sesaat_dan_pulih(monkeypatch):
    monkeypatch.setattr(proxy_pool.urllib.request, 'urlopen', _fake_urlopen({}))
    p = proxy_pool.ProxyPool(explicit=['http://1.1.1.1:1', 'http://2.2.2.2:2'], sources=[])
    p.report('http://1.1.1.1:1', False)
    assert p.candidates() == ['http://2.2.2.2:2'], 'yang gagal dibuang sementara'
    p.report('http://1.1.1.1:1', True)
    assert 'http://1.1.1.1:1' in p.candidates(), 'lolos lagi setelah sukses'


def test_stats_dan_max_size(monkeypatch):
    monkeypatch.setattr(proxy_pool.urllib.request, 'urlopen', _fake_urlopen({
        'https://a/all.txt': '\n'.join(f'10.0.0.{i}:8080' for i in range(50)),
    }))
    p = proxy_pool.ProxyPool(sources=['https://a/all.txt'], max_size=10)
    assert len(p.candidates()) == 10
    st = p.stats()
    assert st['free'] == 10 and st['explicit'] == 0 and st['dead'] == 0


# ---------------------------------------------------------------- integrasi engine

def test_slots_diluar_domain_tak_kena_pool(monkeypatch):
    monkeypatch.setenv('XYDL_EXTRACT_PROXY', 'http://proxy.bayar:8000')
    monkeypatch.setattr(engine.proxy_pool, 'get_pool',
                        lambda: (_ for _ in ()).throw(AssertionError('nggak boleh dipanggil')))
    slots = engine._proxy_slots('https://www.tiktok.com/@x/video/1')
    assert slots == [{}], 'domain di luar scope: koneksi langsung saja'


def test_slots_urutan_bersih_dulu_lalu_eksplisit_lalu_pool(monkeypatch):
    monkeypatch.setenv('XYDL_PROXY_POOL', 'on')
    monkeypatch.setenv('XYDL_EXTRACT_PROXY', 'http://proxy.bayar:8000')
    monkeypatch.setenv('XYDL_PROXY_TRIES', '2')

    class _Pool:
        def candidates(self):
            return ['http://gratis1:1', 'http://gratis2:2', 'http://gratis3:3']
    monkeypatch.setattr(engine.proxy_pool, 'get_pool', lambda: _Pool())

    slots = engine._proxy_slots('https://www.douyin.com/video/123')
    assert slots == [{}, {'proxy': 'http://proxy.bayar:8000'},
                     {'proxy': 'http://gratis1:1'}, {'proxy': 'http://gratis2:2'}]


def test_pool_bisa_dimatikan(monkeypatch):
    monkeypatch.setenv('XYDL_PROXY_POOL', 'off')
    monkeypatch.setenv('XYDL_EXTRACT_PROXY', 'http://proxy.bayar:8000')
    slots = engine._proxy_slots('https://youtu.be/dQw4w9WgXcQ')
    assert slots == [{}, {'proxy': 'http://proxy.bayar:8000'}]


def test_default_pool_mati_gagal_cepat(monkeypatch):
    """Keputusan 2026-09-29: tanpa env, pool publik TIDAK aktif — blokir platform
    harus gagal cepat dan mengarahkan ke APK, bukan 2 menit muter proxy percuma."""
    monkeypatch.delenv('XYDL_PROXY_POOL', raising=False)
    monkeypatch.delenv('XYDL_EXTRACT_PROXY', raising=False)
    assert proxy_pool.pool_on() is False
    slots = engine._proxy_slots('https://www.douyin.com/video/123')
    assert slots == [{}], 'default: satu percobaan langsung, gagal cepat'
    assert engine._compose_attempts('https://www.douyin.com/video/123') == [{}]


def test_compose_attempts_dibatasi_lima(monkeypatch):
    monkeypatch.setenv('XYDL_PROXY_POOL', 'on')
    monkeypatch.setenv('XYDL_PROXY_TRIES', '9')
    monkeypatch.setenv('XYDL_PROXY_DOMAINS', 'x.com')  # twitter: 2 varian dasar
    monkeypatch.delenv('XYDL_EXTRACT_PROXY', raising=False)

    class _Pool:
        def candidates(self):
            return [f'http://p{i}:1' for i in range(20)]
    monkeypatch.setattr(engine.proxy_pool, 'get_pool', lambda: _Pool())

    url = 'https://x.com/jack/status/20'  # twitter = 2 varian dasar
    percobaan = engine._compose_attempts(url)
    assert len(percobaan) == 5, 'total percobaan dibatasi 5'
    assert percobaan[0] == {'extractor_args': {'twitter': {'api': ['syndication']}}}, \
        'percobaan pertama tetap jalur bersih'


def test_pool_singleton_dan_env(monkeypatch):
    monkeypatch.setenv('XYDL_EXTRACT_PROXY', 'http://a:1, http://b:2')
    monkeypatch.setattr(proxy_pool.urllib.request, 'urlopen', _fake_urlopen({}))
    monkeypatch.setattr(proxy_pool, '_pool', None)
    p = proxy_pool.get_pool()
    assert p.explicit == ['http://a:1', 'http://b:2'], 'env dipisah koma, spasi dibuang'
    assert proxy_pool.get_pool() is p, 'singleton per proses'
