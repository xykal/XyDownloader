package id.my.xyverse.xydownloader.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.my.xyverse.xydownloader.DlRecord
import id.my.xyverse.xydownloader.MainViewModel
import id.my.xyverse.xydownloader.Popup
import id.my.xyverse.xydownloader.Screen
import id.my.xyverse.xydownloader.R
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun XyRoot(vm: MainViewModel) {
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val records by vm.records.collectAsState()
    val running = records.count { it.status == DlRecord.STATUS_RUNNING || it.status == DlRecord.STATUS_QUEUED }
    var showSplash by rememberSaveable { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        delay(1200)
        showSplash = false
    }
    // popup "yang baru" / pembaruan baru ditampilkan setelah splash selesai
    LaunchedEffect(showSplash) { if (!showSplash) vm.onStartup() }
    val cs = MaterialTheme.colorScheme

    Box(Modifier.fillMaxSize().background(cs.background)) {
        Scaffold(
            containerColor = cs.background,
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                Column {
                    HorizontalDivider(color = cs.outlineVariant)
                    NavigationBar(containerColor = cs.background, tonalElevation = 0.dp) {
                        val colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = cs.primary,
                            selectedTextColor = cs.onSurface,
                            indicatorColor = cs.primaryContainer,
                            unselectedIconColor = cs.onSurfaceVariant,
                            unselectedTextColor = cs.onSurfaceVariant,
                        )
                        NavigationBarItem(
                            selected = vm.tab == 0, onClick = { vm.tab = 0 }, colors = colors,
                            icon = { Icon(Icons.Outlined.Home, null) }, label = { Text("Beranda") },
                        )
                        NavigationBarItem(
                            selected = vm.tab == 1, onClick = { vm.tab = 1 }, colors = colors,
                            icon = { Icon(painterResource(R.drawable.ic_download), null) },
                            label = { Text(if (running > 0) "Unduhan ($running)" else "Unduhan") },
                        )
                        NavigationBarItem(
                            selected = vm.tab == 2, onClick = { vm.tab = 2 }, colors = colors,
                            icon = { Icon(Icons.Outlined.Info, null) }, label = { Text("Tentang") },
                        )
                    }
                }
            },
        ) { padding ->
            Box(Modifier.padding(padding)) {
                when (vm.tab) {
                    0 -> HomeScreen(vm) { msg -> scope.launch { snackbar.showSnackbar(msg) } }
                    1 -> DownloadsScreen(vm)
                    else -> AboutScreen(vm)
                }
            }
        }
        // layar penuh di atas tab: Pembaruan & Lisensi
        when (vm.screen) {
            Screen.Update -> UpdateScreen(vm) { vm.screen = Screen.Main }
            Screen.Licenses -> LicensesScreen { vm.screen = Screen.Main }
            Screen.Main -> Unit
        }
        AnimatedVisibility(visible = showSplash, enter = fadeIn(), exit = fadeOut()) {
            SplashCredit()
        }
        if (!showSplash) {
            when (val p = vm.popup) {
                is Popup.WhatsNew -> BannerPopup(p.bannerUrl, onClose = { vm.closePopup() }, onOpen = { vm.openPopup() })
                is Popup.Update -> BannerPopup(p.release.bannerUrl, onClose = { vm.closePopup() }, onOpen = { vm.openPopup() })
                null -> Unit
            }
        }
    }
}

/** Layar pembuka dengan kredit XyVerse. */
@Composable
fun SplashCredit() {
    val cs = MaterialTheme.colorScheme
    Box(Modifier.fillMaxSize().background(cs.background), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Image(painterResource(R.drawable.ic_splash), null, Modifier.size(112.dp))
            Spacer(Modifier.height(4.dp))
            Text("DownloadAja", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = cs.onBackground)
            Text("Semua platform, satu aplikasi", color = cs.onSurfaceVariant, fontSize = 14.sp)
        }
        Row(
            Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 36.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            XyVerseLogo(22.dp)
            Spacer(Modifier.width(8.dp))
            Text("built in ", color = cs.onSurfaceVariant, fontSize = 13.sp)
            Text("XyVerse", color = cs.onBackground, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun BrandHeader(modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Image(painterResource(R.drawable.ic_splash), null, Modifier.size(40.dp))
        Spacer(Modifier.width(8.dp))
        Column {
            Text("DownloadAja", style = MaterialTheme.typography.titleLarge, color = cs.onBackground)
            Text("by XyVerse", color = cs.onSurfaceVariant, fontSize = 12.sp)
        }
    }
}
