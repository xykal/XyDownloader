"""Xiaohongshu 小红书 engine entry point.

Backend: DownloadAja custom extractor in extractor.py.
Site-specific runtime changes belong in this folder.
"""
from .._common.runtime import PlatformEngine


class EngineXiaohongshu(PlatformEngine):
    platform_id = 'xiaohongshu'

    def extract(self, downloader, url, *, download=False):
        return self.extract_with(downloader, url, download=download)


ENGINE = EngineXiaohongshu(__file__)
