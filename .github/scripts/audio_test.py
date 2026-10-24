"""On-device audit of the APK's actual FFmpeg binary, using self-generated media.

Tests the native command used by AudioNormalizer, not perceptual loudness on a phone
or Android LoudnessEnhancer. No external media/download dependency.
"""
import hashlib
import json
import math
from pathlib import Path
import re
import shlex
import struct
import subprocess
import sys
import tempfile
import wave
import zipfile

REMOTE = '/data/local/tmp/dlaja-audio-audit'


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise RuntimeError(f'Command failed: {args[:3]}\n{result.stdout[-2000:]}\n{result.stderr[-4000:]}')
    return result.stdout + result.stderr


def ff(*args):
    return run('adb', 'shell', shlex.join([REMOTE + '/ffmpeg', '-nostdin', '-y', '-hide_banner', *args]))


def measure(path):
    output = ff('-i', path, '-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
                '-c:a', 'aac', '-ar', '48000', '-f', 'null', '-')
    matches = re.findall(r'\{\s*"input_i".*?\}', output, re.S)
    if not matches:
        raise AssertionError('Native FFmpeg did not produce loudness statistics')
    stats = json.loads(matches[-1])
    return {key: float(stats[key]) for key in ('input_i', 'input_tp', 'input_lra')}


def mdat_hash(path):
    data = path.read_bytes()
    payload = bytearray()
    pos = 0
    while pos + 8 <= len(data):
        size, kind = struct.unpack_from('>I4s', data, pos)
        header = 8
        if size == 1:
            size = struct.unpack_from('>Q', data, pos + 8)[0]
            header = 16
        elif size == 0:
            size = len(data) - pos
        if size < header or pos + size > len(data):
            raise AssertionError('Invalid MP4 box')
        if kind == b'mdat':
            payload.extend(data[pos + header:pos + size])
        pos += size
    assert payload, 'No video bytes found'
    return hashlib.sha256(payload).hexdigest()


def main():
    apk_dir, output_dir = map(Path, sys.argv[1:3])
    output_dir.mkdir(parents=True, exist_ok=True)
    apk = next(apk_dir.glob('*x86_64.apk'))
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        with zipfile.ZipFile(apk) as archive:
            binary = archive.read('lib/x86_64/libffmpeg.so')
        (tmp / 'ffmpeg').write_bytes(binary)
        rate, seconds = 44100, 8
        with wave.open(str(tmp / 'quiet.wav'), 'wb') as wav:
            wav.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
            wav.writeframes(b''.join(struct.pack('<h', int(32767 * .012 * (
                math.sin(2 * math.pi * 440 * i / rate) + .3 * math.sin(2 * math.pi * 880 * i / rate))))
                for i in range(rate * seconds)))
        # A small original BMP; no copyrighted source or network dependency.
        pixels = bytes((40, 100, 180)) * 32 * 32
        bmp = b'BM' + struct.pack('<IHHI', 54 + len(pixels), 0, 0, 54)
        bmp += struct.pack('<IiiHHIIiiII', 40, 32, 32, 1, 24, 0, len(pixels), 0, 0, 0, 0) + pixels
        (tmp / 'frame.bmp').write_bytes(bmp)
        run('adb', 'shell', 'mkdir', '-p', REMOTE)
        for name in ('ffmpeg', 'quiet.wav', 'frame.bmp'):
            run('adb', 'push', str(tmp / name), REMOTE + '/' + name)
        run('adb', 'shell', 'chmod', '755', REMOTE + '/ffmpeg')
        ff('-loglevel', 'error', '-i', REMOTE + '/quiet.wav', '-c:a', 'libmp3lame', '-b:a', '192k', REMOTE + '/input.mp3')
        ff('-loglevel', 'error', '-i', REMOTE + '/quiet.wav', '-c:a', 'aac', '-b:a', '192k', REMOTE + '/input.m4a')
        ff('-loglevel', 'error', '-loop', '1', '-r', '5', '-i', REMOTE + '/frame.bmp', '-i', REMOTE + '/quiet.wav',
           '-t', str(seconds), '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', REMOTE + '/input.mp4')
        results = []
        for ext in ('mp3', 'm4a', 'mp4'):
            source, target = f'{REMOTE}/input.{ext}', f'{REMOTE}/normalized.{ext}'
            before = measure(source)
            # Matches AudioNormalizer's native processing options.
            ff('-loglevel', 'error', '-i', source, '-map', '0:v?', '-map', '0:a:0', '-map_metadata', '0',
               '-c:v', 'copy', '-c:a', 'libmp3lame' if ext == 'mp3' else 'aac', '-b:a', '192k', '-threads', '2',
               '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', target)
            after = measure(target)
            gain = after['input_i'] - before['input_i']
            result = {'format': ext, 'before': before, 'after': after, 'gain_lu': round(gain, 2)}
            assert math.isfinite(gain) and gain >= 10, result
            assert abs(after['input_i'] + 16) <= 1.5, result
            assert after['input_tp'] <= -1.0, result
            if ext == 'mp4':
                hashes = []
                for name, path in (('before', source), ('after', target)):
                    video = f'{REMOTE}/video-{name}.mp4'
                    ff('-loglevel', 'error', '-i', path, '-map', '0:v:0', '-an', '-c:v', 'copy', video)
                    local = tmp / f'video-{name}.mp4'
                    run('adb', 'pull', video, str(local))
                    hashes.append(mdat_hash(local))
                assert hashes[0] == hashes[1], 'Video bytes changed during audio normalization'
                result['video_payload_sha256'] = hashes[0]
                result['video_copied_unchanged'] = True
            for name in ('input', 'normalized'):
                run('adb', 'pull', f'{REMOTE}/{name}.{ext}', str(output_dir / f'{name}.{ext}'))
            results.append(result)
            print(json.dumps(result), flush=True)
        if '--fixtures-only' not in sys.argv[3:]:
            # Also measure the actual MP3 saved by the app's preceding download smoke.
            paths = run('adb', 'shell', "find /sdcard/Download/DownloadAja -type f -name '*.mp3'").splitlines()
            assert paths, 'No real downloaded MP3 to audit'
            source = paths[0].strip()
            target = REMOTE + '/download-normalized.mp3'
            before = measure(source)
            ff('-loglevel', 'error', '-i', source, '-map', '0:v?', '-map', '0:a:0', '-map_metadata', '0',
               '-c:v', 'copy', '-c:a', 'libmp3lame', '-b:a', '192k', '-threads', '2',
               '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', target)
            after = measure(target)
            assert abs(after['input_i'] + 16) <= 1.5 and after['input_tp'] <= -1.0, after
            actual = {'format': 'downloaded-mp3', 'source_file': Path(source).name, 'before': before, 'after': after,
                      'gain_lu': round(after['input_i'] - before['input_i'], 2)}
            results.append(actual)
            print(json.dumps(actual), flush=True)
        report = {'apk': apk.name, 'ffmpeg_sha256': hashlib.sha256(binary).hexdigest(),
                  'source': 'Self-generated 8-second two-tone PCM and original 32x32 image',
                  'scope': 'Native Android FFmpeg command; not a real-device listening test or preview gain measurement',
                  'passed': True, 'downloaded_mp3_audited': any(r['format'] == 'downloaded-mp3' for r in results), 'results': results}
        (output_dir / 'report.json').write_text(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
