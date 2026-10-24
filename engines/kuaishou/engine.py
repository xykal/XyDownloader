"""Kuaishou 快手 engine entry point.

Backend: DownloadAja custom extractor in extractor.py.
Site-specific runtime changes belong in this folder.
"""
from .._common.runtime import PlatformEngine


class EngineKuaishou(PlatformEngine):
    platform_id = 'kuaishou'

    def extract(self, downloader, url, *, download=False):
        return self.extract_with(downloader, url, download=download)


ENGINE = EngineKuaishou(__file__)
