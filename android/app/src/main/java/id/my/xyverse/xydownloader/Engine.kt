package id.my.xyverse.xydownloader

import android.content.Context
import android.content.res.AssetManager
import android.util.Log
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.json.JSONObject
import java.io.File
import java.util.Locale

/**
 * Pembungkus youtubedl-android: Python + yt-dlp + FFmpeg + QuickJS berjalan langsung di HP.
 * Semua fungsi di sini BLOCKING — panggil dari Dispatchers.IO.
 */
object Engine {
    private const val TAG = "XyEngine"
    private const val PREFS = "engine"
    private const val KEY_LAST_UPDATE = "last_update"
    private val lock = Any()

    @Volatile var ready = false
        private set
    @Volatile var initError: String? = null
        private set

    fun init(ctx: Context): Boolean {
        if (ready) return true
        synchronized(lock) {
            if (ready) return true
            return try {
                val app = ctx.applicationContext
                YoutubeDL.getInstance().init(app)
                FFmpeg.getInstance().init(app)
                installPlugins(app)
                initError = null
                ready = true
                true
            } catch (t: Throwable) {
                Log.e(TAG, "init gagal", t)
                initError = t.message ?: t.toString()
                false
            }
        }
    }

    // ------------------------------------------------------------ plugin extractor
    // Dipakai sebagai --plugin-dirs. Struktur: ytdlp-plugins/xydl/yt_dlp_plugins/extractor/(file .py)
    fun pluginDir(ctx: Context) = File(ctx.filesDir, "ytdlp-plugins")

    private fun installPlugins(ctx: Context) {
        val target = pluginDir(ctx)
        val marker = File(ctx.filesDir, "ytdlp-plugins.version")
        val version = "${BuildConfig.VERSION_CODE}-${BuildConfig.VERSION_NAME}"
        if (marker.exists() && marker.readText() == version) return
        target.deleteRecursively()
        copyAssets(ctx.assets, "ytdlp-plugins", target)
        target.mkdirs()
        marker.writeText(version)
    }

    private fun copyAssets(am: AssetManager, path: String, dest: File) {
        val children = am.list(path) ?: emptyArray()
        if (children.isEmpty()) {
            try {
                dest.parentFile?.mkdirs()
                am.open(path).use { input -> dest.outputStream().use { input.copyTo(it) } }
            } catch (e: Exception) {
                Log.w(TAG, "gagal salin asset $path", e)
            }
            return
        }
        dest.mkdirs()
        for (child in children) copyAssets(am, "$path/$child", File(dest, child))
    }

    // ------------------------------------------------------------ versi & update engine
    fun version(ctx: Context): String? = try {
        YoutubeDL.getInstance().version(ctx.applicationContext)
    } catch (e: Exception) {
        null
    }

    /** Update yt-dlp ke rilis stable terbaru. Return pesan hasil untuk UI. */
    fun update(ctx: Context): String {
        if (!init(ctx)) return "Engine belum siap: ${initError ?: "-"}"
        return try {
            val status = YoutubeDL.getInstance().updateYoutubeDL(ctx.applicationContext, YoutubeDL.UpdateChannel.STABLE)
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putLong(KEY_LAST_UPDATE, System.currentTimeMillis()).apply()
            when (status) {
                YoutubeDL.UpdateStatus.DONE -> "Engine diperbarui ke ${version(ctx) ?: "versi terbaru"} ✅"
                YoutubeDL.UpdateStatus.ALREADY_UP_TO_DATE -> "Engine sudah versi terbaru (${version(ctx) ?: "-"})"
                else -> "Update selesai"
            }
        } catch (e: Exception) {
            Log.w(TAG, "update gagal", e)
            "Gagal update engine: ${e.message?.take(160)}"
        }
    }

