package id.my.xyverse.xydownloader.engines

import com.yausername.youtubedl_android.YoutubeDLRequest
import id.my.xyverse.xydownloader.PlatformCatalog
import id.my.xyverse.xydownloader.engines.twitter.TwitterPolicy

/** Routing only. Site-specific CLI policy is owned by that engine's folder. */
interface AndroidEnginePolicy {
    val id: String
    fun attempts(): List<String?> = listOf(null)
    fun apply(request: YoutubeDLRequest, variant: String?) {}
}

object PlatformRuntime {
    private object Default : AndroidEnginePolicy { override val id = "default" }
    private val policies = listOf(TwitterPolicy).associateBy { it.id }
    fun forUrl(url: String?): AndroidEnginePolicy {
        val id = PlatformCatalog.detect(url)?.id ?: return Default
        return policies[id] ?: Default
    }
}
