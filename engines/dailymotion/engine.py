"""Dailymotion engine entry point.

Backend: upstream yt-dlp; do not fork/copy its third-party implementation.
Site-specific runtime changes belong in this folder.
"""
from .._common.runtime import PlatformEngine


class EngineDailymotion(PlatformEngine):
    platform_id = 'dailymotion'

    def extraction_attempts(self):
        return super().extraction_attempts()

    def extract(self, downloader, url, *, download=False):
        return self.extract_with(downloader, url, download=download)


ENGINE = EngineDailymotion(__file__)
