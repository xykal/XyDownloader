package id.my.xyverse.xydownloader.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import id.my.xyverse.xydownloader.BuildConfig
import id.my.xyverse.xydownloader.Http
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/**
 * Pembaruan aplikasi dari GitHub Releases (xykal/XyDownloader).
 * - cek rilis terbaru (API publik GitHub, tanpa token)
 * - unduh APK sesuai arsitektur HP
 * - pasang lewat PackageInstaller. Android 12+: tanpa dialog konfirmasi (USER_ACTION_NOT_REQUIRED)
 *   selama izin "Instal aplikasi tidak dikenal" sudah diberikan & aplikasi memperbarui dirinya sendiri.
 */
object AppUpdater {
    private const val TAG = "XyUpdater"
    const val REPO = "xykal/XyDownloader"
    private const val API = "https://api.github.com/repos/$REPO/releases/latest"
    private const val PREFS = "xy_update"
    const val BANNER_ASSET = "update-banner.webp"

    data class Asset(val name: String, val url: String, val size: Long)

    data class Release(
        val tag: String,
        val version: String,
        val title: String,
        val notes: String,
        val htmlUrl: String,
        val publishedAt: String?,
        val apk: Asset?,
        val bannerUrl: String?,
    )

    sealed interface State {
        data object Idle : State
        data object Checking : State
        data class UpToDate(val latest: Release?) : State
        data class Available(val release: Release) : State
        data class NeedsPermission(val release: Release) : State
        data class Downloading(val release: Release, val bytes: Long, val total: Long) : State
        data class Installing(val release: Release) : State
        data class Failed(val message: String, val release: Release?) : State
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state

    val currentVersion: String get() = BuildConfig.VERSION_NAME

    /** URL banner "yang baru" untuk versi yang sedang terpasang (aset rilis GitHub). */
    fun currentBannerUrl(): String? =
        if (currentVersion.contains('-')) null
        else "https://github.com/$REPO/releases/download/v$currentVersion/$BANNER_ASSET"

    /** Bandingkan versi "1.2.0" / "1.2.0-dev.5". Versi -dev dianggap lebih lama dari rilisnya. */
    fun compare(a: String, b: String): Int {
        fun parts(v: String) = v.removePrefix("v").substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
        val pa = parts(a)
        val pb = parts(b)
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val x = pa.getOrElse(i) { 0 }
            val y = pb.getOrElse(i) { 0 }
            if (x != y) return x.compareTo(y)
        }
        val da = a.contains('-')
        val db = b.contains('-')
        return when {
            da == db -> 0
            da -> -1
            else -> 1
        }
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun lastCheck(ctx: Context) = prefs(ctx).getLong("last_check", 0L)
    fun dismissed(ctx: Context) = prefs(ctx).getString("dismissed", null)
    fun dismiss(ctx: Context, version: String) = prefs(ctx).edit().putString("dismissed", version).apply()

    /**
     * Popup "yang baru" setelah aplikasi diperbarui (sekali per versionCode).
     * Install baru (bukan update) tidak menampilkan popup.
     */
    fun shouldShowWhatsNew(ctx: Context): Boolean {
        val p = prefs(ctx)
        val code = BuildConfig.VERSION_CODE
        val seen = p.getInt("seen_code", -1)
        p.edit().putInt("seen_code", code).apply()
        if (seen == -1) {
            return try {
                val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
                pi.firstInstallTime != pi.lastUpdateTime
            } catch (_: Exception) {
                false
            }
        }
        return code > seen
    }

    suspend fun check(ctx: Context): Release? = withContext(Dispatchers.IO) {
        _state.value = State.Checking
        try {
            val rel = parse(JSONObject(Http.getText(API, mapOf("Accept" to "application/vnd.github+json"), 15_000)))
            prefs(ctx).edit().putLong("last_check", System.currentTimeMillis()).apply()
            _state.value = if (rel != null && compare(rel.version, currentVersion) > 0) State.Available(rel)
            else State.UpToDate(rel)
            rel
        } catch (e: Exception) {
            Log.w(TAG, "cek update gagal", e)
            _state.value = State.Failed("Gagal cek pembaruan: ${e.message?.take(100) ?: "koneksi bermasalah"}", null)
            null
        }
    }

