package id.my.xyverse.xydownloader

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface HomeState {
    data object Idle : HomeState
    data object Loading : HomeState
    data class Loaded(val info: MediaInfo) : HomeState
    data class Error(val message: String) : HomeState
}

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val ctx get() = getApplication<Application>()

    var url by mutableStateOf("")
    var state by mutableStateOf<HomeState>(HomeState.Idle)
        private set
    var tab by mutableStateOf(0)
    var updateMessage by mutableStateOf<String?>(null)
        private set
    var updating by mutableStateOf(false)
        private set
    private var job: Job? = null

    val records = Downloads.records
    val engine = XyApp.engine

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
        fetch()
    }

    fun fetch() {
        val target = extractUrl(url)
        if (target == null) {
            state = HomeState.Error("Tempel link video yang valid dulu ya (diawali https://)")
            return
        }
        url = target
        job?.cancel()
        state = HomeState.Loading
        job = viewModelScope.launch {
            state = try {
                val info = withContext(Dispatchers.IO) { Engine.fetchInfo(ctx, target) }
                HomeState.Loaded(info)
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

    companion object {
        private val URL_RE = Regex("https?://[^\\s<>\"'\\u3000-\\u303f\\uff00-\\uffef]+", RegexOption.IGNORE_CASE)

        fun extractUrl(text: String): String? {
            val m = URL_RE.find(text) ?: run {
                val t = text.trim()
                return if (Regex("^[\\w-]+(\\.[\\w-]+)+/\\S*$").matches(t)) "https://$t" else null
            }
            return m.value.trimEnd('.', ',', ';', ':', '!', '?', ')', ']', '}', '>', '\'', '"')
        }
    }
}
