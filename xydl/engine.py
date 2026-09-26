"""DownloadAja engine — yt-dlp + plugin DownloadAja, dinormalisasi jadi JSON rapi.

Alur:
  1. Ambil URL dari teks yang di-paste (share text TikTok/Douyin biasanya ada kalimatnya).
  2. yt-dlp extract_info(download=False)  -> daftar format + header/cookie yang dibutuhkan.
  3. Pilih opsi terbaik per resolusi (video) + opsi audio (MP3 / M4A asli).
  4. Setiap sumber dibungkus jadi link proxy bertanda tangan:
       - Cloudflare Worker  (default, streaming tanpa batas ukuran, dukung Range/resume)
       - /api/stream Vercel (khusus link yang terikat IP server, mis. googlevideo/YouTube)
"""
import ipaddress
import hashlib
import os
import re
import shutil
import socket
import sys
import threading
import time
import urllib.parse
import zipfile

_HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN_DIR = os.path.join(os.path.dirname(_HERE), 'plugins')
if PLUGIN_DIR not in sys.path:
    sys.path.insert(0, PLUGIN_DIR)

# Lingkungan serverless: hanya /tmp yang bisa ditulis
os.environ.setdefault('XDG_CACHE_HOME', '/tmp/xydl-cache')
os.environ.setdefault('DENO_DIR', '/tmp/xydl-deno-cache')
os.environ.setdefault('DENO_NO_UPDATE_CHECK', '1')
if not os.access(os.path.expanduser('~') or '/', os.W_OK):
    os.environ['HOME'] = '/tmp'

import yt_dlp  # noqa: E402
from yt_dlp.networking import Request as YRequest  # noqa: E402

from . import signer  # noqa: E402
from .platforms import detect_platform  # noqa: E402

VERSION = '1.3.1'
URL_RE = re.compile(r'https?://[^\s<>"\'\u3000-\u303f\uff00-\uffef]+', re.I)
IP_BOUND_HOSTS = ('googlevideo.com',)  # URL format YouTube terikat IP server yang meng-extract
MAX_ENTRIES = 12
MAX_GALLERY = 60  # foto slide bisa puluhan (TikTok/Douyin s.d. 35, Weibo/XHS s.d. 18)


# ---------------------------------------------------------------------------
# Util
# ---------------------------------------------------------------------------
def find_url(text):
    if not text:
        return None
    text = text.strip()
    m = URL_RE.search(text)
    if not m:
        if re.match(r'^[\w-]+(\.[\w-]+)+/\S*$', text):  # tanpa skema: "vt.tiktok.com/xxx"
            return 'https://' + text
        return None
    url = m.group(0).rstrip('.,;:!?)]}>\'"')
    return url


def is_public_url(url):
    """Cegah SSRF: tolak host lokal/privat."""
    try:
        p = urllib.parse.urlparse(url)
    except ValueError:
        return False
    if p.scheme not in ('http', 'https') or not p.hostname:
        return False
    host = p.hostname.lower()
    if host in ('localhost',) or host.endswith(('.local', '.internal', '.localhost')):
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return True  # biar yt-dlp yang memberi error "tidak ditemukan"
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if not ip.is_global:
            return False
    return True


def site_suffix(host):
    """'v16-webapp.tiktok.com' -> 'tiktok.com' ; 'a.b.com.cn' -> 'b.com.cn'."""
    host = (host or '').lower().strip('.')
    parts = host.split('.')
    if len(parts) <= 2:
        return host
    two_level = {'co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'go', 'my', 'web', 'sch'}
    if parts[-2] in two_level and len(parts[-1]) == 2:
        return '.'.join(parts[-3:])
    return '.'.join(parts[-2:])


def safe_filename(name, max_len=90):
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f\x7f]+', ' ', str(name or 'video'))
    name = re.sub(r'\s+', ' ', name).strip(' .')
    if len(name) > max_len:
        name = name[:max_len].rstrip() + '…'
    return name or 'video'



def _slug_title(name, max_len=36):
    """Judul aman untuk nama file branded (tanpa spasi aneh)."""
    s = safe_filename(name, max_len=max_len + 10)
    s = re.sub(r'[^A-Za-z0-9\u00c0-\u024f\u0400-\u04ff\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+', '-', s)
    s = re.sub(r'-{2,}', '-', s).strip('-')
    if len(s) > max_len:
        s = s[:max_len].rstrip('-')
    return s or 'file'


def content_id(info, page_url=''):
    """ID stabil pendek dari id platform / hash URL — untuk nama file DownloadAja-…"""
    raw = str(info.get('id') or '').strip()
    if not raw:
        raw = page_url or info.get('webpage_url') or info.get('original_url') or info.get('title') or 'x'
    h = hashlib.sha1(raw.encode('utf-8', 'ignore')).hexdigest()[:8]
    return h


def branded_name(info, title, page_url='', tag='', ext='mp4'):
    """DownloadAja-<slug>-<id>[-tag].ext"""
    slug = _slug_title(title or info.get('title') or 'file')
    cid = content_id(info, page_url)
    base = f'DownloadAja-{slug}-{cid}'
    if tag:
        tag = re.sub(r'[\\/:*?"<>|\s]+', '', str(tag))
        if tag:
            base = f'{base}-{tag}'
    ext = (ext or 'bin').lstrip('.').lower() or 'bin'
    return f'{base}.{ext}'


