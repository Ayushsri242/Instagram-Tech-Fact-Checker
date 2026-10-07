package com.techfactchecker.app.domain

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Keeps the app process alive while a reel is being analysed.
 *
 * The analysis runs in JavaScript. A user who pastes a link does not sit on a
 * sixty-second spinner - they switch apps, lock the phone, or swipe the app
 * away. Without a foreground service Android is free to freeze or kill the
 * process the moment it leaves the screen, and on this project's test phone it
 * did exactly that: logcat recorded `OplusHansManager: freeze uid ...
 * com.techfactchecker.mobile` seconds after the app was backgrounded. A frozen
 * process finishes nothing and notifies nobody.
 *
 * A running foreground service is the documented exemption. Its notification is
 * also the "analysing" line the user sees, so there is one notification, not a
 * service notification plus a separate progress one.
 *
 * Started and stopped from JS through TechFactCheckerModule. It holds no work of
 * its own; it only keeps the lights on while JS does the work.
 */
class AnalysisService : Service() {

    companion object {
        const val ACTION_START = "com.techfactchecker.ANALYSIS_START"
        const val EXTRA_MESSAGE = "message"
        const val NOTIFICATION_ID = 1001
        const val CHANNEL_ID = "analysis_progress"
        /**
         * One logcat tag for the whole user-visible flow - bubble tap, JS
         * pickup, service start/stop, notifications, verdict - native and JS
         * alike. Release builds cannot be inspected with run-as, so this is how
         * a release APK gets debugged:  adb logcat -s TFC_FLOW
         */
        const val FLOW_TAG = "TFC_FLOW"
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val message = intent?.getStringExtra(EXTRA_MESSAGE) ?: "Analysing reel..."
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager?.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Analysis progress", NotificationManager.IMPORTANCE_LOW)
            )
        }

        // Tapping the progress line brings the app back to wherever it was.
        val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        val tap = if (launch != null) {
            PendingIntent.getActivity(
                this, 3, launch,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        } else null

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Fact-checking")
            .setContentText(message)
            .setSmallIcon(android.R.drawable.ic_menu_search)
            .setOngoing(true)
            .setProgress(0, 0, true)
            .setContentIntent(tap)
            .build()

        // Android 14 requires the type at start as well as in the manifest.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        FlowLog.init(this)
        FlowLog.i("service: foreground started (" + message + ")")
        // If the system kills us anyway, do not restart: the JS that owned the
        // job is gone with the process, so a revived service would spin forever.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        FlowLog.i("service: stopped")
        super.onDestroy()
    }
}
