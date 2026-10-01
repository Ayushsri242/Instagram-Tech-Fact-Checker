package com.techfactchecker.app.domain

import android.content.Context

/**
 * On-device LLM, switched off until the offline phase (MIGRATION_PLAN.md).
 *
 * The MediaPipe Gemma engine added 5 MB of native code to every APK while every
 * analysis ran through the Groq API. The class keeps its shape so the offline
 * branches in FactCheckEngine still compile; they are simply never taken,
 * because the model is never ready. The full implementation is in git history
 * (commit 516e5dd and earlier) and comes back with the offline phase.
 */
class LocalLlamaEngine(@Suppress("UNUSED_PARAMETER") context: Context) {

    fun reloadModel() {}

    fun isLocalModelReady(): Boolean = false

    suspend fun generateResponse(@Suppress("UNUSED_PARAMETER") prompt: String): String {
        throw IllegalStateException("On-device model is not part of this build; analysis runs on the Groq API.")
    }
}
