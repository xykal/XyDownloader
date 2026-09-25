package id.my.xyverse.xydownloader.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import id.my.xyverse.xydownloader.BuildConfig
import id.my.xyverse.xydownloader.Downloads
import id.my.xyverse.xydownloader.MainActivity
import id.my.xyverse.xydownloader.R

/** Status sesi PackageInstaller + notifikasi setelah aplikasi berhasil diperbarui. */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_STATUS -> onStatus(context, intent)
            Intent.ACTION_MY_PACKAGE_REPLACED -> notifyUpdated(context)
        }
    }

    private fun onStatus(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm: Intent? = if (Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_INTENT)
                }
                if (confirm == null) {
                    AppUpdater.onInstallFailed("konfirmasi sistem tidak tersedia")
                    return
                }
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                AppUpdater.onNeedsConfirmation()
                try {
                    context.startActivity(confirm)
                } catch (e: Exception) {
                    Log.w(TAG, "tidak bisa membuka konfirmasi, kirim notifikasi", e)
                    val pi = PendingIntent.getActivity(
                        context, 7, confirm, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                    )
                    post(context, "Pembaruan siap dipasang", "Ketuk untuk memasang versi terbaru DownloadAja", pi)
                }
            }
            PackageInstaller.STATUS_SUCCESS -> Unit // proses aplikasi akan diganti oleh sistem
            else -> AppUpdater.onInstallFailed(intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
        }
    }

    private fun notifyUpdated(context: Context) {
        val open = PendingIntent.getActivity(
            context, 8, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        post(context, "DownloadAja diperbarui", "Versi ${BuildConfig.VERSION_NAME} siap dipakai. Ketuk untuk membuka.", open)
    }

    private fun post(context: Context, title: String, text: String, pi: PendingIntent) {
        Downloads.createChannels(context)
        val n = NotificationCompat.Builder(context, Downloads.CH_DONE)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(4242, n)
        } catch (_: SecurityException) {
        }
    }

    companion object {
        private const val TAG = "XyInstall"
        const val ACTION_STATUS = "id.my.xyverse.xydownloader.INSTALL_STATUS"
    }
}
