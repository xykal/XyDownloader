"""Tes offline (tanpa internet) untuk logika pemilihan format & token.

    pip install -r requirements.txt pytest && pytest -q
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('XYDL_SIGNING_KEY', 'test-key')

import pytest  # noqa: E402

from xydl import engine, signer  # noqa: E402
from xydl.platforms import catalog, detect_platform  # noqa: E402


class FakeJar:
    def get_cookie_header(self, url):
        return 'a=1' if 'needcookie' in url else None


class FakeYdl:
    cookiejar = FakeJar()


def ctx(info):
    return engine._Ctx(FakeYdl(), info, 'https://proxy.test', info.get('webpage_url', 'https://example.com/v'))


def fmt(fid, url, **kw):
    base = {'format_id': fid, 'url': url, 'protocol': 'https', 'ext': 'mp4'}
    base.update(kw)
    return base


def test_find_url_from_share_text():
    text = '7.43 复制打开抖音，看看【作品】 https://v.douyin.com/FX6c30f0S_c/ bAg:/ 02/18'
    assert engine.find_url(text) == 'https://v.douyin.com/FX6c30f0S_c/'
    assert engine.find_url('vt.tiktok.com/ZSabc/') == 'https://vt.tiktok.com/ZSabc/'
    assert engine.find_url('halo') is None


def test_signer_roundtrip_and_tamper():
    tok = signer.sign({'u': 'https://a.com/x.mp4', 'h': {'Referer': 'https://a.com/'}})
    assert signer.verify(tok)['u'] == 'https://a.com/x.mp4'
    body, sig = tok.split('.')
    with pytest.raises(signer.TokenError):
        signer.verify(body + '.' + sig[:-2] + 'AA')
    expired = signer.sign({'u': 'x', 'x': 1})
    with pytest.raises(signer.TokenError):
        signer.verify(expired)


def test_muxed_direct_preferred_and_music_track_separate():
    info = {'id': '1', 'title': 'TikTok', 'duration': 10, 'extractor_key': 'TikTok', 'formats': [
        fmt('audio', 'https://v.tiktok.com/music.mp3', ext='mp3', vcodec='none', acodec='mp3'),
        fmt('h264_540p', 'https://v.tiktok.com/540.mp4', vcodec='h264', acodec='aac', width=576, height=1024),
        fmt('bytevc1_720p', 'https://v.tiktok.com/720.mp4', vcodec='h265', acodec='aac', width=720, height=1280),
    ]}
    e = engine.build_entry(ctx(info), info)
    assert [v['label'] for v in e['video']] == ['Normal · 720p', 'Normal · 576p']
    assert all(v['mode'] == 'direct' for v in e['video'])
    assert all(str(v['filename']).startswith('DownloadAja-') for v in e['video'])
    ids = [a['id'] for a in e['audio']]
    assert 'music' in ids and 'mp3-320' in ids
    mp3 = next(a for a in e['audio'] if a['id'] == 'mp3-128')
    assert mp3['sources'][0]['type'] == 'av'  # audio asli video, bukan musik latar


def test_merge_when_video_only_plus_audio():
    info = {'id': '2', 'title': 'Bili', 'extractor_key': 'BiliBili', 'formats': [
        fmt('30280', 'https://upos.bilivideo.com/a.m4s', ext='m4a', vcodec='none', acodec='mp4a.40.2', abr=190),
        fmt('100024', 'https://upos.bilivideo.com/v1080.m4s', vcodec='avc1.640032', acodec='none', width=1920, height=1080),
        fmt('100023', 'https://upos.bilivideo.com/v1080h.m4s', vcodec='hev1.1.6', acodec='none', width=1920, height=1080),
    ]}
    e = engine.build_entry(ctx(info), info)
    v = e['video'][0]
    assert v['label'] == 'Tinggi · 1080p' and v['mode'] == 'merge' and v['codec'] == 'H.264'
    assert v['filename'].startswith('DownloadAja-') and v.get('tier') == 'tinggi'
    assert [s['type'] for s in v['sources']] == ['video', 'audio']
    assert v['ext'] == 'mp4'


def test_video_only_dropped_when_no_audio_to_merge():
    info = {'id': '3', 'title': 'FB', 'extractor_key': 'Facebook', 'formats': [
        fmt('sd', 'https://video.fbcdn.net/sd.mp4'),
        fmt('hd', 'https://video.fbcdn.net/hd.mp4'),
        fmt('480v', 'https://video.fbcdn.net/480.mp4', vcodec='vp09', acodec='none', width=480, height=848),
    ]}
    e = engine.build_entry(ctx(info), info)
    assert [v['label'] for v in e['video']] == ['Normal · HD', 'Hemat · SD']


def test_images_and_drm_ignored_and_hls_proxied():
    info = {'id': '4', 'title': 'Weibo', 'formats': [
        fmt('scrubber', 'https://w.cn/s.jpg', ext='jpg', width=320, height=180),
        fmt('drm', 'https://w.cn/d.mp4', has_drm=True, width=1920, height=1080),
        fmt('hls-720', 'https://w.cn/720.m3u8', protocol='m3u8_native', width=1280, height=720),
    ]}
    e = engine.build_entry(ctx(info), info)
    assert [v['label'] for v in e['video']] == ['Normal · 720p']
    src = e['video'][0]['sources'][0]
    assert src['proto'] == 'hls' and src['url'].startswith('https://proxy.test/m3u8?t=')


def test_ip_bound_youtube_goes_through_server_and_prefers_dash():
    info = {'id': 'yt', 'title': 'YT', 'extractor_key': 'Youtube', 'webpage_url': 'https://www.youtube.com/watch?v=yt',
            'formats': [
                fmt('18', 'https://rr1.googlevideo.com/18', vcodec='avc1', acodec='mp4a', width=640, height=360),
                fmt('134', 'https://rr1.googlevideo.com/134', vcodec='avc1', acodec='none', width=640, height=360),
                fmt('140', 'https://rr1.googlevideo.com/140', ext='m4a', vcodec='none', acodec='mp4a.40.2', abr=129),
            ]}
    e = engine.build_entry(ctx(info), info)
    v = e['video'][0]
    assert v['mode'] == 'merge'
    assert all(s['via'] == 'server' and s['url'].startswith('/api/stream?t=') for s in v['sources'])
    payload = signer.verify(v['sources'][0]['url'].split('t=', 1)[1])
    assert payload['fid'] == '134' and payload['k'] == 'video' and payload['h'] == 360


def test_pick_similar_format():
    fmts = [
        fmt('133', 'https://g/133', vcodec='avc1', acodec='none', width=426, height=240),
        fmt('134', 'https://g/134', vcodec='avc1', acodec='none', width=640, height=360),
        fmt('140', 'https://g/140', ext='m4a', vcodec='none', acodec='mp4a', abr=129),
    ]
    assert engine._pick_similar(fmts, {'k': 'video', 'h': 360, 'e': 'mp4'})['format_id'] == '134'
    assert engine._pick_similar(fmts, {'k': 'audio', 'e': 'm4a'})['format_id'] == '140'
    assert engine._pick_similar(fmts, {'k': 'av', 'h': 360}) is None


def test_cookie_header_forwarded_in_token():
    info = {'id': '5', 'title': 'Douyin', 'formats': [
        fmt('play', 'https://www.douyin.com/aweme/v1/play/?needcookie=1', vcodec='h264', acodec='aac', width=1080, height=1920),
    ]}
    e = engine.build_entry(ctx(info), info)
    tok = e['video'][0]['sources'][0]['url'].split('t=', 1)[1]
    payload = signer.verify(tok)
    assert payload['h'].get('Cookie') == 'a=1'
    assert payload['a'] == ['douyin.com']


def test_platform_detection_and_catalog():
    assert detect_platform('https://v.douyin.com/abc')['id'] == 'douyin'
    assert detect_platform('https://www.kuaishou.com/short-video/x')['id'] == 'kuaishou'
    assert detect_platform('https://x.com/a/status/1')['id'] == 'twitter'
    assert detect_platform('https://v.qq.com/x/page/a.html')['id'] == 'vqq'
    regions = {r['id'] for r in catalog()['regions']}
    assert regions == {'id', 'cn', 'jp', 'sg', 'us', 'global'}
    assert detect_platform('https://www.pixiv.net/artworks/1')['id'] == 'pixiv'


def test_site_suffix():
    assert engine.site_suffix('v16-webapp.tiktok.com') == 'tiktok.com'
    assert engine.site_suffix('a.b.co.id') == 'b.co.id'
    assert engine.site_suffix('upos-sz.bilivideo.com') == 'bilivideo.com'


def test_friendly_errors():
    assert engine.friendly_error("Sign in to confirm you're not a bot")[0] == 'blocked'
    assert engine.friendly_error('HTTP Error 412: Precondition Failed')[0] == 'blocked'
    assert engine.friendly_error('Unsupported URL: https://x')[0] == 'unsupported'
    assert engine.friendly_error('This video is private')[0] == 'private'
    assert engine.friendly_error('HTTP Error 404: Not Found')[0] == 'notfound'


def test_pixiv_gallery_and_ugoira():
    img = {'id': '1_p0', 'title': 'Karya p1', 'xy_image': True, 'thumbnail': 'https://i.pximg.net/s.jpg',
           'webpage_url': 'https://www.pixiv.net/artworks/1',
           'formats': [fmt('original', 'https://i.pximg.net/img-original/1_p0.png', ext='png', width=1400, height=1900,
                           http_headers={'Referer': 'https://www.pixiv.net/'})]}
    e = engine.build_gallery(FakeYdl(), img, [img], 'https://proxy.test', img['webpage_url'])
    assert not e['video'] and not e['audio'] and len(e['gallery']) == 1
    it = e['gallery'][0]
    assert it['type'] == 'image' and it['image']['ext'] == 'png' and it['width'] == 1400
    assert it['image']['filename'].startswith('DownloadAja-') and it['image']['filename'].endswith('.png')
    payload = signer.verify(it['image']['url'].split('t=', 1)[1])
    assert payload['h']['Referer'] == 'https://www.pixiv.net/' and payload['a'] == ['pximg.net']

    ug = {'id': '2', 'title': 'Anim', 'duration': 0.75, 'webpage_url': 'https://www.pixiv.net/artworks/2',
          'xy_ugoira': {'frames': [{'file': '000000.jpg', 'delay': 120}, {'file': '000001.jpg', 'delay': 130}]},
          'formats': [fmt('ugoira', 'https://i.pximg.net/img-zip-ugoira/2.zip', ext='bin', width=720, height=720)]}
    e = engine.build_entry(ctx(ug), ug)
    assert [v['ext'] for v in e['video']] == ['mp4', 'gif']
    assert all(v['mode'] == 'ugoira' for v in e['video'])
    assert len(e['ugoira']['frames']) == 2 and 'gallery' not in e


def test_mixed_gallery_live_photo_and_music():
    hdr = {'Referer': 'https://www.douyin.com/'}
    photo = {'id': 'n_1', 'title': 'Slide (1)', 'xy_image': True,
             'formats': [fmt('image', 'https://p3.douyinpic.com/a.jpeg', ext='jpg', width=1080, height=1440,
                             http_headers=hdr)]}
    live = {'id': 'n_2', 'title': 'Slide (2)', 'xy_image': True, 'xy_live': True, 'duration': 3,
            'formats': [fmt('image', 'https://p3.douyinpic.com/b.jpeg', ext='jpg', width=1080, height=1440,
                            http_headers=hdr),
                        fmt('live', 'https://v26.douyinvod.com/b.mp4', ext='mp4', http_headers=hdr)]}
    video = {'id': 'n_3', 'title': 'Slide (3)', 'thumbnail': 'https://p3.douyinpic.com/c.jpg',
             'formats': [fmt('hd', 'https://v26.douyinvod.com/c-720.mp4', width=720, height=1280,
                             vcodec='h264', acodec='aac'),
                         fmt('sd', 'https://v26.douyinvod.com/c-360.mp4', width=360, height=640,
                             vcodec='h264', acodec='aac')]}
    pl = {'_type': 'playlist', 'id': 'n', 'title': 'Slide', 'xy_gallery': True,
          'xy_audio': {'url': 'https://sf.douyinstatic.com/m.mp3', 'ext': 'mp3', 'http_headers': hdr},
          'entries': [photo, live, video]}
    e = engine.build_gallery(FakeYdl(), pl, pl['entries'], 'https://proxy.test', 'https://www.douyin.com/note/n')
    types = [it['type'] for it in e['gallery']]
    assert types == ['image', 'live', 'video']
    assert e['gallery'][1]['video']['filename'].startswith('DownloadAja-') and 'live' in e['gallery'][1]['video']['filename']
    assert e['gallery'][2]['video']['filename'].startswith('DownloadAja-') and e['gallery'][2]['width'] == 720
    assert e['gallery'][2]['video']['mode'] == 'direct'
    assert [a['id'] for a in e['audio']] == ['music']  # sudah MP3 -> tanpa konversi


def test_preview_prefers_light_muxed_format():
    info = {'id': 'v', 'title': 'Video', 'duration': 30, 'webpage_url': 'https://example.com/v',
            'formats': [fmt('1080', 'https://cdn.example.com/1080.mp4', width=1920, height=1080,
                            vcodec='avc1', acodec='mp4a'),
                        fmt('720', 'https://cdn.example.com/720.mp4', width=1280, height=720,
                            vcodec='avc1', acodec='mp4a'),
                        fmt('360', 'https://cdn.example.com/360.mp4', width=640, height=360,
                            vcodec='avc1', acodec='mp4a')]}
    e = engine.build_entry(ctx(info), info)
    assert e['preview']['type'] == 'av'
    assert signer.verify(e['preview']['url'].split('t=', 1)[1])['u'].endswith('/720.mp4')

    dash = {'id': 'd', 'title': 'Dash', 'webpage_url': 'https://example.com/d',
            'formats': [fmt('v', 'https://cdn.example.com/v480.mp4', width=854, height=480, vcodec='avc1',
                            acodec='none'),
                        fmt('a', 'https://cdn.example.com/a.m4a', ext='m4a', vcodec='none', acodec='mp4a')]}
    e = engine.build_entry(ctx(dash), dash)
    assert e['preview']['type'] == 'pair' and e['preview']['audio']
