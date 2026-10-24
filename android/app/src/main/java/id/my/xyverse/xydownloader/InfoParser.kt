package id.my.xyverse.xydownloader

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

data class VideoOption(
    val height: Int, val label: String, val sizeBytes: Long?, val codec: String?,
    val formatId: String? = null, val selector: String? = null, val container: String? = null,
)
data class AudioOption(val formatId: String, val label: String, val sizeBytes: Long?)

data class EntryInfo(val index: Int, val title: String, val thumbnail: String?, val duration: Double?)

/** Sumber HTTP + header yang dibutuhkan (Referer, User-Agent, Cookie, ...). */
data class HttpSource(val url: String, val headers: Map<String, String>, val ext: String?)

/** Pratinjau: video (muxed / HLS) atau video-only + audio terpisah (diputar bersamaan). */
data class PreviewSource(val video: HttpSource, val audio: HttpSource?, val hls: Boolean, val width: Int, val height: Int)

enum class ItemType { IMAGE, LIVE, VIDEO }

/** Satu item galeri: foto, Live Photo (foto + video pendek), atau video di dalam carousel. */
data class GalleryItem(
    val index: Int,
    val type: ItemType,
    val title: String,
    val thumb: String?,
    val image: HttpSource?,
    val video: HttpSource?,
    val width: Int,
    val height: Int,
    val duration: Double?,
    /** Video tanpa file siap-unduh (mis. DASH) -> diunduh lewat yt-dlp (--playlist-items). */
    val needsYtDlp: Boolean = false,
) {
    val headers: Map<String, String> get() = (image ?: video)?.headers ?: emptyMap()
}

data class MusicTrack(val source: HttpSource, val title: String?)

data class MediaInfo(
    val sourceUrl: String,
    val title: String,
    val uploader: String?,
    val thumbnail: String?,
    val duration: Double?,
    val platform: String,
    val videoOptions: List<VideoOption>,
    val hasAudio: Boolean,
    val audioOptions: List<AudioOption> = emptyList(),
    val entries: List<EntryInfo> = emptyList(),
    /** Ugoira pixiv (animasi) -> dikonversi ke MP4 oleh plugin XyUgoiraPP. */
    val isUgoira: Boolean = false,
    /** Foto slide / carousel / Live Photo (bisa dipilih satu per satu). */
    val gallery: List<GalleryItem> = emptyList(),
    /** Musik latar foto slide (TikTok/Douyin/Kuaishou). */
    val music: MusicTrack? = null,
    val preview: PreviewSource? = null,
    /** File info JSON hasil "proses link" (dipakai ulang saat download: --load-info-json). */
    val infoPath: String? = null,
)

/** Parser JSON output yt-dlp (--dump-single-json / daemon) memakai org.json bawaan Android. */
object InfoParser {
    private val imageExts = setOf("jpg", "jpeg", "png", "webp", "gif", "mhtml", "heic", "avif", "bmp")

