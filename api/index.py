"""DownloadAja API — satu Vercel Python Function (ASGI murni, tanpa framework).

Endpoint:
  GET  /api/health              status engine
  GET  /api/platforms           katalog platform per region
  GET  /api/extract?url=...     (atau POST {"url": "..."}) -> info + opsi download
  GET  /api/stream?t=TOKEN      streaming untuk sumber yang terikat IP server (YouTube)
"""
import asyncio
import hashlib
import hmac
import json
import mimetypes
import os
import sys
import time
import traceback
import urllib.parse
from collections import defaultdict, deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from xydl import engine, netpolicy, signer  # noqa: E402
from xydl.platforms import catalog  # noqa: E402

PROXY_BASE = os.environ.get('XYDL_PROXY_BASE', 'http://127.0.0.1:8787')
STREAM_CHUNK = 8 * 1024 * 1024
READ_SIZE = 256 * 1024
RATE_LIMIT = int(os.environ.get('XYDL_RATE_LIMIT', '25'))  # request extract / menit / IP

# Budget lapor-probe per instance: tanpa ini, satu scripts flood UA terlarang bikin
# kita yang nembak dash sendiri (write amplification ke KV lewat beacon).
PROBE_BUDGET_PER_MIN = int(os.environ.get('XYDL_PROBE_BUDGET', '60'))
# Total waktu yang boleh dipakai buat lapor probe. Dulu blocking di event loop
# (2 endpoint x urlopen timeout 2.5s) -> satu instance bisa dikunci 5 detik per request.
PROBE_BUDGET_SECONDS = float(os.environ.get('XYDL_PROBE_TIMEOUT', '0.6'))

# User-Agent scrapers yang diblokir di /api/extract (bukan browser/app)
_BLOCKED_UA = (
    'scrapy', 'httrack', 'wget/', 'curl/', 'python-requests', 'python-urllib',
    'go-http-client', 'java/', 'libwww', 'httpclient', # app Android pakai okhttp + UA DownloadAja
    'bytespider', 'gptbot', 'ccbot', 'anthropic', 'claude-web', 'petalbot',
    'semrush', 'ahrefs', 'dataforseo', 'mj12bot', 'dotbot', 'magpie-crawler',
)



DASH_BEACON = (
    'https://dash.dlaja.xyverse.my.id/api/public/beacon',
    'https://dlaja-dash.akuntiktok76y.workers.dev/api/public/beacon',
)


def _probe_headers(ip):
    """Tanda tangan laporan internal -> dash. Tanpa ini, dash tidak bisa bedakan
    'IP yang dikirim API Vercel tentang pengguna' (valid) dengan 'IP yang dikarang
    penyerang di body beacon' (log poisoning di tabel device/probe admin).
    """
    secret = os.environ.get('XYDL_PROBE_SECRET') or ''
    if not secret:
        return {}
    ts = str(int(time.time()))
    sig = hmac.new(secret.encode(), f'{ts}.{ip or ""}'.encode(), hashlib.sha256).hexdigest()
    return {'X-Xydl-Probe-Ts': ts, 'X-Xydl-Probe-Sig': sig}


def _post_probe(payload, deadline):
    """Dipanggil di thread (bukan event loop). Total waktu dibatasi `deadline` detik."""
    import urllib.request
    extra = _probe_headers(payload.get('ip'))
    for url in DASH_BEACON:
        left = deadline - time.monotonic()
        if left <= 0.05:
            return False
        try:
            req = urllib.request.Request(
                url, data=json.dumps(payload).encode(), method='POST',
                headers={'Content-Type': 'application/json', 'User-Agent': 'DownloadAja-API/1.0', **extra},
            )
            with urllib.request.urlopen(req, timeout=min(0.5, left)) as r:
                r.read(64)
            return True
        except Exception:
            continue
    return False


_probe_times = deque(maxlen=PROBE_BUDGET_PER_MIN)


def _probe_budget_ok():
    """Batas lapor probe per instance per menit (anti amplification ke dash sendiri)."""
    now = time.monotonic()
    while _probe_times and now - _probe_times[0] > 60:
        _probe_times.popleft()
    if len(_probe_times) >= PROBE_BUDGET_PER_MIN:
        return False
    _probe_times.append(now)
    return True


async def report_probe(ip, ua, reason, path='/api/extract', cc=None):
    """Catat IP yang mencoba menembus API (scraper/bot/flood).

    Best-effort dan TIDAK pernah menunda respons lebih dari PROBE_BUDGET_SECONDS.
    Kode lama manggil urlopen sinkron di dalam coroutine: event loop instance itu
    berhenti buat SEMUA pengguna lain sampai 2 x 2.5 detik tiap request ber-UA dicurigai.
    """
    if not _probe_budget_ok():
        return
    payload = {
        'type': 'probe',
        'client': 'web',
        'ip': (ip or '')[:64],
        'cc': (cc or '')[:8],
        'ua': (ua or '')[:300],
        'reason': reason[:64],
        'path': path[:120],
    }
    try:
        await asyncio.wait_for(
            asyncio.to_thread(_post_probe, payload, time.monotonic() + PROBE_BUDGET_SECONDS),
            timeout=PROBE_BUDGET_SECONDS,
        )
    except Exception:
        pass  # statistik tidak boleh menggagalkan request


