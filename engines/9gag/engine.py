"""9GAG engine entry point.

Backend: upstream yt-dlp; do not fork/copy its third-party implementation.
Site-specific runtime changes belong in this folder.
"""
from .._common.runtime import PlatformEngine


class Engine9Gag(PlatformEngine):
    platform_id = '9gag'

    def extract(self, downloader, url, *, download=False):
        return self.extract_with(downloader, url, download=download)


ENGINE = Engine9Gag(__file__)
