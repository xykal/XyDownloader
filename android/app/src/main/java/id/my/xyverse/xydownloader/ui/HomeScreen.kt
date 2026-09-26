package id.my.xyverse.xydownloader.ui

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
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
import id.my.xyverse.xydownloader.PlatformCatalog
import id.my.xyverse.xydownloader.R
import id.my.xyverse.xydownloader.XyApp
import id.my.xyverse.xydownloader.AppSettings
import androidx.compose.material3.Surface

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeScreen(vm: MainViewModel, toast: (String) -> Unit) {
    val context = LocalContext.current
    val focus = LocalFocusManager.current
    val engine by vm.engine.collectAsState()
    val cs = MaterialTheme.colorScheme
    val detected = PlatformCatalog.detect(MainViewModel.extractUrl(vm.url))

    LazyColumn(
        Modifier.statusBarsPadding(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { BrandHeader(Modifier.padding(bottom = 4.dp)) }
        item {
            XyCard {
                Text("Download video, audio & foto", style = MaterialTheme.typography.titleMedium, color = cs.onSurface)
                Text(
                    "TikTok, Douyin, Instagram, YouTube, Bilibili, Kuaishou, X, Threads, pixiv & 1.700+ situs — termasuk foto slide & Live Photo.",
                    style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp, bottom = 12.dp),
                )
                OutlinedTextField(
                    value = vm.url,
                    onValueChange = { vm.url = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Tempel link di sini…") },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { focus.clearFocus(); vm.fetch() }),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = cs.primary, unfocusedBorderColor = cs.outline,
                    ),
                    leadingIcon = if (detected != null) {
                        { PlatformLogo(detected, 22.dp) }
                    } else null,
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
                if (detected != null) {
                    Text(
                        "Terdeteksi: ${detected.name}", style = MaterialTheme.typography.bodySmall,
                        color = cs.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp),
                    )
                }
                Spacer(Modifier.height(12.dp))
                PrimaryButton(
                    text = if (vm.state is HomeState.Loading) "Membaca link…" else "Proses link",
                    icon = R.drawable.ic_download,
                    enabled = vm.state !is HomeState.Loading,
                    modifier = Modifier.fillMaxWidth(),
                ) { focus.clearFocus(); vm.fetch() }
                when (val e = engine) {
                    is XyApp.EngineState.Loading -> EngineHint(R.drawable.ic_cpu, "Menyiapkan engine (pertama kali bisa ±10 detik)…")
                    is XyApp.EngineState.Failed -> EngineHint(R.drawable.ic_alert, "Engine gagal dimuat: ${e.message}")
                    else -> Unit
                }
            }
        }

        when (val s = vm.state) {
            is HomeState.Idle -> {
                item { HowToCard() }
                item { SectionTitle("Platform yang didukung", R.drawable.ic_globe) }
                PlatformCatalog.regions.forEach { region ->
                    val list = PlatformCatalog.byRegion(region.id)
                    if (list.isNotEmpty()) {
                        item(key = "region-${region.id}") {
                            XyCard(padding = 14.dp) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    if (region.id == "global") {
                                        Icon(painterResource(R.drawable.ic_globe), null, Modifier.size(18.dp), tint = cs.onSurfaceVariant)
                                    } else {
                                        Text(region.flag, fontSize = 17.sp) // bendera
                                    }
                                    Spacer(Modifier.width(8.dp))
                                    Text(region.name, style = MaterialTheme.typography.titleSmall, color = cs.onSurface)
                                    Spacer(Modifier.width(6.dp))
                                    Text("${list.size}", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                                }
                                Spacer(Modifier.height(10.dp))
                                FlowRow(
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    verticalArrangement = Arrangement.spacedBy(6.dp),
                                ) { list.forEach { PlatformChip(it) } }
                            }
                        }
                    }
                }
            }
            is HomeState.Loading -> item { LoadingCard { vm.cancelFetch() } }
            is HomeState.Error -> item { ErrorCard(s.message) { vm.fetch() } }
            is HomeState.Loaded -> {
                val info = s.info
                item { InfoCard(info, onPreview = if (info.preview != null) ({ vm.showPreview = true }) else null) }
                when {
                    info.isUgoira -> {
                        item { SectionTitle("Animasi (ugoira)", R.drawable.ic_video) }
                        item {
                            OptionRow(R.drawable.ic_video, "MP4", "Frame ugoira dijadikan video H.264") {
                                vm.download(info, "ugoira", label = "Ugoira · MP4")
                                toast("Download dimulai — cek tab Unduhan")
                            }
                        }
                    }
                    info.gallery.isNotEmpty() -> {
                        item { XyCard(padding = 14.dp) { GalleryHeader(vm, info) } }
                        val rows = info.gallery.chunked(3)
                        items(rows.size, key = { "g-$it" }) { r ->
                            GalleryRow(vm, rows[r]) { picked -> vm.viewerIndex = info.gallery.indexOf(picked) }
                        }
                        item {
                            val n = vm.fileCount(info)
                            PrimaryButton(
                                text = when {
                                    vm.selected.isEmpty() -> "Pilih item dulu"
                                    n > 1 -> "Unduh $n file"
                                    else -> "Unduh"
                                },
                                icon = R.drawable.ic_download,
                                enabled = vm.selected.isNotEmpty(),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                val c = vm.downloadGallery(info)
                                toast(if (c > 1) "$c file ditambahkan ke Unduhan" else "Download dimulai — cek tab Unduhan")
                            }
                        }
                        info.music?.let { m ->
                            item { SectionTitle("Musik latar", R.drawable.ic_music) }
                            item {
                                OptionRow(R.drawable.ic_music, "MP3 · 192 kbps", "Dikonversi dengan FFmpeg di HP") {
                                    vm.downloadMusic(info, mp3 = true)
                                    toast("Download musik (MP3) dimulai — cek tab Unduhan")
                                }
                            }
                            item {
                                OptionRow(R.drawable.ic_music, "${(m.source.ext ?: "m4a").uppercase()} · kualitas asli", "Tanpa konversi") {
                                    vm.downloadMusic(info, mp3 = false)
                                    toast("Download musik dimulai — cek tab Unduhan")
                                }
                            }
                        }
                    }
                    info.entries.isNotEmpty() -> {
                        item { SectionTitle("${info.entries.size} item di postingan / playlist ini", R.drawable.ic_video) }
                        items(info.entries, key = { "e-${it.index}" }) { entry ->
                            EntryRow(entry.index, entry.title,
                                onVideo = {
                                    vm.download(info, "video", 0, item = entry.index, label = "Video terbaik")
                                    toast("Ditambahkan ke Unduhan: #${entry.index}")
                                },
                                onMp3 = {
                                    vm.download(info, "mp3", kbps = 192, item = entry.index, label = "MP3 192 kbps")
                                    toast("Ditambahkan ke Unduhan: #${entry.index} (MP3)")
                                })
                        }
                    }
                    else -> {
                        item { SectionTitle("Video", R.drawable.ic_video) }
                        val recH = AppSettings.pickVideoHeight(context, info.videoOptions)
                        items(info.videoOptions, key = { "v-${it.height}" }) { o ->
                            val rec = o.height == recH && recH > 0
                            OptionRow(
                                R.drawable.ic_video,
                                buildString {
                                    append(if (o.height > 0) o.label else "Kualitas terbaik")
                                    if (rec) append(" · disarankan")
                                },
                                listOfNotNull("MP4", o.codec, o.sizeBytes?.let { "±" + formatBytes(it) }).joinToString(" · "),
                            ) {
                                vm.download(info, "video", o.height, label = if (o.height > 0) "${o.label} · MP4" else "Video terbaik")
                                toast("Download ${o.label} dimulai — cek tab Unduhan")
                            }
                        }
                        if (info.hasAudio) {
                            item { SectionTitle("Audio", R.drawable.ic_music) }
                            val wantKbps = AppSettings.defaultAudioKbps(context)
                            val audio = listOf(
                                Triple("mp3", 320, "MP3 · 320 kbps"), Triple("mp3", 192, "MP3 · 192 kbps"),
                                Triple("mp3", 128, "MP3 · 128 kbps"), Triple("m4a", 0, "M4A · kualitas asli"),
                            )
                            items(audio, key = { "a-${it.third}" }) { (kind, kbps, label) ->
                                val rec = (kind == "mp3" && kbps == wantKbps) || (kind == "m4a" && wantKbps == 0)
                                OptionRow(
                                    R.drawable.ic_music,
                                    if (rec) "$label · disarankan" else label,
                                    if (kind == "mp3") "Dikonversi dengan FFmpeg di HP" else "Tanpa konversi",
                                ) {
                                    vm.download(info, kind, kbps = if (kbps > 0) kbps else 192, label = label)
                                    toast("Download $label dimulai — cek tab Unduhan")
                                }
                            }
                        }
                    }
                }
            }
        }
        item { Spacer(Modifier.height(8.dp)) }
    }

    // ---- pratinjau video & viewer galeri
    val loaded = (vm.state as? HomeState.Loaded)?.info
    val preview = loaded?.preview
    if (loaded != null && preview != null && vm.showPreview) {
        PreviewDialog(preview, loaded.title) { vm.showPreview = false }
    }
    val viewer = vm.viewerIndex
    if (loaded != null && viewer != null && loaded.gallery.isNotEmpty()) {
        GalleryViewer(
            items = loaded.gallery,
            start = viewer,
            selected = vm.selected,
            onToggle = { vm.toggle(it) },
            onDownload = { item, photoOnly ->
                val c = vm.downloadGallery(loaded, only = item, onlyPhoto = photoOnly)
                toast(if (c > 0) "Download dimulai — cek tab Unduhan" else "Tidak ada file untuk item ini")
            },
            onDismiss = { vm.viewerIndex = null },
        )
    }
}

