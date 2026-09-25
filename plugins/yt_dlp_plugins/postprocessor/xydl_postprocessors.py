# XyDownloader — postprocessor plugin yt-dlp
# XyUgoiraPP: mengubah ugoira pixiv (ZIP berisi frame + delay per frame) menjadi video MP4.
# Dipakai aplikasi Android:  yt-dlp --use-postprocessor XyUgoira ...
# (di web, konversi yang sama dilakukan di browser dengan ffmpeg.wasm)
import os
import shutil
import zipfile

from yt_dlp.postprocessor.ffmpeg import FFmpegPostProcessor
from yt_dlp.utils import PostProcessingError

__all__ = ['XyUgoiraPP']


class XyUgoiraPP(FFmpegPostProcessor):
    def run(self, info):
        meta = info.get('xy_ugoira') or {}
        path = info.get('filepath')
        frames = meta.get('frames') or []
        if not frames or not path or not os.path.exists(path) or not zipfile.is_zipfile(path):
            return [], info
        workdir = path + '.frames'
        os.makedirs(workdir, exist_ok=True)
        try:
            with zipfile.ZipFile(path) as z:
                z.extractall(workdir)
            listfile = os.path.join(workdir, 'concat.txt')
            with open(listfile, 'w', encoding='utf-8') as f:
                f.write('ffconcat version 1.0\n')
                for fr in frames:
                    f.write(f"file '{fr['file']}'\nduration {max(fr.get('delay') or 100, 20) / 1000:.3f}\n")
                f.write(f"file '{frames[-1]['file']}'\n")  # frame terakhir perlu diulang agar durasinya dipakai
            out = os.path.splitext(path)[0] + '.mp4'
            self.to_screen(f'Mengubah ugoira ({len(frames)} frame) menjadi MP4')
            base = ['-fps_mode', 'vfr', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-pix_fmt', 'yuv420p',
                    '-movflags', '+faststart']
            try:
                self.real_run_ffmpeg([(listfile, ['-f', 'concat', '-safe', '0'])],
                                     [(out, base + ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'])])
            except Exception:
                # build FFmpeg tanpa libx264 -> encoder bawaan mpeg4
                self.real_run_ffmpeg([(listfile, ['-f', 'concat', '-safe', '0'])],
                                     [(out, base + ['-c:v', 'mpeg4', '-q:v', '3'])])
        except PostProcessingError:
            raise
        except Exception as e:
            raise PostProcessingError(f'Gagal mengubah ugoira: {e}')
        finally:
            shutil.rmtree(workdir, ignore_errors=True)
        info['filepath'] = out
        info['ext'] = 'mp4'
        return [path], info
