"""Lazy discovery/routing only. Each platform owns its actual engine entry point."""
from functools import lru_cache
from importlib import import_module
import json
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent


def platforms():
    return [json.loads(p.read_text(encoding='utf-8')) for p in sorted(ROOT.glob('*/platform.json'))]


@lru_cache(maxsize=1)
def _domains():
    return {domain: p['id'] for p in platforms() for domain in p['domains']}


def detect_id(url):
    try:
        host = (urlparse(url).hostname or '').lower()
    except ValueError:
        return None
    parts = host.split('.')
    for index in range(len(parts) - 1):
        platform_id = _domains().get('.'.join(parts[index:]))
        if platform_id:
            return platform_id
    return None


@lru_cache(maxsize=64)
def load_engine(platform_id):
    if platform_id not in set(_domains().values()):
        raise KeyError(platform_id)
    return import_module(f'{__package__}.{platform_id}.engine').ENGINE


def resolve(url):
    platform_id = detect_id(url)
    return load_engine(platform_id) if platform_id else None


def extract(downloader, url, *, download=False):
    engine = resolve(url)
    if engine is not None:
        return engine.extract(downloader, url, download=download)
    # Non-featured yt-dlp sites still work; no fabricated per-site support claims.
    return downloader.extract_info(url, download=download)


def resolve_info(info, page_url):
    """Choose by platform-owned metadata, then extractor identity, then URL."""
    key = str(info.get('extractor_key') or info.get('extractor') or '').lower()
    catalog = platforms()
    for platform in catalog:
        if any(marker in info for marker in platform.get('runtime', {}).get('info_markers', [])):
            return load_engine(platform['id'])
    for platform in catalog:
        custom_key = platform.get('custom_extractor', '').removesuffix('IE').lower()
        if key and (key.startswith(platform['id']) or (custom_key and key.startswith(custom_key))):
            return load_engine(platform['id'])
    return resolve(page_url)


@lru_cache(maxsize=8)
def domain_policy(name):
    return tuple(domain for platform in platforms()
                 for domain in platform.get('runtime', {}).get(name, []))


def is_ip_bound(host):
    return any(host == domain or host.endswith('.' + domain)
               for domain in domain_policy('ip_bound_domains'))