def quality_tier(q):
    """Label manusiawi di atas resolusi mentah."""
    q = int(q or 0)
    if q <= 0:
        return 'auto'
    if q <= 480:
        return 'hemat'
    if q <= 720:
        return 'normal'
    if q <= 1080:
        return 'tinggi'
    return 'maksimal'


# ---------------------------------------------------------------------------
# JavaScript runtime (dibutuhkan yt-dlp untuk YouTube)
# ---------------------------------------------------------------------------
_DENO_LOCK = threading.Lock()
_DENO_TMP = '/tmp/xydl-deno/deno'


def find_deno():
    cands = [shutil.which('deno'), _DENO_TMP]
    try:
        import deno as _deno_pkg  # pip install deno
        cands.insert(0, _deno_pkg.find_deno_bin())
    except Exception:
        pass
    for p in list(sys.path):
        cands.append(os.path.join(p, 'bin', 'deno'))
        cands.append(os.path.join(os.path.dirname(p), 'bin', 'deno'))
    for c in cands:
        if c and os.path.isfile(c):
            if not os.access(c, os.X_OK):
                try:
                    tmp = _DENO_TMP
                    os.makedirs(os.path.dirname(tmp), exist_ok=True)
                    if c != tmp:
                        shutil.copy2(c, tmp)
                    os.chmod(tmp, 0o755)
                    c = tmp
                except OSError:
                    continue
            return c
    return None


def ensure_deno(download=True):
    path = find_deno()
    if path or not download or not sys.platform.startswith('linux'):
        return path
    with _DENO_LOCK:
        path = find_deno()
        if path:
            return path
        try:
            import urllib.request
            os.makedirs(os.path.dirname(_DENO_TMP), exist_ok=True)
            zpath = _DENO_TMP + '.zip'
            url = 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip'
            with urllib.request.urlopen(url, timeout=40) as r, open(zpath, 'wb') as f:
                shutil.copyfileobj(r, f, 1 << 20)
            with zipfile.ZipFile(zpath) as z:
                z.extract('deno', os.path.dirname(_DENO_TMP))
            os.chmod(_DENO_TMP, 0o755)
            os.remove(zpath)
            return _DENO_TMP
        except Exception as e:  # tanpa deno, YouTube tetap dicoba (format terbatas)
            print('[xydl] gagal download deno:', e, file=sys.stderr)
            return None


def ydl_opts(need_js=False):
    opts = {
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
        'noplaylist': True,
        'playlistend': MAX_ENTRIES,
        'socket_timeout': 20,
        'retries': 2,
        'extractor_retries': 1,
        'cachedir': '/tmp/xydl-cache/yt-dlp',
        'check_formats': False,
        'geo_bypass': True,
        'noprogress': True,
    }
    deno = ensure_deno(download=need_js)
    if deno:
        opts['js_runtimes'] = {'deno': {'path': deno}}
    return opts


def proxy_opts(url):
    """Opsional: XYDL_EXTRACT_PROXY (http/socks5, mis. proxy residensial) untuk domain yang memblokir
    IP cloud. XYDL_PROXY_DOMAINS = daftar domain dipisah koma (default: youtube, bilibili, douyin, reddit)."""
    proxy = os.environ.get('XYDL_EXTRACT_PROXY')
    if not proxy:
        return {}
    domains = [d.strip().lower() for d in os.environ.get(
        'XYDL_PROXY_DOMAINS', 'youtube.com,youtu.be,bilibili.com,b23.tv,douyin.com,reddit.com,redd.it').split(',') if d.strip()]
    host = (urllib.parse.urlparse(url).hostname or '').lower()
    if any(host == d or host.endswith('.' + d) for d in domains):
        return {'proxy': proxy}
    return {}


def _attempt_opts(url):
    """Opsi tambahan per percobaan. X/Twitter: API syndication lebih stabil dari IP server,
    graphql (guest) sebagai cadangan."""
    host = (urllib.parse.urlparse(url).hostname or '').lower()
    if host.endswith(('twitter.com', 'x.com')):
        return [{'extractor_args': {'twitter': {'api': ['syndication']}}},
                {'extractor_args': {'twitter': {'api': ['graphql']}}}]
    return [{}]


def _is_youtube(url):
    host = (urllib.parse.urlparse(url).hostname or '').lower()
    return host.endswith(('youtube.com', 'youtu.be', 'youtube-nocookie.com'))


