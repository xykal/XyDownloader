package id.my.xyverse.xydownloader.ui

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import id.my.xyverse.xydownloader.GalleryItem
import id.my.xyverse.xydownloader.ItemType
import id.my.xyverse.xydownloader.LiveMode
import id.my.xyverse.xydownloader.MainViewModel
import id.my.xyverse.xydownloader.MediaInfo
import id.my.xyverse.xydownloader.R

/** Ringkasan isi galeri: "9 foto · 3 Live Photo · 1 video". */
fun gallerySummary(items: List<GalleryItem>): String {
    val img = items.count { it.type == ItemType.IMAGE }
    val live = items.count { it.type == ItemType.LIVE }
    val vid = items.count { it.type == ItemType.VIDEO }
    return listOfNotNull(
        img.takeIf { it > 0 }?.let { "$it foto" },
        live.takeIf { it > 0 }?.let { "$it Live Photo" },
        vid.takeIf { it > 0 }?.let { "$it video" },
    ).joinToString(" · ")
}

@Composable
fun GalleryHeader(vm: MainViewModel, info: MediaInfo) {
    val cs = MaterialTheme.colorScheme
    val all = vm.selected.size == info.gallery.size
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(gallerySummary(info.gallery), style = MaterialTheme.typography.titleSmall, color = cs.onSurface)
                Text("Ketuk untuk memilih · ikon perbesar untuk melihat", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
            }
            TextButton(onClick = { vm.selectAll(info, !all) }) { Text(if (all) "Batal pilih" else "Pilih semua") }
        }
        if (info.gallery.any { it.type == ItemType.LIVE }) {
            Spacer(Modifier.height(6.dp))
            Text("Live Photo diunduh sebagai", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
            Spacer(Modifier.height(6.dp))
            Row(
                Modifier.clip(RoundedCornerShape(12.dp)).background(cs.surfaceContainer)
                    .border(1.dp, cs.outlineVariant, RoundedCornerShape(12.dp)).padding(3.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                LiveMode.entries.forEach { mode ->
                    val on = vm.liveMode == mode
                    Surface(
                        onClick = { vm.liveMode = mode },
                        shape = RoundedCornerShape(9.dp),
                        color = if (on) cs.surface else Color.Transparent,
                        border = if (on) androidx.compose.foundation.BorderStroke(1.dp, cs.outlineVariant) else null,
                    ) {
                        Text(
                            mode.label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                            color = if (on) cs.onSurface else cs.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                        )
                    }
                }
            }
        }
    }
}

/** Satu baris grid (3 kolom). Dipanggil per baris dari LazyColumn supaya tetap ringan. */
@Composable
fun GalleryRow(vm: MainViewModel, row: List<GalleryItem>, onOpen: (GalleryItem) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        row.forEach { item ->
            GalleryTile(item, item.index in vm.selected, { vm.toggle(item.index) }, { onOpen(item) }, Modifier.weight(1f))
        }
        repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
    }
}

@Composable
private fun GalleryTile(item: GalleryItem, selected: Boolean, onToggle: () -> Unit, onOpen: () -> Unit, modifier: Modifier) {
    val context = LocalContext.current
    val cs = MaterialTheme.colorScheme
    val shape = RoundedCornerShape(12.dp)
    Box(
        modifier.aspectRatio(3f / 4f).clip(shape).background(cs.surfaceContainer)
            .border(if (selected) 2.dp else 1.dp, if (selected) cs.primary else cs.outlineVariant, shape)
            .clickable(role = Role.Checkbox, onClickLabel = "Pilih item ${item.index}", onClick = onToggle),
    ) {
        AsyncImage(
            model = thumbModel(context, item.thumb, item.headers),
            contentDescription = item.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier.matchParentSize().alpha(if (selected) 1f else 0.55f),
        )
        // centang
        Box(
            Modifier.align(Alignment.TopStart).padding(6.dp).size(22.dp)
                .background(if (selected) cs.primary else Color(0x59000000), CircleShape)
                .border(2.dp, if (selected) cs.primary else Color.White, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (selected) Icon(painterResource(R.drawable.ic_check), null, Modifier.size(13.dp), tint = Color.White)
        }
        // perbesar
        Box(
            Modifier.align(Alignment.TopEnd).padding(4.dp).size(30.dp).clip(RoundedCornerShape(8.dp))
                .background(Color(0x73000000)).clickable(onClickLabel = "Lihat item ${item.index}", onClick = onOpen),
            contentAlignment = Alignment.Center,
        ) {
            Icon(painterResource(R.drawable.ic_expand), "Lihat", Modifier.size(15.dp), tint = Color.White)
        }
        val badge = when (item.type) {
            ItemType.LIVE -> "LIVE"
            ItemType.VIDEO -> item.duration?.let { formatDuration(it) } ?: "Video"
            else -> null
        }
        if (badge != null) {
            Row(
                Modifier.align(Alignment.BottomStart).padding(6.dp)
                    .background(Color(0xB8000000), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (item.type == ItemType.VIDEO) {
                    Icon(painterResource(R.drawable.ic_play), null, Modifier.size(10.dp), tint = Color.White)
                    Spacer(Modifier.width(3.dp))
                }
                Text(badge, color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            }
        }
        Text(
            "${item.index}", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp),
        )
    }
}
