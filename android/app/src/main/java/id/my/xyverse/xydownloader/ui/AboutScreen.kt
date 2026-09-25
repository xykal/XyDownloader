package id.my.xyverse.xydownloader.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.my.xyverse.xydownloader.BuildConfig
import id.my.xyverse.xydownloader.MainViewModel
import id.my.xyverse.xydownloader.R
import id.my.xyverse.xydownloader.XyApp

@Composable
fun AboutScreen(vm: MainViewModel) {
    val context = LocalContext.current
    val engine by vm.engine.collectAsState()
    fun open(url: String) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) { }
    }

    Column(
        Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Spacer(Modifier.height(8.dp))
        Image(painterResource(R.drawable.ic_splash), null, Modifier.size(96.dp))
        Text("XyDownloader", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Color.White)
        Text("Versi ${BuildConfig.VERSION_NAME}", color = XyMuted, fontSize = 13.sp)

        // ---- engine
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(XySurface).padding(16.dp)) {
            Text("⚙️ Engine", fontWeight = FontWeight.Bold, color = Color.White)
            val ver = when (val e = engine) {
                is XyApp.EngineState.Ready -> "yt-dlp ${e.version ?: "-"} · FFmpeg · Python"
                is XyApp.EngineState.Failed -> "Gagal dimuat: ${e.message}"
                else -> "Menyiapkan…"
            }
            Text(ver, color = XyMuted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
            Text(
                "Platform sering mengubah sistemnya. Kalau ada link yang tiba-tiba gagal, perbarui engine dulu.",
                color = XyMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp),
            )
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                GradientButton(
                    text = if (vm.updating) "Memperbarui…" else "Perbarui engine",
                    enabled = !vm.updating && engine is XyApp.EngineState.Ready,
                    modifier = Modifier.weight(1f),
                    icon = Icons.Filled.Refresh,
                ) { vm.updateEngine() }
                if (vm.updating) {
                    Spacer(Modifier.width(12.dp))
                    CircularProgressIndicator(Modifier.size(24.dp), color = XyPrimary, strokeWidth = 3.dp)
                }
            }
            vm.updateMessage?.let { Text(it, color = Color.White, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp)) }
        }

        // ---- info
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(XySurface).padding(16.dp)) {
            Text("📁 Lokasi file", fontWeight = FontWeight.Bold, color = Color.White)
            Text("Internal storage › Download › XyDownloader", color = XyMuted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
            Spacer(Modifier.height(10.dp))
            Text("🌐 Versi web", fontWeight = FontWeight.Bold, color = Color.White)
            Text(BuildConfig.WEB_URL, color = XyCyan, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp).clickable { open(BuildConfig.WEB_URL) })
            Spacer(Modifier.height(10.dp))
            Text("💻 Source code (GPL-3.0)", fontWeight = FontWeight.Bold, color = Color.White)
            Text(BuildConfig.REPO_URL, color = XyCyan, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp).clickable { open(BuildConfig.REPO_URL) })
        }

        // ---- kredit
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(XySurface).padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Image(painterResource(R.drawable.ic_xyverse), null, Modifier.size(34.dp))
                Spacer(Modifier.width(10.dp))
                Column {
                    Text("Built with 💜 by XyVerse", color = Color.White, fontWeight = FontWeight.Bold)
                    Text("xyverse.my.id", color = XyMuted, fontSize = 12.sp, modifier = Modifier.clickable { open("https://xyverse.my.id") })
                }
            }
            Spacer(Modifier.height(12.dp))
            Text(
                "Dibangun di atas proyek open source: yt-dlp, youtubedl-android, FFmpeg, Python, QuickJS, Jetpack Compose.",
                color = XyMuted, fontSize = 12.sp, textAlign = TextAlign.Center,
            )
        }

        Text(
            "Gunakan hanya untuk konten milik sendiri atau yang kamu punya izin untuk mengunduhnya. " +
                "Hormati hak cipta kreator. XyDownloader tidak berafiliasi dengan platform mana pun.",
            color = XyMuted, fontSize = 11.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 8.dp),
        )
        Spacer(Modifier.height(12.dp))
    }
}