    fun parse(json: JSONObject, sourceUrl: String, infoPath: String? = null): MediaInfo {
        val platform = json.optStr("extractor_key") ?: json.optStr("extractor") ?: Engine.hostOf(sourceUrl)
        val entriesArr: JSONArray? = json.optJSONArray("entries")
        val entryObjs = ArrayList<JSONObject>()
        if (entriesArr != null) for (i in 0 until entriesArr.length()) entriesArr.optJSONObject(i)?.let { entryObjs.add(it) }

        // ---- galeri: foto slide / carousel / Live Photo
        val isGallery = json.optBoolean("xy_gallery", false) || entryObjs.any { isGalleryItem(it) } ||
            (entriesArr == null && isGalleryItem(json))
        if (isGallery) {
            val items = (if (entriesArr != null) entryObjs else listOf(json))
                .mapIndexedNotNull { i, e -> galleryItem(e, i + 1) }
            val first = entryObjs.firstOrNull() ?: json
            return MediaInfo(
                sourceUrl = sourceUrl,
                title = json.optStr("title") ?: first.optStr("title") ?: "Galeri",
                uploader = json.optStr("uploader") ?: first.optStr("uploader"),
                thumbnail = thumbnailOf(json) ?: items.firstOrNull()?.thumb,
                duration = null,
                platform = platform,
                videoOptions = emptyList(),
                hasAudio = false,
                gallery = items,
                music = json.optJSONObject("xy_audio")?.let { a ->
                    a.optStr("url")?.let { u -> MusicTrack(HttpSource(u, headersOf(a), a.optStr("ext") ?: "mp3"), a.optStr("title")) }
                },
                infoPath = infoPath,
            )
        }

        if (entriesArr != null) {
            val entries = entryObjs.mapIndexed { i, e -> EntryInfo(i + 1, e.optStr("title") ?: "Item ${i + 1}", thumbnailOf(e), e.optDur()) }
            val first = entryObjs.firstOrNull()
            if (entries.size == 1 && first != null) return single(first, sourceUrl, platform, infoPath)
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
                infoPath = infoPath,
            )
        }
        return single(json, sourceUrl, platform, infoPath)
    }

    private fun isGalleryItem(o: JSONObject) = o.optBoolean("xy_image", false) || o.optBoolean("xy_live", false)

    private fun single(json: JSONObject, sourceUrl: String, platform: String, infoPath: String?): MediaInfo {
        val title = json.optStr("title") ?: json.optStr("id") ?: "Video"
        if (json.has("xy_ugoira")) {
            return MediaInfo(
                sourceUrl = sourceUrl, title = title, uploader = json.optStr("uploader"),
                thumbnail = thumbnailOf(json), duration = json.optDur(), platform = platform,
                videoOptions = emptyList(), hasAudio = false, isUgoira = true, infoPath = infoPath,
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
            audioOptions = audioOptions(json),
            preview = formats?.let { pickPreview(it) },
            infoPath = infoPath,
        )
    }

    // ------------------------------------------------------------------ galeri
    private fun galleryItem(e: JSONObject, index: Int): GalleryItem? {
        val formats = e.optJSONArray("formats") ?: JSONArray()
        val list = (0 until formats.length()).mapNotNull { formats.optJSONObject(it) }.filter { it.optStr("url") != null }
        val title = e.optStr("title") ?: "Item $index"
        if (isGalleryItem(e)) {
            val img = list.firstOrNull { it.optStr("format_id") == "image" } ?: list.firstOrNull() ?: return null
            val live = if (e.optBoolean("xy_live", false)) list.firstOrNull { it.optStr("format_id") == "live" } else null
            val image = HttpSource(img.getString("url"), headersOf(img), (img.optStr("ext") ?: "jpg").lowercase(Locale.ROOT))
            return GalleryItem(
                index = index,
                type = if (live != null) ItemType.LIVE else ItemType.IMAGE,
                title = title,
                thumb = thumbnailOf(e) ?: image.url,
                image = image,
                video = live?.let { HttpSource(it.getString("url"), headersOf(it), (it.optStr("ext") ?: "mp4").lowercase(Locale.ROOT)) },
                width = img.optInt("width", 0),
                height = img.optInt("height", 0),
                duration = e.optDur(),
            )
        }
        // video di dalam carousel: pilih file muxed siap-unduh terbaik (<= 1080p, H.264 diutamakan)
        val candidates = list.filter { isDirect(it) && hasVideo(it) && it.optStr("acodec") != "none" && !watermarked(it) }
        val best = candidates.maxWithOrNull(compareBy<JSONObject>({ shortSide(it) in 1..1080 }, {
            val q = shortSide(it); if (q <= 1080) q else -q
        }, { codecScore(it) }, { it.optDouble("tbr", 0.0) }))
        return GalleryItem(
            index = index,
            type = ItemType.VIDEO,
            title = title,
            thumb = thumbnailOf(e),
            image = null,
            video = best?.let { HttpSource(it.getString("url"), headersOf(it), (it.optStr("ext") ?: "mp4").lowercase(Locale.ROOT)) },
            width = best?.optInt("width", 0) ?: e.optInt("width", 0),
            height = best?.optInt("height", 0) ?: e.optInt("height", 0),
            duration = e.optDur(),
            needsYtDlp = best == null,
        )
    }

    // ------------------------------------------------------------------ pratinjau
    private fun pickPreview(formats: JSONArray): PreviewSource? {
        val list = (0 until formats.length()).mapNotNull { formats.optJSONObject(it) }
            .filter { it.optStr("url") != null && hasVideo(it) && (it.optStr("ext") ?: "") !in imageExts }
        val near480 = compareBy<JSONObject>({ shortSide(it) in 1..480 }, {
            val q = shortSide(it); if (q <= 480) q else -q
        }, { codecScore(it) })
        val muxed = list.filter { it.optStr("acodec") != "none" && !watermarked(it) }
        muxed.filter { isDirect(it) }.maxWithOrNull(near480)?.let { return preview(it, null, false) }
        muxed.filter { isHls(it) }.maxWithOrNull(near480)?.let { return preview(it, null, true) }
        val videoOnly = list.filter { it.optStr("acodec") == "none" && isDirect(it) && codecScore(it) >= 2 }
        val audio = (0 until formats.length()).mapNotNull { formats.optJSONObject(it) }
            .filter { it.optStr("url") != null && it.optStr("vcodec") == "none" && it.optStr("acodec") != "none" && isDirect(it) }
            .maxWithOrNull(compareBy({ (it.optStr("ext") ?: "") == "m4a" }, { it.optDouble("abr", 0.0) }))
        val v = videoOnly.maxWithOrNull(near480)
        if (v != null && audio != null) return preview(v, audio, false)
        return null
    }

    private fun preview(v: JSONObject, a: JSONObject?, hls: Boolean) = PreviewSource(
        video = HttpSource(v.getString("url"), headersOf(v), v.optStr("ext")),
        audio = a?.let { HttpSource(it.getString("url"), headersOf(it), it.optStr("ext")) },
        hls = hls,
        width = v.optInt("width", 0),
        height = v.optInt("height", 0),
    )

    // ------------------------------------------------------------------ util format
    private fun protocol(f: JSONObject) = (f.optStr("protocol") ?: "https").substringBefore('+')
    private fun isDirect(f: JSONObject) = protocol(f) in setOf("http", "https") && !f.has("fragments")
    private fun isHls(f: JSONObject) = protocol(f) in setOf("m3u8", "m3u8_native")
    private fun hasVideo(f: JSONObject) = f.optStr("vcodec") != "none" &&
        !(f.optStr("video_ext") == "none" && (f.optStr("audio_ext") ?: "none") != "none")
    private fun watermarked(f: JSONObject): Boolean {
        val note = "${f.optStr("format_note") ?: ""} ${f.optStr("format_id") ?: ""}".lowercase(Locale.ROOT)
        return "watermark" in note || note.trim().startsWith("download")
    }
    private fun shortSide(f: JSONObject): Int {
        val w = f.optInt("width", 0)
        val h = f.optInt("height", 0)
        return if (w > 0 && h > 0) min(w, h) else max(w, h)
    }
    private fun codecScore(f: JSONObject): Int {
        val v = (f.optStr("vcodec") ?: "").lowercase(Locale.ROOT)
        return when {
            v.startsWith("avc") || v.startsWith("h264") -> 5
            v.isEmpty() -> 4
            v.startsWith("hev") || v.startsWith("hvc") || v.startsWith("h265") -> 3
            v.startsWith("vp9") || v.startsWith("vp09") -> 2
            v.startsWith("av01") -> 1
            else -> 0
        }
    }

    /** http_headers format + Cookie (dihitung daemon dari cookiejar yt-dlp). */
    fun headersOf(f: JSONObject): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        f.optJSONObject("http_headers")?.let { h ->
            val keys = h.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                if (k.equals("Accept-Encoding", true) || k.equals("Host", true)) continue
                h.optStr(k)?.let { out[k] = it }
            }
        }
        f.optStr("xy_cookie")?.let { out["Cookie"] = it }
        return out
    }

    fun videoOptions(json: JSONObject): List<VideoOption> {
        val formats = json.optJSONArray("formats") ?: if (json.optStr("vcodec") == "none") return emptyList() else return listOf(VideoOption(0, "Terbaik", null, null))
        var bestAudio = 0L
        var separateAudioAvailable = false
        for (i in 0 until formats.length()) {
            val f = formats.optJSONObject(i) ?: continue
            if (f.optStr("vcodec") == "none" && f.optStr("acodec") !in listOf(null, "none") && !f.optBoolean("has_drm", false)) {
                separateAudioAvailable = true
                bestAudio = max(bestAudio, sizeOf(f) ?: 0L)
            }
        }
        val options = LinkedHashMap<String, VideoOption>()
        for (i in 0 until formats.length()) {
            val f = formats.optJSONObject(i) ?: continue
            if (!hasVideo(f) || (f.optStr("ext") ?: "") in imageExts || f.optBoolean("has_drm", false)) continue
            val id = f.optStr("format_id") ?: continue
            if (!FormatPolicy.validId(id)) continue
            val q = shortSide(f)
            val codec = codecLabel(f.optStr("vcodec")) ?: f.optStr("vcodec") ?: "Codec tidak diketahui"
            val ext = f.optStr("ext") ?: "sumber"
            val fps = f.optDouble("fps", 0.0).toInt()
            val size = sizeOf(f)?.let { if (f.optStr("acodec") == "none") it + bestAudio else it }
            val label = listOf(if (q > 0) "${q}p" else "Resolusi sumber", ext.uppercase(Locale.ROOT), codec,
                if (fps > 0) "${fps}fps" else null).filterNotNull().joinToString(" · ")
            options[id] = VideoOption(q, label, size, codec, id,
                FormatPolicy.videoSelector(id, f.optStr("acodec") == "none" && separateAudioAvailable), ext)
        }
        return options.values.sortedWith(compareByDescending<VideoOption> { it.height }.thenBy { it.codec }.thenBy { it.formatId })
    }

    fun audioOptions(json: JSONObject): List<AudioOption> {
        val formats = json.optJSONArray("formats") ?: return emptyList()
        return (0 until formats.length()).mapNotNull { index ->
            val f = formats.optJSONObject(index) ?: return@mapNotNull null
            val id = f.optStr("format_id") ?: return@mapNotNull null
            if (!FormatPolicy.validId(id) || f.optStr("vcodec") != "none" || f.optStr("acodec") in listOf(null, "none") || f.optBoolean("has_drm", false)) return@mapNotNull null
            val codec = f.optStr("acodec") ?: "audio"
            val ext = f.optStr("ext") ?: "audio"
            val abr = f.optDouble("abr", 0.0).toInt()
            val language = f.optStr("language")
            val label = listOf(ext.uppercase(Locale.ROOT), codec, if (abr > 0) "${abr} kbps" else null, language).filterNotNull().joinToString(" · ")
            AudioOption(id, label, sizeOf(f))
        }.distinctBy { it.formatId }
    }

    private fun codecLabel(v: String?): String? {
        val c = (v ?: "").lowercase(Locale.ROOT)
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
