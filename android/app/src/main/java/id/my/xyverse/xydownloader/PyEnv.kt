package id.my.xyverse.xydownloader

import android.content.Context
import android.util.Log
import java.io.File
import kotlin.concurrent.thread

/**
 * Lingkungan Python milik youtubedl-android (path & environment dibuat PERSIS seperti
 * YoutubeDL.execute) supaya kita bisa menjalankan proses Python sendiri: daemon yt-dlp,
 * ekstrak/update yt-dlp, dll.
 */
object PyEnv {
    private const val TAG = "XyPyEnv"

    fun nativeDir(ctx: Context) = File(ctx.applicationInfo.nativeLibraryDir)
    fun python(ctx: Context) = File(nativeDir(ctx), "libpython.so")
    fun qjs(ctx: Context) = File(nativeDir(ctx), "libqjs.so")
    fun ffmpeg(ctx: Context) = File(nativeDir(ctx), "libffmpeg.so")
    fun baseDir(ctx: Context) = File(ctx.noBackupFilesDir, "youtubedl-android")
    private fun packages(ctx: Context) = File(baseDir(ctx), "packages")

    /** File yang dijalankan youtubedl-android: `python <file> args...` (zipapp atau launcher kita). */
    fun ytdlpFile(ctx: Context) = File(baseDir(ctx), "yt-dlp/yt-dlp")

    fun processBuilder(ctx: Context, args: List<String>): ProcessBuilder {
        val pkgs = packages(ctx).absolutePath
        val pb = ProcessBuilder(listOf(python(ctx).absolutePath) + args)
        pb.environment().apply {
            this["LD_LIBRARY_PATH"] = "$pkgs/python/usr/lib:$pkgs/ffmpeg/usr/lib:$pkgs/aria2c/usr/lib"
            this["SSL_CERT_FILE"] = "$pkgs/python/usr/etc/tls/cert.pem"
            this["PATH"] = (System.getenv("PATH") ?: "/system/bin") + ":" + nativeDir(ctx).absolutePath
            this["PYTHONHOME"] = "$pkgs/python/usr"
            this["HOME"] = "$pkgs/python/usr"
            this["TMPDIR"] = ctx.cacheDir.absolutePath
            this["PYTHONIOENCODING"] = "utf-8"
            this["PYTHONUTF8"] = "1"
        }
        return pb
    }

    /** Jalankan perintah Python singkat. Return (exit code, output gabungan stdout+stderr). */
    fun run(ctx: Context, args: List<String>, timeoutSec: Long = 120): Pair<Int, String> {
        val p = try {
            processBuilder(ctx, args).redirectErrorStream(true).start()
        } catch (e: Exception) {
            Log.w(TAG, "gagal start python", e)
            return Pair(-1, e.toString())
        }
        val out = StringBuilder()
        val reader = thread(name = "xy-py-run", isDaemon = true) {
            try {
                p.inputStream.bufferedReader().forEachLine { line ->
                    synchronized(out) { if (out.length < 32_000) out.appendLine(line) }
                }
            } catch (_: Exception) {
            }
        }
        var timedOut = false
        val watchdog = thread(name = "xy-py-watchdog", isDaemon = true) {
            try {
                Thread.sleep(timeoutSec * 1000)
                timedOut = true
                p.destroy()
            } catch (_: InterruptedException) {
            }
        }
        val code = try { p.waitFor() } catch (e: InterruptedException) { p.destroy(); -1 }
        watchdog.interrupt()
        reader.join(2000)
        return Pair(if (timedOut) -2 else code, synchronized(out) { out.toString() })
    }

    /** String literal Python yang aman untuk path. */
    fun pyStr(s: String): String = "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"
}
