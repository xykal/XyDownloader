package id.my.xyverse.xydownloader.engines.pixiv

import com.yausername.youtubedl_android.YoutubeDLRequest
import id.my.xyverse.xydownloader.engines.AndroidEnginePolicy

/** Pixiv ugoira conversion is owned by Pixiv, not the common download builder. */
object PixivPolicy : AndroidEnginePolicy {
    override val id = "pixiv"
    override fun configureDownload(request: YoutubeDLRequest, kind: String): Boolean {
        if (kind != "ugoira") return false
        request.addOption("--use-postprocessor", "XyUgoira")
        return true
    }
}
