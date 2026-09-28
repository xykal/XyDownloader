package id.my.xyverse.xydownloader

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import id.my.xyverse.xydownloader.ui.XyRoot
import id.my.xyverse.xydownloader.ui.XyTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()

    private val askPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) handleIntent(intent)
        requestNeededPermissions()
        watchFirstDownload()
        setContent {
            XyTheme {
                XyRoot(vm)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        if (intent.action == Intent.ACTION_SEND) {
            val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: intent.getStringExtra(Intent.EXTRA_SUBJECT)
            vm.onShared(text)
        } else if (intent.hasExtra("tab")) {
            vm.tab = intent.getIntExtra("tab", 0)
        }
    }

    private fun requestNeededPermissions() {
        // POST_NOTIFICATIONS sengaja TIDAK diminta di awal — user baru diminta
        // setelah unduhan pertamanya selesai (lihat watchFirstDownload).
        if (Build.VERSION.SDK_INT <= 28 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
        ) {
            askPermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }
    }

    /**
     * Izin notifikasi diminta tepat saat nilainya jelas: begitu unduhan pertama
     * selesai (notifikasi "Download selesai" baru ada gunanya). Diminta sekali
     * saja — kalau ditolak, tidak diganggu lagi.
     */
    private fun watchFirstDownload() {
        if (Build.VERSION.SDK_INT < 33) return
        Downloads.load(this)
        lifecycleScope.launch {
            var awal: Set<String>? = null   // baseline: riwayat lama bukan "unduhan pertama"
            Downloads.records.collect { list ->
                val selesai = list.filter { it.status == DlRecord.STATUS_DONE }.map { it.id }.toSet()
                val baseline = awal
                if (baseline == null) { awal = selesai; return@collect }
                val baru = selesai - baseline
                if (baru.isNotEmpty() && !AppSettings.notificationAsked(this@MainActivity)) {
                    AppSettings.setNotificationAsked(this@MainActivity, true)
                    if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED
                    ) {
                        askPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                }
            }
        }
    }
}