# ---------------------------------------------------------------------------
# Error ramah pengguna
# ---------------------------------------------------------------------------
def friendly_error(msg):
    m = (msg or '').lower()
    rules = [
        (('unsupported url',), 'unsupported',
         'Link ini belum didukung. Pastikan itu link postingan/video (bukan profil atau halaman utama).'),
        (('confirm you', 'not a bot'), 'blocked',
         'YouTube memblokir server cloud (termasuk server DownloadAja) dengan cek anti-bot. Untuk YouTube, '
         'pakai aplikasi Android DownloadAja — download langsung dari HP kamu, jauh lebih stabil.'),
        (('412', 'precondition failed', 'menolak permintaan', 'butuh verifikasi', 'argus'), 'blocked',
         'Platform ini sedang memblokir IP server cloud kami. Coba lagi beberapa saat lagi, atau pakai aplikasi '
         'Android DownloadAja (download langsung dari HP kamu).'),
        (('drm',), 'drm', 'Konten ini dilindungi DRM (konten premium/berbayar) dan tidak bisa diunduh.'),
        (('private', 'login', 'log in', 'sign in', 'authentication', 'cookies', 'members-only', 'subscriber'),
         'private', 'Konten ini privat / butuh login. DownloadAja hanya bisa mengambil konten publik.'),
        (('geo', 'not available in your country', 'your region', 'country'), 'geo',
         'Konten ini dibatasi wilayah (geo-block).'),
        (('timed out', 'timeout', 'time out'), 'timeout', 'Server platform lambat merespons. Coba lagi sebentar lagi.'),
        (('403', 'forbidden', 'tls fingerprint', 'blocked', 'rate-limit', 'rate limit', '429'), 'blocked',
         'Platform memblokir/membatasi server kami untuk link ini. Coba lagi nanti atau pakai aplikasi Android.'),
        (('404', 'not found', 'unavailable', 'removed', 'deleted', 'does not exist', 'no longer'), 'notfound',
         'Konten tidak ditemukan — mungkin sudah dihapus, privat, atau link-nya salah.'),
        (('no video', 'no formats', 'no media', 'tidak ada video', 'bukan video'), 'novideo',
         'Tidak ada video/audio yang bisa diunduh di postingan ini.'),
    ]
    for keys, code, text in rules:
        if any(k in m for k in keys):
            return code, text
    return 'error', 'Gagal memproses link ini.'


def _clean_error(msg):
    msg = re.sub(r'\x1b\[[0-9;]*m', '', str(msg or ''))
    msg = msg.replace('ERROR: ', '')
    msg = re.sub(r';? ?please report this issue on.*$', '', msg, flags=re.S | re.I)
    return msg.strip()[:400]


class XyError(Exception):
    def __init__(self, code, message, detail=None, status=422):
        super().__init__(message)
        self.code, self.message, self.detail, self.status = code, message, detail, status


# ---------------------------------------------------------------------------
# Analisis format
# ---------------------------------------------------------------------------
_IMAGE_EXTS = {'mhtml', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'avif'}


def _proto(f):
    p = (f.get('protocol') or '').split('+')[0]
    if p in ('http', 'https'):
        return 'direct'
    if p in ('m3u8', 'm3u8_native'):
        return 'hls'
    return None


def _usable(f):
    if not f.get('url') or f.get('has_drm'):
        return False
    if f.get('ext') in _IMAGE_EXTS or 'storyboard' in (f.get('format_note') or '').lower():
        return False
    if (f.get('vcodec') or '').lower() in ('jpeg', 'png', 'gif', 'webp', 'mjpeg'):
        return False
    kind = _proto(f)
    if kind is None:
        return False
    if kind == 'direct' and f.get('fragments'):
        return False
    return True


def _has_video(f):
    if f.get('vcodec') == 'none':
        return False
    # yt-dlp menandai format audio-only dengan video_ext='none' & audio_ext terisi
    if f.get('video_ext') == 'none' and f.get('audio_ext') not in (None, 'none'):
        return False
    return True


def _has_audio(f):
    # catatan: audio_ext='none' juga dipakai yt-dlp untuk format muxed, jadi jangan dipakai di sini
    return f.get('acodec') != 'none'


def _watermarked(f):
    note = f"{f.get('format_note') or ''} {f.get('format_id') or ''}".lower()
    return 'watermark' in note or note.strip().startswith('download')


def _vcodec_score(f):
    v = (f.get('vcodec') or '').lower()
    if v.startswith(('avc', 'h264')):
        return 4
    if not v:
        return 3.5
    if v.startswith(('hev', 'hvc', 'h265', 'bytevc1')):
        return 3
    if v.startswith('av01'):
        return 2
    if v.startswith(('vp9', 'vp09')):
        return 1.5
    return 1


def _vcodec_label(f):
    v = (f.get('vcodec') or '').lower()
    if v.startswith(('avc', 'h264')):
        return 'H.264'
    if v.startswith(('hev', 'hvc', 'h265', 'bytevc1')):
        return 'HEVC'
    if v.startswith('av01'):
        return 'AV1'
    if v.startswith(('vp9', 'vp09')):
        return 'VP9'
    return None


def _size(f):
    return f.get('filesize') or f.get('filesize_approx')


def _short_side(f):
    w, h = f.get('width'), f.get('height')
    if w and h:
        return min(w, h)
    if h or w:
        return h or w
    # resolusi tidak diketahui: tebak dari format_id/format_note (Facebook: 'hd'/'sd')
    hint = f"{f.get('format_id') or ''} {f.get('format_note') or ''}".lower()
    if re.search(r'\bhd\b', hint):
        return 719
    if re.search(r'\bsd\b', hint):
        return 359
    return 0


def _quality_label(q):
    if q == 719:
        return 'HD'
    if q == 359:
        return 'SD'
    return f'{q}p' if q else 'Video'


