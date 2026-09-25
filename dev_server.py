"""Server lokal untuk development: web (public/) + API di satu port.

    pip install -r requirements.txt uvicorn
    XYDL_PROXY_BASE=https://<worker-kamu>.workers.dev XYDL_SIGNING_KEY=<sama dgn worker> \\
        uvicorn dev_server:app --port 8000
"""
import mimetypes
import os

from api.index import app as api_app

ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public'))
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/manifest+json', '.webmanifest')


async def app(scope, receive, send):
    if scope['type'] != 'http' or scope['path'].startswith('/api'):
        return await api_app(scope, receive, send)
    path = scope['path']
    if path.endswith('/'):
        path += 'index.html'
    fp = os.path.realpath(os.path.join(ROOT, path.lstrip('/')))
    if not fp.startswith(ROOT) or not os.path.isfile(fp):
        await send({'type': 'http.response.start', 'status': 404, 'headers': [(b'content-type', b'text/plain')]})
        await send({'type': 'http.response.body', 'body': b'not found'})
        return
    with open(fp, 'rb') as f:
        body = f.read()
    ctype = (mimetypes.guess_type(fp)[0] or 'application/octet-stream').encode()
    await send({'type': 'http.response.start', 'status': 200,
                'headers': [(b'content-type', ctype), (b'content-length', str(len(body)).encode())]})
    await send({'type': 'http.response.body', 'body': body})
