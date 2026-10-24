"""Threads custom extractor; no login or DRM bypass."""
from .._common.gallery import (
    ExtractorError,
    InfoExtractor,
    _UA_DESKTOP,
    _first_line,
    _walk,
    _xy_gallery,
    _xy_image,
    float_or_none,
    int_or_none,
    re,
    traverse_obj,
    url_or_none,
)

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
