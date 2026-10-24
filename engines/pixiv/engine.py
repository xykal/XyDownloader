"""pixiv engine entry point.

Backend: DownloadAja custom extractor in extractor.py.
Site-specific runtime changes belong in this folder.
"""
from .._common.runtime import PlatformEngine


class EnginePixiv(PlatformEngine):
    platform_id = 'pixiv'

    def build_special_entry(self, ctx, info, title, base_name, helpers):
        if info.get('xy_ugoira'):
            from .web import build_ugoira_entry
            return build_ugoira_entry(ctx, info, title, base_name, **helpers)
        return None

    def extract(self, downloader, url, *, download=False):
        return self.extract_with(downloader, url, download=download)


ENGINE = EnginePixiv(__file__)
