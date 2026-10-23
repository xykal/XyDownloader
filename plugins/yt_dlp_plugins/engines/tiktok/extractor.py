"""TikTok custom extractor; no login or DRM bypass."""
from ..shared import (
    ExtractorError,
    _YtDlpTikTokIE,
    _first_line,
    _xy_gallery,
    _xy_image,
    int_or_none,
    mimetype2ext,
    parse_qs,
    traverse_obj,
    url_or_none,
)

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
