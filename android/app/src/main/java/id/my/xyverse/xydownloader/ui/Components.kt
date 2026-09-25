package id.my.xyverse.xydownloader.ui

import android.content.Context
import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.request.ImageRequest
import id.my.xyverse.xydownloader.Platform
import id.my.xyverse.xydownloader.R

/** Kartu datar dengan border tipis (tanpa bayangan/gradasi). */
@Composable
fun XyCard(modifier: Modifier = Modifier, padding: Dp = 16.dp, content: @Composable ColumnScope.() -> Unit) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(Modifier.padding(padding), content = content)
    }
}

@Composable
fun PrimaryButton(
    text: String,
    modifier: Modifier = Modifier,
    @DrawableRes icon: Int? = null,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(48.dp),
        shape = RoundedCornerShape(12.dp),
        contentPadding = PaddingValues(horizontal = 18.dp),
    ) {
        if (icon != null) {
            Icon(painterResource(icon), null, Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun SmallAction(text: String, @DrawableRes icon: Int, onClick: () -> Unit) {
    FilledTonalButton(
        onClick = onClick,
        shape = RoundedCornerShape(10.dp),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
        modifier = Modifier.height(34.dp),
        colors = ButtonDefaults.filledTonalButtonColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainer,
            contentColor = MaterialTheme.colorScheme.onSurface,
        ),
    ) {
        Icon(painterResource(icon), null, Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text(text, fontSize = 13.sp)
    }
}

@Composable
fun SectionTitle(text: String, @DrawableRes icon: Int? = null, modifier: Modifier = Modifier) {
    Row(modifier.padding(top = 6.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) {
            Icon(painterResource(icon), null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(8.dp))
        }
        Text(text, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
    }
}

/** Baris opsi download: ikon, judul, keterangan, tombol Unduh. */
@Composable
fun OptionRow(@DrawableRes icon: Int, title: String, subtitle: String, action: String = "Unduh", onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(36.dp).clip(RoundedCornerShape(10.dp))
                    .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(painterResource(icon), null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                if (subtitle.isNotBlank()) {
                    Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.primary) {
                Row(Modifier.padding(horizontal = 12.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(painterResource(R.drawable.ic_download), null, Modifier.size(15.dp), tint = MaterialTheme.colorScheme.onPrimary)
                    Spacer(Modifier.width(6.dp))
                    Text(action, color = MaterialTheme.colorScheme.onPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

/** Logo asli platform (ikon aplikasi resmi), sudut membulat ala ikon app. */
@Composable
fun PlatformLogo(platform: Platform?, size: Dp = 20.dp) {
    val shape = RoundedCornerShape(size * 0.24f)
    if (platform != null) {
        Image(
            painterResource(platform.logo), platform.name,
            Modifier.size(size).clip(shape).border(0.5.dp, MaterialTheme.colorScheme.outlineVariant, shape),
        )
    } else {
        Icon(painterResource(R.drawable.ic_globe), null, Modifier.size(size), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun PlatformChip(platform: Platform) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.surface,
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(Modifier.padding(start = 5.dp, end = 10.dp, top = 5.dp, bottom = 5.dp), verticalAlignment = Alignment.CenterVertically) {
            PlatformLogo(platform, 20.dp)
            Spacer(Modifier.width(7.dp))
            Text(platform.name, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun InfoLine(@DrawableRes icon: Int, title: String, body: String, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    val click = if (onClick != null) Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick = onClick) else Modifier
    Row(modifier.fillMaxWidth().then(click).padding(vertical = 6.dp), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.Start) {
        Icon(painterResource(icon), null, Modifier.size(18.dp).padding(top = 1.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
            val color = if (onClick != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
            Text(body, style = MaterialTheme.typography.bodyMedium, color = color, modifier = Modifier.padding(top = 2.dp))
        }
        if (onClick != null) {
            Icon(painterResource(R.drawable.ic_chevron_right), null, Modifier.size(18.dp).align(Alignment.CenterVertically),
                tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Beberapa CDN gambar menolak tanpa Referer (pixiv, Weibo, ...). */
private val REFERERS = listOf(
    "pximg.net" to "https://www.pixiv.net/",
    "sinaimg.cn" to "https://weibo.com/",
    "xhscdn.com" to "https://www.xiaohongshu.com/",
    "douyinpic.com" to "https://www.douyin.com/",
    "yximgs.com" to "https://www.kuaishou.com/",
)

fun thumbModel(context: Context, url: String?, headers: Map<String, String> = emptyMap()): Any? {
    if (url == null) return null
    val b = ImageRequest.Builder(context).data(url).crossfade(true)
    headers.forEach { (k, v) ->
        if (!k.equals("Accept-Encoding", true) && !k.equals("Accept", true)) b.addHeader(k, v)
    }
    if (headers.keys.none { it.equals("Referer", true) }) {
        REFERERS.firstOrNull { url.contains(it.first) }?.let { b.addHeader("Referer", it.second) }
    }
    return b.build()
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
