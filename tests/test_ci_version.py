"""Versi APK dihitung dari tag, bukan dari nomor run CI (lihat .github/scripts/version.py)."""
import importlib.util
import os

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('xydl_ci_version', os.path.join(ROOT, '.github', 'scripts', 'version.py'))
ver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ver)


@pytest.mark.parametrize('tag,code', [
    ('1.3.2', 1_003_020),
    ('1.10.0', 1_010_000),      # minor >= 10 tetap urut: 1.10 > 1.9
    ('2.0.0', 2_000_000),
])
def test_kode_rilis_diturunkan_dari_versi(tag, code):
    assert ver.release_code(tag) == code


def test_urutan_kode_naik_terus():
    seq = ['1.3.1', '1.3.2', '1.3.10', '1.4.0', '1.10.0', '1.99.99', '2.0.0']
    codes = [ver.release_code(v) for v in seq]
    assert codes == sorted(codes) and len(set(codes)) == len(codes)


def test_tag_cakep_ditolak():
    for bad in ('1.3', 'v1.3.2', '1.3.2.1', '', '1.3.x', '1.1000.0'):
        with pytest.raises(ValueError):
            ver.release_code(bad)


def test_build_dev_ngalah_di_bawah_rilis():
    """APK artifact CI tidak boleh kelihatan lebih baru dari rilis di mata installer."""
    assert ver.dev_code(1) > ver.DEV_BASE
    assert max(ver.dev_code(n) for n in range(0, 500_000)) < ver.RELEASE_BASE
    with pytest.raises(ValueError):
        ver.dev_code(999_999)


def test_nama_dari_ref():
    assert ver.names('refs/tags/v1.3.2', '1.3.2', 27) == ('1.3.2', 1_003_020)
    assert ver.names('refs/heads/main', '1.3.2', 27) == ('1.3.2-dev.27', 127)
    assert ver.names('refs/pull/4/merge', '1.3.2', 9) == ('1.3.2-dev.9', 109)
    assert ver.parse_tag('refs/heads/main') == ''


def test_cli_cetak_env_pair():
    assert ver.main(['version.py', 'refs/tags/v1.3.2', '1.3.2', '27']) == 0
    assert ver.main(['version.py', 'refs/tags/v1.3', '1.3.2', '27']) == 1      # tag cacat -> exit 1
    assert ver.main(['version.py', 'refs/tags/v1.3.2']) == 2                  # arg kurang
