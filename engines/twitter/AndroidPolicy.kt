package id.my.xyverse.xydownloader.engines.twitter

import com.yausername.youtubedl_android.YoutubeDLRequest
import id.my.xyverse.xydownloader.engines.AndroidEnginePolicy

/** Twitter-specific retries/arguments, not mixed into the generic Android Engine. */
object TwitterPolicy : AndroidEnginePolicy {
    override val id = "twitter"
    override fun attempts(): List<String?> = listOf("syndication", null)
    override fun apply(request: YoutubeDLRequest, variant: String?) {
        if (variant != null) request.addOption("--extractor-args", "twitter:api=$variant")
    }
}
