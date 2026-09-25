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
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.my.xyverse.xydownloader.DlRecord
import id.my.xyverse.xydownloader.MainViewModel
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
        delay(1300)
        showSplash = false
    }

    Box(Modifier.fillMaxSize().background(XyBg)) {
        Scaffold(
            containerColor = XyBg,
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                NavigationBar(containerColor = Color(0xFF0F1224), tonalElevation = 0.dp) {
                    val colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Color.White,
                        selectedTextColor = Color.White,
                        indicatorColor = XyPrimary.copy(alpha = 0.35f),
                        unselectedIconColor = XyMuted,
                        unselectedTextColor = XyMuted,
                    )
                    NavigationBarItem(
                        selected = vm.tab == 0, onClick = { vm.tab = 0 }, colors = colors,
                        icon = { Icon(Icons.Filled.Home, null) }, label = { Text("Beranda") },
                    )
                    NavigationBarItem(
                        selected = vm.tab == 1, onClick = { vm.tab = 1 }, colors = colors,
                        icon = { Icon(painterResource(R.drawable.ic_download), null) },
                        label = { Text(if (running > 0) "Unduhan ($running)" else "Unduhan") },
                    )
                    NavigationBarItem(
                        selected = vm.tab == 2, onClick = { vm.tab = 2 }, colors = colors,
                        icon = { Icon(Icons.Filled.Info, null) }, label = { Text("Tentang") },
                    )
                }
            },
        ) { padding ->
            Box(Modifier.padding(padding)) {
                when (vm.tab) {
                    0 -> HomeScreen(vm) { msg ->
                        scope.launch { snackbar.showSnackbar(msg) }
                    }
                    1 -> DownloadsScreen(vm)
                    else -> AboutScreen(vm)
                }
            }
        }
        AnimatedVisibility(visible = showSplash, enter = fadeIn(), exit = fadeOut()) {
            SplashCredit()
        }
    }
}

/** Layar pembuka dengan kredit XyVerse. */
@Composable
fun SplashCredit() {
    Box(Modifier.fillMaxSize().background(XyBg), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Image(painterResource(R.drawable.ic_splash), null, Modifier.size(128.dp))
            Spacer(Modifier.height(8.dp))
            Text("XyDownloader", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Color.White)
            Text("Semua platform, satu aplikasi", color = XyMuted, fontSize = 14.sp)
        }
        Row(
            Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 36.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Image(painterResource(R.drawable.ic_xyverse), null, Modifier.size(26.dp))
            Spacer(Modifier.width(8.dp))
            Text("built in ", color = XyMuted, fontSize = 13.sp)
            Text("XyVerse", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun BrandHeader(modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Image(painterResource(R.drawable.ic_splash), null, Modifier.size(44.dp))
        Spacer(Modifier.width(10.dp))
        Column {
            Text("XyDownloader", style = MaterialTheme.typography.titleLarge, color = Color.White)
            Text("by XyVerse", color = XyMuted, fontSize = 12.sp)
        }
    }
}
