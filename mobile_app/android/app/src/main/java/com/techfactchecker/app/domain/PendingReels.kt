package com.techfactchecker.app.domain

import android.content.Context

/**
 * Links the bubble caught that JavaScript has not confirmed yet.
 *
 * Oct 7: the first tap after an update reached the native module but JS was
 * not listening yet, so the link was dropped and the bubble sat orange until a
 * second tap. Now every link is saved here first; JS removes it when it queues
 * it (ack) and, on start-up, picks up anything still waiting (take).
 */
object PendingReels {
    private const val PREFS = "tfc_pending_reels"
    private const val KEY = "urls"

    private fun read(context: Context): List<String> =
        (context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "") ?: "")
            .split('\n').filter { it.isNotBlank() }

    private fun write(context: Context, urls: List<String>) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY, urls.joinToString("\n")).commit()
    }

    @Synchronized
    fun add(context: Context, url: String) {
        val urls = read(context)
        if (url !in urls) write(context, urls + url)
    }

    @Synchronized
    fun ack(context: Context, url: String) {
        write(context, read(context).filter { it != url })
    }

    @Synchronized
    fun contains(context: Context, url: String): Boolean = url in read(context)

    @Synchronized
    fun takeAll(context: Context): List<String> {
        val urls = read(context)
        write(context, emptyList())
        return urls
    }
}
