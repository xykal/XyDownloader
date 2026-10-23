"""Kuaishou 快手 custom extractor; no login or DRM bypass."""
from ..shared import (
    ExtractorError,
    InfoExtractor,
    _UA_IOS,
    _first_line,
    _video_ext,
    _walk,
    _xy_gallery,
    _xy_image,
    float_or_none,
    int_or_none,
    re,
    str_or_none,
    traverse_obj,
    url_or_none,
)

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
