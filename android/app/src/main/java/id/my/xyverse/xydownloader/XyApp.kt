package id.my.xyverse.xydownloader

import android.app.Application
import com.onesignal.OneSignal
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class XyApp : Application() {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        // Push pengumuman (rilis & kabar penting). Izin notifikasi sudah diminta MainActivity;
        // OneSignal subscribe otomatis begitu izin dikasih.
        OneSignal.initWithContext(this, ONESIGNAL_APP_ID)
        Analytics.track(this, "session")
        Downloads.createChannels(this)
        Downloads.load(this)
        appScope.launch {
            val ok = Engine.init(this@XyApp)
            engineState.value = if (ok) EngineState.Ready(Engine.version(this@XyApp)) else EngineState.Failed(Engine.initError)
            if (ok) {
                // daemon Python "hangat": link pertama langsung diproses cepat
                PyDaemon.warmUp(this@XyApp)
                // yt-dlp diperbarui otomatis maksimal sekali sehari
                Engine.autoUpdateIfDue(this@XyApp)
                engineState.value = EngineState.Ready(Engine.version(this@XyApp))
            }
        }
    }

    sealed interface EngineState {
        data object Loading : EngineState
        data class Ready(val version: String?) : EngineState
        data class Failed(val message: String?) : EngineState
    }

    companion object {
        // App ID OneSignal khusus DownloadAja (per-app — jangan ditukar sama app lain).
        private const val ONESIGNAL_APP_ID = "8d66b3fd-06ea-4df6-aa39-0487d1cf85aa"

        val engineState = MutableStateFlow<EngineState>(EngineState.Loading)
        val engine: StateFlow<EngineState> get() = engineState
    }
}
