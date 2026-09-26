package id.my.xyverse.xydownloader

import android.content.Context
import android.os.Build
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors

/** Beacon ringan ke dash (non-blocking, gagal diam-diam). */
object Analytics {
    private val exec = Executors.newSingleThreadExecutor()
    private const val PREFS = "dlaja_analytics_v1"
    private const val KEY_CID = "cid"
    private val ENDPOINTS = listOf(
        "https://dash.dlaja.xyverse.my.id/api/public/beacon",
        "https://dlaja-dash.akuntiktok76y.workers.dev/api/public/beacon",
    )

    private fun cid(ctx: Context): String {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        var id = p.getString(KEY_CID, null)
        if (id.isNullOrBlank()) {
            id = "a_" + UUID.randomUUID().toString()
            p.edit().putString(KEY_CID, id).apply()
        }
        return id!!
    }

    private fun ua(): String {
        return "DownloadAja/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE}; ${Build.MODEL}) XyVerse"
    }

    fun track(ctx: Context, type: String, platform: String? = null, count: Int = 1) {
        val appCtx = ctx.applicationContext
        exec.execute {
            try {
                val body = JSONObject()
                    .put("type", type)
                    .put("client", "apk")
                    .put("cid", cid(appCtx))
                    .put("ua", ua())
                    .put("count", count.coerceIn(1, 50))
                if (!platform.isNullOrBlank()) body.put("platform", platform)
                val payload = body.toString().toByteArray(Charsets.UTF_8)
                for (url in ENDPOINTS) {
                    try {
                        postJson(url, payload)
                        return@execute
                    } catch (_: Exception) {
                        // try next endpoint
                    }
                }
            } catch (_: Exception) {
                // ignore
            }
        }
    }

    private fun postJson(url: String, payload: ByteArray) {
        val c = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 8_000
            readTimeout = 8_000
            doOutput = true
            requestMethod = "POST"
            instanceFollowRedirects = true
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", ua())
            setFixedLengthStreamingMode(payload.size)
        }
        try {
            c.outputStream.use { it.write(payload) }
            val code = c.responseCode
            if (code !in 200..299) {
                runCatching { c.errorStream?.bufferedReader()?.use { it.readText() } }
                throw java.io.IOException("HTTP $code")
            }
            runCatching { c.inputStream.bufferedReader().use { it.readText() } }
        } finally {
            c.disconnect()
        }
    }
}