def _audio_ext(f):
    a = (f.get('acodec') or '').lower()
    if a.startswith('mp4a') or f.get('ext') in ('m4a', 'mp4', 'aac'):
        return 'm4a'
    if a.startswith('opus') or f.get('ext') == 'webm':
        return 'webm'
    if a.startswith('mp3') or f.get('ext') == 'mp3':
        return 'mp3'
    return f.get('ext') or 'm4a'


class _Ctx:
    """Konteks pembuatan link (butuh instance YoutubeDL untuk cookie)."""

    def __init__(self, ydl, info, proxy_base, page_url):
        self.ydl, self.info, self.proxy_base, self.page_url = ydl, info, proxy_base.rstrip('/'), page_url

    def headers_for(self, f):
        h = {}
        for k, v in (f.get('http_headers') or {}).items():
            if k.lower() in ('accept-encoding', 'host', 'content-length'):
                continue
            h[k] = v
        try:
            cookie = self.ydl.cookiejar.get_cookie_header(f['url'])
        except Exception:
            cookie = None
        if cookie:
            h['Cookie'] = cookie
        return h

    def source(self, f, kind, filename):
        url = f['url']
        host = (urllib.parse.urlparse(url).hostname or '').lower()
        proto = _proto(f)
        src = {'type': kind, 'proto': proto, 'ext': f.get('ext'), 'size': _size(f), 'format_id': f.get('format_id')}
        meta = {'s': self.page_url, 'fid': f.get('format_id'), 'f': filename, 'k': kind,
                'h': _short_side(f), 'e': f.get('ext')}
        if host.endswith(IP_BOUND_HOSTS):
            src.update(via='server', url=f'/api/stream?t={signer.sign(meta)}')
            return src
        token = signer.sign({'u': url, 'h': self.headers_for(f), 'f': filename, 'a': [site_suffix(host)]})
        if proto == 'hls':
            src.update(via='proxy', url=f'{self.proxy_base}/m3u8?t={token}')
        else:
            src.update(via='proxy', url=f'{self.proxy_base}/f/{urllib.parse.quote(filename)}?t={token}')
            if f.get('format_id'):
                # jalur cadangan kalau CDN menolak IP Cloudflare: stream lewat Vercel
                src['alt'] = f'/api/stream?t={signer.sign(meta)}'
        return src

    def thumb(self, url):
        if not url:
            return None
        host = (urllib.parse.urlparse(url).hostname or '').lower()
        headers = {'User-Agent': 'Mozilla/5.0'}
        page_host = urllib.parse.urlparse(self.page_url).hostname
        if page_host:
            headers['Referer'] = f'https://{page_host}/'
        token = signer.sign({'u': url, 'h': headers, 'a': [site_suffix(host)], 'ct': 'image/jpeg'}, ttl=24 * 3600)
        return f'{self.proxy_base}/f/thumb.jpg?t={token}'


def _entry_meta(ctx, info, title):
    return {
        'id': info.get('id'),
        'title': title,
        'uploader': info.get('uploader') or info.get('channel') or info.get('uploader_id'),
        'duration': info.get('duration'),
        'thumbnail': ctx.thumb(info.get('thumbnail') or next(
            (t.get('url') for t in reversed(info.get('thumbnails') or []) if t.get('url')), None)),
        'webpage_url': info.get('webpage_url') or ctx.page_url,
        'extractor': info.get('extractor_key') or info.get('extractor'),
        'is_live': bool(info.get('is_live')),
        'video': [],
        'audio': [],
    }



def _build_ugoira_entry(ctx, info, title, base_name):
    """Ugoira pixiv: ZIP berisi frame + delay -> dikonversi ke MP4/GIF di browser (ffmpeg.wasm)."""
    entry = _entry_meta(ctx, info, title)
    fmt = next((f for f in info.get('formats') or [] if f.get('url')), None)
    if fmt is None:
        return entry
    src = ctx.source(fmt, 'frames', branded_name(info, title, ctx.page_url, tag='ugoira', ext='zip'))
    frames = (info.get('xy_ugoira') or {}).get('frames') or []
    entry['ugoira'] = {'frames': frames}
    q = _short_side(fmt)
    for ext, label, codec in (('mp4', 'MP4', 'H.264'), ('gif', 'GIF', None)):
        entry['video'].append({
            'id': f'ugoira-{ext}', 'label': label, 'quality': q, 'ext': ext, 'codec': codec, 'size': None,
            'no_audio': False, 'mode': 'ugoira', 'filename': branded_name(info, title, ctx.page_url, tag=ext, ext=ext), 'sources': [src],
        })
    return entry


def _is_gallery_item(info):
    return bool(info.get('xy_image') or info.get('xy_live'))


def _media_src(ctx, f, kind, filename):
    """Sumber ringkas untuk item galeri / pratinjau."""
    src = ctx.source(f, kind, filename)
    out = {'url': src['url'], 'ext': f.get('ext'), 'filename': filename, 'size': _size(f), 'via': src['via'],
           'proto': src['proto']}
    if src.get('alt'):
        out['alt'] = src['alt']
    return out


