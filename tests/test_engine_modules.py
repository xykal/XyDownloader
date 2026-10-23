"""Regression tests for modular engines; no platform/network access required."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from xydl import engine
from xydl.platforms import PLATFORMS, detect_platform

ROOT = Path(__file__).resolve().parents[1]
ENGINES = ROOT / 'plugins/yt_dlp_plugins/engines'


def test_each_featured_platform_has_its_own_configuration():
    assert len(PLATFORMS) == 48
    assert len({p['id'] for p in PLATFORMS}) == 48
    for platform in PLATFORMS:
        directory = ENGINES / platform['id']
        assert json.loads((directory / 'platform.json').read_text()) == platform
        if platform.get('custom_extractor'):
            assert (directory / 'extractor.py').is_file()
        for domain in platform['domains']:
            assert detect_platform('https://sub.' + domain + '/example')['id'] == platform['id']


def test_discovery_registers_all_custom_extractors():
    # Fresh interpreter catches sys.path/discovery regressions hidden by import caches.
    code = '''
import json
from yt_dlp.plugins import load_all_plugins
from yt_dlp.globals import plugin_ies
load_all_plugins()
print(json.dumps(sorted(plugin_ies.value)))
'''
    env = {**os.environ, 'PYTHONPATH': str(ROOT / 'plugins')}
    output = subprocess.check_output([sys.executable, '-c', code], env=env, cwd=ROOT, text=True)
    expected = sorted(p['custom_extractor'] for p in PLATFORMS if p.get('custom_extractor'))
    assert json.loads(output) == expected


@pytest.mark.parametrize('url', ['https://evilyoutube.com/a', 'https://notx.com/a',
                                'https://youtube.com.evil.test/a'])
def test_unrelated_domains_do_not_receive_platform_policies(url):
    assert detect_platform(url) is None
    assert engine._attempt_opts(url) == [{}]
    assert not engine._is_youtube(url)


def test_runtime_policies_come_from_platform_folder():
    assert engine._is_youtube('https://youtu.be/abc')
    assert engine._attempt_opts('https://x.com/user/status/1')[0] == {
        'extractor_args': {'twitter': {'api': ['syndication']}}}


def test_tiktok_gallery_retains_photo_and_music_contract():
    from yt_dlp_plugins.engines.tiktok.extractor import XyTikTokIE
    ie = XyTikTokIE()
    result = ie._photo_post({
        'desc': 'Contoh foto', 'author': {'uniqueId': 'demo'},
        'imagePost': {'images': [{'imageURL': {'urlList': ['https://cdn.example/a.jpg']},
                                  'imageWidth': 1080, 'imageHeight': 1920}]},
        'music': {'playUrl': 'https://cdn.example/audio.mp3', 'title': 'Demo'},
    }, '123', 'demo')
    assert result['xy_gallery'] is True
    assert result['entries'][0]['xy_image'] is True
    assert result['entries'][0]['formats'][0]['url'] == 'https://cdn.example/a.jpg'
    assert result['xy_audio']['ext'] == 'mp3'
