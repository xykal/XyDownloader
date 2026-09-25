package id.my.xyverse.xydownloader

import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** HTTP sederhana (HttpURLConnection) dengan redirect lintas-protokol & header kustom. */
object Http {
    const val UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/139.0.0.0 Mobile Safari/537.36"
    private val SKIP = setOf("accept-encoding", "host", "content-length", "connection")

    fun open(url: String, headers: Map<String, String> = emptyMap(), timeoutMs: Int = 20_000): HttpURLConnection {
        var current = url
        for (hop in 0 until 8) {
            val c = URL(current).openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = timeoutMs
            c.readTimeout = timeoutMs
            var hasUa = false
            for ((k, v) in headers) {
                if (k.lowercase() in SKIP) continue
                if (k.equals("User-Agent", true)) hasUa = true
                c.setRequestProperty(k, v)
            }
            if (!hasUa) c.setRequestProperty("User-Agent", UA)
            val code = c.responseCode
            if (code in 300..399) {
                val loc = c.getHeaderField("Location")
                c.disconnect()
                if (loc.isNullOrBlank()) throw IOException("Redirect tanpa tujuan ($code)")
                current = URL(URL(current), loc).toString()
                continue
            }
            return c
        }
        throw IOException("Terlalu banyak redirect")
    }

    fun getText(url: String, headers: Map<String, String> = emptyMap(), timeoutMs: Int = 20_000): String {
        val c = open(url, headers, timeoutMs)
        try {
            if (c.responseCode !in 200..299) throw IOException("HTTP ${c.responseCode}")
            return c.inputStream.bufferedReader().use { it.readText() }
        } finally {
            c.disconnect()
        }
    }

    /**
     * Unduh ke file. onProgress(bytes, total) — total = -1 kalau tidak diketahui.
     * isCancelled dicek berkala supaya bisa dibatalkan.
     */
    fun download(
        url: String,
        headers: Map<String, String>,
        dest: File,
        isCancelled: () -> Boolean = { false },
        onProgress: (Long, Long) -> Unit = { _, _ -> },
    ): Long {
        val c = open(url, headers, 30_000)
        try {
            val code = c.responseCode
            if (code !in 200..299) throw IOException("HTTP $code")
            val total = c.getHeaderField("Content-Length")?.toLongOrNull() ?: -1L
            dest.parentFile?.mkdirs()
            var bytes = 0L
            var last = 0L
            c.inputStream.use { input ->
                dest.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        if (isCancelled()) throw InterruptedException("dibatalkan")
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        bytes += n
                        val now = System.currentTimeMillis()
                        if (now - last > 250) {
                            last = now
                            onProgress(bytes, total)
                        }
                    }
                }
            }
            onProgress(bytes, total)
            if (total > 0 && bytes < total) throw IOException("Unduhan terputus ($bytes/$total)")
            return bytes
        } finally {
            c.disconnect()
        }
    }
}