def _cors_for(origin: str | None):
    """CORS ketat: hanya origin allowlist EKSAK. Tanpa origin (same-origin / curl) = tanpa ACAO."""
    allow = netpolicy.origin_allowed(origin)
    headers = [
        (b'access-control-allow-methods', b'GET, POST, HEAD, OPTIONS'),
        (b'access-control-allow-headers', b'Content-Type, Range'),
        (b'access-control-expose-headers', b'Content-Length, Content-Range, Content-Disposition, Accept-Ranges'),
        (b'vary', b'Origin'),
    ]
    if allow:
        headers.insert(0, (b'access-control-allow-origin', allow.encode()))
    return headers



def _ua_blocked(ua: str | None) -> bool:
    u = (ua or '').lower()
    if not u or u == 'mozilla/5.0':  # kosong / terlalu generik
        return True
    # Browser & app DownloadAja lolos
    if 'mozilla/' in u or 'xyverse' in u or 'xydownloader' in u:
        return False
    return any(b in u for b in _BLOCKED_UA)

_hits = defaultdict(deque)
_hits_seen = 0


def _rate_limited(ip):
    """Fixed window 60 detik per IP. Dulu `_hits.clear()` begitu tabel lewat 5000 IP:
    penyerang yang sengaja nyebar 5000 IP palsu bikin semua counter orang lain ke-reset
    (rate limit mati total). Sekarang entry kedaluwarsa dibuang satu-satu.
    """
    global _hits_seen
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        return True
    q.append(now)
    _hits_seen += 1
    if len(_hits) > 5000 or _hits_seen % 512 == 0:
        for key in [k for k, v in _hits.items() if not v or now - v[-1] > 120]:
            del _hits[key]
    return False


async def _send_json(send, status, data, extra_headers=(), origin=None):
    body = json.dumps(data, ensure_ascii=False).encode()
    headers = [
        (b'content-type', b'application/json; charset=utf-8'),
        (b'content-length', str(len(body)).encode()),
        (b'cache-control', b'no-store'),
        (b'x-robots-tag', b'noindex, nofollow'),
        *_cors_for(origin), *extra_headers,
    ]
    await send({'type': 'http.response.start', 'status': status, 'headers': headers})
    await send({'type': 'http.response.body', 'body': body})


async def _read_body(receive, limit=64 * 1024):
    body = b''
    while True:
        msg = await receive()
        body += msg.get('body', b'')
        if len(body) > limit or not msg.get('more_body'):
            return body[:limit]


def _content_disposition(filename):
    ascii_name = filename.encode('ascii', 'ignore').decode() or 'download'
    ascii_name = ascii_name.replace('"', "'")
    return f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{urllib.parse.quote(filename)}'.encode()


async def handle_extract(send, query, receive, method, origin=None):
    text = query.get('url')
    if method == 'POST':
        try:
            data = json.loads((await _read_body(receive)) or b'{}')
            text = data.get('url') or text
        except ValueError:
            pass
    try:
        result = await asyncio.to_thread(engine.extract, text or '', PROXY_BASE)
        await _send_json(send, 200, result, origin=origin)
    except signer.SigningKeyMissing as e:
        await _send_json(send, 500, {'ok': False, 'code': 'config', 'error': str(e)}, origin=origin)
    except engine.XyError as e:
        await _send_json(
            send, e.status,
            {'ok': False, 'code': e.code, 'error': e.message, 'detail': e.detail},
            origin=origin,
        )


