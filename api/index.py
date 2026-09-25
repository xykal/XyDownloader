"""XyDownloader API — satu Vercel Python Function (ASGI murni, tanpa framework).

Endpoint:
  GET  /api/health              status engine
  GET  /api/platforms           katalog platform per region
  GET  /api/extract?url=...     (atau POST {"url": "..."}) -> info + opsi download
  GET  /api/stream?t=TOKEN      streaming untuk sumber yang terikat IP server (YouTube)
"""
import asyncio
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

from xydl import engine, signer  # noqa: E402
from xydl.platforms import catalog  # noqa: E402

PROXY_BASE = os.environ.get('XYDL_PROXY_BASE', 'http://127.0.0.1:8787')
STREAM_CHUNK = 8 * 1024 * 1024
READ_SIZE = 256 * 1024
RATE_LIMIT = int(os.environ.get('XYDL_RATE_LIMIT', '25'))  # request extract / menit / IP

CORS = [
    (b'access-control-allow-origin', b'*'),
    (b'access-control-allow-methods', b'GET, POST, HEAD, OPTIONS'),
    (b'access-control-allow-headers', b'Content-Type, Range'),
    (b'access-control-expose-headers', b'Content-Length, Content-Range, Content-Disposition, Accept-Ranges'),
]

_hits = defaultdict(deque)


def _rate_limited(ip):
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        return True
    q.append(now)
    if len(_hits) > 5000:
        _hits.clear()
    return False


async def _send_json(send, status, data, extra_headers=()):
    body = json.dumps(data, ensure_ascii=False).encode()
    headers = [
        (b'content-type', b'application/json; charset=utf-8'),
        (b'content-length', str(len(body)).encode()),
        (b'cache-control', b'no-store'),
        *CORS, *extra_headers,
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


async def handle_extract(send, query, receive, method):
    text = query.get('url')
    if method == 'POST':
        try:
            data = json.loads((await _read_body(receive)) or b'{}')
            text = data.get('url') or text
        except ValueError:
            pass
    try:
        result = await asyncio.to_thread(engine.extract, text or '', PROXY_BASE)
        await _send_json(send, 200, result)
    except engine.XyError as e:
        await _send_json(send, e.status, {'ok': False, 'code': e.code, 'error': e.message, 'detail': e.detail})


async def handle_stream(send, query, headers, method):
    try:
        payload = signer.verify(query.get('t', ''))
    except signer.TokenError as e:
        return await _send_json(send, 403, {'ok': False, 'code': 'token', 'error': str(e)})
    filename = payload.get('f') or 'video.mp4'
    try:
        ydl, fmt, fheaders = await asyncio.to_thread(engine.resolve_stream_format, payload['s'], payload['fid'],
                                                      payload)
    except engine.XyError as e:
        return await _send_json(send, e.status, {'ok': False, 'code': e.code, 'error': e.message})
    except Exception as e:
        raw = engine._clean_error(e)
        code, msg = engine.friendly_error(raw)
        return await _send_json(send, 502, {'ok': False, 'code': code, 'error': msg, 'detail': raw})

    ctype = (mimetypes.guess_type(filename)[0] or 'application/octet-stream').encode()
    base_headers = [(b'content-type', ctype), (b'accept-ranges', b'bytes'), (b'cache-control', b'no-store'), *CORS]
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
    ip = (headers.get('x-real-ip') or headers.get('x-forwarded-for', '').split(',')[0].strip()
          or (scope.get('client') or ('?',))[0])

    if method == 'OPTIONS':
        await send({'type': 'http.response.start', 'status': 204, 'headers': [*CORS, (b'access-control-max-age', b'86400')]})
        await send({'type': 'http.response.body', 'body': b''})
        return

    try:
        if path in ('/api/health', '/api'):
            return await _send_json(send, 200, engine.health())
        if path == '/api/platforms':
            return await _send_json(send, 200, catalog(), [(b'cache-control', b'public, max-age=3600')])
        if path == '/api/extract':
            if method not in ('GET', 'POST'):
                return await _send_json(send, 405, {'ok': False, 'error': 'method not allowed'})
            if _rate_limited(ip):
                return await _send_json(send, 429, {'ok': False, 'code': 'rate_limit',
                                                    'error': 'Terlalu banyak permintaan. Tunggu 1 menit ya.'})
            return await handle_extract(send, query, receive, method)
        if path == '/api/stream':
            return await handle_stream(send, query, headers, method)
        return await _send_json(send, 404, {'ok': False, 'error': 'not found'})
    except Exception as e:  # jangan sampai function crash tanpa respon
        traceback.print_exc()
        try:
            await _send_json(send, 500, {'ok': False, 'code': 'internal', 'error': 'Terjadi kesalahan server.',
                                         'detail': str(e)[:300]})
        except Exception:
            pass
