package id.my.xyverse.xydownloader.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import id.my.xyverse.xydownloader.AppSettings

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen() {
    val ctx = LocalContext.current
    val cs = MaterialTheme.colorScheme

    var autoplayVideo by remember { mutableStateOf(AppSettings.autoplayVideo(ctx)) }
    var autoplayMusic by remember { mutableStateOf(AppSettings.autoplayMusic(ctx)) }
    var openMusic by remember { mutableStateOf(AppSettings.openMusicPlayer(ctx)) }
    var dataSaver by remember { mutableStateOf(AppSettings.dataSaver(ctx)) }
    var videoTier by remember { mutableStateOf(AppSettings.defaultVideoTier(ctx)) }
    var audioKbps by remember { mutableStateOf(AppSettings.defaultAudioKbps(ctx)) }
    var liveMode by remember { mutableStateOf(AppSettings.livePhotoMode(ctx)) }

    LazyColumn(
        Modifier.statusBarsPadding().fillMaxWidth(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text("Pengaturan", style = MaterialTheme.typography.headlineSmall, color = cs.onSurface)
            Text(
                "Pratinjau, kualitas default, dan hemat data. Disimpan di HP ini.",
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp, bottom = 4.dp),
            )
        }
        item {
            XyCard {
                Text("Pratinjau", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(8.dp))
                SettingSwitch("Autoplay video", "Putar otomatis setelah proses (bisa di-mute dulu)") {
                    Switch(checked = autoplayVideo, onCheckedChange = {
                        autoplayVideo = it; AppSettings.setAutoplayVideo(ctx, it)
                    })
                }
                SettingSwitch("Autoplay musik", "Putar lagu otomatis untuk link audio") {
                    Switch(checked = autoplayMusic, onCheckedChange = {
                        autoplayMusic = it; AppSettings.setAutoplayMusic(ctx, it)
                    })
                }
                SettingSwitch("Buka pemutar musik", "Tampilkan player di hasil audio-only") {
                    Switch(checked = openMusic, onCheckedChange = {
                        openMusic = it; AppSettings.setOpenMusicPlayer(ctx, it)
                    })
                }
                SettingSwitch("Mode hemat data", "Matikan autoplay & kurangi preload") {
                    Switch(checked = dataSaver, onCheckedChange = {
                        dataSaver = it; AppSettings.setDataSaver(ctx, it)
                    })
                }
            }
        }
        item {
            XyCard {
                Text("Download default", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(10.dp))
                DropdownField(
                    label = "Kualitas video",
                    value = videoTier,
                    options = listOf(
                        AppSettings.TIER_HEMAT to "Hemat (~480p)",
                        AppSettings.TIER_NORMAL to "Normal (~720p)",
                        AppSettings.TIER_TINGGI to "Tinggi (~1080p)",
                        AppSettings.TIER_MAX to "Maksimal",
                        AppSettings.TIER_AUTO to "Otomatis",
                    ),
                ) {
                    videoTier = it; AppSettings.setDefaultVideoTier(ctx, it)
                }
                Spacer(Modifier.height(8.dp))
                DropdownField(
                    label = "Kualitas MP3",
                    value = audioKbps.toString(),
                    options = listOf(
                        "128" to "Hemat · 128 kbps",
                        "192" to "Normal · 192 kbps",
                        "320" to "Tinggi · 320 kbps",
                        "0" to "Asli (M4A, tanpa convert)",
                    ),
                ) {
                    audioKbps = it.toIntOrNull() ?: 192
                    AppSettings.setDefaultAudioKbps(ctx, audioKbps)
                }
                Spacer(Modifier.height(8.dp))
                DropdownField(
                    label = "Live Photo",
                    value = liveMode,
                    options = listOf(
                        "photo" to "Foto saja",
                        "video" to "Video saja",
                        "both" to "Foto + Video",
                    ),
                ) {
                    liveMode = it; AppSettings.setLivePhotoMode(ctx, it)
                }
            }
        }
        item {
            Text(
                "Nama file: DownloadAja-judul-id.ext — tersimpan di Download/DownloadAja.",
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
            )
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun SettingSwitch(title: String, hint: String, control: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        control()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DropdownField(
    label: String,
    value: String,
    options: List<Pair<String, String>>,
    onChange: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val text = options.find { it.first == value }?.second ?: value
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = text,
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier = Modifier.menuAnchor().fillMaxWidth(),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (k, labelText) ->
                DropdownMenuItem(
                    text = { Text(labelText) },
                    onClick = { onChange(k); expanded = false },
                )
            }
        }
    }
}
