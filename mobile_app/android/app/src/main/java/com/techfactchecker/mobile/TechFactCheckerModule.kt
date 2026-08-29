package com.techfactchecker.mobile

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import com.facebook.react.bridge.*
import com.techfactchecker.app.domain.FactCheckEngine
import com.techfactchecker.app.domain.LocalLlamaEngine
import com.techfactchecker.app.domain.OcrEngine
import com.techfactchecker.app.domain.OcrResult
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import kotlinx.coroutines.*
import java.io.File

class TechFactCheckerModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val factCheckEngine = FactCheckEngine()
    private val llamaEngine = LocalLlamaEngine(reactContext)
    private val ocrEngine = OcrEngine()

    override fun getName(): String {
        return "TechFactChecker"
    }

    @ReactMethod
    fun reloadModel(promise: Promise) {
        try {
            llamaEngine.reloadModel()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("RELOAD_ERROR", e.message)
        }
    }

    @ReactMethod
    fun generateResponse(prompt: String, promise: Promise) {
        scope.launch {
            try {
                val response = llamaEngine.generateResponse(prompt)
                promise.resolve(response)
            } catch (e: Exception) {
                promise.reject("LLM_ERROR", e.message)
            }
        }
    }

    @ReactMethod
    fun analyzeAndVerify(url: String, promise: Promise) {
        scope.launch {
            try {
                val tempDir = File(reactContext.cacheDir, "yt_dlp_tmp")
                tempDir.mkdirs()
                
                val outputName = "reel_${System.currentTimeMillis()}.mp4"
                val outputPath = File(tempDir, outputName).absolutePath

                // 1. Download Video
                val request = YoutubeDLRequest(url)
                request.addOption("-o", outputPath)
                request.addOption("-f", "best[ext=mp4]/best")
                YoutubeDL.getInstance().execute(request, null)

                // 2. Extract Frames & Run OCR
                val retriever = MediaMetadataRetriever()
                retriever.setDataSource(outputPath)
                
                val durationStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                val durationMs = durationStr?.toLongOrNull() ?: 0L
                
                val combinedText = StringBuilder()
                val repos = mutableSetOf<String>()
                val urls = mutableSetOf<String>()
                
                // Extract 4 frames evenly spaced
                for (i in 1..4) {
                    val timeUs = (durationMs * 1000 * i) / 5
                    val bitmap = retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST)
                    if (bitmap != null) {
                        val ocrRes = ocrEngine.processImage(bitmap)
                        combinedText.append(ocrRes.fullText).append("\n")
                        repos.addAll(ocrRes.detectedRepos)
                        urls.addAll(ocrRes.detectedUrls)
                    }
                }
                retriever.release()
                
                // Cleanup temp video
                File(outputPath).delete()

                val finalOcr = OcrResult(
                    fullText = combinedText.toString(),
                    lines = emptyList(),
                    detectedRepos = repos.toList(),
                    detectedUrls = urls.toList()
                )
                
                // 3. Verify
                val result = factCheckEngine.analyzeAndVerify(
                    reelId = url.hashCode().toString(),
                    sourceUrl = url,
                    title = "Instagram Reel",
                    author = "Creator",
                    rawTranscript = "Audio transcription bypassed for on-device limits. Relied on visual text.",
                    ocrResult = finalOcr
                )
                
                // 4. Return to JS
                val map = Arguments.createMap()
                map.putString("reelId", result.reelId)
                map.putString("sourceUrl", result.sourceUrl)
                map.putString("title", result.title)
                map.putString("author", result.author)
                map.putString("techName", result.techName)
                map.putString("verdict", result.verdict.name)
                map.putString("pricingModel", result.pricingModel)
                map.putString("githubUrl", result.githubUrl)
                map.putString("factualReality", result.factualReality)
                map.putString("summaryMarkdown", result.summaryMarkdown)
                map.putString("rawTranscript", result.rawTranscript)
                
                val toolsArray = Arguments.createArray()
                result.tools.forEach { tool ->
                    val toolMap = Arguments.createMap()
                    toolMap.putString("name", tool.name)
                    toolMap.putString("githubRepo", tool.githubRepo)
                    toolMap.putString("pipCommand", tool.pipCommand)
                    toolMap.putBoolean("isVerified", tool.isVerified)
                    toolsArray.pushMap(toolMap)
                }
                map.putArray("tools", toolsArray)
                
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("FACT_CHECK_ERROR", e.message)
            }
        }
    }
}
