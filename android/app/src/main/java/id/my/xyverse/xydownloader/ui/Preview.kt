package id.my.xyverse.xydownloader.ui

import android.content.Context
import android.view.ViewGroup
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.MergingMediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import id.my.xyverse.xydownloader.GalleryItem
import id.my.xyverse.xydownloader.Http
import id.my.xyverse.xydownloader.HttpSource
import id.my.xyverse.xydownloader.ItemType
import id.my.xyverse.xydownloader.PreviewSource
import id.my.xyverse.xydownloader.R

/** Sumber yang akan diputar: video (+ audio terpisah) atau HLS. */
data class PlaySpec(val video: HttpSource, val audio: HttpSource? = null, val hls: Boolean = false, val loop: Boolean = false)

@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
private fun dataSource(context: Context, headers: Map<String, String>): DataSource.Factory {
    val ua = headers.entries.firstOrNull { it.key.equals("User-Agent", true) }?.value ?: Http.UA
    val props = headers.filterKeys {
        !it.equals("User-Agent", true) && !it.equals("Accept-Encoding", true) && !it.equals("Range", true)
    }
    val http = DefaultHttpDataSource.Factory()
        .setUserAgent(ua)
        .setDefaultRequestProperties(props)
        .setAllowCrossProtocolRedirects(true)
        .setConnectTimeoutMs(15_000)
        .setReadTimeoutMs(20_000)
    return DefaultDataSource.Factory(context, http)
}

@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
private fun mediaSource(context: Context, spec: PlaySpec): MediaSource {
    val v = if (spec.hls) {
        HlsMediaSource.Factory(dataSource(context, spec.video.headers)).createMediaSource(MediaItem.fromUri(spec.video.url))
    } else {
        ProgressiveMediaSource.Factory(dataSource(context, spec.video.headers)).createMediaSource(MediaItem.fromUri(spec.video.url))
    }
    val a = spec.audio ?: return v
    val audio = ProgressiveMediaSource.Factory(dataSource(context, a.headers)).createMediaSource(MediaItem.fromUri(a.url))
    return MergingMediaSource(v, audio)
}

/** Pemutar ExoPlayer untuk Compose. spec = null -> berhenti. */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
@Composable
fun VideoPlayer(spec: PlaySpec?, modifier: Modifier = Modifier, muted: Boolean = false) {
    val context = LocalContext.current
    var error by remember { mutableStateOf<String?>(null) }
    var buffering by remember { mutableStateOf(true) }
    val player = remember {
        ExoPlayer.Builder(context).build().apply {
            addListener(object : Player.Listener {
                override fun onPlayerError(e: PlaybackException) {
                    error = "Pratinjau gagal dimuat (${e.errorCodeName.removePrefix("ERROR_CODE_").lowercase()}). " +
                        "Download tetap bisa dicoba."
                }

                override fun onPlaybackStateChanged(state: Int) {
                    buffering = state == Player.STATE_BUFFERING || state == Player.STATE_IDLE
                }
            })
        }
    }
    DisposableEffect(Unit) { onDispose { player.release() } }
    LaunchedEffect(spec) {
        error = null
        if (spec == null) {
            player.stop()
            player.clearMediaItems()
            return@LaunchedEffect
        }
        player.setMediaSource(mediaSource(context, spec))
        player.repeatMode = if (spec.loop) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
        player.volume = if (muted) 0f else 1f
        player.prepare()
        player.playWhenReady = true
    }
    Box(modifier.background(Color.Black), contentAlignment = Alignment.Center) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                    useController = true
                    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                    setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
                    setBackgroundColor(android.graphics.Color.BLACK)
                    this.player = player
                }
            },
            update = { it.player = player },
            modifier = Modifier.fillMaxSize(),
        )
        if (buffering && error == null && spec != null) {
            CircularProgressIndicator(Modifier.size(34.dp), color = Color.White, strokeWidth = 3.dp)
        }
        error?.let {
            Text(
                it, color = Color.White, fontSize = 14.sp,
                modifier = Modifier.padding(24.dp).background(Color(0xCC18181B), RoundedCornerShape(12.dp)).padding(16.dp),
            )
        }
    }
}

@Composable
private fun DialogTopBar(title: String, subtitle: String?, onClose: () -> Unit, trailing: @Composable () -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onClose) { Icon(Icons.Filled.Close, "Tutup", tint = Color.White) }
        Column(Modifier.weight(1f).padding(start = 4.dp)) {
            Text(title, color = Color.White, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, color = Color(0xFFA1A1AA), fontSize = 12.sp, maxLines = 1)
        }
        trailing()
    }
}

