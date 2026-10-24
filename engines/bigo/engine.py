"""Bigo Live engine entry point.

Backend: upstream yt-dlp; do not fork/copy its third-party implementation.
Site-specific runtime changes belong in this folder.
"""
from .._common.runtime import PlatformEngine


class EngineBigo(PlatformEngine):
    platform_id = 'bigo'

    def extraction_attempts(self):
        return super().extraction_attempts()

    def extract(self, downloader, url, *, download=False):
        return self.extract_with(downloader, url, download=download)


ENGINE = EngineBigo(__file__)
