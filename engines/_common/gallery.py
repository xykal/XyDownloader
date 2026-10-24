"""Platform-neutral gallery helpers and optional dependency resolver."""
import json

import random

import re

import string

import time

import urllib.parse

from yt_dlp.extractor.common import InfoExtractor

from yt_dlp.utils import (
    ExtractorError,
    clean_html,
    float_or_none,
    int_or_none,
    mimetype2ext,
    parse_iso8601,
    parse_qs,
    str_or_none,
    traverse_obj,
    url_or_none,
)

def optional_ie(module, name):
    """Resolve an optional upstream dependency without breaking plugin discovery."""
    try:
        mod = __import__(f'yt_dlp.extractor.{module}', fromlist=[name])
        return getattr(mod, name)
    except (ImportError, AttributeError):  # compatibility with older yt-dlp releases
        return None

_UA_DESKTOP = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
               '(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36')

_UA_IOS = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
           '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')

def _walk(obj, fn, depth=0):
    """DFS sederhana untuk mencari dict di dalam JSON bersarang."""
    if depth > 80:
        return None
    if isinstance(obj, dict):
        if fn(obj):
            return obj
        values = obj.values()
    elif isinstance(obj, list):
        values = obj
    else:
        return None
    for v in values:
        if isinstance(v, (dict, list)):
            found = _walk(v, fn, depth + 1)
            if found is not None:
                return found
    return None

_IMG_EXT_RE = re.compile(r'\.(jpe?g|png|webp|gif|heic|heif|avif)(?=$|[?~!_@/&#])', re.I)

def _img_ext(url, default='jpg'):
    m = _IMG_EXT_RE.search(urllib.parse.urlparse(url or '').path) or _IMG_EXT_RE.search(url or '')
    ext = (m.group(1).lower() if m else default)
    return 'jpg' if ext == 'jpeg' else ext

def _video_ext(url, default='mp4'):
    m = re.search(r'\.(mp4|mov|m4v|webm)(?=$|[?#&])', url or '', re.I)
    return m.group(1).lower() if m else default

def _xy_image(id_, title, url, width=None, height=None, thumb=None, headers=None, ext=None, **extra):
    """Satu foto dalam galeri."""
    return {
        'id': str(id_),
        'title': title,
        'thumbnail': thumb or url,
        'formats': [{
            'url': url, 'format_id': 'image', 'ext': ext or _img_ext(url),
            'width': int_or_none(width), 'height': int_or_none(height),
            'format_note': 'Foto', 'http_headers': dict(headers or {}),
        }],
        'xy_image': True,
        **{k: v for k, v in extra.items() if v is not None},
    }

def _xy_live(id_, title, still, motion, width=None, height=None, thumb=None, headers=None,
             duration=None, motion_ext=None, **extra):
    """Live Photo = foto + video pendek (bergerak). Keduanya bisa diunduh."""
    info = _xy_image(id_, title, still, width, height, thumb, headers, **extra)
    info['formats'].append({
        'url': motion, 'format_id': 'live', 'ext': motion_ext or _video_ext(motion),
        'width': int_or_none(width), 'height': int_or_none(height),
        'format_note': 'Live Photo (video)', 'http_headers': dict(headers or {}),
    })
    info['xy_live'] = True
    if duration:
        info['duration'] = duration
    return info

def _xy_gallery(ie, entries, playlist_id, title, audio=None, **extra):
    """Playlist galeri (foto/Live Photo/video campur). audio = musik latar (TikTok/Douyin)."""
    entries = [e for e in entries if e]
    if not entries:
        raise ExtractorError('Tidak ada foto/video di postingan ini.', expected=True)
    res = ie.playlist_result(entries, str(playlist_id), title, **{k: v for k, v in extra.items() if v is not None})
    res['xy_gallery'] = True
    if not res.get('thumbnail'):
        res['thumbnail'] = entries[0].get('thumbnail')
    if audio and audio.get('url'):
        res['xy_audio'] = audio
    return res

_INVISIBLE_RE = re.compile('[\u200b-\u200f\u2060\ufeff]')

def _first_line(text, limit=100):
    text = _INVISIBLE_RE.sub('', text or '').strip()
    return text.split('\n')[0].strip()[:limit]

# Explicit re-exports used by individual platform implementations.
__all__ = ['json', 'random', 're', 'string', 'time', 'urllib', 'InfoExtractor', 'ExtractorError', 'clean_html', 'float_or_none', 'int_or_none', 'mimetype2ext', 'parse_iso8601', 'parse_qs', 'str_or_none', 'traverse_obj', 'url_or_none']
