package com.techfactchecker.app.domain

import android.content.Context
import android.os.Environment
import android.util.Log
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

class LocalLlamaEngine(private val context: Context) {

    companion object {
        private const val TAG = "TFC_DEBUG"

        // The .task file is compiled with a 2048-token KV cache (ekv2048).
        // setMaxTokens must match it exactly. Asking for more than the cache
        // was compiled for is what produced the old native SIGABRT.
        private const val MAX_TOKENS = 2048

        // Reserve headroom inside the 2048 window for the model's own output.
        private const val PROMPT_TOKEN_BUDGET = 1400

        // Rough fallback when sizeInTokens() is unavailable.
        private const val CHARS_PER_TOKEN = 4

        private const val MODEL_FILE = "Gemma3-1B-IT_multi-prefill-seq_q4_ekv2048.task"
    }

    private var llmInference: LlmInference? = null
    private var isInitialized = false
    private var initError: String? = null

    init {
        initModelAsync()
    }

    private fun initModelAsync() {
        try {
            Log.i(TAG, "LLM init: searching model files")
            Log.i(TAG, "LLM init: filesDir=${context.filesDir.absolutePath}")
            val modelFile = findModelFile()
            if (modelFile != null && modelFile.exists()) {
                Log.i(TAG, "LLM init: found ${modelFile.absolutePath}, bytes=${modelFile.length()}")
                // topK/temperature moved to LlmInferenceSession in tasks-genai 0.10.24;
                // only model path and window sizing belong on the inference options now.
                val options = LlmInference.LlmInferenceOptions.builder()
                    .setModelPath(modelFile.absolutePath)
                    .setMaxTokens(MAX_TOKENS)
                    .setMaxTopK(64)
                    // Pinned to CPU: this device's MediaTek GPU stack has already
                    // crashed us once on native inference. Slower, but it runs.
                    .setPreferredBackend(LlmInference.Backend.CPU)
                    .build()
                llmInference = LlmInference.createFromOptions(context, options)
                isInitialized = true
                initError = null
                Log.i(TAG, "LLM init: MediaPipe ready (maxTokens=$MAX_TOKENS)")
            } else {
                initError = "Model file not found in storage."
                Log.w(TAG, "LLM init: $initError")
            }
        } catch (e: Exception) {
            isInitialized = false
            initError = "${e.javaClass.simpleName}: ${e.message}"
            Log.e(TAG, "MediaPipe Init Failed: $initError", e)
        }
    }

    fun reloadModel() {
        try {
            llmInference?.close()
        } catch (e: Exception) {
            Log.w(TAG, "LLM reload: close failed: ${e.message}")
        }
        llmInference = null
        isInitialized = false
        initModelAsync()
    }

    private fun findModelFile(): File? {
        val downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val candidatePaths = listOf(
            File(context.filesDir, "models/$MODEL_FILE"),
            File(downloadDir, "models/$MODEL_FILE"),
            File(downloadDir, MODEL_FILE)
        )
        return candidatePaths.find { it.exists() && it.length() > 50_000_000 }
    }

    fun isLocalModelReady(): Boolean = isInitialized && llmInference != null

    /**
     * Runs one prompt in a throwaway session, so pipeline stages never leak
     * context into each other. Temperature is low: this engine is used for
     * extraction and verdicts, not creative writing.
     */
    suspend fun generateResponse(prompt: String): String = withContext(Dispatchers.Default) {
        val engine = llmInference
        if (!isLocalModelReady() || engine == null) {
            throw Exception("Local model is NOT ready! InitError: $initError")
        }

        val fitted = fitPrompt(engine, prompt)
        var session: LlmInferenceSession? = null
        try {
            val sessionOptions = LlmInferenceSession.LlmInferenceSessionOptions.builder()
                .setTopK(40)
                .setTopP(0.9f)
                .setTemperature(0.3f)
                .build()
            session = LlmInferenceSession.createFromOptions(engine, sessionOptions)
            session.addQueryChunk(fitted)
            return@withContext session.generateResponse() ?: ""
        } catch (e: Exception) {
            throw Exception("MediaPipe Inference Crash: ${e.message}")
        } finally {
            try {
                session?.close()
            } catch (e: Exception) {
                Log.w(TAG, "LLM: session close failed: ${e.message}")
            }
        }
    }

    /**
     * Keeps the prompt under PROMPT_TOKEN_BUDGET. Trims from the middle so the
     * instruction header and the closing turn markers both survive.
     */
    private fun fitPrompt(engine: LlmInference, prompt: String): String {
        val tokens = try {
            engine.sizeInTokens(prompt)
        } catch (e: Exception) {
            prompt.length / CHARS_PER_TOKEN
        }
        if (tokens <= PROMPT_TOKEN_BUDGET) return prompt

        val keepRatio = PROMPT_TOKEN_BUDGET.toDouble() / tokens.toDouble()
        val keepChars = (prompt.length * keepRatio * 0.95).toInt().coerceAtLeast(400)
        val head = (keepChars * 2) / 3
        val tail = keepChars - head
        val trimmed = prompt.take(head) + "\n...[trimmed]...\n" + prompt.takeLast(tail)
        Log.w(TAG, "LLM: prompt trimmed tokens=$tokens chars=${prompt.length}->${trimmed.length}")
        return trimmed
    }
}
