package id.my.xyverse.xydownloader.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val XyBg = Color(0xFF0B0D17)
val XySurface = Color(0xFF141731)
val XySurface2 = Color(0xFF1B1F3D)
val XyPrimary = Color(0xFF8B5CF6)
val XyIndigo = Color(0xFF6366F1)
val XyCyan = Color(0xFF06B6D4)
val XyMuted = Color(0xFF9AA0C3)
val XyOk = Color(0xFF22C55E)
val XyErr = Color(0xFFEF4444)

val XyGradient = Brush.linearGradient(listOf(XyPrimary, XyIndigo, XyCyan))

private val scheme = darkColorScheme(
    primary = XyPrimary,
    onPrimary = Color.White,
    primaryContainer = Color(0xFF2E2266),
    onPrimaryContainer = Color(0xFFE4DAFF),
    secondary = XyCyan,
    onSecondary = Color.Black,
    secondaryContainer = Color(0xFF123B45),
    onSecondaryContainer = Color(0xFFCFF6FF),
    background = XyBg,
    onBackground = Color(0xFFEEF0FF),
    surface = XyBg,
    onSurface = Color(0xFFEEF0FF),
    surfaceVariant = XySurface,
    onSurfaceVariant = XyMuted,
    surfaceContainer = XySurface,
    surfaceContainerHigh = XySurface2,
    surfaceContainerLow = Color(0xFF10132A),
    outline = Color(0x33FFFFFF),
    outlineVariant = Color(0x1FFFFFFF),
    error = XyErr,
)

private val typography = Typography(
    headlineSmall = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Bold),
    titleLarge = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.Bold),
    titleMedium = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
)

@Composable
fun XyTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = typography, content = content)
}
