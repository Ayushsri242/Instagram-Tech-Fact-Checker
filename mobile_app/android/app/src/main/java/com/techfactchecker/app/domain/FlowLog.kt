package com.techfactchecker.app.domain

import android.content.Context
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The user-visible flow (bubble taps, queue, analysis start/end, service), kept
 * in a FILE as well as logcat.
 *
 * Background bugs only reproduce on release builds - debug pauses JS when the
 * app leaves the screen, so the bubble cannot even be tested there - and on the
 * OnePlus test phone logcat rolls over within minutes. A queue problem noticed
 * an hour later had nothing left to read. The file lives next to the saved run
 * log and can be pulled at any time:
 *
 *   adb pull /sdcard/Android/data/com.techfactchecker.mobile/files/flowlog.txt
 *
 * Rotates at 1 MB to flowlog_old.txt, so at most ~2 MB on the phone.
 */
object FlowLog {
    const val TAG = "TFC_FLOW"
    private const val MAX_BYTES = 1_000_000L
    private val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)

    @Volatile private var dir: File? = null

    /** Called once with any Context; the file needs one to find its folder. */
    fun init(context: Context) {
        if (dir == null) dir = context.applicationContext.getExternalFilesDir(null)
    }

    fun i(message: String) = write("I", message)
    fun w(message: String) = write("W", message)

    @Synchronized
    private fun write(level: String, message: String) {
        if (level == "W") Log.w(TAG, message) else Log.i(TAG, message)
        val folder = dir ?: return
        try {
            val file = File(folder, "flowlog.txt")
            if (file.length() > MAX_BYTES) {
                val old = File(folder, "flowlog_old.txt")
                old.delete()
                file.renameTo(old)
            }
            file.appendText(stamp.format(Date()) + " " + level + " " + message + "\n")
        } catch (e: Exception) {
            // Logging must never break the flow it is describing.
        }
    }
}
