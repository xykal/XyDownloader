"""yt-dlp discovery entry point. Implementations live in ../engines/<platform>/.

Keep this module for compatibility with web, Android and existing imports.
"""
from ..engines.douyin.extractor import XyDouyinIE
from ..engines.kuaishou.extractor import XyKuaishouIE
from ..engines.threads.extractor import XyThreadsIE
from ..engines.bilibili.extractor import XyBiliBiliIE
from ..engines.pixiv.extractor import XyPixivIE
from ..engines.tiktok.extractor import XyTikTokIE
from ..engines.twitter.extractor import XyTwitterIE
from ..engines.instagram.extractor import XyInstagramIE
from ..engines.bluesky.extractor import XyBlueskyIE
from ..engines.weibo.extractor import XyWeiboIE
from ..engines.xiaohongshu.extractor import XyXiaoHongShuIE

__all__ = ['XyDouyinIE', 'XyKuaishouIE', 'XyThreadsIE', 'XyBiliBiliIE', 'XyPixivIE', 'XyTikTokIE', 'XyTwitterIE', 'XyInstagramIE', 'XyBlueskyIE', 'XyWeiboIE', 'XyXiaoHongShuIE']

# yt-dlp only discovers classes whose __module__ matches this entry point.
# Re-export the actual classes (not subclasses) to preserve super() behaviour.
for _name in __all__:
    _cls = globals().get(_name)
    if _cls is not None:
        _cls.__module__ = __name__
del _cls, _name