def _pick_preview(formats, best_audio=None):
    """Format ringan (<=720p) untuk diputar sebelum download."""
    fm = [f for f in formats if _usable(f) and _has_video(f)]

    def near720(f):
        q = _short_side(f) or 0
        return (q <= 720, q if q <= 720 else -q, _vcodec_score(f))

    muxed = [f for f in fm if _has_audio(f) and not _watermarked(f)]
    direct = [f for f in muxed if _proto(f) == 'direct']
    if direct:
        return ('av', max(direct, key=near720), None)
    hls = [f for f in muxed if _proto(f) == 'hls']
    if hls:
        return ('hls', max(hls, key=near720), None)
    vonly = [f for f in fm if not _has_audio(f) and _proto(f) == 'direct' and _vcodec_score(f) >= 1.5]
    if vonly and best_audio is not None and _proto(best_audio) == 'direct':
        return ('pair', max(vonly, key=near720), best_audio)
    return None


def _preview_payload(ctx, info, formats, best_audio, base_name):
    pick = _pick_preview(formats, best_audio)
    if not pick:
        return None
    kind, f, a = pick
    v = _media_src(ctx, f, 'av' if kind != 'pair' else 'video', branded_name(info, base_name, ctx.page_url, tag='preview', ext=f.get('ext') or 'mp4'))
    if v['via'] == 'server':  # stream lewat Vercel terlalu berat untuk pratinjau
        return None
    out = {'type': kind, 'url': v['url'], 'alt': v.get('alt'), 'width': f.get('width'), 'height': f.get('height')}
    if a is not None:
        au = _media_src(ctx, a, 'audio', branded_name(info, base_name, ctx.page_url, tag='preview-a', ext=_audio_ext(a)))
        if au['via'] == 'server':
            return None
        out['audio'] = au['url']
    return out


def _gallery_item(ctx, e, idx, base_name, total):
    fmts = [f for f in (e.get('formats') or []) if f.get('url')]
    num = f' ({idx})' if total > 1 else ''
    thumb_url = e.get('thumbnail') or next((t.get('url') for t in reversed(e.get('thumbnails') or [])
                                            if t.get('url')), None)
    item = {'index': idx, 'id': e.get('id'), 'title': e.get('title'), 'thumb': None,
            'width': None, 'height': None, 'duration': e.get('duration')}
    if _is_gallery_item(e):
        img = next((f for f in fmts if f.get('format_id') == 'image'), None) or (fmts[0] if fmts else None)
        if img is None:
            return None
        ext = (img.get('ext') or 'jpg').lower()
        item.update(type='image', width=img.get('width'), height=img.get('height'))
        item['image'] = _media_src(ctx, img, 'image', branded_name(e, e.get('title') or base_name, ctx.page_url, tag=(f'p{idx:02d}' if total > 1 else 'img'), ext=ext))
        item['thumb'] = ctx.thumb(thumb_url or img['url'])
        live = next((f for f in fmts if f.get('format_id') == 'live'), None) if e.get('xy_live') else None
        if live is not None:
            v_ext = (live.get('ext') or 'mp4').lower()
            item['type'] = 'live'
            item['video'] = _media_src(ctx, live, 'av', branded_name(e, e.get('title') or base_name, ctx.page_url, tag=(f'p{idx:02d}-live' if total > 1 else 'live'), ext=v_ext))
        return item
    # video di dalam carousel: pilih format muxed siap-putar terbaik (<=1080p)
    cands = [f for f in fmts if _usable(f) and _has_video(f) and _has_audio(f) and not _watermarked(f)]
    if not cands:
        cands = [f for f in fmts if _usable(f) and _has_video(f)]
    if not cands:
        return None

    def vk(f):
        q = _short_side(f) or 0
        return (_proto(f) == 'direct', q <= 1080, q if q <= 1080 else -q, _vcodec_score(f), f.get('tbr') or 0)

    best = max(cands, key=vk)
    v_ext = 'mp4' if (_proto(best) == 'hls' or (best.get('ext') in (None, 'mp4', 'm4v', 'unknown_video'))) \
        else best.get('ext')
    item.update(type='video', width=best.get('width'), height=best.get('height'))
    item['video'] = _media_src(ctx, best, 'av', branded_name(e, e.get('title') or base_name, ctx.page_url, tag=(f'p{idx:02d}' if total > 1 else 'vid'), ext=v_ext))
    item['video']['mode'] = 'hls' if _proto(best) == 'hls' else ('fetch' if item['video']['via'] == 'server'
                                                               else 'direct')
    item['thumb'] = ctx.thumb(thumb_url)
    return item


