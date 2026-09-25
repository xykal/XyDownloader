# DownloadAja — custom yt-dlp extractor plugins
# -----------------------------------------------------------------------------
# File ini dipakai di DUA tempat sekaligus:
#   1. Backend web (Vercel)  -> folder `plugins/` dimasukkan ke sys.path
#   2. Aplikasi Android       -> disalin ke filesDir lalu dipanggil via --plugin-dirs
#
# Isinya extractor untuk platform yang belum didukung / sering rusak di yt-dlp:
#   - Douyin 抖音   : yt-dlp butuh cookie "fresh". Di sini cookie ttwid dibuat otomatis
#                    + dukung short link v.douyin.com & link share iesdouyin.
#   - Kuaishou 快手 : belum ada di yt-dlp. Ambil data dari halaman share mobile.
#   - Threads      : belum ada di yt-dlp. Ambil data dari JSON SSR halaman post.
#
#   - pixiv        : belum ada di yt-dlp. Ilustrasi & manga (resolusi asli, semua halaman) +
#                    ugoira (animasi; dikonversi ke MP4 oleh XyUgoiraPP / di browser).
#
#   Foto slide & Live Photo (v1.2): yt-dlp bawaan hanya mengambil VIDEO. Extractor di bawah
#   menambahkan foto (dan video pendek Live Photo) supaya bisa dipilih satu per satu:
#     TikTok (mode foto), Douyin (图文 + 实况), Kuaishou (atlas), Xiaohongshu (图文 + 实况),
#     X/Twitter, Instagram (carousel), Threads, Bluesky, Weibo (termasuk livephoto).
#   Format keluaran galeri (dipakai web & Android):
#     - entri foto : 'xy_image': True, formats = [{'format_id': 'image', ...}]
#     - Live Photo : 'xy_live': True,  formats = [image, {'format_id': 'live', ext mp4/mov}]
#     - playlist   : 'xy_gallery': True, opsional 'xy_audio' = musik latar slide
#
# Semua extractor di sini TIDAK butuh login dan TIDAK membobol DRM.
# Lisensi: GPL-3.0 (sama seperti repo DownloadAja)
# -----------------------------------------------------------------------------
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

try:  # Douyin memakai parser bawaan yt-dlp (TikTok/Douyin base)
    from yt_dlp.extractor.tiktok import DouyinIE as _YtDlpDouyinIE
except Exception:  # pragma: no cover - yt-dlp versi lama/aneh
    _YtDlpDouyinIE = None

try:
    from yt_dlp.extractor.bilibili import BiliBiliIE as _YtDlpBiliBiliIE
except Exception:  # pragma: no cover
    _YtDlpBiliBiliIE = None


def _optional_ie(module, name):
    """Import extractor bawaan yt-dlp kalau ada (plugin tetap jalan di versi yt-dlp lain)."""
    try:
        mod = __import__(f'yt_dlp.extractor.{module}', fromlist=[name])
        return getattr(mod, name)
    except Exception:  # pragma: no cover
        return None


_YtDlpTikTokIE = _optional_ie('tiktok', 'TikTokIE')
_YtDlpTwitterIE = _optional_ie('twitter', 'TwitterIE')
_YtDlpInstagramIE = _optional_ie('instagram', 'InstagramIE')
_YtDlpBlueskyIE = _optional_ie('bluesky', 'BlueskyIE')
_YtDlpWeiboIE = _optional_ie('weibo', 'WeiboIE')
_YtDlpXiaoHongShuIE = _optional_ie('xiaohongshu', 'XiaoHongShuIE')

__all__ = ['XyDouyinIE', 'XyKuaishouIE', 'XyThreadsIE', 'XyBiliBiliIE', 'XyPixivIE', 'XyTikTokIE',
           'XyTwitterIE', 'XyInstagramIE', 'XyBlueskyIE', 'XyWeiboIE', 'XyXiaoHongShuIE']

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


