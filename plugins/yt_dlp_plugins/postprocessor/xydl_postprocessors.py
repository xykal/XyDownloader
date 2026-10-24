"""yt-dlp discovery shim only. Pixiv implementation lives in engines/pixiv/."""
from ..engines.pixiv.postprocessor import XyUgoiraPP

__all__ = ['XyUgoiraPP']
XyUgoiraPP.__module__ = __name__
