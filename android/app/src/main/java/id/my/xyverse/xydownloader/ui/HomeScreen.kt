package id.my.xyverse.xydownloader.ui

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import id.my.xyverse.xydownloader.HomeState
import id.my.xyverse.xydownloader.MainViewModel
import id.my.xyverse.xydownloader.MediaInfo
import id.my.xyverse.xydownloader.R
import id.my.xyverse.xydownloader.XyApp

@Composable
fun HomeScreen(vm: MainViewModel, toast: (String) -> Unit) {
    val context = LocalContext.current
    val focus = LocalFocusManager.current
    val engine by vm.engine.collectAsState()

    LazyColumn(
        Modifier.statusBarsPadding(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item { BrandHeader(Modifier.padding(bottom = 4.dp)) }
        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = XySurface),
                shape = RoundedCornerShape(20.dp),
            ) {
                Column(Modifier.padding(14.dp)) {
                    Text("Download video & MP3 dari semua platform", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = Color.White)
                    Text(
                        "TikTok, Douyin, Instagram, YouTube, Bilibili, Kuaishou, X, Facebook, Threads, Vidio & 1.700+ situs.",
                        color = XyMuted, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp, bottom = 12.dp),
                    )
                    OutlinedTextField(
                        value = vm.url,
                        onValueChange = { vm.url = it },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Tempel link di sini…") },
                        singleLine = true,
                        shape = RoundedCornerShape(14.dp),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                        keyboardActions = KeyboardActions(onGo = { focus.clearFocus(); vm.fetch() }),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = XyPrimary, unfocusedBorderColor = Color(0x33FFFFFF),
                            focusedContainerColor = XyBg, unfocusedContainerColor = XyBg,
                        ),
                        trailingIcon = {
                            if (vm.url.isNotEmpty()) {
                                IconButton(onClick = { vm.clear() }) { Icon(Icons.Filled.Close, "Hapus") }
                            } else {
                                IconButton(onClick = {
                                    val text = readClipboard(context)
                                    if (text.isNullOrBlank()) toast("Clipboard kosong") else {
                                        vm.url = text.trim(); focus.clearFocus(); vm.fetch()
                                    }
                                }) { Icon(painterResource(R.drawable.ic_paste), "Tempel") }
                            }
                        },
                    )
                    Spacer(Modifier.height(10.dp))
                    GradientButton(
                        text = if (vm.state is HomeState.Loading) "Membaca link…" else "Proses link",
                        enabled = vm.state !is HomeState.Loading,
                        modifier = Modifier.fillMaxWidth(),
                    ) { focus.clearFocus(); vm.fetch() }
                    when (val e = engine) {
                        is XyApp.EngineState.Loading -> EngineHint("⏳ Menyiapkan engine (pertama kali bisa ±10 detik)…")
                        is XyApp.EngineState.Failed -> EngineHint("⚠️ Engine gagal dimuat: ${e.message}")
                        else -> Unit
                    }
                }
            }
        }

        when (val s = vm.state) {
            is HomeState.Idle -> item { TipsCard() }
            is HomeState.Loading -> item { LoadingCard { vm.cancelFetch() } }
            is HomeState.Error -> item { ErrorCard(s.message) { vm.fetch() } }
            is HomeState.Loaded -> {
                item { InfoCard(s.info) }
                if (s.info.entries.isNotEmpty()) {
                    item { SectionTitle("📚 ${s.info.entries.size} item di postingan/playlist ini") }
                    items(s.info.entries.size) { i ->
                        val entry = s.info.entries[i]
                        EntryRow(entry.index, entry.title,
                            onVideo = {
                                vm.download(s.info, "video", 0, item = entry.index, label = "Video terbaik")
                                toast("Ditambahkan ke Unduhan: #${entry.index}")
                            },
                            onMp3 = {
                                vm.download(s.info, "mp3", kbps = 192, item = entry.index, label = "MP3 192 kbps")
                                toast("Ditambahkan ke Unduhan: #${entry.index} (MP3)")
                            })
                    }
                } else {
                    item { SectionTitle("🎬 Video") }
                    items(s.info.videoOptions.size) { i ->
                        val o = s.info.videoOptions[i]
                        OptionRow(
                            icon = R.drawable.ic_video,
                            title = if (o.height > 0) o.label else "Kualitas terbaik",
                            subtitle = listOfNotNull("MP4", o.codec, o.sizeBytes?.let { "±" + formatBytes(it) }).joinToString(" · "),
                        ) {
                            vm.download(s.info, "video", o.height, label = if (o.height > 0) "${o.label} MP4" else "Video terbaik")
                            toast("Download ${o.label} dimulai — cek tab Unduhan")
                        }
                    }
                    if (s.info.hasAudio) {
                        item { SectionTitle("🎵 Audio") }
                        val audio = listOf(
                            Triple("mp3", 320, "MP3 320 kbps"), Triple("mp3", 192, "MP3 192 kbps"),
                            Triple("mp3", 128, "MP3 128 kbps"), Triple("m4a", 0, "M4A (kualitas asli)"),
                        )
                        items(audio.size) { i ->
                            val (kind, kbps, label) = audio[i]
                            OptionRow(
                                icon = R.drawable.ic_music, title = label,
                                subtitle = if (kind == "mp3") "Konversi dengan FFmpeg di HP" else "Tanpa konversi",
                            ) {
                                vm.download(s.info, kind, kbps = if (kbps > 0) kbps else 192, label = label)
                                toast("Download $label dimulai — cek tab Unduhan")
                            }
                        }
                    }
                }
            }
        }
        item { Spacer(Modifier.height(8.dp)) }
    }
}

