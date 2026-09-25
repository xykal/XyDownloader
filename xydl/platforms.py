"""Katalog platform yang ditampilkan di web & dipakai untuk deteksi link.

Catatan: ini hanya daftar "unggulan". Engine sebenarnya (yt-dlp + plugin DownloadAja)
mendukung 1.700+ situs — link dari situs yang tidak ada di daftar ini tetap dicoba.
"""
from urllib.parse import urlparse

REGIONS = {
    'id': {'name': 'Indonesia', 'flag': '🇮🇩'},
    'cn': {'name': 'China', 'flag': '🇨🇳'},
    'jp': {'name': 'Jepang', 'flag': '🇯🇵'},
    'sg': {'name': 'Singapura & Asia Tenggara', 'flag': '🇸🇬'},
    'us': {'name': 'Amerika Serikat', 'flag': '🇺🇸'},
    'global': {'name': 'Global', 'flag': '🌐'},
}

# (id, nama, region, [domain], warna brand, catatan)
_PLATFORMS = [
    # --- US ---
    ('youtube', 'YouTube', 'us', ['youtube.com', 'youtu.be', 'youtube-nocookie.com'], '#FF0000',
     'Web: diblokir anti-bot YouTube untuk server cloud. Pakai aplikasi Android.'),
    ('instagram', 'Instagram', 'us', ['instagram.com', 'instagr.am'], '#E1306C', 'Reels & post publik'),
    ('facebook', 'Facebook', 'us', ['facebook.com', 'fb.watch', 'fb.com'], '#1877F2', 'Video & Reels publik'),
    ('twitter', 'X / Twitter', 'us', ['twitter.com', 'x.com', 't.co', 'fxtwitter.com', 'vxtwitter.com'], '#111111', None),
    ('threads', 'Threads', 'us', ['threads.net', 'threads.com'], '#111111', 'Plugin DownloadAja'),
    ('reddit', 'Reddit', 'us', ['reddit.com', 'redd.it'], '#FF4500', 'Web: kadang diblokir, pakai Android'),
    ('pinterest', 'Pinterest', 'us', ['pinterest.com', 'pin.it'], '#E60023', None),
    ('snapchat', 'Snapchat', 'us', ['snapchat.com'], '#FFFC00', 'Spotlight'),
    ('twitch', 'Twitch', 'us', ['twitch.tv'], '#9146FF', 'Clips & VOD'),
    ('vimeo', 'Vimeo', 'us', ['vimeo.com'], '#1AB7EA', 'Web: sering diblokir, pakai Android'),
    ('soundcloud', 'SoundCloud', 'us', ['soundcloud.com'], '#FF5500', 'Audio'),
    ('linkedin', 'LinkedIn', 'us', ['linkedin.com'], '#0A66C2', None),
    ('bluesky', 'Bluesky', 'us', ['bsky.app'], '#1185FE', None),
    ('tumblr', 'Tumblr', 'us', ['tumblr.com'], '#36465D', None),
    ('rumble', 'Rumble', 'us', ['rumble.com'], '#85C742', None),
    ('imgur', 'Imgur', 'us', ['imgur.com'], '#1BB76E', None),
    # --- Global ---
    ('tiktok', 'TikTok', 'global', ['tiktok.com'], '#FE2C55', 'Tanpa watermark'),
    ('dailymotion', 'Dailymotion', 'global', ['dailymotion.com', 'dai.ly'], '#0066DC', None),
    ('kick', 'Kick', 'global', ['kick.com'], '#53FC18', 'Clips & VOD'),
    ('9gag', '9GAG', 'global', ['9gag.com'], '#222222', None),
    # --- China ---
    ('douyin', 'Douyin 抖音', 'cn', ['douyin.com', 'iesdouyin.com'], '#FE2C55',
     'Tanpa watermark. Web kadang ditolak (IP cloud), Android paling stabil.'),
    ('kuaishou', 'Kuaishou 快手', 'cn', ['kuaishou.com', 'chenzhongtech.com', 'gifshow.com'], '#FF4906',
     'Plugin DownloadAja'),
    ('bilibili', 'Bilibili', 'cn', ['bilibili.com', 'b23.tv', 'bilibili.tv'], '#00A1D6',
     'Web: sering diblokir dari server cloud. Paling stabil lewat aplikasi Android.'),
    ('xiaohongshu', 'Xiaohongshu 小红书', 'cn', ['xiaohongshu.com', 'xhslink.com'], '#FF2442',
     'Pakai link share asli (ada xsec_token)'),
    ('weibo', 'Weibo 微博', 'cn', ['weibo.com', 'weibo.cn'], '#E6162D', None),
    ('youku', 'Youku 优酷', 'cn', ['youku.com'], '#1F9CFF', 'Konten gratis'),
    ('vqq', 'Tencent Video', 'cn', ['v.qq.com'], '#FF6A00', 'Konten gratis'),
    ('zhihu', 'Zhihu 知乎', 'cn', ['zhihu.com'], '#0066FF', None),
    ('acfun', 'AcFun', 'cn', ['acfun.cn'], '#FD4C5D', None),
    ('toutiao', 'Toutiao 头条', 'cn', ['toutiao.com'], '#F04142', None),
    ('ixigua', 'Xigua 西瓜视频', 'cn', ['ixigua.com'], '#F04142', 'Kadang butuh cookie'),
    ('netease', 'NetEase Music', 'cn', ['music.163.com'], '#C20C0C', 'Audio'),
    ('huya', 'Huya 虎牙', 'cn', ['huya.com'], '#FF9600', None),
    ('douyu', 'Douyu 斗鱼', 'cn', ['douyu.com', 'douyu.tv'], '#FF7700', None),
    # --- Jepang ---
    ('pixiv', 'pixiv', 'jp', ['pixiv.net'], '#0096FA', 'Ilustrasi & manga resolusi asli, ugoira jadi MP4/GIF'),
    ('niconico', 'Niconico', 'jp', ['nicovideo.jp', 'nico.ms'], '#252525', None),
    # --- Indonesia ---
    ('vidio', 'Vidio', 'id', ['vidio.com'], '#EE2B24', 'Konten gratis (bukan premium/DRM)'),
    ('snackvideo', 'SnackVideo', 'id', ['snackvideo.com', 'sck.io'], '#FFC400', 'Via generic extractor'),
    ('rctiplus', 'RCTI+', 'id', ['rctiplus.com'], '#1D4ED8', 'Konten gratis'),
    ('liputan6', 'Liputan6', 'id', ['liputan6.com'], '#F97316', None),
    ('detik', 'detikcom (20detik)', 'id', ['detik.com'], '#1E3A8A', None),
    ('kompas', 'Kompas', 'id', ['kompas.com', 'kompas.tv'], '#0F4C81', None),
    ('cnnindonesia', 'CNN Indonesia', 'id', ['cnnindonesia.com'], '#CC0000', None),
    # --- Singapura & SEA ---
    ('likee', 'Likee', 'sg', ['likee.video', 'likee.com'], '#FF3C6E', 'Tergantung yt-dlp'),
    ('bigo', 'Bigo Live', 'sg', ['bigo.tv'], '#00DDCC', 'Live'),
    ('mewatch', 'meWATCH', 'sg', ['mewatch.sg'], '#6A1B9A', 'Konten gratis'),
    ('kwai', 'Kwai', 'sg', ['kwai.com'], '#FF7A00', 'Via generic extractor'),
    ('shopee', 'Shopee Video', 'sg', ['shopee.co.id', 'shopee.sg', 'shp.ee'], '#EE4D2D', 'Eksperimental'),
]

