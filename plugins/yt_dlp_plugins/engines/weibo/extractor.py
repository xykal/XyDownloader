"""Weibo 微博 custom extractor; no login or DRM bypass."""
from ..shared import (
    _YtDlpWeiboIE,
    _first_line,
    _xy_gallery,
    _xy_image,
    _xy_live,
    clean_html,
    traverse_obj,
    url_or_none,
)

if _YtDlpWeiboIE is not None:
    class XyWeiboIE(_YtDlpWeiboIE):
        IE_NAME = 'xy:weibo'
        IE_DESC = 'Weibo 微博 (DownloadAja: video + foto + livephoto)'
        _EMBED_REGEX = []
        _TESTS = []

        def _pic_entry(self, pic, idx, title, headers, user):
            if not isinstance(pic, dict):
                return None
            best = traverse_obj(pic, (('largest', 'mw2000', 'original', 'large', 'bmiddle'), {dict}), get_all=False) or {}
            src = url_or_none(best.get('url'))
            if not src:
                return None
            thumb = traverse_obj(pic, (('bmiddle', 'thumbnail'), 'url', {url_or_none}), get_all=False)
            w, h = best.get('width'), best.get('height')
            # livephoto: URL "media/play" Weibo me-redirect ke file bertanda tangan baru di livephoto.*.sinaimg.cn
            # (URL .mov mentah tanpa tanda tangan ditolak 403). video_hd = resolusi lebih tinggi.
            video = url_or_none(pic.get('video_hd')) or url_or_none(pic.get('video'))
            if pic.get('type') == 'livephoto' and video:
                return _xy_live(f'{pic.get("pic_id") or idx}', f'{title} ({idx})', src, video, w, h, thumb=thumb,
                                headers=headers, motion_ext='mp4', uploader=user)
            return _xy_image(f'{pic.get("pic_id") or idx}', f'{title} ({idx})', src, w, h, thumb=thumb,
                             headers=headers, uploader=user)

        def _real_extract(self, url):
            video_id = self._match_id(url)
            meta = self._weibo_download_json(
                'https://weibo.com/ajax/statuses/show', video_id, query={'id': video_id})
            mix = traverse_obj(meta, ('mix_media_info', 'items', lambda _, v: isinstance(v, dict))) or []
            pic_infos = meta.get('pic_infos') or {}
            if not pic_infos and not any(m.get('type') == 'pic' for m in mix):
                if not mix:
                    return self._parse_video_info(meta)
                return self.playlist_result(self._entries(mix), video_id)

            text = clean_html(meta.get('text_raw') or meta.get('text') or '') or ''
            user = traverse_obj(meta, ('user', 'screen_name', {str}))
            title = _first_line(text) or f'Weibo {video_id}'
            headers = {'Referer': 'https://weibo.com/'}
            entries = []
            if mix:
                for i, item in enumerate(mix, 1):
                    if item.get('type') == 'pic':
                        entries.append(self._pic_entry(item.get('data'), i, title, headers, user))
                    else:
                        entries.append(self._parse_video_info(traverse_obj(item, {
                            'id': ('data', 'object_id'),
                            'page_info': {'media_info': ('data', 'media_info', {dict})},
                        })))
            else:
                for i, pid in enumerate(meta.get('pic_ids') or list(pic_infos), 1):
                    entries.append(self._pic_entry(pic_infos.get(pid), i, title, headers, user))
                if traverse_obj(meta, ('page_info', 'media_info')):  # foto + video dalam satu postingan
                    entries.append(self._parse_video_info(meta))
            return _xy_gallery(self, entries, video_id, title, uploader=user, description=text or None,
                               webpage_url=url)