# =============================================================================
# Douyin 抖音
# =============================================================================
if _YtDlpDouyinIE is not None:
    class XyDouyinIE(_YtDlpDouyinIE):
        IE_NAME = 'xy:douyin'
        IE_DESC = 'Douyin 抖音 (DownloadAja: cookie otomatis + short link)'
        _VALID_URL = (r'https?://(?:(?:www|m)\.)?(?:douyin|iesdouyin)\.com/'
                      r'(?:share/)?(?:video|note|slides)/(?P<id>\d+)'
                      r'|https?://(?:www\.)?douyin\.com/[^#]*?[?&]modal_id=(?P<modal>\d+)'
                      r'|https?://v\.douyin\.com/(?P<short>[\w-]+)')
        _TESTS = []

        _TTWID_PAYLOAD = {
            'region': 'cn', 'aid': 1768, 'needFid': False, 'service': 'www.ixigua.com',
            'migrate_info': {'ticket': '', 'source': 'node'}, 'cbUrlProtocol': 'https', 'union': True,
        }

        def _resolve_id(self, url):
            mobj = self._match_valid_url(url)
            vid = mobj.group('id') or mobj.group('modal')
            if vid:
                return vid
            # short link -> ikuti redirect
            urlh = self._request_webpage(
                url, mobj.group('short'), 'Resolving short link',
                headers={'User-Agent': _UA_IOS})
            final = urlh.url
            m = re.search(r'/(?:video|note|slides)/(\d{8,})', final) or re.search(r'modal_id=(\d{8,})', final)
            if not m:
                raise ExtractorError(f'Link Douyin tidak dikenali: {final}', expected=True)
            return m.group(1)

        def _ensure_ttwid(self, video_id, force=False):
            if not force and self._get_cookies('https://www.douyin.com/').get('ttwid'):
                return
            try:
                self._request_webpage(
                    'https://ttwid.bytedance.com/ttwid/union/register/', video_id,
                    'Generating ttwid cookie', data=json.dumps(self._TTWID_PAYLOAD).encode(),
                    headers={'Content-Type': 'application/json', 'User-Agent': _UA_DESKTOP})
            except ExtractorError as e:
                self.report_warning(f'Gagal membuat cookie ttwid: {e}')
                return
            ttwid = self._get_cookies('https://ttwid.bytedance.com/').get('ttwid')
            if ttwid and ttwid.value:
                self._set_cookie('.douyin.com', 'ttwid', ttwid.value)

        _WEB_PARAMS = {
            'device_platform': 'webapp', 'aid': '6383', 'channel': 'channel_pc_web', 'pc_client_type': '1',
            'version_code': '190500', 'version_name': '19.5.0', 'cookie_enabled': 'true',
            'screen_width': '1920', 'screen_height': '1080', 'browser_language': 'zh-CN',
            'browser_platform': 'Win32', 'browser_name': 'Chrome', 'browser_version': '139.0.0.0',
            'browser_online': 'true', 'engine_name': 'Blink', 'engine_version': '139.0.0.0',
            'os_name': 'Windows', 'os_version': '10', 'cpu_core_num': '8', 'device_memory': '8', 'platform': 'PC',
        }

        def _fetch_detail(self, video_id):
            headers = {'Referer': f'https://www.douyin.com/video/{video_id}', 'User-Agent': _UA_DESKTOP}
            for attempt in (1, 2, 3):
                if attempt == 1:
                    query = {'aweme_id': video_id, 'aid': '6383', 'device_platform': 'webapp'}
                else:
                    # ttwid baru + parameter lengkap ala browser
                    if attempt == 3:
                        time.sleep(1.0)
                    self._ensure_ttwid(video_id, force=True)
                    ms_token = ''.join(random.choices(string.ascii_letters + string.digits, k=107))
                    query = {**self._WEB_PARAMS, 'aweme_id': video_id, 'msToken': ms_token}
                data = self._download_json(
                    'https://www.douyin.com/aweme/v1/web/aweme/detail/', video_id,
                    f'Downloading aweme detail (try {attempt})', fatal=False,
                    query=query, headers=headers) or {}
                detail = traverse_obj(data, ('aweme_detail', {dict}))
                if detail:
                    return detail
            return None

        def _real_extract(self, url):
            video_id = self._resolve_id(url)
            self._ensure_ttwid(video_id)
            detail = self._fetch_detail(video_id)
            if not detail:
                raise ExtractorError(
                    'Douyin menolak permintaan (butuh verifikasi). Coba lagi beberapa saat, '
                    'atau pakai aplikasi Android DownloadAja.', expected=True)
            if traverse_obj(detail, ('images', lambda _, v: isinstance(v, dict))):
                return self._xy_image_post(detail, video_id)
            info = self._parse_aweme_video_app(detail)
            # Tanpa video & tanpa foto: musiknya tetap bisa diambil sebagai audio
            if not info.get('formats'):
                music_url = traverse_obj(detail, ('music', 'play_url', 'url_list', 0, {url_or_none}))
                if music_url:
                    info['formats'] = [{
                        'url': music_url, 'format_id': 'music', 'ext': 'mp3',
                        'vcodec': 'none', 'acodec': 'mp3',
                        'http_headers': {'Referer': 'https://www.douyin.com/'},
                    }]
            info.setdefault('webpage_url', f'https://www.douyin.com/video/{video_id}')
            return info

        def _xy_image_post(self, detail, video_id):
            """图文 (foto slide) + 实况照片 (Live Photo)."""
            desc = (detail.get('desc') or '').strip()
            title = _first_line(desc) or f'Douyin {video_id}'
            author = traverse_obj(detail, ('author', 'nickname', {str}))
            headers = {'Referer': 'https://www.douyin.com/', 'User-Agent': _UA_DESKTOP}
            entries = []
            for i, img in enumerate(traverse_obj(detail, ('images', lambda _, v: isinstance(v, dict))), 1):
                urls = traverse_obj(img, ('url_list', ..., {url_or_none})) or []
                if not urls:
                    continue
                # url_list: webp & jpeg tanpa watermark (download_url_list = ber-watermark)
                still = next((u for u in urls if re.search(r'\.jpe?g(?:$|[?~])', u)), urls[0])
                thumb = traverse_obj(img, ('thumb_url_list', 0, {url_or_none}))
                motion = traverse_obj(img, (
                    'video', ('play_addr_h264', 'play_addr', 'download_addr'), 'url_list', ..., {url_or_none}),
                    get_all=False)
                common = dict(width=img.get('width'), height=img.get('height'), thumb=thumb, headers=headers,
                              uploader=author)
                if motion:
                    entries.append(_xy_live(
                        f'{video_id}_{i}', f'{title} ({i})', still, motion, motion_ext='mp4',
                        duration=float_or_none(traverse_obj(img, ('video', 'duration')), 1000), **common))
                else:
                    entries.append(_xy_image(f'{video_id}_{i}', f'{title} ({i})', still, **common))
            music_url = traverse_obj(detail, ('music', 'play_url', 'url_list', 0, {url_or_none}))
            audio = {'url': music_url, 'ext': 'mp3', 'title': traverse_obj(detail, ('music', 'title', {str})),
                     'http_headers': headers} if music_url else None
            return _xy_gallery(
                self, entries, video_id, title, audio=audio, description=desc or None, uploader=author,
                timestamp=int_or_none(detail.get('create_time')),
                webpage_url=f'https://www.douyin.com/note/{video_id}')


