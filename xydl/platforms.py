"""Katalog platform yang ditampilkan di web & dipakai untuk deteksi link.

Catatan: ini hanya daftar "unggulan". Engine sebenarnya (yt-dlp + plugin DownloadAja)
mendukung 1.700+ situs — link dari situs yang tidak ada di daftar ini tetap dicoba.
"""

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

_PLATFORM_BY_ID = {platform['id']: platform for platform in PLATFORMS}


def detect_platform(url):
    """Shared exact-domain router; platform behavior remains in its own folder."""
    return _PLATFORM_BY_ID.get(registry.detect_id(url))


def catalog():
    groups = []
    for rid, meta in REGIONS.items():
        items = [
            {k: p[k] for k in ('id', 'name', 'color', 'note', 'domains', 'logo')}
            for p in PLATFORMS if p['region'] == rid
        ]
        groups.append({'id': rid, **meta, 'platforms': items})
    return {'regions': groups, 'total_featured': len(PLATFORMS), 'engine_sites': '1700+'}
