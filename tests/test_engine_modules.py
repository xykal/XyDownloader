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
ENGINES = ROOT / 'engines'


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


@pytest.mark.parametrize('platform', PLATFORMS, ids=lambda p: p['id'])
def test_every_platform_has_an_executed_engine_entry_point(platform):
    from yt_dlp_plugins.engines import registry
    from unittest.mock import Mock
    import inspect
    instance = registry.load_engine(platform['id'])
    assert Path(inspect.getfile(type(instance))).resolve() == ENGINES / platform['id'] / 'engine.py'
    assert instance.platform_id == platform['id']
    assert instance.metadata == platform
    downloader = Mock()
    downloader.extract_info.return_value = {'id': 'fixture'}
    url = 'https://' + platform['domains'][0] + '/fixture'
    assert registry.resolve(url) is instance
    assert registry.extract(downloader, url) == {'id': 'fixture'}
    downloader.extract_info.assert_called_once_with(url, download=False)
    with pytest.raises(ValueError):
        instance.extract(downloader, 'https://not-the-platform.invalid/item')


def test_unlisted_sites_keep_generic_upstream_support():
    from yt_dlp_plugins.engines import registry
    from unittest.mock import Mock
    downloader = Mock()
    registry.extract(downloader, 'https://unlisted.example/item', download=True)
    downloader.extract_info.assert_called_once_with('https://unlisted.example/item', download=True)


def test_platform_options_and_upstream_bindings_are_not_in_shared_code():
    from yt_dlp_plugins.engines import registry
    shared = (ENGINES / '_common/gallery.py').read_text()
    assert '_YtDlpTikTokIE' not in shared
    assert '_YtDlpDouyinIE' not in shared
    assert registry.load_engine('twitter').request_options({'engine_variant': 'syndication'}) == {
        'extractor_args': {'twitter': {'api': ['syndication']}}}
    assert registry.load_engine('youtube').request_options({'engine_variant': 'syndication'}) == {}
    assert 'isTwitter(' not in (ROOT / 'android/app/src/main/java/id/my/xyverse/xydownloader/Engine.kt').read_text()


def test_discovery_registers_platform_owned_pixiv_postprocessor():
    from yt_dlp.plugins import load_all_plugins
    from yt_dlp.globals import plugin_pps
    load_all_plugins()
    assert 'XyUgoiraPP' in plugin_pps.value