private fun readClipboard(context: Context): String? {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return null
    val clip = cm.primaryClip ?: return null
    if (clip.itemCount == 0) return null
    return clip.getItemAt(0).coerceToText(context)?.toString()
}

@Composable
private fun EngineHint(text: String) {
    Text(text, color = XyMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
}

@Composable
fun GradientButton(
    text: String,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
    icon: androidx.compose.ui.graphics.vector.ImageVector = Icons.Filled.Search,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(50.dp),
        shape = RoundedCornerShape(14.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(),
        colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent, disabledContainerColor = Color.Transparent),
    ) {
        Box(
            Modifier.fillMaxWidth().height(50.dp)
                .background(if (enabled) XyGradient else androidx.compose.ui.graphics.SolidColor(XySurface2)),
            contentAlignment = Alignment.Center,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, null, tint = Color.White, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text(text, color = Color.White, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun TipsCard() {
    Card(colors = CardDefaults.cardColors(containerColor = XySurface), shape = RoundedCornerShape(18.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("💡 Cara cepat", fontWeight = FontWeight.Bold, color = Color.White)
            Text("1. Di TikTok / IG / YouTube / Douyin, tekan Bagikan → pilih XyDownloader.", color = XyMuted, fontSize = 13.sp)
            Text("2. Atau salin link, lalu tekan ikon tempel di kolom atas.", color = XyMuted, fontSize = 13.sp)
            Text("3. Pilih kualitas video atau MP3. File tersimpan di Download/XyDownloader.", color = XyMuted, fontSize = 13.sp)
        }
    }
}

@Composable
private fun LoadingCard(onCancel: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = XySurface), shape = RoundedCornerShape(18.dp)) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(28.dp), color = XyPrimary, strokeWidth = 3.dp)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text("Membaca link…", color = Color.White, fontWeight = FontWeight.SemiBold)
                Text("Mencari semua kualitas yang tersedia", color = XyMuted, fontSize = 12.sp)
            }
            TextButton(onClick = onCancel) { Text("Batal") }
        }
    }
}

@Composable
fun ErrorCard(message: String, onRetry: (() -> Unit)? = null) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0x22EF4444)),
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier.border(1.dp, Color(0x55EF4444), RoundedCornerShape(18.dp)),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text("Gagal memproses 😕", color = Color.White, fontWeight = FontWeight.Bold)
            Text(message, color = Color(0xFFFECACA), fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
            if (onRetry != null) TextButton(onClick = onRetry, modifier = Modifier.padding(top = 4.dp)) { Text("Coba lagi") }
        }
    }
}

@Composable
private fun InfoCard(info: MediaInfo) {
    Card(colors = CardDefaults.cardColors(containerColor = XySurface), shape = RoundedCornerShape(18.dp)) {
        Row(Modifier.padding(12.dp)) {
            Box(
                Modifier.width(128.dp).aspectRatio(16f / 10f).clip(RoundedCornerShape(12.dp)).background(XySurface2),
            ) {
                if (info.thumbnail != null) {
                    AsyncImage(
                        model = info.thumbnail, contentDescription = null,
                        contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize(),
                    )
                }
                info.duration?.let {
                    Text(
                        formatDuration(it), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.align(Alignment.BottomEnd).padding(4.dp)
                            .background(Color(0xB3000000), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    info.platform, color = XyCyan, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                )
                Text(
                    info.title, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
                    maxLines = 3, overflow = TextOverflow.Ellipsis,
                )
                info.uploader?.let { Text("oleh $it", color = XyMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, color = Color.White, modifier = Modifier.padding(top = 4.dp))
}

@Composable
private fun OptionRow(icon: Int, title: String, subtitle: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(XySurface)
            .clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(38.dp).clip(RoundedCornerShape(11.dp)).background(XyPrimary.copy(alpha = 0.22f)),
            contentAlignment = Alignment.Center,
        ) { Icon(painterResource(icon), null, tint = Color.White, modifier = Modifier.size(20.dp)) }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = Color.White, fontWeight = FontWeight.Bold)
            if (subtitle.isNotBlank()) Text(subtitle, color = XyMuted, fontSize = 12.sp)
        }
        Box(
            Modifier.clip(RoundedCornerShape(10.dp)).background(XyGradient).padding(horizontal = 12.dp, vertical = 7.dp),
        ) { Text("Unduh", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp) }
    }
}

@Composable
private fun EntryRow(index: Int, title: String, onVideo: () -> Unit, onMp3: () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(XySurface).padding(12.dp)) {
        Text("#$index  $title", color = Color.White, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SmallPill("🎬 Video", onVideo)
            SmallPill("🎵 MP3", onMp3)
        }
    }
}

@Composable
fun SmallPill(text: String, onClick: () -> Unit) {
    Box(
        Modifier.clip(RoundedCornerShape(10.dp)).background(XySurface2).clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 7.dp),
    ) { Text(text, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
}

fun formatBytes(b: Long): String {
    if (b <= 0) return "?"
    val units = arrayOf("B", "KB", "MB", "GB")
    var v = b.toDouble()
    var i = 0
    while (v >= 1024 && i < units.size - 1) { v /= 1024; i++ }
    return if (v >= 100 || i == 0) "${v.toInt()} ${units[i]}" else String.format(java.util.Locale.US, "%.1f %s", v, units[i])
}

fun formatDuration(sec: Double): String {
    val s = sec.toLong()
    val h = s / 3600
    val m = (s % 3600) / 60
    val r = s % 60
    return if (h > 0) String.format(java.util.Locale.US, "%d:%02d:%02d", h, m, r)
    else String.format(java.util.Locale.US, "%d:%02d", m, r)
}