# =============================================================================
# Kuaishou 快手
# =============================================================================
class XyKuaishouIE(InfoExtractor):
    IE_NAME = 'xy:kuaishou'
    IE_DESC = 'Kuaishou 快手 (DownloadAja)'
    _VALID_URL = (r'https?://(?:(?:www|v|c|live|m)\.)?(?:kuaishou\.com|gifshow\.com|kwai\.app)/\S+'
                  r'|https?://v\.m\.chenzhongtech\.com/\S+')
    _TESTS = []

    def _photo_id_from(self, url):
        m = re.search(r'/(?:short-video|fw/photo|photo|fw/long-video|video)/(?P<id>[\w-]{6,})', url)
        return m.group('id') if m else None

    def _real_extract(self, url):
        photo_id = self._photo_id_from(url)
        if not photo_id:
            # short link (v.kuaishou.com/xxxx) atau format lain -> ikuti redirect
            urlh = self._request_webpage(url, None, 'Resolving Kuaishou link', headers={'User-Agent': _UA_IOS})
            photo_id = self._photo_id_from(urlh.url)
            if not photo_id:
                page = self._webpage_read_content(urlh, urlh.url, None)
                photo_id = self._search_regex(
                    r'"photoId"\s*:\s*"([\w-]+)"', page, 'photo id', default=None)
        if not photo_id:
            raise ExtractorError('Link Kuaishou tidak dikenali', expected=True)

        page = self._download_webpage(
            f'https://v.m.chenzhongtech.com/fw/photo/{photo_id}', photo_id,
            headers={'User-Agent': _UA_IOS, 'Referer': 'https://v.m.chenzhongtech.com/'})
        state = self._search_json(r'window\.INIT_STATE\s*=', page, 'init state', photo_id, default={})
        photo = _walk(state, lambda d: isinstance(d.get('mainMvUrls'), list) and d.get('mainMvUrls'))
        if not photo:
            holder = _walk(state, lambda d: isinstance(d.get('atlas'), dict) or isinstance(
                traverse_obj(d, ('ext_params', 'atlas')), dict))
            if holder:
                return self._atlas(holder, state, photo_id)
            raise ExtractorError('Video Kuaishou tidak ditemukan (mungkin privat/dihapus).', expected=True)

        formats, seen = [], set()
        for idx, item in enumerate(photo.get('mainMvUrls') or []):
            src = url_or_none(traverse_obj(item, 'url'))
            if not src or src in seen:
                continue
            seen.add(src)
            formats.append({
                'url': src,
                'format_id': f'mp4-{idx}',
                'ext': 'mp4',
                'width': int_or_none(photo.get('width')),
                'height': int_or_none(photo.get('height')),
                'quality': -idx,  # mirror pertama paling diutamakan
                'format_note': 'CDN mirror' if idx else None,
                'http_headers': {'Referer': 'https://www.kuaishou.com/', 'User-Agent': _UA_IOS},
            })
            if len(formats) >= 3:
                break

        return {
            'id': str(photo.get('photoId') or photo_id),
            'title': (photo.get('caption') or f'Kuaishou {photo_id}').strip()[:200],
            'uploader': photo.get('userName'),
            'uploader_id': str_or_none(photo.get('kwaiId') or photo.get('userId')),
            'duration': float_or_none(photo.get('duration'), 1000),
            'thumbnail': traverse_obj(photo, ('coverUrls', 0, 'url', {url_or_none})),
            'like_count': int_or_none(photo.get('likeCount')),
            'view_count': int_or_none(photo.get('viewCount')),
            'webpage_url': f'https://www.kuaishou.com/short-video/{photo_id}',
            'formats': formats,
        }

    def _atlas(self, holder, state, photo_id):
        """Postingan foto (atlas): daftar gambar + musik latar di CDN yximgs."""
        atlas = holder.get('atlas') if isinstance(holder.get('atlas'), dict) else holder['ext_params']['atlas']
        meta = _walk(state, lambda d: d.get('caption') is not None and (
            d.get('photoId') or d.get('userName'))) or holder
        cdns = [c if isinstance(c, str) else (c or {}).get('cdn') for c in (
            atlas.get('cdnList') or atlas.get('cdn') or [])]
        cdn = next((c for c in cdns if c), 'p2.a.yximgs.com')
        sizes = atlas.get('size') or []
        title = _first_line(meta.get('caption')) or f'Kuaishou foto {photo_id}'
        headers = {'Referer': 'https://www.kuaishou.com/', 'User-Agent': _UA_IOS}

        def full(path):
            return path if str(path).startswith('http') else f'https://{cdn}{path}'

        entries = []
        for i, path in enumerate(atlas.get('list') or [], 1):
            size = sizes[i - 1] if i - 1 < len(sizes) and isinstance(sizes[i - 1], dict) else {}
            entries.append(_xy_image(f'{photo_id}_{i}', f'{title} ({i})', full(path), size.get('w'), size.get('h'),
                                     headers=headers, uploader=meta.get('userName')))
        music = atlas.get('music')
        audio = {'url': full(music), 'ext': _video_ext(music, 'm4a') if music else 'm4a', 'title': None,
                 'http_headers': headers} if music else None
        return _xy_gallery(self, entries, photo_id, title, audio=audio, uploader=meta.get('userName'),
                           webpage_url=f'https://www.kuaishou.com/short-video/{photo_id}')


