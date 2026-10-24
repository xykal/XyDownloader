"""Instagram custom extractor; no login or DRM bypass."""
from .._common.gallery import (
    optional_ie,
    _img_ext,
    _xy_gallery,
    int_or_none,
    traverse_obj,
    url_or_none,
)

_YtDlpInstagramIE = optional_ie('instagram', 'InstagramIE')

if _YtDlpInstagramIE is not None:
    class XyInstagramIE(_YtDlpInstagramIE):
        IE_NAME = 'xy:instagram'
        IE_DESC = 'Instagram (DownloadAja: video + foto carousel)'
        _EMBED_REGEX = []
        _TESTS = []

        def _extract_product_media(self, product_media):
            res = super()._extract_product_media(product_media)
            if res.get('formats'):
                return res
            cands = traverse_obj(product_media, (
                'image_versions2', 'candidates', lambda _, v: url_or_none(v['url']))) or []
            if not cands:
                return res
            best = max(cands, key=lambda c: (int_or_none(c.get('width')) or 0) * (int_or_none(c.get('height')) or 0))
            res['formats'] = [{
                'url': best['url'], 'format_id': 'image', 'ext': _img_ext(best['url']),
                'width': int_or_none(best.get('width')), 'height': int_or_none(best.get('height')),
                'format_note': 'Foto', 'http_headers': {'Referer': 'https://www.instagram.com/'},
            }]
            res['xy_image'] = True
            res.setdefault('thumbnail', min(cands, key=lambda c: int_or_none(c.get('width')) or 99999)['url'])
            return res

        def _real_extract(self, url):
            info = super()._real_extract(url)
            entries = info.get('entries') if info.get('_type') == 'playlist' else None
            if entries is not None:
                entries = list(entries)
                info['entries'] = entries
                for i, e in enumerate(entries, 1):
                    if e.get('xy_image') and e.get('id'):
                        e['id'] = f'{e["id"]}_{i}'
                if any(e.get('xy_image') for e in entries):
                    info['xy_gallery'] = True
            elif info.get('xy_image'):
                return _xy_gallery(self, [info], info.get('id'), info.get('title'),
                                   uploader=info.get('uploader'), description=info.get('description'))
            return info
