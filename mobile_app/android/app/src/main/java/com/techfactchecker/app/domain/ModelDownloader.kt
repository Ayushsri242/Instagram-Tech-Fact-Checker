package com.techfactchecker.app.domain

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

class ModelDownloader(private val context: Context) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    val modelFile: File
        get() = File(context.filesDir, "models/llama-3.2-1b-instruct-int8.bin")

    fun isModelDownloaded(): Boolean {
        return modelFile.exists() && modelFile.length() > 50_000_000 // > 50MB
    }

    suspend fun downloadModel(
        modelUrl: String = "https://huggingface.co/google/gemma-2b-it/resolve/main/gemma-2b-it-cpu-int4.bin",
        onProgress: (Int) -> Unit
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            modelFile.parentFile?.mkdirs()
            val request = Request.Builder().url(modelUrl).build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext false

                val body = response.body ?: return@withContext false
                val totalBytes = body.contentLength()
                var bytesDownloaded = 0L

                val inputStream = body.byteStream()
                val outputStream = FileOutputStream(modelFile)

                val buffer = ByteArray(8 * 1024)
                var bytesRead: Int

                while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                    outputStream.write(buffer, 0, bytesRead)
                    bytesDownloaded += bytesRead
                    if (totalBytes > 0) {
                        val progress = ((bytesDownloaded * 100) / totalBytes).toInt()
                        withContext(Dispatchers.Main) {
                            onProgress(progress)
                        }
                    }
                }
                outputStream.flush()
                outputStream.close()
                inputStream.close()
                return@withContext true
            }
        } catch (e: Exception) {
            if (modelFile.exists()) {
                modelFile.delete()
            }
            return@withContext false
        }
    }
}
