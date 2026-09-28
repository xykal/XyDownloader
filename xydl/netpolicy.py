"""Kebijakan origin (CORS) + penentuan IP klien.

Kenapa modul terpisah?
  Aturan yang sama harus berlaku di DUA runtime: Python (Vercel Function, api/index.py)
  dan JavaScript (Cloudflare Worker, worker/src/index.js). Dulu aturan itu ditulis inline di
  masing-masing dan keduanya punya bug presedensi operator yang identik:

      if not allow and o.endswith('.vercel.app') and 'xydl' in o or 'dlaja' in o:

  Python & JS sama-sama menghitung `(A and B and C) or D`, jadi SATU syarat terakhir
  berdiri sendiri: origin apa pun yang mengandung substring "dlaja" dianggap boleh.
  Artinya `https://dlaja.evil.com` (domain siapa pun yang bisa dipasang attacker)
  dapat `Access-Control-Allow-Origin` penuh -> halaman mereka bisa baca /api/extract
  (JSON + link bertanda tangan) dan stream byte lewat proxy kita. Proxy kita jadi
  open-proxy untuk satu orang itu, dan bandwidth Cloudflare account yang kebayar.

  Sekarang: pencocokan host EKSAK (bukan substring), dan tabel kasus di
  tests/fixtures/origin_policy.json dijalankan oleh pytest (Python) DAN node --test (JS)
  supaya kedua implementasi tidak bisa drift lagi.
"""
import ipaddress
import os

# Origin produksi yang diizinkan. Ini daftar EKSAK — skema + host + port harus sama persis.
ALLOWED_EXACT = (
    'https://dlaja.xyverse.my.id',
    'https://dlaja.projectkal.my.id',  # legacy (308 ke domain utama)
    'https://xydl.vercel.app',  # fallback selama DNS apex belum aktif
    'http://127.0.0.1:8000',
    'http://localhost:8000',
)

# Deploy preview Vercel: https://<nama-project>[-git-<branch>-<scope>].vercel.app
# Hanya label pertama yang boleh dipakai untuk pencocokan, supaya host seperti
# https://dlaja.evil.com atau https://evil.test/x#dlaja tidak lolos.
PREVIEW_SUFFIX = '.vercel.app'
PREVIEW_PREFIXES = ('xydl', 'dlaja')

# Urutan sama persis dengan worker/src/netpolicy.js (x-real-ip -> cf-connecting-ip -> x-forwarded-for)
_HEADER_IP_SOURCES = ('x-real-ip', 'cf-connecting-ip', 'x-forwarded-for')


def _extra_origins():
    """Origin tambahan tanpa ubah kode (mis. staging): XYDL_EXTRA_ORIGINS="https://a,https://b". """
    raw = os.environ.get('XYDL_EXTRA_ORIGINS', '')
    return {o.strip() for o in raw.split(',') if o.strip()}


def _parse_origin(origin):
    """-> (scheme, host_with_port, path_ok) atau None kalau bukan origin yang valid."""
    o = (origin or '').strip()
    if not o or o.lower() == 'null':
        return None
    scheme, sep, rest = o.partition('://')
    if not sep:
        return None
    scheme = scheme.lower()
    host = rest.split('/', 1)[0]
    if host != rest[:len(host)]:  # ada path setelah host -> bukan origin
        return None
    if any(c in rest for c in '/?#\\@'):
        return None
    if not host:
        return None
    return scheme, host.lower()


def origin_allowed(origin, extra=None):
    """Kembalikan origin yang boleh dicerminkan ke Access-Control-Allow-Origin, atau '' kalau tolak."""
    parsed = _parse_origin(origin)
    if not parsed:
        return ''
    scheme, host = parsed
    o = f'{scheme}://{host}'
    if o in ALLOWED_EXACT:
        return o
    if extra is None:
        extra = _extra_origins()
    if o in extra:
        return o
    if scheme == 'https' and host.endswith(PREVIEW_SUFFIX):
        first = host.split('.', 1)[0]
        if any(first == p or first.startswith(p + '-') for p in PREVIEW_PREFIXES):
            return o
    return ''


def _valid_ip(value):
    v = (value or '').strip()
    if not v:
        return ''
    if v.startswith('['):  # [::1]:8080
        v = v[1:].split(']', 1)[0]
    elif v.count(':') == 1 and '.' in v:  # 1.2.3.4:443
        v = v.rsplit(':', 1)[0]
    try:
        ipaddress.ip_address(v)
    except ValueError:
        return ''
    return v


def client_ip(headers, fallback=''):
    """IP klien untuk kunci rate-limit.

    Kode lama ambil elemen PERTAMA X-Forwarded-For, padahal itu nilai yang dikirim
    klien — tiap request bisa bawa "X-Forwarded-For: 1.2.3.4" different tiap kali dan
    rate limit 25/menit jadi hiasan doang. Nilai tepercaya adalah hop TERAKHIR
    (ditambahkan proxy di depan app), dan x-real-ip (di-set ulang oleh proxy Vercel).
    """
    for name in _HEADER_IP_SOURCES:
        raw = headers.get(name) or ''
        if ',' in raw:
            raw = raw.split(',')[-1]
        ip = _valid_ip(raw)
        if ip:
            return ip[:64]
    return (fallback or '?')[:64]
