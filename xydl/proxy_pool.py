"""Rotasi proxy untuk ekstraksi — anti blokir IP datacenter.

Dipakai engine.extract sebagai CADANGAN setelah koneksi langsung gagal
(kode 'blocked' / jaringan). Teknik rotasi yang dipakai:

  1. Failover  : langsung dulu; baru proxy kalau gagal — jalur bersih tetap
                 yang tercepat, proxy cuma turun tangan saat perlu.
  2. Round-robin: tiap percobaan ganti proxy, nggak nempel ke satu host.
  3. Shuffle   : urutan pool diacak tiap isi ulang supaya nggak monoton.
  4. Blacklist : proxy yang error dibuang 10 menit (TTL), nggak dipakai lagi.
  5. Multi-sumber: pool diisi dari banyak daftar publik + daftar eksplisit
                 dari env; diisi ulang otomatis tiap 10 menit.
  6. Campur protokol: http untuk CONNECT, socks5 sebagai alternatif.

KEAMANAN — baca ini sebelum ngembangin:
Proxy publik = pihak ketiga NGGAK terpercaya (bisa MITM kapan saja).
Proxy HANYA dipakai mengambil metadata halaman publik saat ekstraksi.
TIDAK PERNAH untuk unduhan file, cookie, login, atau kredensial apa pun.
URL unduhan tetap ditandatangani sendiri dan lewat worker proxy kita.

Env:
  XYDL_EXTRACT_PROXY   proxy eksplisit (utama; boleh dipisah koma)
  XYDL_PROXY_POOL      'off' mematikan pool gratis (default: on)
  XYDL_PROXY_TRIES     berapa proxy pool dicoba setelah gagal (default: 3)
  XYDL_PROXY_SOURCES   sumber daftar proxy (koma); kosong = pakai bawaan
"""

from __future__ import annotations

import os
import random
import threading
import time
import urllib.request

DEFAULT_SOURCES = (
    'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=all',
    'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=5000&country=all',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt',
)

TTL = 600  # detik: umur pool & masa hukuman blacklist
MAX_SIZE = 24
_lock = threading.Lock()


def _norm(line: str, proto: str = 'http') -> str | None:
    """Baris daftar proxy -> URL proxy siap pakai. Sampah -> None."""
    line = line.strip()
    if not line or line.startswith('#') or ' ' in line:
        return None
    if '://' in line:
        scheme = line.split('://', 1)[0].lower()
        return line if scheme in ('http', 'https', 'socks4', 'socks5') else None
    if line.count(':') == 1:
        host, port = line.rsplit(':', 1)
        if host and port.isdigit():
            return f'{proto}://{line}'
    return None


class ProxyPool:
    """Pool proxy dengan rotasi round-robin + blacklist TTL."""

    def __init__(self, explicit=(), sources=None, max_size: int = MAX_SIZE):
        self.explicit = [p for p in (explicit or []) if p]
        self.sources = list(sources) if sources is not None else list(DEFAULT_SOURCES)
        self.max_size = max_size
        self._free: list[str] = []
        self._dead: dict[str, float] = {}
        self._filled = 0.0

    def _refill(self, now: float) -> None:
        if self._free and now - self._filled < TTL:
            return
        found: list[str] = []
        for src in self.sources:
            if len(found) >= self.max_size * 3:
                break
            proto = 'socks5' if 'socks5' in src.lower() else 'http'
            try:
                req = urllib.request.Request(src, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=6) as r:
                    text = r.read(200_000).decode('utf-8', 'ignore')
            except Exception:
                continue
            for line in text.splitlines():
                p = _norm(line, proto)
                if p:
                    found.append(p)
        seen: set[str] = set()
        uniq = []
        for p in found:
            if p not in seen and p not in self.explicit:
                seen.add(p)
                uniq.append(p)
        random.shuffle(uniq)  # teknik rotasi: acak tiap isi ulang
        self._free = uniq[: self.max_size]
        self._filled = now

    def candidates(self) -> list[str]:
        """Urutan rotasi: eksplisit dulu, lalu pool (yang masih hidup)."""
        now = time.time()
        with _lock:
            self._refill(now)
            return [p for p in self.explicit + self._free if self._dead.get(p, 0) < now]

    def report(self, proxy: str, ok: bool) -> None:
        """Laporkan hasil pemakaian: gagal = blacklist sementara."""
        with _lock:
            if ok:
                self._dead.pop(proxy, None)
            else:
                self._dead[proxy] = time.time() + TTL

    def stats(self) -> dict:
        with _lock:
            return {
                'explicit': len(self.explicit),
                'free': len(self._free),
                'dead': sum(1 for t in self._dead.values() if t >= time.time()),
                'sources': len(self.sources),
            }


_pool: ProxyPool | None = None


def get_pool() -> ProxyPool:
    """Singleton proses — pool diisi ulang malas (tanpa jaringan saat impor)."""
    global _pool
    if _pool is None:
        explicit = [p.strip() for p in os.environ.get('XYDL_EXTRACT_PROXY', '').split(',') if p.strip()]
        custom = [s.strip() for s in os.environ.get('XYDL_PROXY_SOURCES', '').split(',') if s.strip()]
        _pool = ProxyPool(explicit=explicit, sources=custom or None)
    return _pool


def pool_on() -> bool:
    return os.environ.get('XYDL_PROXY_POOL', 'on').strip().lower() != 'off'


def max_tries() -> int:
    try:
        return max(0, int(os.environ.get('XYDL_PROXY_TRIES', '3')))
    except ValueError:
        return 3
