"""Ambil logo ASLI tiap platform (ikon aplikasi resmi dari App Store / ikon situs resmi).

Output: public/logos/<id>.webp (96x96) — dipakai web & disalin ke Android oleh sync_android.py.
Jalankan manual kalau ada platform baru:  python scripts/fetch_logos.py [id ...]

Logo & merek adalah milik pemiliknya masing-masing; dipakai hanya untuk menunjukkan kompatibilitas.
"""
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'logos')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'

# id: (kata kunci App Store, negara toko, bundleId yang diharapkan atau None, fallback situs)
APPS = {
    'youtube': ('YouTube', 'us', 'com.google.ios.youtube', None),
    'instagram': ('Instagram', 'us', 'com.burbn.instagram', None),
    'facebook': ('Facebook', 'us', 'com.facebook.Facebook', None),
    'twitter': ('X', 'us', 'com.atebits.Tweetie2', None),
    'threads': ('Threads', 'us', 'com.burbn.barcelona', None),
    'reddit': ('Reddit', 'us', 'com.reddit.Reddit', None),
    'pinterest': ('Pinterest', 'us', 'pinterest', None),
    'snapchat': ('Snapchat', 'us', 'com.toyopagroup.picaboo', None),
    'twitch': ('Twitch', 'us', 'tv.twitch', None),
    'vimeo': ('Vimeo', 'us', None, None),
    'soundcloud': ('SoundCloud', 'us', 'com.soundcloud.TouchApp', None),
    'linkedin': ('LinkedIn', 'us', 'com.linkedin.LinkedIn', None),
    'bluesky': ('Bluesky Social', 'us', 'xyz.blueskyweb.app', None),
    'tumblr': ('Tumblr', 'us', 'com.tumblr.tumblr', None),
    'rumble': ('Rumble', 'us', None, None),
    'imgur': ('Imgur', 'us', None, None),
    'tiktok': ('TikTok', 'us', 'com.zhiliaoapp.musically', None),
    'dailymotion': ('Dailymotion', 'us', None, None),
    'kick': ('Kick Streaming', 'us', None, 'https://kick.com/'),
    '9gag': ('9GAG', 'us', None, None),
    'douyin': ('抖音', 'cn', 'com.ss.iphone.ugc.Aweme', None),
    'kuaishou': ('快手', 'cn', 'com.jiangjia.gif', None),
    'bilibili': ('哔哩哔哩', 'cn', 'tv.danmaku.bilianime', None),
    'xiaohongshu': ('小红书', 'cn', 'com.xingin.discover', None),
    'weibo': ('微博', 'cn', 'com.sina.weibo', None),
    'youku': ('优酷视频', 'cn', None, None),
    'vqq': (None, None, None, 'https://vfiles.gtimg.cn/wuji_dashboard/xy/starter/4ea79867.png'),
    'zhihu': ('知乎', 'cn', 'com.zhihu.ios', None),
    'acfun': ('AcFun', 'cn', None, None),
    'toutiao': ('今日头条', 'cn', None, None),
    'ixigua': ('西瓜视频', 'cn', None, None),
    'netease': ('网易云音乐', 'cn', 'com.netease.cloudmusic', None),
    'huya': ('虎牙直播', 'cn', None, None),
    'douyu': ('斗鱼', 'cn', None, None),
    'vidio': ('Vidio', 'id', None, None),
    'snackvideo': ('SnackVideo', 'id', None, None),
    'rctiplus': ('RCTI+', 'id', None, None),
    'liputan6': ('Liputan6', 'id', None, None),
    'detik': ('detikcom', 'id', None, None),
    'kompas': ('Kompas.com', 'id', None, None),
    'cnnindonesia': ('CNN Indonesia', 'id', None, None),
    'likee': ('Likee', 'sg', None, None),
    # ikon App Store Bigo & Tencent Video sedang versi promo musiman -> pakai ikon resmi dari situsnya
    'bigo': (None, None, None, 'https://static-web.hzmk.site/as/bigo-static/www.bigo.tv/img/logo_icon2.png'),
    'mewatch': ('meWATCH', 'sg', None, None),
    'kwai': ('Kwai', 'br', None, None),
    'shopee': ('Shopee', 'id', None, None),
    'pixiv': ('pixiv', 'jp', 'jp.pxv.iphone', None),
    'niconico': ('ニコニコ', 'jp', None, 'https://www.nicovideo.jp/'),
}


def http(url, accept=None):
    req = urllib.request.Request(url, headers={'User-Agent': UA, **({'Accept': accept} if accept else {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def from_app_store(term, country, bundle):
    q = urllib.parse.urlencode({'term': term, 'country': country, 'entity': 'software', 'limit': 15})
    results = json.loads(http(f'https://itunes.apple.com/search?{q}'))['results']
    pick = None
    if bundle:
        pick = next((r for r in results if r.get('bundleId', '').lower() == bundle.lower()), None)
    if pick is None:
        t = term.casefold()
        pick = next((r for r in results if r.get('trackName', '').casefold().startswith(t)), None) or \
            next((r for r in results if t in r.get('trackName', '').casefold()), None)
    if pick is None:
        raise LookupError(f'tidak ketemu di App Store: {term} ({country})')
    art = pick.get('artworkUrl512') or pick.get('artworkUrl100')
    art = re.sub(r'/\d+x\d+bb\.(jpg|png|webp)$', '/256x256bb.png', art)
    return http(art), f"{pick.get('trackName')} [{pick.get('bundleId')}] — {pick.get('sellerName')}"


def from_site(url):
    if re.search(r'\.(png|jpe?g|webp|ico)(\?|$)', url, re.I):  # URL ikon langsung
        return http(url), f'official icon {url}'
    html = http(url).decode('utf-8', 'replace')
    cands = []
    for m in re.finditer(r'<link[^>]+>', html, re.I):
        tag = m.group(0)
        rel = re.search(r'rel=["\']([^"\']+)', tag, re.I)
        href = re.search(r'href=["\']([^"\']+)', tag, re.I)
        if not rel or not href or 'icon' not in rel.group(1).lower():
            continue
        size = re.search(r'sizes=["\'](\d+)x', tag)
        score = int(size.group(1)) if size else (180 if 'apple' in rel.group(1).lower() else 32)
        if href.group(1).endswith('.svg'):
            continue
        cands.append((score, urllib.parse.urljoin(url, href.group(1))))
    cands.sort(reverse=True)
    for _, icon in cands:
        try:
            return http(icon), f'site icon {icon}'
        except Exception:
            continue
    host = urllib.parse.urlparse(url).hostname
    return http(f'https://www.google.com/s2/favicons?domain={host}&sz=128'), 'google s2 favicon'


def save(pid, data):
    img = Image.open(io.BytesIO(data)).convert('RGBA')
    img = img.resize((96, 96), Image.LANCZOS)
    img.save(os.path.join(OUT, f'{pid}.webp'), 'WEBP', quality=92, method=6)


def main(ids):
    os.makedirs(OUT, exist_ok=True)
    for pid in ids or APPS:
        term, country, bundle, site = APPS[pid]
        try:
            if term:
                try:
                    data, src = from_app_store(term, country, bundle)
                except LookupError:
                    if not site:
                        raise
                    data, src = from_site(site)
            else:
                data, src = from_site(site)
            save(pid, data)
            print(f'OK   {pid:13s} {src}')
        except Exception as e:
            print(f'FAIL {pid:13s} {e}')


if __name__ == '__main__':
    main(sys.argv[1:])
