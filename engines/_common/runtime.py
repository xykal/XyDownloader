"""Shared mechanics only; no platform names, URL rules or extractor implementations."""
from copy import deepcopy
import json
from pathlib import Path
from urllib.parse import urlparse


class PlatformEngine:
    platform_id = None

    def __init__(self, source_file):
        self.directory = Path(source_file).resolve().parent
        self.metadata = json.loads((self.directory / 'platform.json').read_text(encoding='utf-8'))
        if self.metadata['id'] != self.platform_id:
            raise ValueError('Engine identity does not match its own metadata')

    def matches(self, url):
        try:
            host = (urlparse(url).hostname or '').lower()
        except ValueError:
            return False
        return any(host == domain or host.endswith('.' + domain) for domain in self.metadata['domains'])

    @property
    def needs_js(self):
        return bool(self.metadata.get('runtime', {}).get('needs_js', False))

    def extraction_attempts(self):
        return deepcopy(self.metadata.get('runtime', {}).get('attempts', [{}]))

    def request_options(self, request):
        return {}

    def extract_with(self, downloader, url, *, download=False):
        if not self.matches(url):
            raise ValueError(f'URL does not belong to engine {self.platform_id}')
        return downloader.extract_info(url, download=download)
