package id.my.xyverse.xydownloader

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import id.my.xyverse.xydownloader.update.AppUpdater
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale

sealed interface HomeState {
    data object Idle : HomeState
    data object Loading : HomeState
    data class Loaded(val info: MediaInfo) : HomeState
    data class Error(val message: String) : HomeState
}

enum class Screen { Main, Update, Licenses }

enum class LiveMode(val label: String) { PHOTO("Foto"), VIDEO("Video"), BOTH("Foto + Video") }

sealed interface Popup {
    data class WhatsNew(val bannerUrl: String?) : Popup
    data class Update(val release: AppUpdater.Release) : Popup
}

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val ctx get() = getApplication<Application>()

    var url by mutableStateOf("")
    var state by mutableStateOf<HomeState>(HomeState.Idle)
        private set
    var tab by mutableStateOf(0)
    var screen by mutableStateOf(Screen.Main)
    var updateMessage by mutableStateOf<String?>(null)
        private set
    var updating by mutableStateOf(false)
        private set
    private var job: Job? = null

    // galeri (foto slide / Live Photo / carousel)
    var selected by mutableStateOf<Set<Int>>(emptySet())
    var liveMode by mutableStateOf(LiveMode.BOTH)
    var viewerIndex by mutableStateOf<Int?>(null)
    var showPreview by mutableStateOf(false)

    // popup pembaruan / yang baru
    var popup by mutableStateOf<Popup?>(null)
        private set
    private var pendingUpdatePopup: AppUpdater.Release? = null
    private var startupDone = false

    val records = Downloads.records
    val engine = XyApp.engine
    val updateState = AppUpdater.state

    init {
        Downloads.load(ctx)
        // Sinkronkan status riwayat dengan WorkManager (mis. setelah aplikasi ditutup paksa)
        viewModelScope.launch {
            WorkManager.getInstance(ctx).getWorkInfosByTagFlow(Downloads.TAG).collect { infos ->
                for (wi in infos) {
                    val id = wi.id.toString()
                    when (wi.state) {
                        WorkInfo.State.SUCCEEDED -> Downloads.upsert(ctx, id) {
                            if (it.status == DlRecord.STATUS_DONE) it else it.copy(
                                status = DlRecord.STATUS_DONE, progress = 1f,
                                uri = wi.outputData.getString(Downloads.K_URI) ?: it.uri,
                                mime = wi.outputData.getString(Downloads.K_MIME) ?: it.mime,
                                fileName = wi.outputData.getString(Downloads.K_NAME) ?: it.fileName,
                            )
                        }
                        WorkInfo.State.FAILED, WorkInfo.State.CANCELLED -> Downloads.upsert(ctx, id) {
                            if (it.status == DlRecord.STATUS_FAILED) it else it.copy(
                                status = DlRecord.STATUS_FAILED,
                                error = wi.outputData.getString(Downloads.K_ERROR)
                                    ?: if (wi.state == WorkInfo.State.CANCELLED) "Dibatalkan" else "Gagal",
                            )
                        }
                        else -> Unit
                    }
                }
            }
        }
    }

    fun onShared(text: String?) {
        val found = extractUrl(text ?: "") ?: return
        url = found
        tab = 0
        screen = Screen.Main
        fetch()
    }

    fun fetch() {
        val target = extractUrl(url)
        if (target == null) {
            state = HomeState.Error("Tempel link video / postingan yang valid dulu ya (diawali https://)")
            return
        }
        url = target
        job?.cancel()
        state = HomeState.Loading
        showPreview = false
        viewerIndex = null
        job = viewModelScope.launch {
            state = try {
                val info = withContext(Dispatchers.IO) { Engine.fetchInfo(ctx, target) }
                selected = info.gallery.map { it.index }.toSet()
                liveMode = when (AppSettings.livePhotoMode(ctx)) {
                    "photo" -> LiveMode.PHOTO
                    "video" -> LiveMode.VIDEO
                    else -> LiveMode.BOTH
                }
                val loaded = HomeState.Loaded(info)
                runCatching {
                    Analytics.track(ctx, "extract", platform = info.platform ?: PlatformCatalog.detect(target)?.id)
                }
                // Auto-buka pratinjau video jika diizinkan & ada sumber
                showPreview = info.preview != null
                    && AppSettings.autoplayVideo(ctx)
                    && !AppSettings.dataSaver(ctx)
                loaded
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Throwable) {
                HomeState.Error(Engine.friendlyError(e.message))
            }
        }
    }

    fun cancelFetch() {
        job?.cancel()
        state = HomeState.Idle
    }

    fun clear() {
        url = ""
        state = HomeState.Idle
    }

    fun download(info: MediaInfo, kind: String, height: Int = 0, kbps: Int = 192, item: Int = 0, label: String) {
        val title = if (item > 0) info.entries.firstOrNull { it.index == item }?.title ?: info.title else info.title
        Downloads.enqueue(ctx, info, kind, height, kbps, item, label, title)
    }

    // ------------------------------------------------------------------ galeri
    fun toggle(index: Int) {
        selected = if (index in selected) selected - index else selected + index
    }

    fun selectAll(info: MediaInfo, all: Boolean) {
        selected = if (all) info.gallery.map { it.index }.toSet() else emptySet()
    }

    /** Jumlah file yang akan diunduh untuk pilihan sekarang. */
    fun fileCount(info: MediaInfo): Int {
        var n = 0
        for (item in info.gallery) {
            if (item.index !in selected) continue
            n += if (item.type == ItemType.LIVE && liveMode == LiveMode.BOTH) 2 else 1
        }
        return n
    }

    /** Unduh item galeri terpilih (atau hanya [only]). Return jumlah file. */
    fun downloadGallery(info: MediaInfo, only: GalleryItem? = null, onlyPhoto: Boolean? = null): Int {
        val items = if (only != null) listOf(only) else info.gallery.filter { it.index in selected }
        if (items.isEmpty()) return 0
        val base = "DownloadAja-" + safeName(info.title).take(40)
        val multi = info.gallery.size > 1
        val files = ArrayList<Downloads.FileJob>()
        var viaEngine = 0
        for (it in items) {
            val num = if (multi) "-p${it.index.toString().padStart(2, '0')}" else ""
            when (it.type) {
                ItemType.IMAGE -> it.image?.let { s -> files.add(job(s, "$base$num", "jpg")) }
                ItemType.LIVE -> {
                    val photo = onlyPhoto ?: (liveMode != LiveMode.VIDEO)
                    val video = if (onlyPhoto != null) !onlyPhoto else liveMode != LiveMode.PHOTO
                    if (photo) it.image?.let { s -> files.add(job(s, "$base$num", "jpg")) }
                    if (video) it.video?.let { s -> files.add(job(s, "$base$num-live", "mp4")) }
                }
                ItemType.VIDEO -> {
                    val v = it.video
                    if (v != null) files.add(job(v, "$base$num", "mp4"))
                    else {
                        Downloads.enqueue(ctx, info, "video", 0, 192, it.index, "Video #${it.index}", "${info.title} #${it.index}")
                        viaEngine++
                    }
                }
            }
        }
        if (files.isNotEmpty()) {
            val label = if (files.size == 1) labelFor(files[0].name) else "${files.size} file"
            Downloads.enqueueFiles(ctx, info, files, label, info.title)
        }
        return files.size + viaEngine
    }

    private fun labelFor(name: String) = when (name.substringAfterLast('.').lowercase(Locale.ROOT)) {
        "mp4", "mov", "webm" -> "Video"
        "mp3", "m4a" -> "Audio"
        else -> "Foto"
    }

    private fun job(s: HttpSource, name: String, defExt: String): Downloads.FileJob {
        val raw = (s.ext ?: defExt).lowercase(Locale.ROOT).let { if (it == "jpeg") "jpg" else it }
        val ext = if (raw.length in 2..5 && raw.all { it.isLetterOrDigit() }) raw else defExt
        val file = "$name.$ext"
        return Downloads.FileJob(s.url, s.headers, file, Engine.mimeOf(file))
    }

    /** Musik latar foto slide: file asli (langsung) atau MP3 (dikonversi FFmpeg di HP). */
    fun downloadMusic(info: MediaInfo, mp3: Boolean) {
        val m = info.music ?: return
        val base = safeName(info.title) + " (musik)"
        if (!mp3) {
            Downloads.enqueueFiles(ctx, info, listOf(job(m.source, base, "m4a")), "Musik latar", info.title)
            return
        }
        val ext = m.source.ext ?: "m4a"
        val fmt = JSONObject().put("format_id", "music").put("url", m.source.url).put("ext", ext)
            .put("vcodec", "none").put("acodec", if (ext == "mp3") "mp3" else "aac").put("protocol", "https")
            .put("http_headers", JSONObject(m.source.headers as Map<*, *>))
        val json = JSONObject().put("id", "musik").put("title", "${info.title.take(80)} (musik)")
            .put("extractor", "generic").put("extractor_key", "Generic").put("webpage_url", info.sourceUrl)
            .put("formats", JSONArray().put(fmt))
        val file = File(PyDaemon.infoDir(ctx), "music-${System.currentTimeMillis()}.json")
        file.writeText(json.toString())
        Downloads.enqueue(ctx, info, "mp3", 0, 192, 0, "Musik latar · MP3", "${info.title} (musik)", infoPath = file.absolutePath)
    }

    // ------------------------------------------------------------------ engine
    fun updateEngine() {
        if (updating) return
        updating = true
        updateMessage = "Mengecek versi terbaru…"
        viewModelScope.launch {
            val msg = withContext(Dispatchers.IO) { Engine.update(ctx) }
            XyApp.engineState.value = XyApp.EngineState.Ready(withContext(Dispatchers.IO) { Engine.version(ctx) })
            updateMessage = msg
            updating = false
        }
    }

    // ------------------------------------------------------------------ pembaruan aplikasi
    /** Dipanggil setelah splash selesai: popup "yang baru" + cek pembaruan (maks. tiap 6 jam). */
    fun onStartup() {
        if (startupDone) return
        startupDone = true
        viewModelScope.launch {
            if (withContext(Dispatchers.IO) { AppUpdater.shouldShowWhatsNew(ctx) }) {
                popup = Popup.WhatsNew(AppUpdater.currentBannerUrl())
            }
            val due = System.currentTimeMillis() - AppUpdater.lastCheck(ctx) > 6 * 3600_000L
            if (!due) return@launch
            val rel = AppUpdater.check(ctx) ?: return@launch
            if (AppUpdater.compare(rel.version, AppUpdater.currentVersion) > 0 && AppUpdater.dismissed(ctx) != rel.version) {
                if (popup == null) popup = Popup.Update(rel) else pendingUpdatePopup = rel
            }
        }
    }

    /** Tombol X di popup. */
    fun closePopup() {
        val p = popup
        if (p is Popup.Update) AppUpdater.dismiss(ctx, p.release.version)
        popup = pendingUpdatePopup?.let { Popup.Update(it) }
        pendingUpdatePopup = null
    }

    /** Gambar popup ditekan -> halaman Pembaruan. */
    fun openPopup() {
        popup = null
        pendingUpdatePopup = null
        openUpdates()
    }

    fun openUpdates() {
        screen = Screen.Update
        val s = AppUpdater.state.value
        if (s is AppUpdater.State.Idle || s is AppUpdater.State.Failed) checkUpdates()
    }

    fun checkUpdates() {
        viewModelScope.launch { AppUpdater.check(ctx) }
    }

    fun startUpdate(release: AppUpdater.Release) {
        viewModelScope.launch { AppUpdater.downloadAndInstall(ctx, release) }
    }

    /** Kembali dari pengaturan izin "instal aplikasi tidak dikenal". */
    fun onResumeFromSettings() {
        val s = AppUpdater.state.value
        if (s is AppUpdater.State.NeedsPermission && AppUpdater.canInstall(ctx)) startUpdate(s.release)
    }

    companion object {
        private val URL_RE = Regex("https?://[^\\s<>\"'\\u3000-\\u303f\\uff00-\\uffef]+", RegexOption.IGNORE_CASE)

        fun extractUrl(text: String): String? {
            val m = URL_RE.find(text) ?: run {
                val t = text.trim()
                return if (Regex("^[\\w-]+(\\.[\\w-]+)+/\\S*$").matches(t)) "https://$t" else null
            }
            return m.value.trimEnd('.', ',', ';', ':', '!', '?', ')', ']', '}', '>', '\'', '"')
        }

        fun safeName(name: String): String =
            name.replace(Regex("[\\\\/:*?\"<>|\\r\\n\\t]+"), " ").replace(Regex("\\s+"), " ").trim().take(80).ifBlank { "DownloadAja" }
    }
}
