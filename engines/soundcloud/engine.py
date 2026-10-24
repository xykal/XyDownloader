"""SoundCloud engine entry point.

Backend: upstream yt-dlp; do not fork/copy its third-party implementation.
Site-specific runtime changes belong in this folder.
"""
from .._common.runtime import PlatformEngine


class EngineSoundcloud(PlatformEngine):
    platform_id = 'soundcloud'

    def extract(self, downloader, url, *, download=False):
        return self.extract_with(downloader, url, download=download)


ENGINE = EngineSoundcloud(__file__)