    private fun parse(o: JSONObject): Release? {
        val tag = o.optString("tag_name").ifBlank { return null }
        val assets = o.optJSONArray("assets")
        val list = ArrayList<Asset>()
        for (i in 0 until (assets?.length() ?: 0)) {
            val a = assets!!.optJSONObject(i) ?: continue
            list.add(Asset(a.optString("name"), a.optString("browser_download_url"), a.optLong("size")))
        }
        val apks = list.filter { it.name.endsWith(".apk", true) }
        val apk = Build.SUPPORTED_ABIS.firstNotNullOfOrNull { abi -> apks.firstOrNull { it.name.endsWith("-$abi.apk") } }
            ?: apks.firstOrNull { it.name.contains("universal", true) }
        return Release(
            tag = tag,
            version = tag.removePrefix("v"),
            title = o.optString("name").ifBlank { "DownloadAja $tag" },
            notes = o.optString("body"),
            htmlUrl = o.optString("html_url").ifBlank { "https://github.com/$REPO/releases/latest" },
            publishedAt = o.optString("published_at").ifBlank { null },
            apk = apk,
            bannerUrl = list.firstOrNull { it.name == BANNER_ASSET }?.url,
        )
    }

    fun canInstall(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ctx.packageManager.canRequestPackageInstalls()

    fun permissionIntent(ctx: Context): Intent =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))
        } else Intent(Settings.ACTION_SECURITY_SETTINGS)

    /** Unduh APK lalu pasang. Dipanggil dari coroutine (IO). */
    suspend fun downloadAndInstall(ctx: Context, release: Release) = withContext(Dispatchers.IO) {
        val apk = release.apk
        if (apk == null) {
            _state.value = State.Failed("APK untuk HP ini tidak ditemukan di rilis ${release.tag}.", release)
            return@withContext
        }
        if (!canInstall(ctx)) {
            _state.value = State.NeedsPermission(release)
            return@withContext
        }
        val dir = File(ctx.cacheDir, "update").apply { mkdirs() }
        dir.listFiles()?.forEach { if (it.name != apk.name) it.delete() }
        val file = File(dir, apk.name)
        try {
            if (!(file.exists() && apk.size > 0 && file.length() == apk.size)) {
                val part = File(dir, apk.name + ".part")
                _state.value = State.Downloading(release, 0, apk.size)
                Http.download(apk.url, emptyMap(), part) { bytes, total ->
                    _state.value = State.Downloading(release, bytes, if (total > 0) total else apk.size)
                }
                if (!part.renameTo(file)) throw IllegalStateException("gagal menyimpan APK")
            }
            verify(ctx, file)
            _state.value = State.Installing(release)
            install(ctx, file)
        } catch (e: Exception) {
            Log.w(TAG, "update gagal", e)
            _state.value = State.Failed("Pembaruan gagal: ${e.message?.take(140) ?: e.toString()}", release)
        }
    }

    private fun verify(ctx: Context, file: File) {
        val info = ctx.packageManager.getPackageArchiveInfo(file.absolutePath, 0)
            ?: throw IllegalStateException("file APK rusak, coba lagi")
        if (info.packageName != ctx.packageName) throw IllegalStateException("APK bukan DownloadAja")
    }

    private fun install(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName)
            setSize(apk.length())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) setInstallReason(PackageManager.INSTALL_REASON_USER)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            apk.inputStream().use { input ->
                session.openWrite("DownloadAja.apk", 0, apk.length()).use { out ->
                    input.copyTo(out, 1 shl 16)
                    session.fsync(out)
                }
            }
            val intent = Intent(ctx, InstallReceiver::class.java).setAction(InstallReceiver.ACTION_STATUS)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
            val pi = PendingIntent.getBroadcast(ctx, sessionId, intent, flags)
            session.commit(pi.intentSender)
        }
    }

    internal fun onInstallFailed(message: String?) {
        val rel = when (val s = _state.value) {
            is State.Installing -> s.release
            is State.Downloading -> s.release
            is State.Available -> s.release
            else -> null
        }
        _state.value = State.Failed("Pemasangan gagal: ${message ?: "dibatalkan"}", rel)
    }

    internal fun onNeedsConfirmation() {
        // dialog konfirmasi sistem muncul; status tetap "Installing"
    }

    fun reset(release: Release?) {
        _state.value = if (release != null) State.Available(release) else State.Idle
    }
}
