"""SnackVideo engine entry point.

Backend: upstream yt-dlp; do not fork/copy its third-party implementation.
Site-specific runtime changes belong in this folder.
"""
from .._common.runtime import PlatformEngine


class EngineSnackvideo(PlatformEngine):
    platform_id = 'snackvideo'

    def extract(self, downloader, url, *, download=False):
        return self.extract_with(downloader, url, download=download)


ENGINE = EngineSnackvideo(__file__)
