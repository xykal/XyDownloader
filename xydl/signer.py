"""Token bertanda tangan (HMAC-SHA256) untuk link download.

Format token:  base64url(deflate_raw(json)) + "." + base64url(hmac_sha256(key, bagian_pertama))

Token yang sama diverifikasi oleh Cloudflare Worker (worker/src/index.js) dan oleh
endpoint /api/stream di Vercel. Tujuannya: proxy TIDAK bisa dipakai orang lain sebagai
open-proxy — hanya link yang dibuat oleh API DownloadAja yang valid, dan ada masa berlakunya.
"""
import base64
import hashlib
import hmac
import json
import os
import time
import zlib

DEFAULT_TTL = 6 * 3600  # 6 jam


def _b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')


def _b64d(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + '=' * (-len(data) % 4))


def get_key() -> bytes:
    key = os.environ.get('XYDL_SIGNING_KEY', '')
    if not key:
        # Mode dev lokal. Di produksi WAJIB di-set (Vercel env + Worker secret).
        key = 'dev-insecure-key-change-me'
    return key.encode()


def sign(payload: dict, ttl: int = DEFAULT_TTL, key: bytes = None) -> str:
    payload = dict(payload)
    payload.setdefault('x', int(time.time()) + ttl)
    raw = json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode()
    comp = zlib.compressobj(9, zlib.DEFLATED, -15)
    body = _b64e(comp.compress(raw) + comp.flush())
    sig = _b64e(hmac.new(key or get_key(), body.encode('ascii'), hashlib.sha256).digest())
    return f'{body}.{sig}'


class TokenError(Exception):
    pass


def verify(token: str, key: bytes = None) -> dict:
    try:
        body, sig = token.split('.', 1)
    except (ValueError, AttributeError):
        raise TokenError('token rusak')
    expected = _b64e(hmac.new(key or get_key(), body.encode('ascii'), hashlib.sha256).digest())
    if not hmac.compare_digest(expected, sig):
        raise TokenError('tanda tangan tidak valid')
    try:
        payload = json.loads(zlib.decompress(_b64d(body), -15))
    except Exception:
        raise TokenError('payload rusak')
    if payload.get('x') and time.time() > payload['x']:
        raise TokenError('link sudah kadaluarsa, silakan proses ulang')
    return payload
