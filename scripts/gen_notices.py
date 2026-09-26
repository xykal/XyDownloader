"""Buat THIRD_PARTY_NOTICES.md dari licenses/components.json (sumber tunggal daftar lisensi).

    python scripts/gen_notices.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    data = json.load(open(os.path.join(ROOT, 'licenses', 'components.json'), encoding='utf-8'))
    out = ['# Third-party notices — DownloadAja', '',
           'DownloadAja (Built in XyVerse) dirilis dengan lisensi **GPL-3.0-or-later** dan memakai komponen open '
           'source berikut. Teks lisensi lengkap ada di folder [`licenses/texts`](licenses/texts) dan juga bisa '
           'dibuka dari aplikasi Android (Tentang → Lisensi open source) serta web (footer → Lisensi).', '']
    for key, head in (('android', 'Aplikasi Android'), ('web', 'Web (dlaja.xyverse.my.id)')):
        out += [f'## {head}', '', '| Komponen | Lisensi | Hak cipta | Keterangan |', '|---|---|---|---|']
        for c in data[key]:
            name = f"[{c['name']}]({c['url']})"
            lic = f"[{c['license']}](licenses/texts/{c['file']})"
            out.append(f"| {name} | {lic} | {c['copyright']} | {c.get('note') or ''} |")
        out.append('')
    out += ['## Kode sumber komponen (L)GPL', '',
            '- FFmpeg & LAME dibangun ulang dari sumber resmi dengan skrip [`android/ffmpeg/build.sh`]'
            '(android/ffmpeg/build.sh) (versi, checksum, dan daftar komponen tercantum di sana).',
            '- Runtime Python/yt-dlp berasal dari [youtubedl-android](https://github.com/JunkFood02/youtubedl-android) '
            '(GPL-3.0); versi ramping dibuat dengan [`android/tools/prepare_native.py`](android/tools/prepare_native.py).',
            '- Seluruh kode DownloadAja tersedia di repositori ini.', '',
            '## Merek dagang', '', data['trademarks'], '']
    path = os.path.join(ROOT, 'THIRD_PARTY_NOTICES.md')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out))
    print(path)


if __name__ == '__main__':
    main()
