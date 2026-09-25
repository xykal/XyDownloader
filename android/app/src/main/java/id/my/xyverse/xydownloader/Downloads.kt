package id.my.xyverse.xydownloader

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.yausername.youtubedl_android.YoutubeDL
import id.my.xyverse.xydownloader.ui.formatBytes
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.runInterruptible
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Riwayat download (disimpan di SharedPreferences sebagai JSON). */
data class DlRecord(
    val id: String,
    val title: String,
    val label: String,
    val kind: String,
    val thumbnail: String?,
    val sourceUrl: String,
    val createdAt: Long,
    val status: String = STATUS_QUEUED,
    val progress: Float = 0f,
    val line: String? = null,
    val uri: String? = null,
    val mime: String? = null,
    val fileName: String? = null,
    val error: String? = null,
    val count: Int = 1,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id); put("title", title); put("label", label); put("kind", kind)
        put("thumbnail", thumbnail ?: JSONObject.NULL); put("sourceUrl", sourceUrl); put("createdAt", createdAt)
        put("status", status); put("uri", uri ?: JSONObject.NULL); put("mime", mime ?: JSONObject.NULL)
        put("fileName", fileName ?: JSONObject.NULL); put("error", error ?: JSONObject.NULL); put("count", count)
    }

    companion object {
        const val STATUS_QUEUED = "queued"
        const val STATUS_RUNNING = "running"
        const val STATUS_DONE = "done"
        const val STATUS_FAILED = "failed"

        private fun JSONObject.s(k: String): String? = if (isNull(k)) null else optString(k, "").ifBlank { null }

        fun fromJson(o: JSONObject) = DlRecord(
            id = o.optString("id"), title = o.optString("title"), label = o.optString("label"),
            kind = o.optString("kind"), thumbnail = o.s("thumbnail"), sourceUrl = o.optString("sourceUrl"),
            createdAt = o.optLong("createdAt"), status = o.optString("status", STATUS_QUEUED),
            uri = o.s("uri"), mime = o.s("mime"), fileName = o.s("fileName"), error = o.s("error"),
            count = o.optInt("count", 1),
        )
    }
}

object Downloads {
    const val TAG = "xydl"
    const val K_URL = "url"
    const val K_TITLE = "title"
    const val K_KIND = "kind"
    const val K_HEIGHT = "height"
    const val K_KBPS = "kbps"
    const val K_ITEM = "item"
    const val K_INFO = "info"
    const val K_FILES = "files"
    const val K_PROGRESS = "p"
    const val K_LINE = "line"
    const val K_URI = "uri"
    const val K_MIME = "mime"
    const val K_NAME = "name"
    const val K_ERROR = "error"
    const val CH_PROGRESS = "progress"
    const val CH_DONE = "done"
    private const val PREFS = "downloads"
    private const val KEY = "records"

    private val _records = MutableStateFlow<List<DlRecord>>(emptyList())
    val records: StateFlow<List<DlRecord>> = _records
    private var loaded = false

