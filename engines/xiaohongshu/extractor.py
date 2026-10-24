"""Xiaohongshu 小红书 custom extractor; no login or DRM bypass."""
from .._common.gallery import (
    ExtractorError,
    _UA_DESKTOP,
    _UA_IOS,
    optional_ie,
    _first_line,
    _img_ext,
    _xy_gallery,
    _xy_image,
    _xy_live,
    re,
    traverse_obj,
    url_or_none,
    urllib,
)

_YtDlpXiaoHongShuIE = optional_ie('xiaohongshu', 'XiaoHongShuIE')

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