private fun readClipboard(context: Context): String? {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return null
    val clip = cm.primaryClip ?: return null
    if (clip.itemCount == 0) return null
    return clip.getItemAt(0).coerceToText(context)?.toString()
}

@Composable
private fun EngineHint(icon: Int, text: String) {
    Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(painterResource(icon), null, Modifier.size(15.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(6.dp))
        Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun HowToCard() {
    val cs = MaterialTheme.colorScheme
    XyCard {
        Text("Cara cepat", style = MaterialTheme.typography.titleSmall, color = cs.onSurface)
        Spacer(Modifier.height(8.dp))
        val steps = listOf(
            R.drawable.ic_share to "Di TikTok, Instagram, YouTube, Douyin, dll: tekan Bagikan lalu pilih DownloadAja.",
            R.drawable.ic_paste to "Atau salin link, lalu tekan ikon tempel di kolom atas.",
            R.drawable.ic_folder to "Pilih kualitas, atau pilih foto satu per satu. File tersimpan di Download/DownloadAja.",
        )
        steps.forEach { (icon, text) ->
            Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.Top) {
                Icon(painterResource(icon), null, Modifier.size(16.dp).padding(top = 2.dp), tint = cs.primary)
                Spacer(Modifier.width(10.dp))
                Text(text, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun LoadingCard(onCancel: () -> Unit) {
    XyCard {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.5.dp)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text("Membaca link…", style = MaterialTheme.typography.titleSmall)
                Text("Mencari semua kualitas yang tersedia", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            TextButton(onClick = onCancel) { Text("Batal") }
        }
    }
}

@Composable
fun ErrorCard(message: String, onRetry: (() -> Unit)? = null) {
    val cs = MaterialTheme.colorScheme
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
            .background(cs.error.copy(alpha = 0.08f))
            .border(1.dp, cs.error.copy(alpha = 0.35f), RoundedCornerShape(16.dp))
            .padding(16.dp),
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(painterResource(R.drawable.ic_alert), null, Modifier.size(18.dp), tint = cs.error)
                Spacer(Modifier.width(8.dp))
                Text("Gagal memproses", style = MaterialTheme.typography.titleSmall, color = cs.error)
            }
            Text(message, style = MaterialTheme.typography.bodyMedium, color = cs.onSurface, modifier = Modifier.padding(top = 6.dp))
            if (onRetry != null) TextButton(onClick = onRetry, modifier = Modifier.padding(top = 2.dp)) { Text("Coba lagi") }
        }
    }
}

@Composable
private fun InfoCard(info: MediaInfo, onPreview: (() -> Unit)?) {
    val context = LocalContext.current
    val cs = MaterialTheme.colorScheme
    val platform = PlatformCatalog.detect(info.sourceUrl)
    XyCard(padding = 12.dp) {
        Row {
            Box(
                Modifier.width(120.dp).aspectRatio(16f / 10f).clip(RoundedCornerShape(10.dp))
                    .background(cs.surfaceContainer),
            ) {
                if (info.thumbnail != null) {
                    AsyncImage(
                        model = thumbModel(context, info.thumbnail), contentDescription = null,
                        contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize(),
                    )
                }
                val badge = when {
                    info.gallery.isNotEmpty() -> "${info.gallery.size} item"
                    info.duration != null && !info.isUgoira -> formatDuration(info.duration)
                    else -> null
                }
                if (badge != null) {
                    Text(
                        badge, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.align(Alignment.BottomEnd).padding(4.dp)
                            .background(Color(0xC7000000), RoundedCornerShape(5.dp)).padding(horizontal = 5.dp, vertical = 1.dp),
                    )
                }
                if (onPreview != null) {
                    Surface(
                        onClick = onPreview,
                        shape = androidx.compose.foundation.shape.CircleShape,
                        color = Color(0xA6000000),
                        modifier = Modifier.align(Alignment.Center).size(40.dp),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(painterResource(R.drawable.ic_play), "Putar pratinjau", Modifier.size(18.dp).padding(start = 2.dp), tint = Color.White)
                        }
                    }
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    PlatformLogo(platform, 18.dp)
                    Spacer(Modifier.width(6.dp))
                    Text(
                        platform?.name ?: info.platform, style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.SemiBold, color = cs.onSurfaceVariant, maxLines = 1,
                    )
                }
                Text(
                    info.title, style = MaterialTheme.typography.titleSmall, color = cs.onSurface,
                    maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp),
                )
                info.uploader?.let {
                    Text("oleh $it", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (onPreview != null) {
                    Text("Pratinjau siap — ketuk play bila di-pause", style = MaterialTheme.typography.bodySmall, color = cs.primary,
                        modifier = Modifier.padding(top = 2.dp))
                }
            }
        }
    }
}

@Composable
private fun EntryRow(index: Int, title: String, onVideo: () -> Unit, onMp3: () -> Unit) {
    XyCard(padding = 12.dp) {
        Text("#$index  $title", style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SmallAction("Video", R.drawable.ic_video, onVideo)
            SmallAction("MP3", R.drawable.ic_music, onMp3)
        }
    }
}
