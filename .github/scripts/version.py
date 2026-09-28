"""Hitung VERSION_NAME + VERSION_CODE buat workflow Android.

Dulu nomor versi diturunin dari GITHUB_RUN_NUMBER. Itu jalan, tapi:
  - build ulang commit yang sama bikin versionCode naik sendiri (dan bisa beda antara
    percobaan yang gagal & yang sukses) -> urutan upgrade jadi tebak-tebakan;
  - build dev (artifact) dan build rilis pakai rumus yang sama, jadi APK dev bisa
    kelihatan "lebih baru" dari rilis di mata PackageInstaller.

Aturan sekarang:
  tag vA.B.C      -> name A.B.C      code A*1_000_000 + B*1_000 + C*10
  branch/PR       -> name BASE-dev.N code 100 + N      (N = run number, selalu < 1_000_000)
sisa digit di kode rilis (…0) dipakai buat hotfix kalau suatu saat perlu (A.B.C.1 -> +1).
"""
import re
import sys

RELEASE_BASE = 1_000_000
DEV_BASE = 100


def parse_tag(ref):
    """'refs/tags/v1.3.2' -> '1.3.2'; bukan tag -> ''."""
    if not ref or not ref.startswith('refs/tags/v'):
        return ''
    return ref[len('refs/tags/v'):].strip()


def release_code(version):
    m = re.match(r'^(\d+)\.(\d+)\.(\d+)$', version or '')
    if not m:
        raise ValueError(f'format tag harus vMAJOR.MINOR.PATCH, dapat {version!r}')
    major, minor, patch = (int(x) for x in m.groups())
    if minor > 999 or patch > 99:
        raise ValueError(f'MINOR/PATCH terlalu besar buat skema versionCode ini: {version}')
    if major * RELEASE_BASE + minor * 1000 + patch * 10 > 2_100_000_000:
        raise ValueError(f'versi {version} bikin versionCode lewat batas int32 Android')
    return major * RELEASE_BASE + minor * 1000 + patch * 10


def dev_code(run_number):
    n = int(run_number)
    if n < 0:
        raise ValueError('run_number negatif?')
    if DEV_BASE + n >= RELEASE_BASE:
        raise ValueError('nomor run sudah menyamai kode rilis — naikin DEV_BASE skema')
    return DEV_BASE + n


def names(ref, base_version, run_number):
    tag = parse_tag(ref)
    if tag:
        return tag, release_code(tag)
    return f'{base_version}-dev.{run_number}', dev_code(run_number)


def main(argv):
    if len(argv) != 4:
        print('pakai: version.py <git_ref> <base_version> <run_number>', file=sys.stderr)
        return 2
    try:
        name, code = names(argv[1], argv[2], argv[3])
    except ValueError as e:
        print(f'ERROR: {e}', file=sys.stderr)
        return 1
    print(f'VERSION_NAME={name}')
    print(f'VERSION_CODE={code}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