def build_gallery(ydl, info, entries, proxy_base, page_url):
    """Foto slide / carousel / Live Photo -> satu kartu galeri berisi item yang bisa dipilih."""
    ctx = _Ctx(ydl, info, proxy_base, page_url)
    title = info.get('title') or (entries[0].get('title') if entries else None) or 'galeri'
    base_name = safe_filename(title)
    head = entries[0] if entries else info
    entry = _entry_meta(ctx, {**head, **{k: info.get(k) for k in ('id', 'title', 'uploader', 'webpage_url')
                                        if info.get(k)}}, title)
    entry['thumbnail'] = entry['thumbnail'] or (ctx.thumb(info.get('thumbnail')) if info.get('thumbnail') else None)
    entry['duration'] = None
    items = []
    for idx, e in enumerate(entries[:MAX_GALLERY], 1):
        ectx = _Ctx(ydl, e, proxy_base, e.get('webpage_url') or page_url)
        it = _gallery_item(ectx, e, idx, base_name, len(entries))
        if it:
            items.append(it)
    entry['gallery'] = items
    if not entry['thumbnail'] and items:
        entry['thumbnail'] = items[0]['thumb']
    music = info.get('xy_audio') or {}
    if music.get('url'):
        a_ext = (music.get('ext') or 'mp3').lower()
        fmt = {'url': music['url'], 'ext': a_ext, 'format_id': 'music', 'protocol': 'https',
               'http_headers': music.get('http_headers') or {}, 'vcodec': 'none', 'acodec': a_ext}
        src = ctx.source(fmt, 'audio', branded_name(info, title, ctx.page_url, tag='musik', ext=a_ext))
        if a_ext != 'mp3':
            entry['audio'].append({
                'id': 'music-mp3', 'label': 'Musik latar (MP3)', 'kind': 'mp3', 'bitrate': 192, 'ext': 'mp3',
                'mode': 'mp3', 'filename': branded_name(info, title, ctx.page_url, tag='musik-mp3', ext='mp3'), 'sources': [src], 'size': None})
        entry['audio'].append({
            'id': 'music', 'label': f'Musik latar ({a_ext.upper()})', 'kind': 'original', 'ext': a_ext,
            'filename': branded_name(info, title, ctx.page_url, tag='musik', ext=a_ext), 'sources': [src], 'mode': 'direct', 'size': None})
    return entry


def build_entry(ctx, info):
    title = info.get('title') or info.get('id') or 'video'
    base_name = safe_filename(title)
    if info.get('xy_ugoira'):
        return _build_ugoira_entry(ctx, info, title, base_name)
    formats = [f for f in (info.get('formats') or ([info] if info.get('url') else [])) if _usable(f)]

    videos = [f for f in formats if _has_video(f)]
    audios = [f for f in formats if not _has_video(f) and _has_audio(f)]
    if any(not _watermarked(f) for f in videos):
        videos = [f for f in videos if not _watermarked(f)]

    def audio_key(f):
        return (_proto(f) == 'direct', _audio_ext(f) == 'm4a', f.get('abr') or f.get('tbr') or 0)

    best_audio = max(audios, key=audio_key) if audios else None
    muxed_videos = [f for f in videos if _has_audio(f)]
    # TikTok/Douyin: format audio-only = musik latar (bukan audio asli video) -> jangan dipakai untuk merge/MP3
    music_track = None
    if best_audio is not None and muxed_videos and (best_audio.get('format_id') in ('audio', 'music')):
        music_track, best_audio = best_audio, None
    # Tidak ada audio terpisah untuk di-merge -> buang format video-only (hasilnya bisu) kalau ada versi muxed
    if best_audio is None and muxed_videos:
        videos = muxed_videos
    # YouTube: format muxed (mis. 18) sering hilang-timbul antar request -> pakai DASH (video + audio) yang stabil
    if best_audio is not None and 'youtube' in (info.get('extractor_key') or '').lower():
        videos = [f for f in videos if not _has_audio(f)] or videos

    # ---- opsi video per resolusi ------------------------------------------------
    buckets = {}
    for f in videos:
        buckets.setdefault(_short_side(f), []).append(f)

    def vkey(f):
        muxed = _has_audio(f)
        direct = _proto(f) == 'direct'
        return (
            direct and (muxed or best_audio is not None),  # bisa langsung / bisa di-merge
            muxed,
            _vcodec_score(f),
            f.get('fps') or 0,
            f.get('tbr') or 0,
            _size(f) or 0,
        )

    video_options = []
    for q in sorted(buckets, reverse=True):
        f = max(buckets[q], key=vkey)
        muxed = _has_audio(f)
        raw_label = _quality_label(q)
        fps = int(f['fps']) if f.get('fps') and f['fps'] > 30 else None
        if fps:
            raw_label += f'{fps}'
        tier = quality_tier(q)
        # Label UI: "Normal · 720p" agar ada pilihan manusiawi, bukan cuma angka
        if q and tier in ('hemat', 'normal', 'tinggi', 'maksimal'):
            label = f'{tier.capitalize()} · {raw_label}'
        else:
            label = raw_label
        need_audio = not muxed and best_audio is not None
        if need_audio:
            a_ext = _audio_ext(best_audio)
            v_ext = f.get('ext') or 'mp4'
            ext = 'mp4' if (v_ext in ('mp4', 'm4v') and a_ext == 'm4a') else ('webm' if v_ext == 'webm' and a_ext == 'webm' else 'mkv')
        else:
            ext = 'mp4' if (f.get('ext') in (None, 'mp4', 'm4v', 'unknown_video') or _proto(f) == 'hls') else f.get('ext')
        tag = raw_label if raw_label and raw_label != 'Video' else (tier if tier != 'auto' else 'video')
        filename = branded_name(info, title, ctx.page_url, tag=tag, ext=ext)
        sources = [ctx.source(f, 'av' if muxed else 'video', filename)]
        if need_audio:
            sources.append(ctx.source(best_audio, 'audio', branded_name(info, title, ctx.page_url, tag='audio', ext=_audio_ext(best_audio))))
        protos = {s['proto'] for s in sources}
        vias = {s['via'] for s in sources}
        if len(sources) > 1:
            mode = 'merge'
        elif 'hls' in protos:
            mode = 'hls'
        elif 'server' in vias:
            mode = 'fetch'
        else:
            mode = 'direct'
        size = sum(s['size'] for s in sources if s.get('size')) or None
        video_options.append({
            'id': f'v{q}-{f.get("format_id")}',
            'label': label,
            'tier': tier,
            'quality': q,
            'ext': ext,
            'codec': _vcodec_label(f),
            'size': size,
            'no_audio': not muxed and best_audio is None and f.get('acodec') == 'none',
            'mode': mode,
            'filename': filename,
            'sources': sources,
        })
    video_options = video_options[:8]

    # ---- opsi audio ----------------------------------------------------------------
    audio_options = []
    mp3_src_fmt = best_audio
    if mp3_src_fmt is None and muxed_videos:
        mp3_src_fmt = min(muxed_videos, key=lambda f: (_proto(f) != 'direct', _short_side(f) or 9999, _size(f) or 0))
    if mp3_src_fmt is not None:
        src = ctx.source(mp3_src_fmt, 'audio' if mp3_src_fmt is best_audio else 'av', branded_name(info, title, ctx.page_url, tag='mp3', ext='mp3'))
        for kbps in (320, 192, 128):
            audio_options.append({
                'id': f'mp3-{kbps}', 'label': f'MP3 {kbps} kbps', 'kind': 'mp3', 'bitrate': kbps, 'ext': 'mp3',
                'mode': 'mp3', 'filename': branded_name(info, title, ctx.page_url, tag=f'mp3-{kbps}', ext='mp3'), 'sources': [src],
                'size': int((info.get('duration') or 0) * kbps * 125) or None,
            })
    if best_audio is not None:
        a_ext = _audio_ext(best_audio)
        abr = int(best_audio.get('abr') or best_audio.get('tbr') or 0)
        fname = branded_name(info, title, ctx.page_url, tag='asli', ext=a_ext)
        src = ctx.source(best_audio, 'audio', fname)
        audio_options.append({
            'id': 'orig', 'label': f'{a_ext.upper()} asli' + (f' {abr} kbps' if abr else ''),
            'kind': 'original', 'ext': a_ext, 'filename': fname, 'sources': [src],
            'mode': 'hls' if src['proto'] == 'hls' else ('fetch' if src['via'] == 'server' else 'direct'),
            'size': _size(best_audio),
        })

    if music_track is not None:
        fname = branded_name(info, title, ctx.page_url, tag='musik', ext=_audio_ext(music_track))
        src = ctx.source(music_track, 'audio', fname)
        audio_options.append({
            'id': 'music', 'label': f'Musik latar ({_audio_ext(music_track).upper()})', 'kind': 'original',
            'ext': _audio_ext(music_track), 'filename': fname, 'sources': [src],
            'mode': 'hls' if src['proto'] == 'hls' else 'direct', 'size': _size(music_track),
        })

    entry = _entry_meta(ctx, info, title)
    entry['video'] = video_options
    entry['audio'] = audio_options
    # bantu UI: audio-only (SoundCloud dll) vs video vs gallery
    if not video_options and audio_options and not info.get('xy_ugoira'):
        entry['media_kind'] = 'audio'
    elif video_options:
        entry['media_kind'] = 'video'
    else:
        entry['media_kind'] = 'other'
    try:
        entry['preview'] = _preview_payload(ctx, info, formats, best_audio, base_name)
    except Exception:  # pratinjau opsional, jangan gagalkan ekstraksi
        entry['preview'] = None
    return entry


