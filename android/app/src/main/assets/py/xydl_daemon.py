"""XyDownloader — daemon Python (yt-dlp "hangat") untuk aplikasi Android. Built in XyVerse.

Kenapa: setiap kali yt-dlp dijalankan sebagai proses baru, Python harus start, mengimpor yt-dlp,
memuat plugin dan meng-compile ratusan regex URL dulu (beberapa detik di HP). Daemon ini melakukan
semua itu SEKALI saat aplikasi dibuka, jadi "proses link" berikutnya tinggal request jaringan.

Dijalankan oleh aplikasi:
    libpython.so -u xydl_daemon.py <yt-dlp dir/zip> <plugin pkg dir> <cache dir> <qjs path> <out dir>

Protokol: satu JSON per baris (stdin -> stdout).
    -> {"id": 1, "op": "info", "url": "https://...", "twitter_api": "syndication"}
    <- {"id": 1, "ok": true, "path": "<out dir>/<hash>.json", "ms": 1234}
    <- {"id": 1, "ok": false, "error": "ERROR: ..."}
    -> {"id": 2, "op": "ping"}
    <- {"id": 2, "ok": true, "version": "2026.08.19", "warm_ms": 850}
Daemon berhenti saat stdin ditutup atau menerima {"op": "exit"}.
"""
import hashlib
import json
import os
import sys
import time
import traceback


def _write(out, obj):
    out.write(json.dumps(obj, ensure_ascii=False) + '\n')
    out.flush()


class _Log:
    def __init__(self):
        self.errors = []

    def debug(self, msg):
        pass

    def info(self, msg):
        pass

    def warning(self, msg):
        pass

    def error(self, msg):
        self.errors.append(str(msg))


def _add_cookie_headers(ydl, info):
    """Header Cookie per format -> dipakai pratinjau (ExoPlayer) & unduhan langsung di Kotlin."""
    def fmt_cookie(f):
        url = f.get('url') if isinstance(f, dict) else None
        if not url:
            return
        try:
            cookie = ydl.cookiejar.get_cookie_header(url)
        except Exception:
            cookie = None
        if cookie:
            f['xy_cookie'] = cookie

    def walk(node, depth=0):
        if not isinstance(node, dict) or depth > 3:
            return
        for f in node.get('formats') or []:
            fmt_cookie(f)
        if isinstance(node.get('xy_audio'), dict):
            fmt_cookie(node['xy_audio'])
        for e in node.get('entries') or []:
            walk(e, depth + 1)

    walk(info)


def main():
    ytdlp, plugdir, cachedir, qjs, outdir = (sys.argv[1:6] + [''] * 5)[:5]
    out = os.fdopen(os.dup(1), 'w', encoding='utf-8', buffering=1)
    os.dup2(2, 1)  # print() nyasar dari library -> stderr, supaya stdout hanya berisi respons JSON
    sys.stdout = sys.stderr
    if ytdlp:
        sys.path.insert(0, ytdlp)
    if plugdir and os.path.isdir(plugdir):
        sys.path.insert(0, plugdir)
    os.makedirs(outdir or '.', exist_ok=True)

    t0 = time.time()
    from yt_dlp import YoutubeDL
    from yt_dlp.version import __version__ as version

    runtimes = {'quickjs': {'path': qjs}} if qjs and os.path.exists(qjs) else {'deno': {}}

    def options(req, logger):
        o = {
            'quiet': True, 'no_warnings': True, 'noprogress': True, 'skip_download': True,
            'cachedir': cachedir or False, 'socket_timeout': 25, 'retries': 3, 'extractor_retries': 1,
            'noplaylist': True, 'playlistend': 60, 'logger': logger, 'js_runtimes': dict(runtimes),
        }
        api = req.get('twitter_api')
        if api:
            o['extractor_args'] = {'twitter': {'api': [api]}}
        return o

    # ---- pemanasan: muat plugin + compile regex semua extractor (sekali saja)
    try:
        with YoutubeDL({'quiet': True, 'no_warnings': True, 'cachedir': False, 'js_runtimes': dict(runtimes)}) as y:
            ies = list(y._ies.values()) if hasattr(y, '_ies') else []
        if not ies:
            from yt_dlp.extractor import gen_extractor_classes
            ies = list(gen_extractor_classes())
        for ie in ies:
            try:
                ie.suitable('https://warmup.xydl.invalid/')
            except Exception:
                pass
    except Exception:
        traceback.print_exc()
    warm_ms = int((time.time() - t0) * 1000)
    _write(out, {'id': 0, 'ok': True, 'ready': True, 'version': version, 'warm_ms': warm_ms})

    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            continue
        rid = req.get('id')
        op = req.get('op')
        if op == 'exit':
            _write(out, {'id': rid, 'ok': True})
            break
        if op == 'ping':
            _write(out, {'id': rid, 'ok': True, 'version': version, 'warm_ms': warm_ms})
            continue
        if op != 'info' or not req.get('url'):
            _write(out, {'id': rid, 'ok': False, 'error': f'op tidak dikenal: {op}'})
            continue
        logger = _Log()
        started = time.time()
        try:
            with YoutubeDL(options(req, logger)) as ydl:
                info = ydl.extract_info(req['url'], download=False)
                info = ydl.sanitize_info(info)
                _add_cookie_headers(ydl, info)
            name = hashlib.sha1(req['url'].encode('utf-8')).hexdigest()[:20] + '.json'
            path = os.path.join(outdir, name)
            with open(path + '.tmp', 'w', encoding='utf-8') as f:
                json.dump(info, f, ensure_ascii=False)
            os.replace(path + '.tmp', path)
            _write(out, {'id': rid, 'ok': True, 'path': path, 'ms': int((time.time() - started) * 1000)})
        except BaseException as e:  # noqa: B036 - daemon tidak boleh mati karena satu link
            if isinstance(e, KeyboardInterrupt):
                break
            msg = '\n'.join(logger.errors) or f'ERROR: {e}'
            _write(out, {'id': rid, 'ok': False, 'error': msg[-3000:]})


if __name__ == '__main__':
    main()
