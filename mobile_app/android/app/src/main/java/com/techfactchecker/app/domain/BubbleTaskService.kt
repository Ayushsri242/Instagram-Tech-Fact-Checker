package com.techfactchecker.app.domain

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Runs the app's JS in the background, with no screen, when the bubble is tapped.
 * Oct 22: with the Quick Settings tile the bubble can be on while the app was
 * never opened (or Android closed it), and a tap only got "Reel saved - tap to
 * start". Loading the JS starts the bubble queue (App.js), which picks up the
 * saved link itself; the task ("AssayBubbleTask") only keeps the app alive
 * until the queue is empty. If the JS is already running, it is reused.
 */
class BubbleTaskService : HeadlessJsTaskService() {
    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
        HeadlessJsTaskConfig("AssayBubbleTask", Arguments.createMap(), 30 * 60 * 1000L, true)
}
