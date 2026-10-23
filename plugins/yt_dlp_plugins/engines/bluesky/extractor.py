"""Bluesky custom extractor; no login or DRM bypass."""
from ..shared import (
    _YtDlpBlueskyIE,
    _first_line,
    _img_ext,
    _xy_gallery,
    _xy_image,
    traverse_obj,
    url_or_none,
)

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
