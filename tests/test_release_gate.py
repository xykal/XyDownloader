"""Publishing must depend on real gates, never just a successful compilation."""
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]


def test_release_waits_for_build_and_emulator():
    jobs = yaml.safe_load((ROOT / '.github/workflows/android.yml').read_text())['jobs']
    assert set(jobs['publish']['needs']) == {'build', 'smoke'}
    assert not any(s.get('name') == 'GitHub Release' for s in jobs['build']['steps'])
    steps = jobs['build']['steps']
    assert any('signature matches' in s.get('name', '') for s in steps)
    assert any('menolak debug key' in s.get('run', '') for s in steps)


def test_smoke_cannot_report_success_after_a_crash():
    text = (ROOT / '.github/scripts/smoke.sh').read_text()
    crash_branch = text.split('if grep -q "FATAL EXCEPTION"', 1)[1].split('\nfi', 1)[0]
    assert 'exit 1' in crash_branch


def test_smoke_requires_real_download_evidence():
    text = (ROOT / '.github/scripts/smoke.sh').read_text()
    assert 'set -euo pipefail' in text
    assert 'downloaded-files.txt' in text
    assert 'MP3 belum terbukti tersimpan' in text
    assert 'foto belum terbukti tersimpan' in text
    assert 'sys.exit(1)' in (ROOT / '.github/scripts/ui.py').read_text()
