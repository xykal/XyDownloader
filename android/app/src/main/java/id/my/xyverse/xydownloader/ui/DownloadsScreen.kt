package id.my.xyverse.xydownloader.ui

import android.content.ActivityNotFoundException
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import id.my.xyverse.xydownloader.DlRecord
import id.my.xyverse.xydownloader.Downloads
import id.my.xyverse.xydownloader.MainViewModel
import id.my.xyverse.xydownloader.R

@Composable
fun DownloadsScreen(vm: MainViewModel) {
    val context = LocalContext.current
    val records by vm.records.collectAsState()

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Unduhan", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color.White)
                Text("Tersimpan di Download/XyDownloader", color = XyMuted, fontSize = 12.sp)
            }
            if (records.any { it.status == DlRecord.STATUS_DONE || it.status == DlRecord.STATUS_FAILED }) {
                TextButton(onClick = { Downloads.clearFinished(context) }) { Text("Bersihkan") }
            }
        }
        if (records.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("📭", fontSize = 44.sp)
                    Text("Belum ada unduhan", color = Color.White, fontWeight = FontWeight.SemiBold)
                    Text("Proses link di tab Beranda untuk mulai.", color = XyMuted, fontSize = 13.sp)
                }
            }
            return@Column
        }
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(records, key = { it.id }) { rec ->
                RecordCard(
                    rec,
                    onOpen = {
                        val uri = rec.uri?.let { Uri.parse(it) } ?: return@RecordCard
                        try {
                            context.startActivity(Downloads.openIntent(uri, rec.mime))
                        } catch (e: ActivityNotFoundException) {
                            Toast.makeText(context, "Tidak ada aplikasi untuk membuka file ini", Toast.LENGTH_SHORT).show()
                        } catch (e: SecurityException) {
                            Toast.makeText(context, "File tidak bisa dibuka (mungkin sudah dihapus)", Toast.LENGTH_SHORT).show()
                        }
                    },
                    onShare = {
                        val uri = rec.uri?.let { Uri.parse(it) } ?: return@RecordCard
                        try { context.startActivity(Downloads.shareIntent(uri, rec.mime)) } catch (_: Exception) { }
                    },
                    onCancel = { Downloads.cancel(context, rec.id) },
                    onRemove = { Downloads.remove(context, rec.id) },
                )
            }
        }
    }
}

@Composable
private fun RecordCard(rec: DlRecord, onOpen: () -> Unit, onShare: () -> Unit, onCancel: () -> Unit, onRemove: () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(XySurface).padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(56.dp).clip(RoundedCornerShape(10.dp)).background(XySurface2), contentAlignment = Alignment.Center) {
                if (rec.thumbnail != null) {
                    AsyncImage(rec.thumbnail, null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
                } else {
                    androidx.compose.material3.Icon(
                        painterResource(if (rec.kind == "video") R.drawable.ic_video else R.drawable.ic_music),
                        null, tint = Color.White,
                    )
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(rec.title, color = Color.White, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 14.sp)
                Text(rec.label, color = XyCyan, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
        }
        when (rec.status) {
            DlRecord.STATUS_QUEUED, DlRecord.STATUS_RUNNING -> {
                Spacer(Modifier.height(10.dp))
                if (rec.progress > 0f) {
                    LinearProgressIndicator(
                        progress = { rec.progress },
                        modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(6.dp)),
                        color = XyPrimary, trackColor = XySurface2,
                    )
                } else {
                    LinearProgressIndicator(
                        modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(6.dp)),
                        color = XyPrimary, trackColor = XySurface2,
                    )
                }
                Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        rec.line ?: if (rec.status == DlRecord.STATUS_QUEUED) "Mengantri…" else "Memproses…",
                        color = XyMuted, fontSize = 12.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    TextButton(onClick = onCancel) { Text("Batal") }
                }
            }
            DlRecord.STATUS_DONE -> {
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("✅ Selesai", color = XyOk, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    SmallPill("▶ Buka", onOpen)
                    SmallPill("↗ Bagikan", onShare)
                    SmallPill("✕", onRemove)
                }
            }
            else -> {
                Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("❌ ${rec.error ?: "Gagal"}", color = Color(0xFFFCA5A5), fontSize = 12.sp, modifier = Modifier.weight(1f))
                    SmallPill("✕", onRemove)
                }
            }
        }
    }
}
