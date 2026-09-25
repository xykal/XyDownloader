package id.my.xyverse.xydownloader

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException

/** Simpan hasil download ke folder publik: Download/XyDownloader */
object Storage {
    const val FOLDER = "XyDownloader"

    fun saveToDownloads(ctx: Context, src: File, displayName: String, mime: String): Uri {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) saveQ(ctx, src, displayName, mime)
        else saveLegacy(ctx, src, displayName, mime)
    }

    private fun saveQ(ctx: Context, src: File, displayName: String, mime: String): Uri {
        val resolver = ctx.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/$FOLDER")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val uri = resolver.insert(collection, values) ?: throw IOException("Gagal membuat file di folder Download")
        try {
            resolver.openOutputStream(uri)?.use { out ->
                src.inputStream().use { it.copyTo(out, 1 shl 16) }
            } ?: throw IOException("Gagal menulis file")
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
        return uri
    }

    @Suppress("DEPRECATION")
    private fun saveLegacy(ctx: Context, src: File, displayName: String, mime: String): Uri {
        val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), FOLDER)
        if (!dir.exists() && !dir.mkdirs()) throw IOException("Tidak bisa membuat folder Download/$FOLDER (izin penyimpanan?)")
        val base = displayName.substringBeforeLast('.')
        val ext = displayName.substringAfterLast('.', "")
        var out = File(dir, displayName)
        var i = 1
        while (out.exists()) out = File(dir, "$base ($i).$ext").also { i++ }
        src.copyTo(out)
        MediaScannerConnection.scanFile(ctx, arrayOf(out.absolutePath), arrayOf(mime), null)
        return FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", out)
    }
}
