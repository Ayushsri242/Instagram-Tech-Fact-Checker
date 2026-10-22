package com.techfactchecker.app.domain

import android.app.ActivityManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * The "Assay" tile in the pull-down Quick Settings panel, like Shazam's.
 * Oct 22: opening Instagram without starting the bubble meant going back to
 * Assay for Start Doomscroll Mode. The tile turns the bubble on and off from
 * anywhere.
 */
class BubbleTileService : TileService() {

    companion object {
        // Set by FloatingBubbleService itself, so a killed process reads as off
        // (BubbleState only says what the user wanted).
        @Volatile var bubbleRunning = false

        fun refresh(context: Context) {
            try {
                TileService.requestListeningState(context, ComponentName(context, BubbleTileService::class.java))
            } catch (e: Exception) {
                // the tile is not added; nothing to refresh
            }
        }
    }

    override fun onStartListening() {
        super.onStartListening()
        val on = isRunning()
        FlowLog.init(this)
        FlowLog.i("tile: panel open, bubble " + (if (on) "on" else "off"))
        show(on)
    }

    // Oct 22 test: the tile stayed grey with the bubble on (the flag alone was
    // stale), so ask Android whether the bubble service is actually running.
    private fun isRunning(): Boolean = try {
        @Suppress("DEPRECATION")
        getSystemService(ActivityManager::class.java).getRunningServices(50)
            .any { it.service.className == FloatingBubbleService::class.java.name }
    } catch (e: Exception) {
        bubbleRunning
    }

    private fun show(on: Boolean) {
        val tile = qsTile ?: return
        tile.state = if (on) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = if (on) "Bubble on" else "Bubble off"
        }
        tile.updateTile()
    }

    // The bubble only shows once the panel closes, so a tap needs its own
    // signal or users tap again and again (Oct 22 test): a tick plus the tile
    // changing at once.
    private fun buzz() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                getSystemService(VibratorManager::class.java).defaultVibrator
            } else {
                getSystemService(Vibrator::class.java)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                vibrator.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK))
            } else {
                vibrator.vibrate(VibrationEffect.createOneShot(30, VibrationEffect.DEFAULT_AMPLITUDE))
            }
        } catch (e: Exception) {
            // no vibrator; the tile change is enough
        }
    }

    override fun onClick() {
        super.onClick()
        FlowLog.init(this)
        buzz()
        val bubble = Intent(this, FloatingBubbleService::class.java)
        if (isRunning()) {
            FlowLog.i("tile: bubble off")
            BubbleState.set(this, false)
            stopService(bubble)
            bubbleRunning = false
            show(false)
            return
        }
        // No overlay permission: open the app, whose setup screen asks for it.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            FlowLog.i("tile: no overlay permission, opening the app")
            openApp()
            return
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(bubble) else startService(bubble)
            show(true)
            FlowLog.i("tile: bubble on")
        } catch (e: Exception) {
            // Android may refuse a background start; the app's own button still works.
            FlowLog.w("tile: could not start the bubble (" + e.message + "), opening the app")
            openApp()
        }
    }

    private fun openApp() {
        val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        } ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startActivityAndCollapse(
                PendingIntent.getActivity(this, 11, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            )
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(launch)
        }
    }
}
