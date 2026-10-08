package com.techfactchecker.app.domain

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * "Update available" notification, even when the app is closed.
 *
 * The in-app check only runs when the app is opened, so a promoted build sat
 * unnoticed until then. About twice a day this asks GitHub for the
 * verified-production release (the same one the in-app updater installs) and,
 * if it is newer than this build, posts one notification per version. Tapping
 * it opens the app, whose own check then offers the download.
 */
class UpdateCheckReceiver : BroadcastReceiver() {
    companion object {
        private const val ACTION = "com.techfactchecker.CHECK_UPDATE"
        private const val RELEASE_URL =
            "https://api.github.com/repos/Ayushsri242/Instagram-Tech-Fact-Checker/releases/tags/verified-production"
        private const val CHANNEL_ID = "app_updates"
        private const val NOTIFICATION_ID = 2001
        private const val PREFS = "tfc_update_check"

        fun schedule(context: Context) {
            try {
                val alarms = context.getSystemService(AlarmManager::class.java) ?: return
                val intent = Intent(context, UpdateCheckReceiver::class.java).setAction(ACTION)
                val pending = PendingIntent.getBroadcast(
                    context, 0, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                // Inexact: Android batches it with other wake-ups, so it costs
                // no battery of its own. First check about an hour from now.
                alarms.setInexactRepeating(
                    AlarmManager.ELAPSED_REALTIME,
                    SystemClock.elapsedRealtime() + AlarmManager.INTERVAL_HOUR,
                    AlarmManager.INTERVAL_HALF_DAY,
                    pending
                )
            } catch (e: Exception) {
                FlowLog.w("update check: could not schedule: " + e.message)
            }
        }

        // "1.0.88" > "1.0.87", part by part.
        private fun isNewer(current: String, incoming: String): Boolean {
            val a = current.replace(Regex("[^0-9.]"), "").split('.').map { it.toIntOrNull() ?: 0 }
            val b = incoming.replace(Regex("[^0-9.]"), "").split('.').map { it.toIntOrNull() ?: 0 }
            for (i in 0 until maxOf(a.size, b.size)) {
                val x = a.getOrElse(i) { 0 }
                val y = b.getOrElse(i) { 0 }
                if (y != x) return y > x
            }
            return false
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        val result = goAsync()
        Thread {
            try {
                check(context.applicationContext)
            } catch (e: Exception) {
                FlowLog.w("update check: failed: " + e.message)
            } finally {
                result.finish()
            }
        }.start()
    }

    private fun check(context: Context) {
        FlowLog.init(context)
        val connection = (URL(RELEASE_URL).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15000
            readTimeout = 15000
            setRequestProperty("Accept", "application/vnd.github+json")
        }
        val body = try {
            if (connection.responseCode != 200) return
            connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
        val release = JSONObject(body)
        val latest = release.optString("name").ifBlank { release.optString("tag_name") }
        val current = context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: return
        if (latest.isBlank() || !isNewer(current, latest)) return

        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getString("notified", null) == latest) return

        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "App updates", NotificationManager.IMPORTANCE_DEFAULT)
            )
        }
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Assay $latest is available")
            .setContentText("Tap to open the app and update.")
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setAutoCancel(true)
        if (launch != null) {
            notification.setContentIntent(
                PendingIntent.getActivity(
                    context, 9, launch,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            )
        }
        manager.notify(NOTIFICATION_ID, notification.build())
        prefs.edit().putString("notified", latest).apply()
        FlowLog.i("update check: $latest available (this is $current), notified")
    }
}