    fun load(ctx: Context) {
        if (loaded) return
        loaded = true
        val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]") ?: "[]"
        val arr = try { JSONArray(raw) } catch (e: Exception) { JSONArray() }
        val list = ArrayList<DlRecord>()
        for (i in 0 until arr.length()) arr.optJSONObject(i)?.let { list.add(DlRecord.fromJson(it)) }
        // yang masih "running" saat aplikasi ditutup paksa -> tandai gagal kalau WorkManager sudah tidak punya
        _records.value = list
    }

    private fun persist(ctx: Context) {
        val arr = JSONArray()
        _records.value.take(200).forEach { arr.put(it.toJson()) }
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, arr.toString()).apply()
    }

    @Synchronized
    fun upsert(ctx: Context, id: String, transform: (DlRecord) -> DlRecord) {
        load(ctx)
        val list = _records.value.toMutableList()
        val idx = list.indexOfFirst { it.id == id }
        if (idx < 0) return
        val before = list[idx]
        val after = transform(before)
        list[idx] = after
        _records.value = list
        if (before.status != after.status || before.uri != after.uri) persist(ctx)
    }

    @Synchronized
    fun remove(ctx: Context, id: String) {
        load(ctx)
        _records.value = _records.value.filterNot { it.id == id }
        persist(ctx)
    }

    @Synchronized
    fun clearFinished(ctx: Context) {
        load(ctx)
        _records.value = _records.value.filter { it.status == DlRecord.STATUS_RUNNING || it.status == DlRecord.STATUS_QUEUED }
        persist(ctx)
    }

    fun enqueue(
        ctx: Context, info: MediaInfo, kind: String, height: Int, kbps: Int, item: Int, label: String, title: String,
        infoPath: String? = info.infoPath,
    ) {
        load(ctx)
        val request = OneTimeWorkRequestBuilder<DownloadWorker>()
            .setInputData(
                workDataOf(
                    K_URL to info.sourceUrl, K_TITLE to title, K_KIND to kind,
                    K_HEIGHT to height, K_KBPS to kbps, K_ITEM to item, K_INFO to infoPath,
                )
            )
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .addTag(TAG)
            .build()
        addRecord(ctx, DlRecord(
            id = request.id.toString(), title = title, label = label, kind = kind,
            thumbnail = info.thumbnail, sourceUrl = info.sourceUrl, createdAt = System.currentTimeMillis(),
        ))
        WorkManager.getInstance(ctx).enqueue(request)
    }

    /** File langsung (foto, Live Photo, video carousel): diunduh via HTTP tanpa yt-dlp. */
    data class FileJob(val url: String, val headers: Map<String, String>, val name: String, val mime: String)

    fun enqueueFiles(ctx: Context, info: MediaInfo, files: List<FileJob>, label: String, title: String) {
        if (files.isEmpty()) return
        load(ctx)
        // Data WorkManager dibatasi 10 KB -> daftar file ditulis ke berkas
        val jobFile = File(ctx.filesDir, "jobs/${UUID.randomUUID()}.json").apply { parentFile?.mkdirs() }
        val arr = JSONArray()
        files.forEach { f ->
            arr.put(JSONObject().put("url", f.url).put("name", f.name).put("mime", f.mime)
                .put("headers", JSONObject(f.headers as Map<*, *>)))
        }
        jobFile.writeText(arr.toString())
        val request = OneTimeWorkRequestBuilder<DownloadWorker>()
            .setInputData(workDataOf(K_URL to info.sourceUrl, K_TITLE to title, K_KIND to "files", K_FILES to jobFile.absolutePath))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .addTag(TAG)
            .build()
        addRecord(ctx, DlRecord(
            id = request.id.toString(), title = title, label = label, kind = "files",
            thumbnail = info.gallery.firstOrNull()?.thumb ?: info.thumbnail, sourceUrl = info.sourceUrl,
            createdAt = System.currentTimeMillis(), count = files.size,
        ))
        WorkManager.getInstance(ctx).enqueue(request)
    }

    private fun addRecord(ctx: Context, rec: DlRecord) {
        synchronized(this) {
            _records.value = listOf(rec) + _records.value
            persist(ctx)
        }
    }

    fun cancel(ctx: Context, id: String) {
        WorkManager.getInstance(ctx).cancelWorkById(UUID.fromString(id))
        YoutubeDL.getInstance().destroyProcessById(id)
        upsert(ctx, id) { it.copy(status = DlRecord.STATUS_FAILED, error = "Dibatalkan") }
    }

    fun createChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CH_PROGRESS, ctx.getString(R.string.channel_progress), NotificationManager.IMPORTANCE_LOW)
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_DONE, ctx.getString(R.string.channel_done), NotificationManager.IMPORTANCE_DEFAULT)
        )
    }

    fun openIntent(uri: Uri, mime: String?): Intent =
        Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime ?: "*/*")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)

    fun shareIntent(uri: Uri, mime: String?): Intent =
        Intent.createChooser(
            Intent(Intent.ACTION_SEND).setType(mime ?: "*/*").putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
            "Bagikan"
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}

