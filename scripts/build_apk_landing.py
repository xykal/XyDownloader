"""Build the public APK release manifest. No credentials or backend needed at runtime."""
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://api.github.com/repos/xykal/XyDownloader/releases/latest'


def main():
    request = urllib.request.Request(URL, headers={'User-Agent': 'DownloadAja-landing-build',
                                                 'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        release = json.load(response)
    assets = []
    for arch in ('arm64-v8a', 'armeabi-v7a', 'x86_64'):
        asset = next((a for a in release['assets'] if a['name'].endswith(f'-{arch}.apk')), None)
        if not asset:
            raise RuntimeError(f'Missing release APK: {arch}; refusing to deploy stale links')
        url = asset['browser_download_url']
        if not url.startswith('https://github.com/xykal/XyDownloader/releases/download/'):
            raise RuntimeError('Unexpected APK URL')
        assets.append({'arch': arch, 'name': asset['name'], 'size': asset['size'], 'url': url})
    manifest = {'version': release['tag_name'], 'published_at': release['published_at'],
                'release_url': release['html_url'], 'assets': assets}
    (ROOT / 'web/public/releases.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print('APK manifest:', release['tag_name'], len(assets), 'architectures')


if __name__ == '__main__':
    main()
