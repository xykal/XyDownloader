# XyDownloader — custom yt-dlp extractor plugins
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
# Semua extractor di sini TIDAK butuh login dan TIDAK membobol DRM.
# Lisensi: GPL-3.0 (sama seperti repo XyDownloader)
# -----------------------------------------------------------------------------
import json
import re

from yt_dlp.extractor.common import InfoExtractor
import random
import string
import time

from yt_dlp.utils import (
    ExtractorError,
    float_or_none,
    int_or_none,
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

__all__ = ['XyDouyinIE', 'XyKuaishouIE', 'XyThreadsIE', 'XyBiliBiliIE']

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


# =============================================================================
# Douyin 抖音
# =============================================================================
if _YtDlpDouyinIE is not None:
    class XyDouyinIE(_YtDlpDouyinIE):
        IE_NAME = 'xy:douyin'
        IE_DESC = 'Douyin 抖音 (XyDownloader: cookie otomatis + short link)'
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
                    'atau pakai aplikasi Android XyDownloader.', expected=True)
            info = self._parse_aweme_video_app(detail)
            # Postingan foto/slide: tidak ada video, tapi musiknya tetap bisa diambil sebagai audio
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


# =============================================================================
# Kuaishou 快手
# =============================================================================
class XyKuaishouIE(InfoExtractor):
    IE_NAME = 'xy:kuaishou'
    IE_DESC = 'Kuaishou 快手 (XyDownloader)'
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
            if _walk(state, lambda d: d.get('atlas') or d.get('ext_params', {}).get('atlas')):
                raise ExtractorError('Postingan ini berupa foto (atlas), bukan video.', expected=True)
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


# =============================================================================
# Threads (Meta)
# =============================================================================
class XyThreadsIE(InfoExtractor):
    IE_NAME = 'xy:threads'
    IE_DESC = 'Threads (XyDownloader)'
    _VALID_URL = r'https?://(?:www\.)?threads\.(?:net|com)/(?:@[\w.]+/post|t)/(?P<id>[\w-]+)'
    _TESTS = []

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
            post = _walk(data, lambda d: d.get('code') == code and (d.get('video_versions') or d.get('carousel_media')))
            if post:
                break
        if not post:
            raise ExtractorError('Tidak ada video di postingan Threads ini (atau akun privat).', expected=True)

        if post.get('carousel_media'):
            entries = [e for e in (
                self._media_entry(item, code, i + 1, post) for i, item in enumerate(post['carousel_media'])) if e]
            if not entries:
                raise ExtractorError('Carousel Threads ini tidak berisi video.', expected=True)
            if len(entries) == 1:
                return entries[0]
            return self.playlist_result(entries, code, entries[0]['title'].rsplit(' #', 1)[0])

        entry = self._media_entry(post, code)
        if not entry:
            raise ExtractorError('Tidak ada video di postingan Threads ini.', expected=True)
        return entry


# =============================================================================
# Bilibili — cadangan via API resmi kalau halaman web diblokir (HTTP 412)
# =============================================================================
_BILI_QN_HEIGHT = {127: 4320, 126: 2160, 125: 2160, 120: 2160, 116: 1080, 112: 1080, 80: 1080,
                   74: 720, 64: 720, 32: 480, 16: 360, 6: 240}

if _YtDlpBiliBiliIE is not None:
    class XyBiliBiliIE(_YtDlpBiliBiliIE):
        IE_NAME = 'xy:bilibili'
        IE_DESC = 'Bilibili (XyDownloader: fallback API bila halaman diblokir)'
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
