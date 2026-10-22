package com.techfactchecker.app.domain

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
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
        val tile = qsTile ?: return
        tile.state = if (bubbleRunning) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = if (bubbleRunning) "Bubble on" else "Bubble off"
        }
        tile.updateTile()
    }

    override fun onClick() {
        super.onClick()
        FlowLog.init(this)
        val bubble = Intent(this, FloatingBubbleService::class.java)
        if (bubbleRunning) {
            FlowLog.i("tile: bubble off")
            BubbleState.set(this, false)
            stopService(bubble)
            bubbleRunning = false
            onStartListening()
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
