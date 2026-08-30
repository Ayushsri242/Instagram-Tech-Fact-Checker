package com.techfactchecker.app.domain

import android.content.Context
import android.os.Environment
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

class LocalLlamaEngine(private val context: Context) {

    private var llmInference: LlmInference? = null
    private var isInitialized = false

    init {
        initModelAsync()
    }

    private fun initModelAsync() {
        try {
            val modelFile = findModelFile()
            if (modelFile != null && modelFile.exists()) {
                val options = LlmInference.LlmInferenceOptions.builder()
                    .setModelPath(modelFile.absolutePath)
                    .setMaxTokens(512)
                    .setTopK(40)
                    .setTemperature(0.3f)
                    .build()
                llmInference = LlmInference.createFromOptions(context, options)
                isInitialized = true
            }
        } catch (e: Exception) {
            isInitialized = false
        }
    }

    fun reloadModel() {
        initModelAsync()
    }

    private fun findModelFile(): File? {
        val downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val candidatePaths = listOf(
            File(context.filesDir, "models/llama-3.2-1b-instruct-int8.bin"),
            File(downloadDir, "models/llama-3.2-1b-instruct.bin"),
            File(downloadDir, "models/llama-3.2-1b-instruct-int8.bin"),
            File(downloadDir, "models/gemma-2b-it-cpu-int4.bin"),
            File(downloadDir, "llama-3.2-1b.bin"),
            File(context.filesDir, "models/gemma-2b-it-gpu-int4.bin")
        )
        return candidatePaths.find { it.exists() && it.length() > 50_000_000 }
    }

    fun isLocalModelReady(): Boolean = isInitialized && llmInference != null

    suspend fun generateResponse(prompt: String): String = withContext(Dispatchers.Default) {
        if (isLocalModelReady()) {
            try {
                return@withContext llmInference?.generateResponse(prompt) 
                    ?: throw Exception("llmInference object is null but isLocalModelReady returned true!")
            } catch (e: Exception) {
                throw Exception("MediaPipe Inference Crash: ${e.message}")
            }
        } else {
            throw Exception("Local model is NOT ready! isInitialized=$isInitialized, llmInference is null=${llmInference == null}")
        }
    }

    private fun fallbackGenerate(prompt: String): String {
        return when {
            prompt.contains("install", ignoreCase = true) ->
                "To install this tool locally, check its PyPI package name and run `pip install <package_name>`. Verify CUDA drivers if GPU acceleration is required."
            prompt.contains("snippet", ignoreCase = true) || prompt.contains("code", ignoreCase = true) ->
                "Here is a standard integration snippet:\n```python\nimport tool_name\n\n# Initialize and execute\nclient = tool_name.Client()\nresult = client.run()\nprint(result)\n```"
            else ->
                "Based on verified on-screen repositories and documentation, this tool provides local-first functionality. Inspect its GitHub repository for the full README and license."
        }
    }
}
