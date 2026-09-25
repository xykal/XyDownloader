package id.my.xyverse.xydownloader

// AUTO-GENERATED oleh scripts/sync_android.py dari xydl/platforms.py — jangan diedit manual.

import androidx.annotation.DrawableRes

data class Region(val id: String, val name: String, val flag: String)

data class Platform(
    val id: String,
    val name: String,
    val region: String,
    val domains: List<String>,
    @DrawableRes val logo: Int,
    val note: String?,
)

object PlatformCatalog {
    val regions = listOf(
        Region("id", "Indonesia", "🇮🇩"),
        Region("cn", "China", "🇨🇳"),
        Region("jp", "Jepang", "🇯🇵"),
        Region("sg", "Singapura & Asia Tenggara", "🇸🇬"),
        Region("us", "Amerika Serikat", "🇺🇸"),
        Region("global", "Global", "🌐"),
    )

    val all = listOf(
        Platform("youtube", "YouTube", "us", listOf("youtube.com", "youtu.be", "youtube-nocookie.com"), R.drawable.logo_youtube, "Web: diblokir anti-bot YouTube untuk server cloud. Pakai aplikasi Android."),
        Platform("instagram", "Instagram", "us", listOf("instagram.com", "instagr.am"), R.drawable.logo_instagram, "Reels & post publik"),
        Platform("facebook", "Facebook", "us", listOf("facebook.com", "fb.watch", "fb.com"), R.drawable.logo_facebook, "Video & Reels publik"),
        Platform("twitter", "X / Twitter", "us", listOf("twitter.com", "x.com", "t.co", "fxtwitter.com", "vxtwitter.com"), R.drawable.logo_twitter, null),
        Platform("threads", "Threads", "us", listOf("threads.net", "threads.com"), R.drawable.logo_threads, "Plugin XyDownloader"),
        Platform("reddit", "Reddit", "us", listOf("reddit.com", "redd.it"), R.drawable.logo_reddit, "Web: kadang diblokir, pakai Android"),
        Platform("pinterest", "Pinterest", "us", listOf("pinterest.com", "pin.it"), R.drawable.logo_pinterest, null),
        Platform("snapchat", "Snapchat", "us", listOf("snapchat.com"), R.drawable.logo_snapchat, "Spotlight"),
        Platform("twitch", "Twitch", "us", listOf("twitch.tv"), R.drawable.logo_twitch, "Clips & VOD"),
        Platform("vimeo", "Vimeo", "us", listOf("vimeo.com"), R.drawable.logo_vimeo, "Web: sering diblokir, pakai Android"),
        Platform("soundcloud", "SoundCloud", "us", listOf("soundcloud.com"), R.drawable.logo_soundcloud, "Audio"),
        Platform("linkedin", "LinkedIn", "us", listOf("linkedin.com"), R.drawable.logo_linkedin, null),
        Platform("bluesky", "Bluesky", "us", listOf("bsky.app"), R.drawable.logo_bluesky, null),
        Platform("tumblr", "Tumblr", "us", listOf("tumblr.com"), R.drawable.logo_tumblr, null),
        Platform("rumble", "Rumble", "us", listOf("rumble.com"), R.drawable.logo_rumble, null),
        Platform("imgur", "Imgur", "us", listOf("imgur.com"), R.drawable.logo_imgur, null),
        Platform("tiktok", "TikTok", "global", listOf("tiktok.com"), R.drawable.logo_tiktok, "Tanpa watermark"),
        Platform("dailymotion", "Dailymotion", "global", listOf("dailymotion.com", "dai.ly"), R.drawable.logo_dailymotion, null),
        Platform("kick", "Kick", "global", listOf("kick.com"), R.drawable.logo_kick, "Clips & VOD"),
        Platform("9gag", "9GAG", "global", listOf("9gag.com"), R.drawable.logo_9gag, null),
        Platform("douyin", "Douyin 抖音", "cn", listOf("douyin.com", "iesdouyin.com"), R.drawable.logo_douyin, "Tanpa watermark. Web kadang ditolak (IP cloud), Android paling stabil."),
        Platform("kuaishou", "Kuaishou 快手", "cn", listOf("kuaishou.com", "chenzhongtech.com", "gifshow.com"), R.drawable.logo_kuaishou, "Plugin XyDownloader"),
        Platform("bilibili", "Bilibili", "cn", listOf("bilibili.com", "b23.tv", "bilibili.tv"), R.drawable.logo_bilibili, "Web: sering diblokir dari server cloud. Paling stabil lewat aplikasi Android."),
        Platform("xiaohongshu", "Xiaohongshu 小红书", "cn", listOf("xiaohongshu.com", "xhslink.com"), R.drawable.logo_xiaohongshu, "Pakai link share asli (ada xsec_token)"),
        Platform("weibo", "Weibo 微博", "cn", listOf("weibo.com", "weibo.cn"), R.drawable.logo_weibo, null),
        Platform("youku", "Youku 优酷", "cn", listOf("youku.com"), R.drawable.logo_youku, "Konten gratis"),
        Platform("vqq", "Tencent Video", "cn", listOf("v.qq.com"), R.drawable.logo_vqq, "Konten gratis"),
        Platform("zhihu", "Zhihu 知乎", "cn", listOf("zhihu.com"), R.drawable.logo_zhihu, null),
        Platform("acfun", "AcFun", "cn", listOf("acfun.cn"), R.drawable.logo_acfun, null),
        Platform("toutiao", "Toutiao 头条", "cn", listOf("toutiao.com"), R.drawable.logo_toutiao, null),
        Platform("ixigua", "Xigua 西瓜视频", "cn", listOf("ixigua.com"), R.drawable.logo_ixigua, "Kadang butuh cookie"),
        Platform("netease", "NetEase Music", "cn", listOf("music.163.com"), R.drawable.logo_netease, "Audio"),
        Platform("huya", "Huya 虎牙", "cn", listOf("huya.com"), R.drawable.logo_huya, null),
        Platform("douyu", "Douyu 斗鱼", "cn", listOf("douyu.com", "douyu.tv"), R.drawable.logo_douyu, null),
        Platform("pixiv", "pixiv", "jp", listOf("pixiv.net"), R.drawable.logo_pixiv, "Ilustrasi & manga resolusi asli, ugoira jadi MP4/GIF"),
        Platform("niconico", "Niconico", "jp", listOf("nicovideo.jp", "nico.ms"), R.drawable.logo_niconico, null),
        Platform("vidio", "Vidio", "id", listOf("vidio.com"), R.drawable.logo_vidio, "Konten gratis (bukan premium/DRM)"),
        Platform("snackvideo", "SnackVideo", "id", listOf("snackvideo.com", "sck.io"), R.drawable.logo_snackvideo, "Via generic extractor"),
        Platform("rctiplus", "RCTI+", "id", listOf("rctiplus.com"), R.drawable.logo_rctiplus, "Konten gratis"),
        Platform("liputan6", "Liputan6", "id", listOf("liputan6.com"), R.drawable.logo_liputan6, null),
        Platform("detik", "detikcom (20detik)", "id", listOf("detik.com"), R.drawable.logo_detik, null),
        Platform("kompas", "Kompas", "id", listOf("kompas.com", "kompas.tv"), R.drawable.logo_kompas, null),
        Platform("cnnindonesia", "CNN Indonesia", "id", listOf("cnnindonesia.com"), R.drawable.logo_cnnindonesia, null),
        Platform("likee", "Likee", "sg", listOf("likee.video", "likee.com"), R.drawable.logo_likee, "Tergantung yt-dlp"),
        Platform("bigo", "Bigo Live", "sg", listOf("bigo.tv"), R.drawable.logo_bigo, "Live"),
        Platform("mewatch", "meWATCH", "sg", listOf("mewatch.sg"), R.drawable.logo_mewatch, "Konten gratis"),
        Platform("kwai", "Kwai", "sg", listOf("kwai.com"), R.drawable.logo_kwai, "Via generic extractor"),
        Platform("shopee", "Shopee Video", "sg", listOf("shopee.co.id", "shopee.sg", "shp.ee"), R.drawable.logo_shopee, "Eksperimental"),
    )

    fun byRegion(regionId: String) = all.filter { it.region == regionId }

    /** Deteksi platform dari URL (berdasarkan domain). */
    fun detect(url: String?): Platform? {
        val host = Engine.hostOf(url ?: return null)
        if (host.isEmpty()) return null
        return all.firstOrNull { p -> p.domains.any { d -> host == d || host.endsWith(".$d") } }
    }
}