# ---------------------------------------------------------------------------
# API publik
# ---------------------------------------------------------------------------
_CACHE = {}
_CACHE_TTL = 300


def extract(text, proxy_base):
    url = find_url(text)
    if not url:
        raise XyError('invalid', 'Tidak ada link yang valid. Paste link video/postingan (awali dengan https://).',
                      status=400)
    if len(url) > 2048:
        raise XyError('invalid', 'Link terlalu panjang.', status=400)
    if not is_public_url(url):
        raise XyError('invalid', 'Link tidak diizinkan.', status=400)

    cached = _CACHE.get(url)
    if cached and time.time() - cached[0] < _CACHE_TTL:
        return cached[1]

    platform = detect_platform(url)
    t0 = time.time()
    try:
        info, ydl = None, None
        attempts = _attempt_opts(url)
        for i, extra in enumerate(attempts):
            ydl = yt_dlp.YoutubeDL({**ydl_opts(need_js=_is_youtube(url)), **proxy_opts(url), **extra})
            try:
                info = ydl.extract_info(url, download=False)
                break
            except Exception:
                ydl.close()
                if i == len(attempts) - 1:
                    raise
        with ydl:
            info = ydl.sanitize_info(info)
            page_url = info.get('webpage_url') or url
            ctx = _Ctx(ydl, info, proxy_base, page_url)
            is_playlist = info.get('_type') == 'playlist' or info.get('entries') is not None
            raw_all = [e for e in (info.get('entries') or []) if e] if is_playlist else [info]
            if info.get('xy_gallery') or any(_is_gallery_item(e) for e in raw_all):
                entries = [build_gallery(ydl, info, raw_all, proxy_base, page_url)]
                title = entries[0]['title']
            elif is_playlist:
                entries = []
                for e in raw_all[:MAX_ENTRIES]:
                    ectx = _Ctx(ydl, e, proxy_base, e.get('webpage_url') or page_url)
                    entries.append(build_entry(ectx, e))
                title = info.get('title')
            else:
                entries = [build_entry(ctx, info)]
                title = entries[0]['title']
    except XyError:
        raise
    except Exception as e:  # DownloadError / ExtractorError / network
        raw = _clean_error(e)
        code, msg = friendly_error(raw)
        raise XyError(code, msg, raw)

    entries = [e for e in entries if e['video'] or e['audio'] or e.get('gallery')]
    if not entries:
        raise XyError('novideo', 'Tidak ada video/foto/audio yang bisa diunduh di link ini.')
    if platform is None and entries:
        ext = (entries[0].get('extractor') or '').lower()
        platform = {'id': ext or 'web', 'name': entries[0].get('extractor') or 'Web', 'region': 'global',
                    'color': '#6366F1'}
    result = {
        'ok': True,
        'url': url,
        'platform': {k: platform.get(k) for k in ('id', 'name', 'region', 'color', 'logo')} if platform else None,
        'title': title,
        'count': len(entries),
        'entries': entries,
        'took_ms': int((time.time() - t0) * 1000),
    }
    if len(_CACHE) > 200:
        _CACHE.clear()
    _CACHE[url] = (time.time(), result)
    return result


