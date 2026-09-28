"""Kunci HMAC: jangan pernah jalan dengan kunci bawaan yang tertulis di repo publik."""
import asyncio
import json
import os

import pytest

from xydl import signer


def test_tanpa_key_di_vercel_gagal_tegas(monkeypatch):
    monkeypatch.delenv('XYDL_SIGNING_KEY', raising=False)
    monkeypatch.setenv('VERCEL', '1')
    monkeypatch.setenv('VERCEL_ENV', 'production')
    with pytest.raises(signer.SigningKeyMissing):
        signer.get_key()
    with pytest.raises(signer.SigningKeyMissing):
        signer.sign({'u': 'https://cdn.example/a.mp4'})
    with pytest.raises(signer.SigningKeyMissing):
        signer.verify('aaa.bbb')


def test_mode_dev_lokal_masih_boleh(monkeypatch):
    monkeypatch.delenv('XYDL_SIGNING_KEY', raising=False)
    for v in ('VERCEL', 'VERCEL_ENV', 'CLOUDFLARE_ENV'):
        monkeypatch.delenv(v, raising=False)
    tok = signer.sign({'u': 'https://cdn.example/a.mp4', 'a': ['cdn.example']})
    assert signer.verify(tok)['u'] == 'https://cdn.example/a.mp4'


def test_token_palsu_ditolak(monkeypatch):
    monkeypatch.setenv('XYDL_SIGNING_KEY', 'kunci-beneran')
    with pytest.raises(signer.TokenError):
        signer.verify('aaaa.bbbb')
    key = os.environ['XYDL_SIGNING_KEY']
    tok = signer.sign({'u': 'https://x/y'}, key=b'kunci-salah')
    with pytest.raises(signer.TokenError):
        signer.verify(tok, key.encode())
    assert signer.verify(tok, b'kunci-salah')['u'] == 'https://x/y'


def test_token_kadaluarsa_ditolak(monkeypatch):
    monkeypatch.setenv('XYDL_SIGNING_KEY', 'kunci-beneran')
    tok = signer.sign({'u': 'https://x/y'}, ttl=-10)
    with pytest.raises(signer.TokenError, match='kadaluarsa'):
        signer.verify(tok)


def test_api_menolak_500_konfig_bukan_pesan_umum(monkeypatch):
    monkeypatch.setenv('VERCEL', '1')
    monkeypatch.setenv('VERCEL_ENV', 'production')
    monkeypatch.delenv('XYDL_SIGNING_KEY', raising=False)
    from api.index import app

    scope = {'type': 'http', 'method': 'GET', 'path': '/api/stream', 'query_string': b't=x.y',
             'headers': [(b'host', b'dlaja.xyverse.my.id')], 'client': ('1.2.3.4', 1)}

    async def receive():
        return {'type': 'http.disconnect'}

    out = {}

    async def send(msg):
        if msg['type'] == 'http.response.start':
            out['status'] = msg['status']
            out['headers'] = {k.decode(): v.decode() for k, v in msg['headers']}
        else:
            out['body'] = msg.get('body', b'')

    async def go():
        await app(scope, receive, send)

    asyncio.run(go())
    assert out['status'] == 500
    assert json.loads(out['body'])['code'] == 'config'
