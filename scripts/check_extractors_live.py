"""Bounded public-link probes. Failures are evidence, not a promise of global support.
No download, cookies, credentials, media proxy, or signed URLs are needed.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def probe(url):
    sys.path.insert(0, str(ROOT))
    from xydl import engine
    with engine.yt_dlp.YoutubeDL({**engine.ydl_opts(), 'socket_timeout': 12,
                                 'retries': 0, 'extractor_retries': 0,
                                 'playlistend': 3}) as ydl:
        info = ydl.extract_info(url, download=False)
        entries = list(info.get('entries') or [info])[:3]
        count = sum(bool(e and (e.get('formats') or e.get('url'))) for e in entries)
        if not count:
            raise RuntimeError('No extractable media in probe result')
        print(json.dumps({'ok': True, 'media_entries': count}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--probe')
    parser.add_argument('--output', default='extractor-health.json')
    args = parser.parse_args()
    if args.probe:
        probe(args.probe)
        return
    cases = json.loads((ROOT / 'tests/fixtures/extractor_smoke.json').read_text())
    results = []
    for case in cases:
        start = time.monotonic()
        try:
            process = subprocess.run([sys.executable, __file__, '--probe', case['url']],
                                     cwd=ROOT, capture_output=True, text=True, timeout=45)
            ok = process.returncode == 0
            # Last error line only. Never emit extracted CDN URLs/cookies.
            detail = 'Metadata extracted without downloading media' if ok else (
                (process.stderr.splitlines() or ['Unknown extraction failure'])[-1][:450])
        except subprocess.TimeoutExpired:
            ok, detail = False, 'Probe exceeded 45-second budget'
        results.append({'id': case['id'], 'ok': ok, 'seconds': round(time.monotonic() - start, 1),
                        'detail': detail})
        print(case['id'], 'PASS' if ok else 'FAIL', detail, flush=True)
    report = {'scope': '4 public sample links from CI/server IP, not Android device certification',
              'results': results, 'all_passed': all(r['ok'] for r in results)}
    Path(args.output).write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
