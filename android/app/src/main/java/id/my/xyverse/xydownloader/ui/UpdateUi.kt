package id.my.xyverse.xydownloader.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import coil.compose.AsyncImage
import coil.request.ImageRequest
import id.my.xyverse.xydownloader.MainViewModel
import id.my.xyverse.xydownloader.R
import id.my.xyverse.xydownloader.update.AppUpdater

/**
 * Popup pembaruan: HANYA gambar (ilustrasi AI dari aset rilis, cadangan gambar bawaan) + tombol X.
 * Gambar ditekan -> halaman Pembaruan.
 */
@Composable
fun BannerPopup(bannerUrl: String?, onClose: () -> Unit, onOpen: () -> Unit) {
    val context = LocalContext.current
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxWidth().padding(horizontal = 28.dp), contentAlignment = Alignment.Center) {
            Box(Modifier.widthIn(max = 420.dp).fillMaxWidth()) {
                AsyncImage(
                    model = ImageRequest.Builder(context).data(bannerUrl ?: R.drawable.update_banner).crossfade(true).build(),
                    contentDescription = "Ada pembaruan XyDownloader — ketuk untuk melihat",
                    placeholder = painterResource(R.drawable.update_banner),
                    error = painterResource(R.drawable.update_banner),
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().aspectRatio(928f / 1152f).clip(RoundedCornerShape(22.dp))
                        .clickable(onClickLabel = "Buka halaman pembaruan", onClick = onOpen),
                )
                Surface(
                    onClick = onClose,
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.surface,
                    shadowElevation = 4.dp,
                    modifier = Modifier.align(Alignment.TopEnd).padding(10.dp).size(36.dp),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.Close, "Tutup", Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurface)
                    }
                }
            }
        }
    }
}