# =============================================================================
# Threads (Meta)
# =============================================================================
class XyThreadsIE(InfoExtractor):
    IE_NAME = 'xy:threads'
    IE_DESC = 'Threads (DownloadAja)'
    _VALID_URL = r'https?://(?:www\.)?threads\.(?:net|com)/(?:@[\w.]+/post|t)/(?P<id>[\w-]+)'
    _TESTS = []

    def _image_entry(self, media, code, index=None, parent=None):
        cands = traverse_obj(media, ('image_versions2', 'candidates', lambda _, v: url_or_none(v['url']))) or []
        if not cands:
            return None
        best = max(cands, key=lambda c: (int_or_none(c.get('width')) or 0) * (int_or_none(c.get('height')) or 0))
        small = min(cands, key=lambda c: int_or_none(c.get('width')) or 99999)
        caption = traverse_obj(parent or media, ('caption', 'text', {str})) or ''
        user = traverse_obj(parent or media, ('user', 'username', {str}))
        suffix = f' ({index})' if index else ''
        return _xy_image(
            f'{code}_{index}' if index else code, (_first_line(caption, 120) or f'Threads {code}') + suffix,
            best['url'], best.get('width'), best.get('height'), thumb=small['url'],
            headers={'Referer': 'https://www.threads.com/'}, uploader=user)

    def _media_entry(self, media, code, index=None, parent=None):
        versions = media.get('video_versions') or []
        formats, seen = [], set()
        for v in versions:
            src = url_or_none(v.get('url'))
            if not src or src in seen:
                continue
            seen.add(src)
            formats.append({
                'url': src,
                'format_id': f'mp4-{v.get("type") or len(formats)}',
                'ext': 'mp4',
                'width': int_or_none(v.get('width') or media.get('original_width')),
                'height': int_or_none(v.get('height') or media.get('original_height')),
                'acodec': None if media.get('has_audio', True) else 'none',
            })
        if not formats:
            return None
        caption = traverse_obj(parent or media, ('caption', 'text', {str})) or ''
        user = traverse_obj(parent or media, ('user', 'username', {str}))
        suffix = f' #{index}' if index else ''
        title = (caption.split('\n')[0][:120] or f'Threads post {code}') + suffix
        return {
            'id': f'{code}_{index}' if index else code,
            'title': title,
            'description': caption or None,
            'uploader': user,
            'uploader_id': user,
            'timestamp': int_or_none((parent or media).get('taken_at')),
            'duration': float_or_none(media.get('video_duration')),
            'thumbnail': traverse_obj(media, ('image_versions2', 'candidates', 0, 'url', {url_or_none})),
            'webpage_url': f'https://www.threads.com/@{user}/post/{code}' if user else f'https://www.threads.com/t/{code}',
            'formats': formats,
        }

    def _real_extract(self, url):
        code = self._match_id(url)
        webpage = self._download_webpage(
            url.replace('threads.net', 'threads.com'), code,
            headers={'User-Agent': _UA_DESKTOP, 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document'})
        post = None
        for m in re.finditer(r'<script type="application/json"[^>]*>(.*?)</script>', webpage, re.S):
            if code not in m.group(1):
                continue
            data = self._parse_json(m.group(1), code, fatal=False)
            post = _walk(data, lambda d: d.get('code') == code and (
                d.get('video_versions') or d.get('carousel_media') or traverse_obj(d, ('image_versions2', 'candidates'))))
            if post:
                break
        if not post:
            raise ExtractorError('Tidak ada foto/video di postingan Threads ini (atau akun privat).', expected=True)

        def one(media, index=None):
            return self._media_entry(media, code, index, post) or self._image_entry(media, code, index, post)

        caption = traverse_obj(post, ('caption', 'text', {str})) or ''
        title = _first_line(caption, 120) or f'Threads {code}'
        user = traverse_obj(post, ('user', 'username', {str}))
        if post.get('carousel_media'):
            entries = [one(item, i + 1) for i, item in enumerate(post['carousel_media'])]
            if not any(entries):
                raise ExtractorError('Carousel Threads ini kosong.', expected=True)
            if any(e and e.get('xy_image') for e in entries):
                return _xy_gallery(self, entries, code, title, uploader=user)
            entries = [e for e in entries if e]
            if len(entries) == 1:
                return entries[0]
            return self.playlist_result(entries, code, title)

        entry = one(post)
        if not entry:
            raise ExtractorError('Tidak ada foto/video di postingan Threads ini.', expected=True)
        if entry.get('xy_image'):
            return _xy_gallery(self, [entry], code, title, uploader=user)
        return entry


# =============================================================================
# Bilibili — cadangan via API resmi kalau halaman web diblokir (HTTP 412)
# =============================================================================
_BILI_QN_HEIGHT = {127: 4320, 126: 2160, 125: 2160, 120: 2160, 116: 1080, 112: 1080, 80: 1080,
                   74: 720, 64: 720, 32: 480, 16: 360, 6: 240}

if _YtDlpBiliBiliIE is not None:
    class XyBiliBiliIE(_YtDlpBiliBiliIE):
        IE_NAME = 'xy:bilibili'
        IE_DESC = 'Bilibili (DownloadAja: fallback API bila halaman diblokir)'
        _TESTS = []

        def _real_extract(self, url):
            try:
                return super()._real_extract(url)
            except ExtractorError as e:
                msg = str(e)
                if not any(k in msg for k in ('412', '403', 'Precondition', 'Forbidden', 'captcha')):
                    raise
                self.report_warning('Halaman Bilibili diblokir, memakai API cadangan')
                return self._api_extract(url)

        def _api_extract(self, url):
            mobj = self._match_valid_url(url)
            prefix, vid = mobj.group('prefix'), mobj.group('id')
            query = {'bvid': f'{prefix}{vid}'} if prefix.lower() == 'bv' else {'aid': vid}
            headers = {'Referer': 'https://www.bilibili.com/', 'Origin': 'https://www.bilibili.com',
                       'User-Agent': _UA_DESKTOP}
            view = self._download_json('https://api.bilibili.com/x/web-interface/view', vid,
                                       'Downloading view info (API)', query=query, headers=headers)
            if view.get('code') != 0:
                raise ExtractorError(f'Bilibili API: {view.get("message")}', expected=True)
            data = view['data']
            bvid = data.get('bvid') or f'{prefix}{vid}'
            pages = data.get('pages') or []
            page = int_or_none(traverse_obj(parse_qs(url), ('p', 0))) or 1
            cur = pages[page - 1] if 0 < page <= len(pages) else (pages[0] if pages else {})
            cid = cur.get('cid') or data.get('cid')
            formats = []

            mp4 = self._download_json(
                'https://api.bilibili.com/x/player/playurl', bvid, 'Downloading mp4 playurl', fatal=False,
                query={'bvid': bvid, 'cid': cid, 'qn': 80, 'fnval': 1, 'platform': 'html5', 'high_quality': 1},
                headers=headers) or {}
            md = mp4.get('data') or {}
            durls = md.get('durl') or []
            if len(durls) == 1 and url_or_none(durls[0].get('url')):
                formats.append({
                    'url': durls[0]['url'], 'format_id': f'mp4-{md.get("quality")}', 'ext': 'mp4',
                    'height': _BILI_QN_HEIGHT.get(md.get('quality')), 'filesize': int_or_none(durls[0].get('size')),
                    'vcodec': 'avc1', 'acodec': 'mp4a.40.2', 'http_headers': headers,
                })

            dash = self._download_json(
                'https://api.bilibili.com/x/player/playurl', bvid, 'Downloading DASH playurl', fatal=False,
                query={'bvid': bvid, 'cid': cid, 'qn': 80, 'fnval': 4048, 'fourk': 1}, headers=headers) or {}
            dd = traverse_obj(dash, ('data', 'dash', {dict})) or {}
            for v in dd.get('video') or []:
                src = url_or_none(v.get('baseUrl') or v.get('base_url'))
                if not src:
                    continue
                formats.append({
                    'url': src, 'format_id': f'dash-{v.get("id")}-{v.get("codecid")}', 'ext': 'mp4',
                    'width': int_or_none(v.get('width')), 'height': int_or_none(v.get('height')),
                    'fps': float_or_none(v.get('frameRate') or v.get('frame_rate')), 'vcodec': v.get('codecs'),
                    'acodec': 'none', 'tbr': float_or_none(v.get('bandwidth'), 1000), 'http_headers': headers,
                })
            audios = list(dd.get('audio') or [])
            audios += traverse_obj(dd, ('dolby', 'audio', ...)) or []
            if traverse_obj(dd, ('flac', 'audio')):
                audios.append(dd['flac']['audio'])
            for a in audios:
                src = url_or_none(a.get('baseUrl') or a.get('base_url'))
                if not src:
                    continue
                formats.append({
                    'url': src, 'format_id': f'audio-{a.get("id")}', 'ext': 'm4a', 'vcodec': 'none',
                    'acodec': a.get('codecs') or 'mp4a', 'tbr': float_or_none(a.get('bandwidth'), 1000),
                    'http_headers': headers,
                })
            if not formats:
                raise ExtractorError('Bilibili: tidak ada format yang bisa diambil (mungkin butuh login/VIP).',
                                     expected=True)
            title = data.get('title') or bvid
            if len(pages) > 1:
                title = f'{title} p{page:02d} {cur.get("part") or ""}'.strip()
            return {
                'id': f'{bvid}_p{page}' if len(pages) > 1 else bvid,
                'title': title,
                'description': data.get('desc'),
                'uploader': traverse_obj(data, ('owner', 'name')),
                'uploader_id': str_or_none(traverse_obj(data, ('owner', 'mid'))),
                'timestamp': int_or_none(data.get('pubdate')),
                'thumbnail': url_or_none(data.get('pic')),
                'duration': float_or_none(cur.get('duration') or data.get('duration')),
                'view_count': int_or_none(traverse_obj(data, ('stat', 'view'))),
                'webpage_url': f'https://www.bilibili.com/video/{bvid}' + (f'?p={page}' if len(pages) > 1 else ''),
                'formats': formats,
                'http_headers': headers,
            }


# =============================================================================
# pixiv — ilustrasi, manga & ugoira (karya publik / non R-18)
# =============================================================================
class XyPixivIE(InfoExtractor):
    IE_NAME = 'xy:pixiv'
    IE_DESC = 'pixiv (ilustrasi, manga, ugoira)'
    _VALID_URL = (r'https?://(?:www\.)?pixiv\.net/(?:(?:[a-z]{2}/)?artworks/|i/|'
                  r'member_illust\.php\?(?:[^#]*&)?illust_id=)(?P<id>\d+)')
    _TESTS = []
    _HEADERS = {'Referer': 'https://www.pixiv.net/', 'User-Agent': _UA_DESKTOP}

    def _api(self, path, video_id, note):
        data = self._download_json(
            f'https://www.pixiv.net/ajax/{path}', video_id, note, fatal=False,
            headers={**self._HEADERS, 'Accept': 'application/json'}, expected_status=(400, 403, 404))
        if not isinstance(data, dict):
            raise ExtractorError('pixiv tidak merespons, coba lagi.', expected=True)
        if data.get('error'):
            msg = data.get('message') or 'karya tidak ditemukan / sudah dihapus'
            raise ExtractorError(f'pixiv: {msg}', expected=True)
        return data.get('body')

    def _real_extract(self, url):
        video_id = self._match_id(url)
        body = self._api(f'illust/{video_id}', video_id, 'Downloading illust info') or {}
        title = (body.get('illustTitle') or body.get('title') or f'pixiv {video_id}').strip()
        common = {
            'uploader': body.get('userName'),
            'uploader_id': str_or_none(body.get('userId')),
            'timestamp': parse_iso8601(body.get('createDate')),
            'description': clean_html(body.get('description') or body.get('illustComment')) or None,
            'tags': traverse_obj(body, ('tags', 'tags', ..., 'tag', {str})) or None,
            'like_count': int_or_none(body.get('likeCount')),
            'view_count': int_or_none(body.get('viewCount')),
            'age_limit': 18 if body.get('xRestrict') else 0,
            'webpage_url': f'https://www.pixiv.net/artworks/{video_id}',
            'http_headers': self._HEADERS,
        }
        thumb = traverse_obj(body, ('urls', ('regular', 'small', 'thumb', 'mini'), {url_or_none}), get_all=False)

        if body.get('illustType') == 2:  # ugoira (animasi)
            meta = self._api(f'illust/{video_id}/ugoira_meta', video_id, 'Downloading ugoira metadata') or {}
            src = url_or_none(meta.get('originalSrc') or meta.get('src'))
            frames = [{'file': f['file'], 'delay': int_or_none(f.get('delay')) or 100}
                      for f in meta.get('frames') or [] if f.get('file')]
            if not src or not frames:
                raise ExtractorError('Ugoira ini tidak bisa diambil (mungkin butuh login).', expected=True)
            return {
                **common,
                'id': video_id,
                'title': title,
                'thumbnail': thumb,
                'duration': sum(f['delay'] for f in frames) / 1000,
                'formats': [{
                    'url': src, 'format_id': 'ugoira', 'ext': 'bin',  # ZIP frame; 'zip' ditolak filter ekstensi yt-dlp
                    'width': int_or_none(body.get('width')), 'height': int_or_none(body.get('height')),
                    'format_note': 'ugoira frames (ZIP)', 'http_headers': self._HEADERS,
                }],
                'xy_ugoira': {'frames': frames, 'mime': meta.get('mime_type')},
            }

        # ilustrasi (0) / manga (1): tiap halaman = 1 gambar resolusi asli.
        # Catatan: vcodec/acodec sengaja tidak diisi supaya format default yt-dlp (-f b) tetap memilihnya;
        # engine DownloadAja mengenali gambar lewat flag 'xy_image'.
        pages = self._api(f'illust/{video_id}/pages', video_id, 'Downloading pages') or []
        entries = []
        for i, page in enumerate(pages):
            original = url_or_none(traverse_obj(page, ('urls', 'original')))
            if not original:
                continue
            ext = original.rsplit('.', 1)[-1].lower().split('?')[0]
            entries.append({
                **common,
                'id': f'{video_id}_p{i}',
                'title': f'{title} p{i + 1}' if len(pages) > 1 else title,
                'thumbnail': url_or_none(traverse_obj(page, ('urls', ('small', 'regular')), get_all=False)) or thumb,
                'formats': [{
                    'url': original, 'format_id': 'original', 'ext': ext,
                    'width': int_or_none(page.get('width')), 'height': int_or_none(page.get('height')),
                    'format_note': 'Original', 'http_headers': self._HEADERS,
                }],
                'xy_image': True,
            })
        if not entries:
            raise ExtractorError('Gambar tidak tersedia (karya R-18 / terbatas butuh login pixiv).', expected=True)
        if len(entries) == 1:
            return entries[0]
        return self.playlist_result(entries, video_id, title, uploader=common['uploader'],
                                    uploader_id=common['uploader_id'], thumbnail=thumb,
                                    webpage_url=common['webpage_url'])


# =============================================================================
# TikTok — mode foto (slide) + video biasa
# =============================================================================
if _YtDlpTikTokIE is not None:
    class XyTikTokIE(_YtDlpTikTokIE):
        IE_NAME = 'xy:tiktok'
        IE_DESC = 'TikTok (DownloadAja: video + foto slide)'
        _VALID_URL = (r'https?://www\.tiktokv?\.com/(?:embed|(?:share|@(?P<user_id>[\w\.-]+)?)/(?:video|photo))'
                      r'/(?P<id>\d+)')
        _EMBED_REGEX = []
        _TESTS = []

        def _extract_web_data_and_status(self, url, video_id, fatal=True):
            # cache per ekstraksi: data halaman dipakai ulang oleh parser video bawaan (tanpa request ke-2)
            cache = self.__dict__.setdefault('_xy_web', {})
            if video_id not in cache:
                cache[video_id] = super()._extract_web_data_and_status(url, video_id, fatal=fatal)
            return cache[video_id]

        def _real_extract(self, url):
            video_id, user_id = self._match_valid_url(url).group('id', 'user_id')
            self.__dict__['_xy_web'] = {}
            try:
                data, status = self._extract_web_data_and_status(self._create_url(user_id, video_id), video_id)
            except ExtractorError:
                data, status = None, None
            if data and status == 0 and traverse_obj(data, ('imagePost', 'images', 0)):
                return self._photo_post(data, video_id, user_id)
            return super()._real_extract(url.replace('/photo/', '/video/'))

        def _photo_post(self, data, video_id, user_id):
            author = traverse_obj(data, ('author', 'uniqueId', {str})) or user_id
            desc = (data.get('desc') or '').strip()
            title = _first_line(desc) or f'TikTok foto {video_id}'
            headers = {'Referer': 'https://www.tiktok.com/'}
            entries = []
            for i, img in enumerate(traverse_obj(data, ('imagePost', 'images', lambda _, v: isinstance(v, dict))), 1):
                urls = traverse_obj(img, ('imageURL', 'urlList', ..., {url_or_none})) or []
                if not urls:
                    continue
                src = next((u for u in urls if 'jpeg' in u or '.jpg' in u), urls[0])
                entries.append(_xy_image(f'{video_id}_{i}', f'{title} ({i})', src, img.get('imageWidth'),
                                         img.get('imageHeight'), headers=headers, uploader=author))
            audio = None
            music_url = traverse_obj(data, ('music', 'playUrl', {url_or_none}))
            if music_url:
                ext = traverse_obj(parse_qs(music_url), (
                    'mime_type', -1, {lambda x: x.replace('_', '/')}, {mimetype2ext})) or (
                    'mp3' if '.mp3' in music_url else 'm4a')
                audio = {'url': music_url, 'ext': ext, 'title': traverse_obj(data, ('music', 'title', {str})),
                         'http_headers': headers}
            return _xy_gallery(
                self, entries, video_id, title, audio=audio, uploader=author, description=desc or None,
                timestamp=int_or_none(data.get('createTime')),
                webpage_url=f'https://www.tiktok.com/@{author or "_"}/photo/{video_id}')


# =============================================================================
# X / Twitter — foto ikut diambil (yt-dlp bawaan hanya video)
# =============================================================================
if _YtDlpTwitterIE is not None:
    class XyTwitterIE(_YtDlpTwitterIE):
        IE_NAME = 'xy:twitter'
        IE_DESC = 'X / Twitter (DownloadAja: video + foto)'
        _EMBED_REGEX = []
        _TESTS = []

        def _extract_status(self, twid):
            cache = self.__dict__.setdefault('_xy_status', {})
            if twid not in cache:
                cache[twid] = super()._extract_status(twid)
            return cache[twid]

        def _real_extract(self, url):
            twid, index = self._match_valid_url(url).group('id', 'index')
            self.__dict__['_xy_status'] = {}
            status = self._extract_status(twid)
            media = traverse_obj(status, ('extended_entities', 'media', lambda _, v: isinstance(v, dict))) or []
            if index or not any(m.get('type') == 'photo' for m in media):
                return super()._real_extract(url)

            videos = []
            if any(m.get('type') != 'photo' for m in media):
                try:
                    res = super()._real_extract(url)
                    videos = list(res.get('entries') or []) if res.get('_type') == 'playlist' else [res]
                except ExtractorError as e:
                    self.report_warning(f'Video di tweet ini gagal diambil: {e}')
            text = traverse_obj(status, (('full_text', 'text'), {str}), get_all=False) or ''
            text = re.sub(r'\s*https?://t\.co/\w+\s*$', '', text).strip()
            user = traverse_obj(status, ('user', 'screen_name', {str}))
            title = _first_line(text) or (f'Postingan @{user}' if user else f'Tweet {twid}')
            headers = {'Referer': 'https://x.com/'}
            entries, vids = [], iter(videos)
            for i, m in enumerate(media, 1):
                if m.get('type') != 'photo':
                    v = next(vids, None)
                    if v:
                        entries.append(v)
                    continue
                src = url_or_none(m.get('media_url_https') or m.get('media_url'))
                if not src:
                    continue
                base, _, ext = src.rpartition('.')
                ext = ext.lower() if ext.lower() in ('jpg', 'jpeg', 'png', 'webp') else 'jpg'
                orig = f'{base}?format={ext}&name=orig' if base else src
                entries.append(_xy_image(
                    f'{twid}_{i}', f'{title} ({i})', orig,
                    traverse_obj(m, ('original_info', 'width')), traverse_obj(m, ('original_info', 'height')),
                    thumb=f'{base}?format={ext}&name=small' if base else src, headers=headers,
                    ext='jpg' if ext == 'jpeg' else ext, uploader=user))
            return _xy_gallery(self, entries, twid, title, uploader=user, description=text or None,
                               webpage_url=f'https://x.com/{user or "i"}/status/{twid}')


# =============================================================================
# Instagram — foto di carousel / postingan foto
# =============================================================================
if _YtDlpInstagramIE is not None:
    class XyInstagramIE(_YtDlpInstagramIE):
        IE_NAME = 'xy:instagram'
        IE_DESC = 'Instagram (DownloadAja: video + foto carousel)'
        _EMBED_REGEX = []
        _TESTS = []

        def _extract_product_media(self, product_media):
            res = super()._extract_product_media(product_media)
            if res.get('formats'):
                return res
            cands = traverse_obj(product_media, (
                'image_versions2', 'candidates', lambda _, v: url_or_none(v['url']))) or []
            if not cands:
                return res
            best = max(cands, key=lambda c: (int_or_none(c.get('width')) or 0) * (int_or_none(c.get('height')) or 0))
            res['formats'] = [{
                'url': best['url'], 'format_id': 'image', 'ext': _img_ext(best['url']),
                'width': int_or_none(best.get('width')), 'height': int_or_none(best.get('height')),
                'format_note': 'Foto', 'http_headers': {'Referer': 'https://www.instagram.com/'},
            }]
            res['xy_image'] = True
            res.setdefault('thumbnail', min(cands, key=lambda c: int_or_none(c.get('width')) or 99999)['url'])
            return res

        def _real_extract(self, url):
            info = super()._real_extract(url)
            entries = info.get('entries') if info.get('_type') == 'playlist' else None
            if entries is not None:
                entries = list(entries)
                info['entries'] = entries
                for i, e in enumerate(entries, 1):
                    if e.get('xy_image') and e.get('id'):
                        e['id'] = f'{e["id"]}_{i}'
                if any(e.get('xy_image') for e in entries):
                    info['xy_gallery'] = True
            elif info.get('xy_image'):
                return _xy_gallery(self, [info], info.get('id'), info.get('title'),
                                   uploader=info.get('uploader'), description=info.get('description'))
            return info


# =============================================================================
# Bluesky — postingan foto
# =============================================================================
if _YtDlpBlueskyIE is not None:
    class XyBlueskyIE(_YtDlpBlueskyIE):
        IE_NAME = 'xy:bluesky'
        IE_DESC = 'Bluesky (DownloadAja: video + foto)'
        _EMBED_REGEX = []
        _TESTS = []

        def _extract_post(self, handle, post_id):
            cache = self.__dict__.setdefault('_xy_post', {})
            if (handle, post_id) not in cache:
                cache[(handle, post_id)] = super()._extract_post(handle, post_id)
            return cache[(handle, post_id)]

        def _real_extract(self, url):
            handle, post_id = self._match_valid_url(url).group('handle', 'id')
            self.__dict__['_xy_post'] = {}
            post = self._extract_post(handle, post_id)
            images = traverse_obj(post, ('embed', (None, 'media'), 'images', lambda _, v: url_or_none(v['fullsize'])))
            if not images:
                return super()._real_extract(url)
            text = traverse_obj(post, ('record', 'text', {str})) or ''
            user = traverse_obj(post, ('author', 'handle', {str})) or handle
            title = _first_line(text) or f'Postingan {user}'
            entries = []
            for i, img in enumerate(images, 1):
                full = img['fullsize']
                entries.append(_xy_image(
                    f'{post_id}_{i}', f'{title} ({i})', full, traverse_obj(img, ('aspectRatio', 'width')),
                    traverse_obj(img, ('aspectRatio', 'height')), thumb=url_or_none(img.get('thumb')),
                    ext=_img_ext(full.replace('@', '.'), 'jpg'), uploader=user, alt_title=img.get('alt') or None))
            return _xy_gallery(self, entries, post_id, title, uploader=user, description=text or None,
                               webpage_url=f'https://bsky.app/profile/{user}/post/{post_id}')


# =============================================================================
# Weibo 微博 — foto & livephoto
# =============================================================================
if _YtDlpWeiboIE is not None:
    class XyWeiboIE(_YtDlpWeiboIE):
        IE_NAME = 'xy:weibo'
        IE_DESC = 'Weibo 微博 (DownloadAja: video + foto + livephoto)'
        _EMBED_REGEX = []
        _TESTS = []

        def _pic_entry(self, pic, idx, title, headers, user):
            if not isinstance(pic, dict):
                return None
            best = traverse_obj(pic, (('largest', 'mw2000', 'original', 'large', 'bmiddle'), {dict}), get_all=False) or {}
            src = url_or_none(best.get('url'))
            if not src:
                return None
            thumb = traverse_obj(pic, (('bmiddle', 'thumbnail'), 'url', {url_or_none}), get_all=False)
            w, h = best.get('width'), best.get('height')
            # livephoto: URL "media/play" Weibo me-redirect ke file bertanda tangan baru di livephoto.*.sinaimg.cn
            # (URL .mov mentah tanpa tanda tangan ditolak 403). video_hd = resolusi lebih tinggi.
            video = url_or_none(pic.get('video_hd')) or url_or_none(pic.get('video'))
            if pic.get('type') == 'livephoto' and video:
                return _xy_live(f'{pic.get("pic_id") or idx}', f'{title} ({idx})', src, video, w, h, thumb=thumb,
                                headers=headers, motion_ext='mp4', uploader=user)
            return _xy_image(f'{pic.get("pic_id") or idx}', f'{title} ({idx})', src, w, h, thumb=thumb,
                             headers=headers, uploader=user)

        def _real_extract(self, url):
            video_id = self._match_id(url)
            meta = self._weibo_download_json(
                'https://weibo.com/ajax/statuses/show', video_id, query={'id': video_id})
            mix = traverse_obj(meta, ('mix_media_info', 'items', lambda _, v: isinstance(v, dict))) or []
            pic_infos = meta.get('pic_infos') or {}
            if not pic_infos and not any(m.get('type') == 'pic' for m in mix):
                if not mix:
                    return self._parse_video_info(meta)
                return self.playlist_result(self._entries(mix), video_id)

            text = clean_html(meta.get('text_raw') or meta.get('text') or '') or ''
            user = traverse_obj(meta, ('user', 'screen_name', {str}))
            title = _first_line(text) or f'Weibo {video_id}'
            headers = {'Referer': 'https://weibo.com/'}
            entries = []
            if mix:
                for i, item in enumerate(mix, 1):
                    if item.get('type') == 'pic':
                        entries.append(self._pic_entry(item.get('data'), i, title, headers, user))
                    else:
                        entries.append(self._parse_video_info(traverse_obj(item, {
                            'id': ('data', 'object_id'),
                            'page_info': {'media_info': ('data', 'media_info', {dict})},
                        })))
            else:
                for i, pid in enumerate(meta.get('pic_ids') or list(pic_infos), 1):
                    entries.append(self._pic_entry(pic_infos.get(pid), i, title, headers, user))
                if traverse_obj(meta, ('page_info', 'media_info')):  # foto + video dalam satu postingan
                    entries.append(self._parse_video_info(meta))
            return _xy_gallery(self, entries, video_id, title, uploader=user, description=text or None,
                               webpage_url=url)


# =============================================================================
# Xiaohongshu 小红书 — catatan foto (图文) + Live Photo (实况) + video
# =============================================================================
if _YtDlpXiaoHongShuIE is not None:
    class XyXiaoHongShuIE(_YtDlpXiaoHongShuIE):
        IE_NAME = 'xy:xiaohongshu'
        IE_DESC = 'Xiaohongshu 小红书 (DownloadAja: video + foto + Live Photo)'
        _VALID_URL = (r'https?://(?:www\.)?xiaohongshu\.com/(?:explore|discovery/item|user/profile/[\da-f]+)'
                      r'/(?P<id>[\da-f]{16,})|https?://xhslink\.com/(?P<short>[\w/]+)')
        _EMBED_REGEX = []
        _TESTS = []
        _HEADERS = {'User-Agent': _UA_DESKTOP, 'Referer': 'https://www.xiaohongshu.com/'}

        def _download_webpage(self, url_or_request, video_id, *args, **kwargs):
            key = (str(url_or_request), video_id)
            cached = self.__dict__.get('_xy_page')
            if cached and cached[0] == key:
                return cached[1]
            page = super()._download_webpage(url_or_request, video_id, *args, **kwargs)
            self.__dict__['_xy_page'] = (key, page)
            return page

        def _real_extract(self, url):
            mobj = self._match_valid_url(url)
            if mobj.group('short'):
                urlh = self._request_webpage(url, mobj.group('short'), 'Resolving xhslink',
                                             headers={'User-Agent': _UA_IOS})
                url = urlh.url
                m = re.search(r'/(?:explore|discovery/item|item)/([\da-f]{16,})', url)
                if not m:
                    raise ExtractorError('Link Xiaohongshu tidak dikenali (mungkin perlu dibuka di aplikasi).',
                                         expected=True)
                url = f'https://www.xiaohongshu.com/explore/{m.group(1)}?' + urllib.parse.urlparse(url).query
            display_id = self._search_regex(r'/([\da-f]{16,})', url, 'note id')
            self.__dict__['_xy_page'] = None
            webpage = self._download_webpage(url, display_id)
            state = self._search_json(r'window\.__INITIAL_STATE__\s*=', webpage, 'initial state', display_id,
                                      transform_source=lambda s: re.sub(r'\bundefined\b', 'null', s), default={})
            note = traverse_obj(state, ('note', 'noteDetailMap', display_id, 'note', {dict})) or {}
            if not note:
                raise ExtractorError('Catatan Xiaohongshu tidak bisa dibuka (butuh xsec_token / login). '
                                     'Salin link lewat tombol Share di aplikasi.', expected=True)
            images = traverse_obj(note, ('imageList', lambda _, v: isinstance(v, dict))) or []
            if note.get('type') == 'video' or not images:
                return super()._real_extract(url)  # parser video bawaan (halaman diambil dari cache)
            desc = (note.get('desc') or '').strip()
            title = (note.get('title') or '').strip() or _first_line(desc) or f'Xiaohongshu {display_id}'
            user = traverse_obj(note, ('user', ('nickname', 'nickName'), {str}), get_all=False)
            entries = []
            for i, img in enumerate(images, 1):
                src = url_or_none(img.get('urlDefault') or img.get('url') or traverse_obj(
                    img, ('infoList', -1, 'url')))
                if not src:
                    continue
                if src.startswith('http://'):
                    src = 'https://' + src[7:]
                thumb = url_or_none(img.get('urlPre'))
                motion = traverse_obj(img, ('stream', ('h264', 'h265', 'av1'), ..., ('masterUrl', ('backupUrls', 0)),
                                            {url_or_none}), get_all=False) if img.get('livePhoto') else None
                common = dict(thumb=thumb, headers=self._HEADERS, uploader=user)
                if motion:
                    entries.append(_xy_live(f'{display_id}_{i}', f'{title} ({i})', src, motion, img.get('width'),
                                            img.get('height'), motion_ext='mp4', **common))
                else:
                    entries.append(_xy_image(f'{display_id}_{i}', f'{title} ({i})', src, img.get('width'),
                                             img.get('height'), ext=_img_ext(src, 'webp') if 'webp' in src else 'jpg',
                                             **common))
            return _xy_gallery(self, entries, display_id, title, uploader=user, description=desc or None,
                               webpage_url=f'https://www.xiaohongshu.com/explore/{display_id}')
