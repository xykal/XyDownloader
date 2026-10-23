"""Douyin 抖音 custom extractor; no login or DRM bypass."""
from ..shared import (
    ExtractorError,
    _UA_DESKTOP,
    _UA_IOS,
    _YtDlpDouyinIE,
    _first_line,
    _xy_gallery,
    _xy_image,
    _xy_live,
    float_or_none,
    int_or_none,
    json,
    random,
    re,
    string,
    time,
    traverse_obj,
    url_or_none,
)

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
