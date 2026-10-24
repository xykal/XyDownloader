"""X / Twitter custom extractor; no login or DRM bypass."""
from .._common.gallery import (
    ExtractorError,
    optional_ie,
    _first_line,
    _xy_gallery,
    _xy_image,
    re,
    traverse_obj,
    url_or_none,
)

_YtDlpTwitterIE = optional_ie('twitter', 'TwitterIE')

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
