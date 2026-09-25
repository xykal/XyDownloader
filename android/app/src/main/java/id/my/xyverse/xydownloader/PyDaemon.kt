package id.my.xyverse.xydownloader

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.File
import kotlin.concurrent.thread
import kotlin.coroutines.resume

/**
 * Proses Python yang tetap hidup (yt-dlp sudah diimpor + regex sudah di-compile) untuk
 * "proses link". Jauh lebih cepat daripada menjalankan yt-dlp dari nol setiap kali.
 * Kalau daemon bermasalah, Engine otomatis kembali ke jalur lama (YoutubeDL.execute).
 */
object PyDaemon {
    private const val TAG = "XyDaemon"
    private const val IDLE_STOP_MS = 10 * 60_000L

    /** Error dari yt-dlp (link tidak didukung, privat, dll) — bukan masalah daemon. */
    class ExtractError(message: String) : Exception(message)

    /** Daemon tidak bisa dipakai -> pakai jalur CLI. */
    class Unavailable(cause: Throwable?) : Exception(cause?.message ?: "daemon tidak tersedia", cause)

    private val mutex = Mutex()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var proc: Process? = null
    private var writer: BufferedWriter? = null
    private var reader: BufferedReader? = null
    private val errTail = ArrayDeque<String>()
    private var nextId = 1
    private var idleJob: Job? = null
    private var failures = 0

    @Volatile var warmMs: Long = -1
        private set

    fun infoDir(ctx: Context) = File(ctx.cacheDir, "info").apply { mkdirs() }

    private fun script(ctx: Context) = File(ctx.filesDir, "py/xydl_daemon.py")

    /** Nyalakan di background supaya link pertama langsung cepat. */
    fun warmUp(ctx: Context) {
        val app = ctx.applicationContext
        scope.launch {
            mutex.withLock {
                try {
                    ensureStarted(app)
                    scheduleIdleStop()
                } catch (e: Exception) {
                    Log.w(TAG, "warm-up gagal", e)
                }
            }
        }
    }

    fun restart() {
        scope.launch { mutex.withLock { stopProcess() } }
    }

    private fun alive(p: Process?): Boolean {
        if (p == null) return false
        return try {
            p.exitValue()
            false
        } catch (_: IllegalThreadStateException) {
            true
        }
    }

    private suspend fun ensureStarted(ctx: Context) {
        if (alive(proc) && warmMs >= 0) return
        stopProcess()
        if (failures >= 3) throw IllegalStateException("daemon dinonaktifkan setelah beberapa kali gagal")
        val s = script(ctx)
        if (!s.exists()) throw IllegalStateException("skrip daemon tidak ada")
        val args = listOf(
            "-u", s.absolutePath,
            YtDlpHome.importPath(ctx),
            File(Engine.pluginDir(ctx), "xydl").absolutePath,
            File(ctx.cacheDir, "yt-dlp-cache").absolutePath,
            PyEnv.qjs(ctx).absolutePath,
            infoDir(ctx).absolutePath,
        )
        val p = PyEnv.processBuilder(ctx, args).start()
        proc = p
        writer = p.outputStream.bufferedWriter(Charsets.UTF_8)
        reader = p.inputStream.bufferedReader(Charsets.UTF_8)
        synchronized(errTail) { errTail.clear() }
        thread(name = "xy-daemon-stderr", isDaemon = true) {
            try {
                p.errorStream.bufferedReader().forEachLine { line ->
                    synchronized(errTail) {
                        errTail.addLast(line)
                        while (errTail.size > 40) errTail.removeFirst()
                    }
                }
            } catch (_: Exception) {
            }
        }
        val ready = withTimeoutOrNull(90_000) { awaitLine() }
        val o = ready?.let { runCatching { JSONObject(it) }.getOrNull() }
        if (o == null || !o.optBoolean("ready")) {
            val tail = synchronized(errTail) { errTail.joinToString("\n") }
            stopProcess()
            failures++
            throw IllegalStateException("daemon gagal start: ${tail.takeLast(800)}")
        }
        warmMs = o.optLong("warm_ms", 0)
        failures = 0
        Log.i(TAG, "daemon siap (yt-dlp ${o.optString("version")}, warm ${warmMs} ms)")
    }

    /** Baca satu baris stdout daemon. Kalau coroutine dibatalkan/timeout, proses dimatikan. */
    private suspend fun awaitLine(): String? = suspendCancellableCoroutine { cont ->
        val r = reader
        if (r == null) {
            cont.resume(null)
            return@suspendCancellableCoroutine
        }
        thread(name = "xy-daemon-read", isDaemon = true) {
            val line = try { r.readLine() } catch (_: Exception) { null }
            if (cont.isActive) cont.resume(line)
        }
        cont.invokeOnCancellation { stopProcess() }
    }

    private fun stopProcess() {
        val p = proc ?: return
        proc = null
        warmMs = -1
        try { writer?.close() } catch (_: Exception) { }
        try { p.destroy() } catch (_: Exception) { }
        writer = null
        reader = null
    }

    private fun scheduleIdleStop() {
        idleJob?.cancel()
        idleJob = scope.launch {
            delay(IDLE_STOP_MS)
            mutex.withLock { stopProcess() }
        }
    }

    /**
     * Ambil info link -> file JSON (format sama dengan `yt-dlp --dump-single-json`, ditambah
     * header Cookie per format). Lempar [ExtractError] atau [Unavailable].
     */
    suspend fun info(ctx: Context, url: String, twitterApi: String?, timeoutMs: Long = 100_000): File =
        withContext(Dispatchers.IO) {
            mutex.withLock {
                try {
                    ensureStarted(ctx.applicationContext)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    throw Unavailable(e)
                }
                val id = nextId++
                val req = JSONObject().put("id", id).put("op", "info").put("url", url)
                    .put("twitter_api", twitterApi ?: JSONObject.NULL)
                try {
                    writer!!.apply { write(req.toString()); newLine(); flush() }
                } catch (e: Exception) {
                    stopProcess()
                    throw Unavailable(e)
                }
                var resp: JSONObject? = null
                val done = withTimeoutOrNull(timeoutMs) {
                    while (true) {
                        val line = awaitLine() ?: break
                        val o = runCatching { JSONObject(line) }.getOrNull() ?: continue
                        if (o.optInt("id", -1) == id) {
                            resp = o
                            break
                        }
                    }
                    true
                }
                scheduleIdleStop()
                val r = resp
                when {
                    done == null -> throw ExtractError("Waktu habis membaca link (lebih dari ${timeoutMs / 1000} detik).")
                    r == null -> {
                        stopProcess()
                        throw Unavailable(null)
                    }
                    r.optBoolean("ok") -> File(r.getString("path"))
                    else -> throw ExtractError(r.optString("error").ifBlank { "Gagal membaca link" })
                }
            }
        }
}
