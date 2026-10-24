"""YouTube engine entry point.

Backend: upstream yt-dlp; do not fork/copy its third-party implementation.
Site-specific runtime changes belong in this folder.
"""
from .._common.runtime import PlatformEngine


class EngineYoutube(PlatformEngine):
    platform_id = 'youtube'

    @property
    def needs_js(self):
        return True

    def filter_video_choices(self, videos, best_audio, info, has_audio):
        # Muxed format 18 can disappear between requests; prefer stable DASH pairs.
        if best_audio is not None and 'youtube' in (info.get('extractor_key') or '').lower():
            return [f for f in videos if not has_audio(f)] or videos
        return videos

    def extract(self, downloader, url, *, download=False):
        return self.extract_with(downloader, url, download=download)


ENGINE = EngineYoutube(__file__)
