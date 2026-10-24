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

    def extract(self, downloader, url, *, download=False):
        return self.extract_with(downloader, url, download=download)


ENGINE = EngineYoutube(__file__)
