"""Bilibili engine entry point.

Backend: DownloadAja custom extractor in extractor.py.
Site-specific runtime changes belong in this folder.
"""
from .._common.runtime import PlatformEngine


class EngineBilibili(PlatformEngine):
    platform_id = 'bilibili'

    def extract(self, downloader, url, *, download=False):
        return self.extract_with(downloader, url, download=download)


ENGINE = EngineBilibili(__file__)
