"""Bilibili custom extractor; no login or DRM bypass."""
from .._common.gallery import (
    ExtractorError,
    _UA_DESKTOP,
    optional_ie,
    float_or_none,
    int_or_none,
    parse_qs,
    str_or_none,
    traverse_obj,
    url_or_none,
)

_YtDlpBiliBiliIE = optional_ie('bilibili', 'BiliBiliIE')

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
