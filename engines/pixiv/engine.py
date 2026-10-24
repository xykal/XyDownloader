"""pixiv engine entry point.

Backend: DownloadAja custom extractor in extractor.py.
Site-specific runtime changes belong in this folder.
"""
from .._common.runtime import PlatformEngine


class EnginePixiv(PlatformEngine):
    platform_id = 'pixiv'

    def extraction_attempts(self):
        return super().extraction_attempts()

    def extract(self, downloader, url, *, download=False):
        return self.extract_with(downloader, url, download=download)


ENGINE = EnginePixiv(__file__)
