package id.my.xyverse.xydownloader.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import id.my.xyverse.xydownloader.BuildConfig
import id.my.xyverse.xydownloader.MainViewModel
import id.my.xyverse.xydownloader.R
import id.my.xyverse.xydownloader.XyApp

@Composable
fun AboutScreen(vm: MainViewModel) {
    val context = LocalContext.current
    val engine by vm.engine.collectAsState()
    val cs = MaterialTheme.colorScheme
    fun open(url: String) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) { }
    }

    Column(
        Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Spacer(Modifier.height(8.dp))
        Image(painterResource(R.drawable.ic_splash), null, Modifier.size(84.dp))
        Text("XyDownloader", style = MaterialTheme.typography.headlineSmall, color = cs.onBackground)
        Text("Versi ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)

        XyCard {
            InfoLine(
                R.drawable.ic_cpu, "Engine",
                when (val e = engine) {
                    is XyApp.EngineState.Ready -> "yt-dlp ${e.version ?: "-"} · FFmpeg · Python"
                    is XyApp.EngineState.Failed -> "Gagal dimuat: ${e.message}"
                    else -> "Menyiapkan…"
                },
            )
            Text(
                "Platform sering mengubah sistemnya. Kalau ada link yang tiba-tiba gagal, perbarui engine dulu.",
                style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant, modifier = Modifier.padding(start = 30.dp),
            )
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                PrimaryButton(
                    text = if (vm.updating) "Memperbarui…" else "Perbarui engine",
                    icon = R.drawable.ic_refresh,
                    enabled = !vm.updating && engine is XyApp.EngineState.Ready,
                    modifier = Modifier.weight(1f),
                ) { vm.updateEngine() }
                if (vm.updating) {
                    Spacer(Modifier.width(12.dp))
                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.5.dp)
                }
            }
            vm.updateMessage?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = cs.onSurface, modifier = Modifier.padding(top = 8.dp))
            }
        }

        XyCard {
            InfoLine(R.drawable.ic_folder, "Lokasi file", "Internal storage › Download › XyDownloader")
            InfoLine(R.drawable.ic_globe, "Versi web", BuildConfig.WEB_URL) { open(BuildConfig.WEB_URL) }
            InfoLine(R.drawable.ic_code, "Source code (GPL-3.0)", BuildConfig.REPO_URL) { open(BuildConfig.REPO_URL) }
        }

        XyCard {
            Row(Modifier.fillMaxWidth().clickable { open("https://xyverse.my.id") }, verticalAlignment = Alignment.CenterVertically) {
                Image(painterResource(R.drawable.ic_xyverse), null, Modifier.size(32.dp))
                Spacer(Modifier.width(12.dp))
                Column {
                    Row {
                        Text("Built in ", style = MaterialTheme.typography.titleSmall, color = cs.onSurface, fontWeight = FontWeight.Normal)
                        Text("XyVerse", style = MaterialTheme.typography.titleSmall, color = cs.onSurface)
                    }
                    Text("xyverse.my.id", style = MaterialTheme.typography.bodySmall, color = cs.primary)
                }
            }
            Spacer(Modifier.height(12.dp))
            Text(
                "Dibangun di atas proyek open source: yt-dlp, youtubedl-android, FFmpeg, Python, QuickJS, Jetpack Compose. " +
                    "Logo platform adalah merek milik pemiliknya masing-masing.",
                style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant,
            )
        }

        Text(
            "Gunakan hanya untuk konten milik sendiri atau yang kamu punya izin untuk mengunduhnya. " +
                "Hormati hak cipta kreator. XyDownloader tidak berafiliasi dengan platform mana pun.",
            style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant, textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
        Spacer(Modifier.height(12.dp))
    }
}