def test_android_shaped_plugin_bundle_runs_outside_repository(tmp_path):
    """No repo/cwd/PYTHONPATH backdoor: exercise the actual Android bundle layout."""
    import shutil
    import textwrap
    package = tmp_path / 'plugin-bundle/xydl/yt_dlp_plugins'
    shutil.copytree(ROOT / 'plugins/yt_dlp_plugins', package, ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copytree(ENGINES, package / 'engines', dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__'))
    code = textwrap.dedent('''
        import json
        from yt_dlp import YoutubeDL
        from yt_dlp.globals import plugin_ies, plugin_pps
        from yt_dlp.plugins import load_all_plugins
        load_all_plugins()
        from yt_dlp_plugins.engines import registry
        assert len(registry.platforms()) == 48
        for p in registry.platforms():
            assert registry.load_engine(p['id']).platform_id == p['id']
        assert 'XyTikTokIE' in plugin_ies.value
        assert 'XyUgoiraPP' in plugin_pps.value
        print('ANDROID_BUNDLE_OK')
    ''')
    output = subprocess.check_output(
        [sys.executable, '-c', code], cwd=tmp_path,
        env={**os.environ, 'PYTHONPATH': str(package.parent)}, text=True)
    assert 'ANDROID_BUNDLE_OK' in output


def test_optional_upstream_bindings_tolerate_missing_module_or_class():
    from yt_dlp_plugins.engines._common.gallery import optional_ie
    assert optional_ie('common', 'NoSuchExtractorClass') is None
    assert optional_ie('no_such_extractor_module', 'NoSuchClass') is None


def test_source_specific_domain_policies_live_beside_their_engine():
    from yt_dlp_plugins.engines import registry
    assert 'googlevideo.com' in registry.load_engine('youtube').metadata['runtime']['ip_bound_domains']
    assert registry.is_ip_bound('r1.googlevideo.com')
    assert not registry.is_ip_bound('evilgooglevideo.com')
    assert not registry.is_ip_bound('googlevideo.com.evil.test')
    assert 'douyin.com' in registry.domain_policy('proxy_domains')


def test_pixiv_web_hook_resolves_by_owned_marker_and_builds_payload():
    from yt_dlp_plugins.engines import registry
    from unittest.mock import Mock
    info = {'id': 'art1', 'title': 'Fixture', 'xy_ugoira': {'frames': [{'file': '1.jpg', 'delay': 100}]},
            'formats': [{'format_id': 'zip', 'url': 'https://cdn.example/frames.zip', 'ext': 'zip', 'width': 32, 'height': 32}]}
    # Marker ownership works even when extractor metadata is absent.
    assert registry.resolve_info(info, 'https://example.org/item').platform_id == 'pixiv'
    downloader = Mock()
    downloader.cookiejar.get_cookie_header.return_value = None
    context = engine._Ctx(downloader, info, 'https://proxy.example', 'https://pixiv.net/artworks/1')
    result = engine.build_entry(context, info)
    assert result['ugoira']['frames'] == info['xy_ugoira']['frames']
    assert [f['mode'] for f in result['video']] == ['ugoira', 'ugoira']


def test_owned_content_marker_takes_precedence_over_extractor_identity():
    from yt_dlp_plugins.engines import registry
    assert registry.resolve_info({'xy_ugoira': {}, 'extractor_key': 'BiliBili'},
                                 'https://bilibili.com/video/1').platform_id == 'pixiv'


@pytest.mark.parametrize('with_common', [False, True])
def test_apk_guard_requires_the_shared_python_package(tmp_path, with_common):
    """AAPT can silently omit underscore directories even when all 48 entries exist."""
    import zipfile
    out, native = tmp_path / 'out', tmp_path / 'native'
    out.mkdir()
    ytdlp = tmp_path / 'yt-dlp'
    ytdlp.write_bytes(b'fixture-runtime')
    prefix = 'assets/ytdlp-plugins/xydl/yt_dlp_plugins/'
    assets = {}
    for directory, relative in [(ROOT / 'plugins/yt_dlp_plugins', ''), (ENGINES, 'engines/')]:
        for file in directory.rglob('*'):
            if file.suffix not in ('.py', '.json') or '__pycache__' in file.parts:
                continue
            assets[prefix + relative + file.relative_to(directory).as_posix()] = file.read_bytes()
    if not with_common:
        assets = {k: v for k, v in assets.items() if '/engines/_common/' not in k}
    assets['assets/py/xydl_daemon.py'] = b'# daemon'
    assets['assets/licenses/components.json'] = b'[]'
    assets['res/raw/ytdlp'] = ytdlp.read_bytes()
    for abi in ('arm64-v8a', 'armeabi-v7a', 'x86_64'):
        libs = native / abi
        libs.mkdir(parents=True)
        with zipfile.ZipFile(out / f'fixture-{abi}.apk', 'w') as z:
            for name, content in assets.items():
                z.writestr(name, content)
            for name in ('libpython.zip.so', 'libffmpeg.so', 'libqjs.so'):
                (libs / name).write_bytes(b'library')
                z.writestr(f'lib/{abi}/{name}', b'library')
    result = subprocess.run([sys.executable, str(ROOT / '.github/scripts/check_apk.py'),
                             str(out), str(native), str(ytdlp)], capture_output=True, text=True)
    assert result.returncode == (0 if with_common else 1), result.stdout + result.stderr
    assert f"[{'OK' if with_common else 'GAGAL'}] modul bersama Python (_common)" in result.stdout