    /** Auto update maksimal sekali sehari (dipanggil saat aplikasi dibuka). */
    fun autoUpdateIfDue(ctx: Context) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val last = prefs.getLong(KEY_LAST_UPDATE, 0L)
        if (System.currentTimeMillis() - last < 24L * 3600 * 1000) return
        update(ctx)
    }

    // ------------------------------------------------------------ request builder
    private fun isTwitter(url: String): Boolean {
        val host = hostOf(url)
        return host == "x.com" || host.endsWith(".x.com") || host.endsWith("twitter.com")
    }

    fun hostOf(url: String): String = try {
        java.net.URI(url).host?.lowercase(Locale.ROOT)?.removePrefix("www.") ?: ""
    } catch (e: Exception) {
        ""
    }

    private fun base(ctx: Context, url: String, twitterApi: String? = "syndication"): YoutubeDLRequest {
        val req = YoutubeDLRequest(url)
        req.addOption("--plugin-dirs", pluginDir(ctx).absolutePath)
        req.addOption("--cache-dir", File(ctx.cacheDir, "yt-dlp-cache").absolutePath)
        req.addOption("--socket-timeout", "25")
        req.addOption("--retries", "3")
        req.addOption("--no-warnings")
        if (twitterApi != null && isTwitter(url)) req.addOption("--extractor-args", "twitter:api=$twitterApi")
        return req
    }

    /** Ambil info (judul, thumbnail, format). */
    fun fetchInfo(ctx: Context, url: String): MediaInfo {
        if (!init(ctx)) throw IllegalStateException("Engine gagal dimuat: $initError")
        val attempts = if (isTwitter(url)) listOf("syndication", null) else listOf("syndication")
        var lastError: Exception? = null
        for (api in attempts) {
            try {
                val req = base(ctx, url, api)
                req.addOption("--dump-single-json")
                req.addOption("--no-playlist")
                req.addOption("--playlist-end", 20)
                val resp = YoutubeDL.getInstance().execute(req, null, null)
                return InfoParser.parse(JSONObject(resp.out), url)
            } catch (e: Exception) {
                lastError = e
            }
        }
        throw lastError ?: IllegalStateException("Gagal membaca link")
    }

    /**
     * Susun request download.
     * kind: "video" (height = resolusi sisi pendek, 0 = terbaik), "mp3" (kbps), "m4a".
     * item: nomor item playlist/carousel (0 = bukan playlist).
     */
    fun downloadRequest(ctx: Context, url: String, kind: String, height: Int, kbps: Int, item: Int, outDir: File): YoutubeDLRequest {
        val req = base(ctx, url)
        req.addOption("-o", File(outDir, "%(title).90B [%(id)s].%(ext)s").absolutePath)
        req.addOption("--no-mtime")
        req.addOption("--newline")
        req.addOption("--concurrent-fragments", 4)
        if (item > 0) req.addOption("--playlist-items", item) else req.addOption("--no-playlist")
        when (kind) {
            "mp3" -> {
                req.addOption("-f", "ba/b")
                req.addOption("-x")
                req.addOption("--audio-format", "mp3")
                req.addOption("--audio-quality", "${kbps}K")
                req.addOption("--embed-metadata")
            }
            "m4a" -> {
                req.addOption("-f", "ba[ext=m4a]/ba/b")
                req.addOption("-x")
                req.addOption("--audio-format", "m4a")
                req.addOption("--embed-metadata")
            }
            else -> {
                req.addOption("-f", "bv*+ba/b")
                // res = sisi terpendek (720 = 720p, termasuk video vertikal). Utamakan H.264 + AAC (paling kompatibel).
                val sort = if (height > 0) "res:$height,vcodec:h264,acodec:aac" else "res,fps,vcodec:h264,acodec:aac"
                req.addOption("-S", sort)
                req.addOption("--merge-output-format", "mp4")
            }
        }
        return req
    }

    /** Cari file hasil (file terbesar yang bukan sisa proses). */
    fun findOutput(dir: File): File? {
        val skip = setOf("part", "ytdl", "json", "jpg", "jpeg", "png", "webp", "temp", "tmp", "vtt", "srt")
        return dir.walkTopDown()
            .filter { it.isFile && it.extension.lowercase(Locale.ROOT) !in skip && !it.name.contains(".part") }
            .maxByOrNull { it.length() }
    }

    fun mimeOf(name: String): String = when (name.substringAfterLast('.', "").lowercase(Locale.ROOT)) {
        "mp4", "m4v" -> "video/mp4"
        "webm" -> "video/webm"
        "mkv" -> "video/x-matroska"
        "mov" -> "video/quicktime"
        "3gp" -> "video/3gpp"
        "flv" -> "video/x-flv"
        "ts" -> "video/mp2t"
        "mp3" -> "audio/mpeg"
        "m4a", "aac" -> "audio/mp4"
        "opus", "ogg" -> "audio/ogg"
        "flac" -> "audio/flac"
        "wav" -> "audio/wav"
        else -> "application/octet-stream"
    }

    /** Pesan error yang ramah (bahasa Indonesia). */
    fun friendlyError(raw: String?): String {
        val msg = (raw ?: "").lowercase(Locale.ROOT)
        return when {
            "unsupported url" in msg -> "Link ini belum didukung. Pastikan itu link postingan/video, bukan profil."
            "not a bot" in msg || "confirm you" in msg ->
                "YouTube minta verifikasi anti-bot untuk jaringan kamu. Coba ganti jaringan (Wi-Fi ↔ data) atau update engine di menu Tentang."
            "drm" in msg -> "Konten ini dilindungi DRM (premium/berbayar) dan tidak bisa diunduh."
            "private" in msg || "login" in msg || "log in" in msg || "sign in" in msg || "cookies" in msg ->
                "Konten ini privat / butuh login. XyDownloader hanya bisa mengambil konten publik."
            "geo" in msg || "not available in your country" in msg -> "Konten ini dibatasi wilayah (geo-block)."
            "timed out" in msg || "timeout" in msg || "unable to connect" in msg || "network is unreachable" in msg ->
                "Koneksi bermasalah. Cek internet kamu lalu coba lagi."
            "404" in msg || "not found" in msg || "unavailable" in msg || "removed" in msg || "deleted" in msg ->
                "Konten tidak ditemukan — mungkin sudah dihapus, privat, atau link-nya salah."
            "no space" in msg -> "Penyimpanan HP penuh."
            "no video" in msg || "no formats" in msg -> "Tidak ada video/audio yang bisa diunduh di postingan ini."
            else -> {
                val line = (raw ?: "").lines().lastOrNull { it.contains("ERROR", true) } ?: raw ?: ""
                "Gagal: " + line.replace("ERROR:", "").trim().take(220).ifBlank { "terjadi kesalahan" }
            }
        }
    }
}