/** Worker download (foreground, tahan ditinggal / layar mati). */
class DownloadWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    private val nid = id.hashCode()

    private fun notification(title: String, progress: Float, text: String): android.app.Notification {
        val open = PendingIntent.getActivity(
            applicationContext, 0,
            Intent(applicationContext, MainActivity::class.java).putExtra("tab", 1)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val cancel = WorkManagerCancel.intent(applicationContext, id)
        return NotificationCompat.Builder(applicationContext, Downloads.CH_PROGRESS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setContentIntent(open)
            .setProgress(100, (progress * 100).toInt(), progress <= 0f)
            .addAction(0, "Batal", cancel)
            .build()
    }

    private fun foreground(title: String, progress: Float, text: String): ForegroundInfo {
        val n = notification(title, progress, text)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(nid, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else ForegroundInfo(nid, n)
    }

    override suspend fun getForegroundInfo(): ForegroundInfo =
        foreground(inputData.getString(Downloads.K_TITLE) ?: "XyDownloader", 0f, "Menyiapkan…")

    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val taskId = id.toString()
        val url = inputData.getString(Downloads.K_URL) ?: return Result.failure()
        val title = inputData.getString(Downloads.K_TITLE) ?: "Video"
        val kind = inputData.getString(Downloads.K_KIND) ?: "video"
        val height = inputData.getInt(Downloads.K_HEIGHT, 0)
        val kbps = inputData.getInt(Downloads.K_KBPS, 192)
        val item = inputData.getInt(Downloads.K_ITEM, 0)
        val infoPath = inputData.getString(Downloads.K_INFO)

        if (kind == "files") {
            try { setForeground(foreground(title, 0f, "Menyiapkan…")) } catch (_: Exception) { }
            return doFiles(ctx, taskId, title, inputData.getString(Downloads.K_FILES) ?: return fail(taskId, "Data unduhan hilang"))
        }
        try { setForeground(foreground(title, 0f, "Menyiapkan engine…")) } catch (_: Exception) { }
        Downloads.upsert(ctx, taskId) { it.copy(status = DlRecord.STATUS_RUNNING, line = "Menyiapkan engine…") }

        if (!Engine.init(ctx)) return fail(taskId, "Engine gagal dimuat: ${Engine.initError}")
        val tmp = File(ctx.cacheDir, "dl/$taskId").apply { deleteRecursively(); mkdirs() }
        val request = Engine.downloadRequest(ctx, url, kind, height, kbps, item, tmp, infoPath)
        var lastUpdate = 0L
        return try {
            runInterruptible(Dispatchers.IO) {
                YoutubeDL.getInstance().execute(request, taskId) { progress: Float, _: Long, line: String ->
                    val now = System.currentTimeMillis()
                    if (now - lastUpdate > 700) {
                        lastUpdate = now
                        val p = (progress / 100f).coerceIn(0f, 1f)
                        val text = describe(line, p)
                        setProgressAsync(workDataOf(Downloads.K_PROGRESS to p, Downloads.K_LINE to text))
                        Downloads.upsert(ctx, taskId) { it.copy(status = DlRecord.STATUS_RUNNING, progress = p, line = text) }
                        try { setForegroundAsync(foreground(title, p, text)) } catch (_: Exception) { }
                    }
                }
            }
            val outputs = Engine.findOutputs(tmp, kind)
            if (outputs.isEmpty()) throw IllegalStateException("File hasil tidak ditemukan")
            Downloads.upsert(ctx, taskId) { it.copy(progress = 1f, line = "Menyimpan ke Download/XyDownloader…") }
            var firstUri: Uri? = null
            for (out in outputs) {
                val uri = Storage.saveToDownloads(ctx, out, out.name, Engine.mimeOf(out.name))
                if (firstUri == null) firstUri = uri
            }
            val first = outputs.first()
            val mime = Engine.mimeOf(first.name)
            val uri = firstUri!!
            Downloads.upsert(ctx, taskId) {
                it.copy(status = DlRecord.STATUS_DONE, progress = 1f, uri = uri.toString(), mime = mime,
                    fileName = first.name, line = null, error = null, count = outputs.size)
            }
            notifyDone(if (outputs.size > 1) "$title (${outputs.size} file)" else title, uri, mime)
            Result.success(workDataOf(Downloads.K_URI to uri.toString(), Downloads.K_MIME to mime, Downloads.K_NAME to first.name))
        } catch (e: YoutubeDL.CanceledException) {
            fail(taskId, "Dibatalkan")
        } catch (e: InterruptedException) {
            fail(taskId, "Dibatalkan")
        } catch (e: kotlinx.coroutines.CancellationException) {
            YoutubeDL.getInstance().destroyProcessById(taskId)
            Downloads.upsert(ctx, taskId) { it.copy(status = DlRecord.STATUS_FAILED, error = "Dibatalkan") }
            throw e
        } catch (e: Throwable) {
            fail(taskId, Engine.friendlyError(e.message))
        } finally {
            tmp.deleteRecursively()
        }
    }

    /** Unduh daftar file langsung (foto / Live Photo / video carousel) lalu simpan ke Download/XyDownloader. */
    private suspend fun doFiles(ctx: Context, taskId: String, title: String, jobPath: String): Result {
        val jobFile = File(jobPath)
        val arr = try { JSONArray(jobFile.readText()) } catch (e: Exception) { return fail(taskId, "Data unduhan hilang") }
        val n = arr.length()
        val tmpDir = File(ctx.cacheDir, "dl/$taskId").apply { deleteRecursively(); mkdirs() }
        Downloads.upsert(ctx, taskId) { it.copy(status = DlRecord.STATUS_RUNNING, line = "Mengunduh 1/$n…") }
        var ok = 0
        var firstUri: Uri? = null
        var firstMime = "application/octet-stream"
        var firstName = ""
        var lastError: String? = null
        var lastUpdate = 0L
        try {
            for (i in 0 until n) {
                if (isStopped) break
                val o = arr.getJSONObject(i)
                val name = o.getString("name")
                val mime = o.optString("mime").ifBlank { Engine.mimeOf(name) }
                val h = o.optJSONObject("headers")
                val headers = HashMap<String, String>()
                if (h != null) for (k in h.keys()) headers[k] = h.optString(k)
                val tmp = File(tmpDir, "f$i")
                try {
                    runInterruptible(Dispatchers.IO) {
                        Http.download(o.getString("url"), headers, tmp, { isStopped }) { bytes, total ->
                            val now = System.currentTimeMillis()
                            if (now - lastUpdate > 600) {
                                lastUpdate = now
                                val frac = if (total > 0) bytes.toFloat() / total else 0f
                                val p = ((i + frac) / n).coerceIn(0f, 1f)
                                val text = "File ${i + 1}/$n · ${formatBytes(bytes)}"
                                setProgressAsync(workDataOf(Downloads.K_PROGRESS to p, Downloads.K_LINE to text))
                                Downloads.upsert(ctx, taskId) { it.copy(status = DlRecord.STATUS_RUNNING, progress = p, line = text) }
                                try { setForegroundAsync(foreground(title, p, text)) } catch (_: Exception) { }
                            }
                        }
                    }
                    val uri = Storage.saveToDownloads(ctx, tmp, name, mime)
                    ok++
                    if (firstUri == null) {
                        firstUri = uri
                        firstMime = mime
                        firstName = name
                    }
                } catch (e: InterruptedException) {
                    break
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (e: Exception) {
                    lastError = e.message
                } finally {
                    tmp.delete()
                }
            }
        } finally {
            tmpDir.deleteRecursively()
            jobFile.delete()
        }
        if (isStopped) return fail(taskId, "Dibatalkan")
        val uri = firstUri ?: return fail(taskId, "Gagal mengunduh: ${lastError ?: "tidak ada file"}")
        val partial = if (ok < n) "${n - ok} file gagal" else null
        Downloads.upsert(ctx, taskId) {
            it.copy(status = DlRecord.STATUS_DONE, progress = 1f, uri = uri.toString(), mime = firstMime,
                fileName = firstName, line = null, error = partial, count = ok)
        }
        notifyDone(if (ok > 1) "$title ($ok file)" else title, uri, firstMime)
        return Result.success(workDataOf(Downloads.K_URI to uri.toString(), Downloads.K_MIME to firstMime, Downloads.K_NAME to firstName))
    }

    private fun describe(line: String, p: Float): String {
        val l = line.trim()
        return when {
            l.startsWith("[download]") && "%" in l -> l.removePrefix("[download]").trim().take(90)
            l.startsWith("[Merger]") -> "Menggabungkan video + audio…"
            l.startsWith("[ExtractAudio]") -> "Mengonversi audio…"
            l.startsWith("[Metadata]") -> "Menulis metadata…"
            l.startsWith("[XyUgoira]") -> "Membuat video dari ugoira…"
            p > 0f -> "Mengunduh ${(p * 100).toInt()}%"
            else -> "Memproses…"
        }
    }

    private fun fail(taskId: String, message: String): Result {
        Downloads.upsert(applicationContext, taskId) { it.copy(status = DlRecord.STATUS_FAILED, error = message, line = null) }
        return Result.failure(workDataOf(Downloads.K_ERROR to message))
    }

    private fun notifyDone(title: String, uri: Uri, mime: String) {
        val ctx = applicationContext
        val pi = PendingIntent.getActivity(
            ctx, nid, Downloads.openIntent(uri, mime),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n = NotificationCompat.Builder(ctx, Downloads.CH_DONE)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Download selesai")
            .setContentText(title)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        try { NotificationManagerCompat.from(ctx).notify(nid + 1, n) } catch (_: SecurityException) { }
    }
}

/** PendingIntent "Batal" di notifikasi. */
object WorkManagerCancel {
    fun intent(ctx: Context, id: UUID): PendingIntent = WorkManager.getInstance(ctx).createCancelPendingIntent(id)
}

@Suppress("unused")
private fun Data.debug(): String = keyValueMap.toString()
