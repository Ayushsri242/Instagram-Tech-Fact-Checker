package com.techfactchecker.app.domain

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings

/**
 * Whether the user wants the bubble on. Set when the bubble starts, cleared
 * only when the USER closes it (drag to X, or "stop" in the app) - not when
 * Android kills it for an update or a reboot.
 */
object BubbleState {
    private const val PREFS = "tfc_bubble_state"
    private const val KEY = "wanted"

    fun set(context: Context, wanted: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, wanted).apply()
    }

    fun wanted(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false)
}

/**
 * After an app update or a phone restart Android has stopped everything,
 * including the bubble. Oct 7: after updating, the bubble was gone (or its
 * first tap was lost) until the app was opened again. Bring it back if the
 * user had it on, and keep the background update check scheduled.
 *
 * (A FORCE STOP cannot be undone this way - Android blocks every restart
 * until the user opens the app; that is by design.)
 */
class SystemEventsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        FlowLog.init(context)
        UpdateCheckReceiver.schedule(context)
        if (!BubbleState.wanted(context)) {
            FlowLog.i("system: $action - bubble was off, not restarting")
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            FlowLog.i("system: $action - no overlay permission, bubble not restarted")
            return
        }
        try {
            val service = Intent(context, FloatingBubbleService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(service)
            } else {
                context.startService(service)
            }
            FlowLog.i("system: $action - bubble restarted")
        } catch (e: Exception) {
            FlowLog.w("system: $action - could not restart bubble: " + e.message)
        }
    }
}
