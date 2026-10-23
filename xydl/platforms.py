"""Katalog platform yang ditampilkan di web & dipakai untuk deteksi link.

Catatan: ini hanya daftar "unggulan". Engine sebenarnya (yt-dlp + plugin DownloadAja)
mendukung 1.700+ situs — link dari situs yang tidak ada di daftar ini tetap dicoba.
"""
from urllib.parse import urlparse

REGIONS = {
    'id': {'name': 'Indonesia', 'flag': '🇮🇩'},
    'cn': {'name': 'China', 'flag': '🇨🇳'},
    'jp': {'name': 'Jepang', 'flag': '🇯🇵'},
    'sg': {'name': 'Singapura & Asia Tenggara', 'flag': '🇸🇬'},
    'us': {'name': 'Amerika Serikat', 'flag': '🇺🇸'},
    'global': {'name': 'Global', 'flag': '🌐'},
}

# Metadata lives beside each engine implementation, also bundled for Android.
import sys
from pathlib import Path

_PLUGIN_ROOT = Path(__file__).resolve().parents[1] / 'plugins'
if str(_PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(_PLUGIN_ROOT))
from yt_dlp_plugins.engines import registry

PLATFORMS = registry.platforms()

_DOMAIN_INDEX = {}
for _p in PLATFORMS:
    for _d in _p['domains']:
        _DOMAIN_INDEX[_d] = _p


def detect_platform(url):
    """Kembalikan dict platform berdasarkan domain URL (atau None)."""
    try:
        host = (urlparse(url).hostname or '').lower()
    except ValueError:
        return None
    parts = host.split('.')
    # cocokkan dari domain terpanjang: v.qq.com -> qq.com
    for i in range(len(parts) - 1):
        cand = '.'.join(parts[i:])
        if cand in _DOMAIN_INDEX:
            return _DOMAIN_INDEX[cand]
    return None


def catalog():
    groups = []
    for rid, meta in REGIONS.items():
        items = [
            {k: p[k] for k in ('id', 'name', 'color', 'note', 'domains', 'logo')}
            for p in PLATFORMS if p['region'] == rid
        ]
        groups.append({'id': rid, **meta, 'platforms': items})
    return {'regions': groups, 'total_featured': len(PLATFORMS), 'engine_sites': '1700+'}
