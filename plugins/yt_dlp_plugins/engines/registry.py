"""Load platform metadata without importing yt-dlp or custom extractors."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def platforms():
    return [json.loads(p.read_text(encoding='utf-8'))
            for p in sorted(ROOT.glob('*/platform.json'))]