async def handle_stream(send, query, headers, method):
    origin = headers.get('origin')
    try:
        payload = signer.verify(query.get('t', ''))
    except signer.SigningKeyMissing as e:
        return await _send_json(send, 500, {'ok': False, 'code': 'config', 'error': str(e)}, origin=origin)
    except signer.TokenError as e:
        return await _send_json(send, 403, {'ok': False, 'code': 'token', 'error': str(e)}, origin=origin)
    filename = payload.get('f') or 'video.mp4'
    try:
        ydl, fmt, fheaders = await asyncio.to_thread(engine.resolve_stream_format, payload['s'], payload['fid'],
                                                      payload)
    except engine.XyError as e:
        return await _send_json(send, e.status, {'ok': False, 'code': e.code, 'error': e.message}, origin=origin)
    except Exception as e:
        raw = engine._clean_error(e)
        code, msg = engine.friendly_error(raw)
        return await _send_json(send, 502, {'ok': False, 'code': code, 'error': msg, 'detail': raw}, origin=origin)

    ctype = (mimetypes.guess_type(filename)[0] or 'application/octet-stream').encode()
    base_headers = [
        (b'content-type', ctype), (b'accept-ranges', b'bytes'), (b'cache-control', b'no-store'),
        (b'x-robots-tag', b'noindex'),
        *_cors_for(origin),
    ]
    if query.get('dl') == '1':
        base_headers.append((b'content-disposition', _content_disposition(filename)))

    async def pipe(resp):
        while True:
            chunk = await asyncio.to_thread(resp.read, READ_SIZE)
            if not chunk:
                break
            await send({'type': 'http.response.body', 'body': chunk, 'more_body': True})

    try:
        client_range = headers.get('range')
        if client_range:
            resp = await asyncio.to_thread(engine.open_stream, ydl, fmt['url'], fheaders, client_range)
            out = list(base_headers)
            for k in ('content-length', 'content-range'):
                v = resp.headers.get(k)
                if v:
                    out.append((k.encode(), v.encode()))
            await send({'type': 'http.response.start', 'status': resp.status, 'headers': out})
            if method != 'HEAD':
                await pipe(resp)
            await send({'type': 'http.response.body', 'body': b''})
            return

        total = fmt.get('filesize')
        if not total:
            probe = await asyncio.to_thread(engine.open_stream, ydl, fmt['url'], fheaders, 'bytes=0-0')
            cr = probe.headers.get('content-range') or ''
            total = int(cr.rsplit('/', 1)[-1]) if '/' in cr and cr.rsplit('/', 1)[-1].isdigit() else None
            probe.close()
        out = list(base_headers)
        if total:
            out.append((b'content-length', str(total).encode()))
        await send({'type': 'http.response.start', 'status': 200, 'headers': out})
        if method != 'HEAD':
            if total:
                start = 0
                while start < total:
                    end = min(start + STREAM_CHUNK, total) - 1
                    resp = await asyncio.to_thread(engine.open_stream, ydl, fmt['url'], fheaders, f'bytes={start}-{end}')
                    await pipe(resp)
                    start = end + 1
            else:
                resp = await asyncio.to_thread(engine.open_stream, ydl, fmt['url'], fheaders)
                await pipe(resp)
        await send({'type': 'http.response.body', 'body': b''})
    except (ConnectionError, OSError):
        pass  # klien putus
    finally:
        try:
            ydl.close()
        except Exception:
            pass


async def app(scope, receive, send):
    if scope['type'] == 'lifespan':
        while True:
            msg = await receive()
            if msg['type'] == 'lifespan.startup':
                await send({'type': 'lifespan.startup.complete'})
            elif msg['type'] == 'lifespan.shutdown':
                await send({'type': 'lifespan.shutdown.complete'})
                return
    if scope['type'] != 'http':
        return

    method = scope.get('method', 'GET').upper()
    path = scope.get('path', '/').rstrip('/') or '/'
    query = dict(urllib.parse.parse_qsl(scope.get('query_string', b'').decode('latin-1'), keep_blank_values=True))
    headers = {k.decode('latin-1').lower(): v.decode('latin-1') for k, v in scope.get('headers', [])}
    ip = netpolicy.client_ip(headers, (scope.get('client') or ('?',))[0])
    origin = headers.get('origin')
    ua = headers.get('user-agent')

    if method == 'OPTIONS':
        await send({
            'type': 'http.response.start', 'status': 204,
            'headers': [*_cors_for(origin), (b'access-control-max-age', b'86400')],
        })
        await send({'type': 'http.response.body', 'body': b''})
        return

    try:
        if path in ('/api/health', '/api'):
            return await _send_json(send, 200, engine.health(), origin=origin)
        if path == '/api/platforms':
            return await _send_json(
                send, 200, catalog(),
                [(b'cache-control', b'public, max-age=3600')],
                origin=origin,
            )
        if path == '/api/extract':
            if method not in ('GET', 'POST'):
                return await _send_json(send, 405, {'ok': False, 'error': 'method not allowed'}, origin=origin)
            # Anti-scrape: tolak UA bot/scraper (browser + app DownloadAja tetap lolos)
            if _ua_blocked(ua):
                await report_probe(ip, ua, 'ua_blocked', path, headers.get('cf-ipcountry') or headers.get('x-vercel-ip-country'))
                return await _send_json(send, 403, {
                    'ok': False, 'code': 'forbidden',
                    'error': 'Akses API ditolak. Pakai situs resmi atau aplikasi DownloadAja.',
                }, origin=origin)
            if _rate_limited(ip):
                await report_probe(ip, ua, 'rate_limit', path, headers.get('cf-ipcountry') or headers.get('x-vercel-ip-country'))
                return await _send_json(send, 429, {'ok': False, 'code': 'rate_limit',
                                                    'error': 'Terlalu banyak permintaan. Tunggu 1 menit ya.'},
                                        origin=origin)
            return await handle_extract(send, query, receive, method, origin=origin)
        if path == '/api/stream':
            return await handle_stream(send, query, headers, method)
        return await _send_json(send, 404, {'ok': False, 'error': 'not found'}, origin=origin)
    except Exception as e:  # jangan sampai function crash tanpa respon
        traceback.print_exc()
        try:
            await _send_json(send, 500, {'ok': False, 'code': 'internal', 'error': 'Terjadi kesalahan server.',
                                         'detail': str(e)[:300]}, origin=origin)
        except Exception:
            pass