PLATFORMS = [
    {'id': p[0], 'name': p[1], 'region': p[2], 'domains': p[3], 'color': p[4], 'note': p[5],
     'logo': f'/logos/{p[0]}.webp'}
    for p in _PLATFORMS
]

_DOMAIN_INDEX = {}
for _p in PLATFORMS:
    for _d in _p['domains']:
        _DOMAIN_INDEX[_d] = _p


def detect_platform(url):
    """Kembalikan dict platform berdasarkan domain URL (atau None)."""
    try:
        host = (urlparse(url).hostname or '').lower()
    except ValueError:
        return None
    parts = host.split('.')
    # cocokkan dari domain terpanjang: v.qq.com -> qq.com
    for i in range(len(parts) - 1):
        cand = '.'.join(parts[i:])
        if cand in _DOMAIN_INDEX:
            return _DOMAIN_INDEX[cand]
    return None


def catalog():
    groups = []
    for rid, meta in REGIONS.items():
        items = [
            {k: p[k] for k in ('id', 'name', 'color', 'note', 'domains', 'logo')}
            for p in PLATFORMS if p['region'] == rid
        ]
        groups.append({'id': rid, **meta, 'platforms': items})
    return {'regions': groups, 'total_featured': len(PLATFORMS), 'engine_sites': '1700+'}
