package id.my.xyverse.xydownloader.engines

import com.yausername.youtubedl_android.YoutubeDLRequest
import id.my.xyverse.xydownloader.PlatformCatalog
import id.my.xyverse.xydownloader.engines.twitter.TwitterPolicy
import id.my.xyverse.xydownloader.engines.pixiv.PixivPolicy

/** Routing only. Site-specific CLI policy is owned by that engine's folder. */
interface AndroidEnginePolicy {
    val id: String
    fun attempts(): List<String?> = listOf(null)
    fun apply(request: YoutubeDLRequest, variant: String?) {}
    fun configureDownload(request: YoutubeDLRequest, kind: String): Boolean = false
}

object PlatformRuntime {
    private object Default : AndroidEnginePolicy { override val id = "default" }
    private val policies = listOf(TwitterPolicy, PixivPolicy).associateBy { it.id }
    fun forUrl(url: String?): AndroidEnginePolicy {
        val id = PlatformCatalog.detect(url)?.id ?: return Default
        return policies[id] ?: Default
    }
}