_STREAM_CACHE = {}
_STREAM_TTL = 900


def _kind_of(f):
    if not _has_video(f):
        return 'audio'
    return 'av' if _has_audio(f) else 'video'


def _pick_similar(fmts, meta):
    """Format ID YouTube bisa berubah antar extract: cari yang paling mirip (jenis, resolusi, ext)."""
    kind, height, ext = meta.get('k'), meta.get('h') or 0, meta.get('e')
    cands = [f for f in fmts if _usable(f) and _proto(f) == 'direct']
    if kind == 'audio':
        pool = [f for f in cands if _kind_of(f) == 'audio']
        return max(pool, key=lambda f: (f.get('ext') == ext, f.get('abr') or f.get('tbr') or 0), default=None)
    if kind == 'av':
        pool = [f for f in cands if _kind_of(f) == 'av']
    else:  # 'video' (akan di-merge): video-only atau muxed sama-sama bisa dipakai
        pool = [f for f in cands if _kind_of(f) == 'video'] or [f for f in cands if _kind_of(f) == 'av']
    return min(pool, key=lambda f: (abs((_short_side(f) or 0) - height), f.get('ext') != ext,
                                    -_vcodec_score(f)), default=None)


def resolve_stream_format(page_url, format_id, meta=None):
    """Dipakai /api/stream: extract ulang (IP server sekarang) lalu ambil format yang sama.

    Hasil extract di-cache per instance supaya request Range berikutnya tidak extract ulang.
    """
    ydl = yt_dlp.YoutubeDL({**ydl_opts(need_js=_is_youtube(page_url)), **proxy_opts(page_url),
                            **_attempt_opts(page_url)[0]})
    cached = _STREAM_CACHE.get(page_url)
    if cached and time.time() - cached[0] < _STREAM_TTL:
        fmts, cookie_jar = cached[1], cached[2]
        for c in cookie_jar:
            ydl.cookiejar.set_cookie(c)
    else:
        info = ydl.extract_info(page_url, download=False)
        if info.get('entries'):
            info = next((e for e in info['entries'] if e), info)
        fmts = info.get('formats') or []
        if len(_STREAM_CACHE) > 100:
            _STREAM_CACHE.clear()
        _STREAM_CACHE[page_url] = (time.time(), fmts, list(ydl.cookiejar))
    fmt = next((f for f in fmts if f.get('format_id') == format_id), None)
    if fmt is None and meta:
        fmt = _pick_similar(fmts, meta)
    if fmt is None:
        raise XyError('notfound', 'Format tidak tersedia lagi. Silakan proses ulang link-nya.', status=404)
    headers = {k: v for k, v in (fmt.get('http_headers') or {}).items() if k.lower() != 'accept-encoding'}
    return ydl, fmt, headers


def open_stream(ydl, url, headers, range_header=None):
    h = dict(headers)
    h['Accept-Encoding'] = 'identity'
    if range_header:
        h['Range'] = range_header
    return ydl.urlopen(YRequest(url, headers=h))


def health():
    import importlib.util
    impersonate = importlib.util.find_spec('curl_cffi') is not None
    plugins = []
    try:
        from yt_dlp.globals import plugin_ies
        from yt_dlp.plugins import load_all_plugins
        load_all_plugins()
        plugins = sorted(plugin_ies.value.keys())
    except Exception:
        pass
    return {
        'ok': True,
        'service': 'DownloadAja API',
        'version': VERSION,
        'yt_dlp': yt_dlp.version.__version__,
        'deno': find_deno(),
        'impersonate': impersonate,
        'plugins': plugins,
        'python': sys.version.split()[0],
        'region': os.environ.get('VERCEL_REGION'),
        'signing_key': bool(os.environ.get('XYDL_SIGNING_KEY')),
    }
