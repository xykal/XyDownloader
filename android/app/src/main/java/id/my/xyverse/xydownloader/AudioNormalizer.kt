package id.my.xyverse.xydownloader

import android.content.Context
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** Opt-in export processing. Original remains untouched until FFmpeg succeeds. */
object AudioNormalizer {
    fun normalize(ctx: Context, files: List<File>, outputKbps: Int = 192): List<File> = files.map { source ->
        val ext = source.extension.lowercase()
        require(ext in listOf("mp3", "m4a", "mp4", "mov")) {
            "Normalisasi format .$ext belum didukung. Matikan normalisasi untuk menyimpan format asli."
        }
        val temp = File(source.parentFile, source.nameWithoutExtension + ".normalized." + ext)
        val args = listOf(PyEnv.ffmpeg(ctx).absolutePath, "-nostdin", "-y", "-hide_banner", "-loglevel", "error",
            "-i", source.absolutePath, "-map", "0:v?", "-map", "0:a:0", "-map_metadata", "0", "-c:v", "copy",
            "-c:a", if (ext == "mp3") "libmp3lame" else "aac", "-b:a", "${outputKbps.coerceIn(64, 320)}k", "-threads", "2",
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", temp.absolutePath)
        val pb = ProcessBuilder(args).redirectErrorStream(true)
        pb.environment().putAll(PyEnv.processBuilder(ctx, emptyList()).environment())
        val process = pb.start()
        val diagnostics = StringBuilder()
        val reader = thread(name = "xy-normalize-log", isDaemon = true) {
            try { process.inputStream.bufferedReader().forEachLine { line ->
                synchronized(diagnostics) { if (diagnostics.length < 4000) diagnostics.appendLine(line) }
            } } catch (_: Exception) { }
        }
        try {
            check(process.waitFor(15, TimeUnit.MINUTES)) { "Normalisasi audio melewati batas waktu" }
            reader.join(2000)
            check(process.exitValue() == 0 && temp.length() > 0) {
                "Normalisasi audio gagal; file asli tidak diubah. " + synchronized(diagnostics) { diagnostics.toString().takeLast(800) }
            }
            check(temp.renameTo(source)) { "Gagal menyimpan hasil normalisasi" }
            source
        } finally {
            process.destroy()
            if (process.isAlive) process.destroyForcibly()
            temp.delete()
        }
    }
}
