package id.my.xyverse.xydownloader

import android.app.Application
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
        Downloads.createChannels(this)
        Downloads.load(this)
        appScope.launch {
            val ok = Engine.init(this@XyApp)
            engineState.value = if (ok) EngineState.Ready(Engine.version(this@XyApp)) else EngineState.Failed(Engine.initError)
            if (ok) {
                // yt-dlp bawaan library bisa sudah lama -> update otomatis maksimal sekali sehari
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
        val engineState = MutableStateFlow<EngineState>(EngineState.Loading)
        val engine: StateFlow<EngineState> get() = engineState
    }
}
