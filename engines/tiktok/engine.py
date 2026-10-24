"""TikTok engine entry point.

Backend: DownloadAja custom extractor in extractor.py.
Site-specific runtime changes belong in this folder.
"""
from .._common.runtime import PlatformEngine


class EngineTiktok(PlatformEngine):
    platform_id = 'tiktok'

    def extract(self, downloader, url, *, download=False):
        return self.extract_with(downloader, url, download=download)


ENGINE = EngineTiktok(__file__)
