"""Huya 虎牙 engine entry point.

Backend: upstream yt-dlp; do not fork/copy its third-party implementation.
Site-specific runtime changes belong in this folder.
"""
from .._common.runtime import PlatformEngine


class EngineHuya(PlatformEngine):
    platform_id = 'huya'

    def extract(self, downloader, url, *, download=False):
        return self.extract_with(downloader, url, download=download)


ENGINE = EngineHuya(__file__)
