"""pixiv custom extractor; no login or DRM bypass."""
from .._common.gallery import (
    ExtractorError,
    InfoExtractor,
    _UA_DESKTOP,
    clean_html,
    int_or_none,
    parse_iso8601,
    str_or_none,
    traverse_obj,
    url_or_none,
)

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
