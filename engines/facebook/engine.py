"""Facebook engine entry point.

Backend: upstream yt-dlp; do not fork/copy its third-party implementation.
Site-specific runtime changes belong in this folder.
"""
from .._common.runtime import PlatformEngine


class EngineFacebook(PlatformEngine):
    platform_id = 'facebook'

    def extraction_attempts(self):
        return super().extraction_attempts()

    def extract(self, downloader, url, *, download=False):
        return self.extract_with(downloader, url, download=download)


ENGINE = EngineFacebook(__file__)