@Composable
fun UpdateScreen(vm: MainViewModel, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val context = LocalContext.current
    val cs = MaterialTheme.colorScheme
    val state by vm.updateState.collectAsState()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) vm.onResumeFromSettings() }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs) }
    }
    fun open(url: String) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
        }
    }
    val release: AppUpdater.Release? = when (val s = state) {
        is AppUpdater.State.Available -> s.release
        is AppUpdater.State.NeedsPermission -> s.release
        is AppUpdater.State.Downloading -> s.release
        is AppUpdater.State.Installing -> s.release
        is AppUpdater.State.Failed -> s.release
        is AppUpdater.State.UpToDate -> s.latest
        else -> null
    }
    val newer = release != null && AppUpdater.compare(release.version, AppUpdater.currentVersion) > 0

    Column(Modifier.fillMaxSize().background(cs.background).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(painterResource(R.drawable.ic_arrow_back), "Kembali", tint = cs.onBackground) }
            Text("Pembaruan aplikasi", style = MaterialTheme.typography.titleMedium, color = cs.onBackground)
        }
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            AsyncImage(
                model = ImageRequest.Builder(context).data(release?.bannerUrl ?: AppUpdater.currentBannerUrl() ?: R.drawable.update_banner)
                    .crossfade(true).build(),
                contentDescription = null,
                placeholder = painterResource(R.drawable.update_banner),
                error = painterResource(R.drawable.update_banner),
                contentScale = ContentScale.Crop,
                alignment = Alignment.TopCenter,
                modifier = Modifier.fillMaxWidth().aspectRatio(928f / 700f).clip(RoundedCornerShape(18.dp)),
            )
            XyCard {
                Text("Versi terpasang", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                Text(AppUpdater.currentVersion, style = MaterialTheme.typography.titleMedium, color = cs.onSurface)
                Spacer(Modifier.height(10.dp))
                when (val s = state) {
                    is AppUpdater.State.Idle, is AppUpdater.State.Checking -> StatusLine(R.drawable.ic_refresh, "Mengecek versi terbaru…")
                    is AppUpdater.State.UpToDate -> StatusLine(R.drawable.ic_check_circle, "Kamu sudah memakai versi terbaru.", cs.primary)
                    is AppUpdater.State.Available -> StatusLine(R.drawable.ic_update, "Versi ${s.release.version} tersedia", cs.primary)
                    is AppUpdater.State.NeedsPermission -> StatusLine(R.drawable.ic_alert, "Izinkan XyDownloader memasang pembaruan", cs.error)
                    is AppUpdater.State.Downloading -> {
                        val p = if (s.total > 0) (s.bytes.toFloat() / s.total).coerceIn(0f, 1f) else 0f
                        StatusLine(R.drawable.ic_download, "Mengunduh ${(p * 100).toInt()}% · ${formatBytes(s.bytes)}" +
                            (if (s.total > 0) " / ${formatBytes(s.total)}" else ""))
                        Spacer(Modifier.height(8.dp))
                        LinearProgressIndicator(progress = { p }, modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(6.dp)))
                    }
                    is AppUpdater.State.Installing -> StatusLine(R.drawable.ic_update, "Memasang versi ${s.release.version}… aplikasi akan tertutup sebentar.")
                    is AppUpdater.State.Failed -> StatusLine(R.drawable.ic_alert, s.message, cs.error)
                }
                Spacer(Modifier.height(14.dp))
                when (val s = state) {
                    is AppUpdater.State.Available -> PrimaryButton(
                        "Perbarui sekarang", Modifier.fillMaxWidth(), icon = R.drawable.ic_download,
                    ) { vm.startUpdate(s.release) }
                    is AppUpdater.State.NeedsPermission -> {
                        Text(
                            "Android meminta izin \"Instal aplikasi tidak dikenal\" untuk XyDownloader. Aktifkan, lalu kembali ke sini — " +
                                "pembaruan lanjut otomatis.",
                            style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(10.dp))
                        PrimaryButton("Buka pengaturan izin", Modifier.fillMaxWidth(), icon = R.drawable.ic_open) {
                            try { context.startActivity(AppUpdater.permissionIntent(context).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { }
                        }
                    }
                    is AppUpdater.State.Failed -> if (s.release != null && newer) {
                        PrimaryButton("Coba lagi", Modifier.fillMaxWidth(), icon = R.drawable.ic_refresh) { vm.startUpdate(s.release) }
                    } else {
                        PrimaryButton("Cek pembaruan", Modifier.fillMaxWidth(), icon = R.drawable.ic_refresh) { vm.checkUpdates() }
                    }
                    is AppUpdater.State.Downloading, is AppUpdater.State.Installing, is AppUpdater.State.Checking -> Unit
                    else -> OutlinedButton(onClick = { vm.checkUpdates() }, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().height(48.dp)) {
                        Icon(painterResource(R.drawable.ic_refresh), null, Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Cek pembaruan", fontWeight = FontWeight.SemiBold)
                    }
                }
                if (newer && release?.apk != null) {
                    Text(
                        "${release.apk.name} · ${formatBytes(release.apk.size)} · dipasang otomatis (Android 12+ tanpa konfirmasi tambahan)",
                        style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
            if (release != null && release.notes.isNotBlank()) {
                XyCard {
                    Text(if (newer) "Yang baru di ${release.version}" else "Catatan rilis ${release.version}",
                        style = MaterialTheme.typography.titleSmall, color = cs.onSurface)
                    Spacer(Modifier.height(8.dp))
                    ReleaseNotes(release.notes)
                    Spacer(Modifier.height(4.dp))
                    Text("Lihat di GitHub", style = MaterialTheme.typography.bodySmall, color = cs.primary,
                        modifier = Modifier.clickable { open(release.htmlUrl) }.padding(vertical = 6.dp))
                }
            }
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically) {
                XyVerseLogo(18..dp)
                Spacer(Modifier.width(6.dp))
                Text("Built in ", color = cs.onSurfaceVariant, fontSize = 12.sp)
                Text("XyVerse", color = cs.onBackground, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun StatusLine(icon: Int, text: String, tint: Color = MaterialTheme.colorScheme.onSurfaceVariant) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(painterResource(icon), null, Modifier.size(18.dp), tint = tint)
        Spacer(Modifier.width(8.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
    }
}

/** Markdown sederhana dari catatan rilis GitHub: judul (#), butir (- / *), teks biasa. */
@Composable
private fun ReleaseNotes(md: String) {
    val cs = MaterialTheme.colorScheme
    val lines = md.lines().map { it.trimEnd() }.filter { it.isNotBlank() && !it.startsWith("|") && !it.startsWith("<!--") }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        lines.take(40).forEach { raw ->
            val clean = raw.replace("**", "").replace("`", "").replace(Regex("\\[([^\\]]+)]\\([^)]+\\)"), "$1")
            when {
                clean.startsWith("#") -> Text(clean.trimStart('#', ' '), style = MaterialTheme.typography.titleSmall,
                    color = cs.onSurface, modifier = Modifier.padding(top = 6.dp))
                clean.trimStart().startsWith("- ") || clean.trimStart().startsWith("* ") -> Row {
                    Text("•", color = cs.primary, modifier = Modifier.width(14.dp))
                    Text(clean.trimStart().drop(2), style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                }
                else -> Text(clean, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
            }
        }
    }
}
