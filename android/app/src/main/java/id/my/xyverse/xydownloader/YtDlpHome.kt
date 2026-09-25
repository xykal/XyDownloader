package id.my.xyverse.xydownloader

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File

/**
 * yt-dlp "hasil ekstrak" (bukan zipapp) supaya Python bisa menyimpan cache bytecode (.pyc):
 * start yt-dlp jadi jauh lebih cepat (di HP bisa hemat 2-3 detik per proses).
 *
 * - <no_backup>/xydl/yt-dlp/      : isi zipapp yt-dlp (yt_dlp/, yt_dlp_ejs/)
 * - <no_backup>/xydl/yt-dlp.zip   : salinan zipapp (cadangan kalau folder rusak)
 * - youtubedl-android/yt-dlp/yt-dlp diganti skrip launcher kecil yang memuat folder di atas,
 *   jadi semua pemanggilan YoutubeDL.execute() ikut cepat.
 */
object YtDlpHome {
    private const val TAG = "XyYtDlp"
    private const val MARK = "# XYDL-LAUNCHER v1"
    private const val RELEASES_API = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest"
    private val lock = Any()

    fun dir(ctx: Context) = File(ctx.noBackupFilesDir, "xydl")
    fun srcDir(ctx: Context) = File(dir(ctx), "yt-dlp")
    private fun zipCopy(ctx: Context) = File(dir(ctx), "yt-dlp.zip")
    private fun versionFile(ctx: Context) = File(dir(ctx), "yt-dlp.version")

    private fun extracted(ctx: Context) = File(srcDir(ctx), "yt_dlp/__init__.py").exists()

    /** Path yang dimasukkan ke sys.path oleh daemon. */
    fun importPath(ctx: Context): String = when {
        extracted(ctx) -> srcDir(ctx).absolutePath
        zipCopy(ctx).exists() -> zipCopy(ctx).absolutePath
        else -> PyEnv.ytdlpFile(ctx).absolutePath
    }

    fun version(ctx: Context): String? =
        versionFile(ctx).takeIf { it.exists() }?.readText()?.trim()?.ifBlank { null }
            ?: readVersion(srcDir(ctx))

    private fun readVersion(src: File): String? {
        val f = File(src, "yt_dlp/version.py")
        if (!f.exists()) return null
        return Regex("__version__\\s*=\\s*'([^']+)'").find(f.readText())?.groupValues?.get(1)
    }

    private fun isLauncher(f: File): Boolean = try {
        f.exists() && f.length() < 8192 && f.bufferedReader().use { it.readLine() } == MARK
    } catch (_: Exception) {
        false
    }

    /** Dipanggil sekali setelah YoutubeDL.init(). Aman dipanggil berulang. */
    fun ensure(ctx: Context) = synchronized(lock) {
        val target = PyEnv.ytdlpFile(ctx)
        val launcher = isLauncher(target)
        if (launcher && extracted(ctx)) return@synchronized
        dir(ctx).mkdirs()
        if (!launcher && target.exists() && target.length() > 500_000) {
            // zipapp bawaan library (build baru) / hasil update versi lama -> jadikan sumber
            target.copyTo(zipCopy(ctx), overwrite = true)
        }
        val zip = zipCopy(ctx)
        if (!zip.exists()) return@synchronized
        if (!extract(ctx, zip, srcDir(ctx))) {
            // gagal ekstrak: kembalikan zipapp asli supaya engine tetap jalan (lebih lambat)
            if (launcher) zip.copyTo(target, overwrite = true)
            return@synchronized
        }
        writeLauncher(ctx)
    }

    private fun extract(ctx: Context, zip: File, dest: File): Boolean {
        val tmp = File(dest.parentFile, dest.name + ".new")
        tmp.deleteRecursively()
        val (code, out) = PyEnv.run(
            ctx,
            listOf("-c", "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",
                zip.absolutePath, tmp.absolutePath),
            timeoutSec = 180,
        )
        if (code != 0 || !File(tmp, "yt_dlp/__init__.py").exists()) {
            Log.w(TAG, "ekstrak yt-dlp gagal ($code): ${out.takeLast(600)}")
            tmp.deleteRecursively()
            return false
        }
        val old = File(dest.parentFile, dest.name + ".old")
        old.deleteRecursively()
        if (dest.exists() && !dest.renameTo(old)) dest.deleteRecursively()
        if (!tmp.renameTo(dest)) {
            old.renameTo(dest)
            tmp.deleteRecursively()
            return false
        }
        old.deleteRecursively()
        readVersion(dest)?.let { versionFile(ctx).writeText(it) }
        return true
    }

    private fun writeLauncher(ctx: Context) {
        val script = """
            $MARK
            # Dibuat DownloadAja (built in XyVerse): jalankan yt-dlp dari folder hasil ekstrak supaya
            # Python bisa memakai cache bytecode (.pyc) -> start jauh lebih cepat dibanding zipapp.
            import os, sys
            src = ${PyEnv.pyStr(srcDir(ctx).absolutePath)}
            if not os.path.isfile(os.path.join(src, 'yt_dlp', '__init__.py')):
                src = ${PyEnv.pyStr(zipCopy(ctx).absolutePath)}
            sys.path.insert(0, src)
            import yt_dlp
            yt_dlp.main()
        """.trimIndent() + "\n"
        val target = PyEnv.ytdlpFile(ctx)
        target.parentFile?.mkdirs()
        val tmp = File(target.parentFile, "yt-dlp.xytmp")
        tmp.writeText(script)
        if (!tmp.renameTo(target)) {
            target.writeText(script)
            tmp.delete()
        }
    }

    /** Update ke rilis stable terbaru dari GitHub. Return pesan untuk UI. */
    fun update(ctx: Context): String = synchronized(lock) {
        val current = version(ctx)
        val rel = try {
            JSONObject(Http.getText(RELEASES_API, mapOf("Accept" to "application/vnd.github+json")))
        } catch (e: Exception) {
            return@synchronized "Gagal cek versi yt-dlp: ${e.message?.take(120)}"
        }
        val tag = rel.optString("tag_name").ifBlank { return@synchronized "Rilis yt-dlp tidak terbaca" }
        if (tag == current && extracted(ctx)) return@synchronized "Engine sudah versi terbaru ($tag)"
        val assets = rel.optJSONArray("assets")
        var url: String? = null
        for (i in 0 until (assets?.length() ?: 0)) {
            val a = assets!!.optJSONObject(i) ?: continue
            if (a.optString("name") == "yt-dlp") url = a.optString("browser_download_url")
        }
        if (url.isNullOrBlank()) return@synchronized "File yt-dlp tidak ditemukan di rilis $tag"
        val dl = File(dir(ctx), "yt-dlp.download")
        return@synchronized try {
            dir(ctx).mkdirs()
            Http.download(url, emptyMap(), dl)
            if (dl.length() < 1_000_000) throw IllegalStateException("file terlalu kecil")
            if (!extract(ctx, dl, srcDir(ctx))) throw IllegalStateException("ekstrak gagal")
            dl.copyTo(zipCopy(ctx), overwrite = true)
            writeLauncher(ctx)
            versionFile(ctx).writeText(readVersion(srcDir(ctx)) ?: tag)
            PyDaemon.restart()
            "Engine diperbarui ke ${version(ctx) ?: tag}"
        } catch (e: Exception) {
            Log.w(TAG, "update gagal", e)
            "Gagal update engine: ${e.message?.take(120)}"
        } finally {
            dl.delete()
        }
    }
}
