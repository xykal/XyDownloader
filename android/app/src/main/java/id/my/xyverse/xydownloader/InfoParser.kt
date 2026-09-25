package id.my.xyverse.xydownloader

import org.json.JSONArray
import org.json.JSONObject
import java.util.TreeMap
import kotlin.math.max
import kotlin.math.min

data class VideoOption(val height: Int, val label: String, val sizeBytes: Long?, val codec: String?)

data class EntryInfo(val index: Int, val title: String, val thumbnail: String?, val duration: Double?)

data class MediaInfo(
    val sourceUrl: String,
    val title: String,
    val uploader: String?,
    val thumbnail: String?,
    val duration: Double?,
    val platform: String,
    val videoOptions: List<VideoOption>,
    val hasAudio: Boolean,
    val entries: List<EntryInfo> = emptyList(),
    /** Halaman gambar (mis. ilustrasi/manga pixiv). */
    val images: List<EntryInfo> = emptyList(),
    /** Ugoira pixiv (animasi) -> dikonversi ke MP4 oleh plugin XyUgoiraPP. */
    val isUgoira: Boolean = false,
)

/** Parser JSON output yt-dlp (--dump-single-json) memakai org.json bawaan Android. */
object InfoParser {
    private val imageExts = setOf("jpg", "jpeg", "png", "webp", "gif", "mhtml")

    fun parse(json: JSONObject, sourceUrl: String): MediaInfo {
        val platform = json.optStr("extractor_key") ?: json.optStr("extractor") ?: Engine.hostOf(sourceUrl)
        val entriesArr: JSONArray? = json.optJSONArray("entries")
        if (entriesArr != null) {
            val entries = ArrayList<EntryInfo>()
            for (i in 0 until entriesArr.length()) {
                val e = entriesArr.optJSONObject(i) ?: continue
                entries.add(EntryInfo(i + 1, e.optStr("title") ?: "Item ${i + 1}", thumbnailOf(e), e.optDur()))
            }
            val first = entriesArr.optJSONObject(0)
            if (entries.size == 1 && first != null) return single(first, sourceUrl, platform)
            val allImages = entries.isNotEmpty() && (0 until entriesArr.length()).all {
                entriesArr.optJSONObject(it)?.optBoolean("xy_image", false) == true
            }
            if (allImages) {
                return MediaInfo(
                    sourceUrl = sourceUrl,
                    title = json.optStr("title") ?: first?.optStr("title") ?: "Gambar",
                    uploader = json.optStr("uploader") ?: first?.optStr("uploader"),
                    thumbnail = thumbnailOf(json) ?: first?.let { thumbnailOf(it) },
                    duration = null,
                    platform = platform,
                    videoOptions = emptyList(),
                    hasAudio = false,
                    images = entries,
                )
            }
            return MediaInfo(
                sourceUrl = sourceUrl,
                title = json.optStr("title") ?: first?.optStr("title") ?: "Playlist",
                uploader = json.optStr("uploader") ?: first?.optStr("uploader"),
                thumbnail = thumbnailOf(json) ?: first?.let { thumbnailOf(it) },
                duration = null,
                platform = platform,
                videoOptions = first?.let { videoOptions(it) } ?: emptyList(),
                hasAudio = true,
                entries = entries,
            )
        }
        return single(json, sourceUrl, platform)
    }

    private fun single(json: JSONObject, sourceUrl: String, platform: String): MediaInfo {
        val title = json.optStr("title") ?: json.optStr("id") ?: "Video"
        if (json.optBoolean("xy_image", false) || json.has("xy_ugoira")) {
            val ugoira = json.has("xy_ugoira")
            return MediaInfo(
                sourceUrl = sourceUrl,
                title = title,
                uploader = json.optStr("uploader"),
                thumbnail = thumbnailOf(json),
                duration = if (ugoira) json.optDur() else null,
                platform = platform,
                videoOptions = emptyList(),
                hasAudio = false,
                images = if (ugoira) emptyList() else listOf(EntryInfo(1, title, thumbnailOf(json), null)),
                isUgoira = ugoira,
            )
        }
        val formats = json.optJSONArray("formats")
        var hasAudio = false
        if (formats != null) {
            for (i in 0 until formats.length()) {
                val f = formats.optJSONObject(i) ?: continue
                if (f.optStr("acodec") != "none") hasAudio = true
            }
        } else hasAudio = true
        return MediaInfo(
            sourceUrl = sourceUrl,
            title = title,
            uploader = json.optStr("uploader") ?: json.optStr("channel") ?: json.optStr("uploader_id"),
            thumbnail = thumbnailOf(json),
            duration = json.optDur(),
            platform = platform,
            videoOptions = videoOptions(json),
            hasAudio = hasAudio,
        )
    }

    fun videoOptions(json: JSONObject): List<VideoOption> {
        val formats = json.optJSONArray("formats") ?: return listOf(VideoOption(0, "Terbaik", null, null))
        var bestAudio = 0L
        for (i in 0 until formats.length()) {
            val f = formats.optJSONObject(i) ?: continue
            if (f.optStr("vcodec") == "none" && f.optStr("acodec") != "none") bestAudio = max(bestAudio, sizeOf(f) ?: 0L)
        }
        val byHeight = TreeMap<Int, Pair<Long?, String?>>(Comparator.reverseOrder())
        for (i in 0 until formats.length()) {
            val f = formats.optJSONObject(i) ?: continue
            val vcodec = f.optStr("vcodec")
            if (vcodec == "none") continue
            if ((f.optStr("ext") ?: "") in imageExts) continue
            val w = f.optInt("width", 0)
            val h = f.optInt("height", 0)
            val q = if (w > 0 && h > 0) min(w, h) else h
            if (q <= 0) continue
            val size = sizeOf(f)?.let { if (f.optStr("acodec") == "none") it + bestAudio else it }
            val prev = byHeight[q]
            val codec = codecLabel(vcodec)
            if (prev == null || (size ?: 0L) > (prev.first ?: 0L)) byHeight[q] = Pair(size, codec ?: prev?.second)
        }
        if (byHeight.isEmpty()) return listOf(VideoOption(0, "Terbaik", sizeOf(json), null))
        return byHeight.entries.take(8).map { (q, v) -> VideoOption(q, "${q}p", v.first, v.second) }
    }

    private fun codecLabel(v: String?): String? {
        val c = (v ?: "").lowercase()
        return when {
            c.startsWith("avc") || c.startsWith("h264") -> "H.264"
            c.startsWith("hev") || c.startsWith("hvc") || c.startsWith("h265") -> "HEVC"
            c.startsWith("av01") -> "AV1"
            c.startsWith("vp9") || c.startsWith("vp09") -> "VP9"
            else -> null
        }
    }

    private fun sizeOf(f: JSONObject): Long? {
        val a = f.optLong("filesize", 0L)
        if (a > 0) return a
        val b = f.optLong("filesize_approx", 0L)
        return if (b > 0) b else null
    }

    private fun thumbnailOf(json: JSONObject): String? {
        json.optStr("thumbnail")?.let { return it }
        val arr = json.optJSONArray("thumbnails") ?: return null
        for (i in arr.length() - 1 downTo 0) {
            arr.optJSONObject(i)?.optStr("url")?.let { return it }
        }
        return null
    }

    private fun JSONObject.optStr(key: String): String? {
        if (!has(key) || isNull(key)) return null
        val v = optString(key, "")
        return v.ifBlank { null }
    }

    private fun JSONObject.optDur(): Double? {
        val d = optDouble("duration", Double.NaN)
        return if (d.isNaN() || d <= 0) null else d
    }
}