/** Pratinjau video sebelum download (layar penuh). */
@Composable
fun PreviewDialog(preview: PreviewSource, title: String, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            VideoPlayer(
                PlaySpec(preview.video, preview.audio, preview.hls),
                Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(top = 56.dp),
            )
            DialogTopBar(title, "Pratinjau", onDismiss)
        }
    }
}

/**
 * Viewer galeri: geser kiri/kanan, foto (Coil) atau video/Live Photo (ExoPlayer),
 * tombol pilih & unduh per item.
 */
@Composable
fun GalleryViewer(
    items: List<GalleryItem>,
    start: Int,
    selected: Set<Int>,
    onToggle: (Int) -> Unit,
    onDownload: (GalleryItem, Boolean?) -> Unit,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val pager = rememberPagerState(initialPage = start.coerceIn(0, (items.size - 1).coerceAtLeast(0)), pageCount = { items.size })
    var showPhoto by remember { mutableStateOf(false) }
    LaunchedEffect(pager.currentPage) { showPhoto = false }
    val current = items.getOrNull(pager.currentPage)

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color(0xFF09090B))) {
            HorizontalPager(state = pager, modifier = Modifier.fillMaxSize(), beyondViewportPageCount = 1) { page ->
                val item = items[page]
                val isCurrent = page == pager.currentPage
                val playVideo = isCurrent && item.video != null &&
                    (item.type == ItemType.VIDEO || (item.type == ItemType.LIVE && !showPhoto))
                Box(
                    Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(top = 56.dp, bottom = 76.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    if (playVideo) {
                        VideoPlayer(
                            PlaySpec(item.video!!, loop = item.type == ItemType.LIVE),
                            Modifier.fillMaxSize(),
                            muted = item.type == ItemType.LIVE,
                        )
                    } else {
                        val src = item.image?.url ?: item.thumb
                        AsyncImage(
                            model = thumbModel(context, src, item.headers),
                            contentDescription = item.title,
                            contentScale = ContentScale.Fit,
                            error = painterResource(R.drawable.ic_image),
                            modifier = Modifier.fillMaxSize(),
                        )
                        if (item.type == ItemType.VIDEO && item.video == null) {
                            Text(
                                "Video ini diproses engine saat diunduh (tanpa pratinjau).", color = Color.White, fontSize = 13.sp,
                                modifier = Modifier.align(Alignment.BottomCenter).padding(12.dp)
                                    .background(Color(0xCC18181B), RoundedCornerShape(10.dp)).padding(10.dp),
                            )
                        }
                    }
                }
            }
            val kind = when (current?.type) {
                ItemType.LIVE -> "Live Photo"
                ItemType.VIDEO -> "Video"
                else -> "Foto"
            }
            DialogTopBar(
                "${pager.currentPage + 1} / ${items.size}", kind, onDismiss,
            ) {
                if (current?.type == ItemType.LIVE) {
                    Surface(
                        onClick = { showPhoto = !showPhoto }, shape = RoundedCornerShape(50),
                        color = Color(0x33FFFFFF), modifier = Modifier.padding(end = 8.dp),
                    ) {
                        Text(
                            if (showPhoto) "Putar Live" else "Lihat foto", color = Color.White, fontSize = 13.sp,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                        )
                    }
                }
            }
            if (current != null) {
                val on = current.index in selected
                Row(
                    Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    OutlinedButton(
                        onClick = { onToggle(current.index) },
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.outlinedButtonColors(
                            containerColor = if (on) MaterialTheme.colorScheme.primary.copy(alpha = 0.22f) else Color.Transparent,
                            contentColor = Color.White,
                        ),
                        modifier = Modifier.weight(1f),
                    ) {
                        Box(
                            Modifier.size(18.dp).background(if (on) MaterialTheme.colorScheme.primary else Color.Transparent, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (on) Icon(painterResource(R.drawable.ic_check), null, Modifier.size(12.dp), tint = Color.White)
                            else Icon(painterResource(R.drawable.ic_circle), null, Modifier.size(18.dp), tint = Color.White)
                        }
                        Spacer(Modifier.width(8.dp))
                        Text(if (on) "Terpilih" else "Pilih")
                    }
                    Button(
                        onClick = { onDownload(current, if (current.type == ItemType.LIVE) showPhoto else null) },
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.weight(1f),
                    ) {
                        Icon(painterResource(R.drawable.ic_download), null, Modifier.size(16.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Unduh ini")
                    }
                }
            }
        }
    }
}
