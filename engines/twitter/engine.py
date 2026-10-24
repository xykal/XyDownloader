"""X / Twitter engine entry point.

Backend: DownloadAja custom extractor in extractor.py.
Site-specific runtime changes belong in this folder.
"""
from .._common.runtime import PlatformEngine


class EngineTwitter(PlatformEngine):
    platform_id = 'twitter'

    def extraction_attempts(self):
        return [
            {'extractor_args': {'twitter': {'api': ['syndication']}}},
            {'extractor_args': {'twitter': {'api': ['graphql']}}},
        ]

    def request_options(self, request):
        variant = request.get('engine_variant', request.get('twitter_api'))
        return {'extractor_args': {'twitter': {'api': [variant]}}} if variant else {}

    def extract(self, downloader, url, *, download=False):
        return self.extract_with(downloader, url, download=download)


ENGINE = EngineTwitter(__file__)
