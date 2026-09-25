package id.my.xyverse.xydownloader.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.my.xyverse.xydownloader.LicenseItem
import id.my.xyverse.xydownloader.Licenses
import id.my.xyverse.xydownloader.R

/** Daftar komponen open source + teks lisensi lengkap. */
@Composable
fun LicensesScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val cs = MaterialTheme.colorScheme
    val catalog = remember { Licenses.load(context) }
    var open by remember { mutableStateOf<LicenseItem?>(null) }
    val current = open
    if (current != null) {
        LicenseText(current) { open = null }
        return
    }
    BackHandler(onBack = onBack)
    Column(Modifier.fillMaxSize().background(cs.background).statusBarsPadding()) {
        TopBar("Lisensi open source", onBack)
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                Text(
                    "XyDownloader dirilis dengan lisensi GPL-3.0 dan dibangun di atas software open source berikut. " +
                        "Ketuk untuk membaca teks lisensinya.",
                    style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant, modifier = Modifier.padding(bottom = 4.dp),
                )
            }
            items(catalog.items, key = { it.name }) { item ->
                Surface(
                    onClick = { open = item },
                    shape = RoundedCornerShape(14.dp),
                    color = cs.surface,
                    border = androidx.compose.foundation.BorderStroke(1.dp, cs.outlineVariant),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(item.name, style = MaterialTheme.typography.titleSmall, color = cs.onSurface)
                            if (item.note.isNotBlank()) {
                                Text(item.note, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                            }
                        }
                        Spacer(Modifier.width(10.dp))
                        Text(
                            item.license, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = cs.primary,
                            modifier = Modifier.background(cs.primaryContainer, RoundedCornerShape(6.dp))
                                .padding(horizontal = 7.dp, vertical = 3.dp),
                        )
                    }
                }
            }
            if (catalog.trademarks.isNotBlank()) {
                item {
                    Text(catalog.trademarks, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant,
                        modifier = Modifier.padding(top = 8.dp))
                }
            }
            item { BuiltIn() }
        }
    }
}

@Composable
private fun LicenseText(item: LicenseItem, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val context = LocalContext.current
    val cs = MaterialTheme.colorScheme
    val text = remember(item.file) { Licenses.text(context, item.file) }
    Column(Modifier.fillMaxSize().background(cs.background).statusBarsPadding()) {
        TopBar(item.name, onBack)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            Text(item.license, style = MaterialTheme.typography.titleSmall, color = cs.primary)
            Text(item.copyright, style = MaterialTheme.typography.bodySmall, color = cs.onSurface, modifier = Modifier.padding(top = 4.dp))
            Text(
                item.url, style = MaterialTheme.typography.bodySmall, color = cs.primary,
                modifier = Modifier.padding(top = 4.dp, bottom = 12.dp),
            )
            Surface(
                shape = RoundedCornerShape(12.dp), color = cs.surfaceContainer,
                onClick = {
                    try {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(item.url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    } catch (_: Exception) {
                    }
                },
            ) {
                Text("Buka situs proyek", modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    style = MaterialTheme.typography.labelLarge, color = cs.onSurface)
            }
            Spacer(Modifier.height(12.dp))
            Text(text, fontFamily = FontFamily.Monospace, fontSize = 11.sp, lineHeight = 15.sp, color = cs.onSurfaceVariant)
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun TopBar(title: String, onBack: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(painterResource(R.drawable.ic_arrow_back), "Kembali", tint = cs.onBackground) }
        Text(title, style = MaterialTheme.typography.titleMedium, color = cs.onBackground, maxLines = 1)
    }
}

@Composable
private fun BuiltIn() {
    val cs = MaterialTheme.colorScheme
    Row(Modifier.fillMaxWidth().padding(vertical = 14.dp), horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically) {
        XyVerseLogo(18.dp)
        Spacer(Modifier.width(6.dp))
        Text("Built in ", color = cs.onSurfaceVariant, fontSize = 12.sp)
        Text("XyVerse", color = cs.onBackground, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}
