package com.techfactchecker.mobile

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.util.Log
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

    companion object {
        private const val TAG = "TFC_DEBUG"
    }

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
                Log.e(TAG, "STEP 1: Starting analyzeAndVerify with url=$url")

                val tempDir = File(reactContext.cacheDir, "yt_dlp_tmp")
                tempDir.mkdirs()
                
                val outputName = "reel_${System.currentTimeMillis()}.mp4"
                val outputPath = File(tempDir, outputName).absolutePath
                Log.e(TAG, "STEP 2: Output path = $outputPath")

                // 1. Initialize YoutubeDL
                Log.e(TAG, "STEP 3: Initializing YoutubeDL...")
                try {
                    YoutubeDL.getInstance().init(reactContext.applicationContext)
                    Log.e(TAG, "STEP 3a: YoutubeDL init OK")
                } catch (e: Exception) {
                    Log.e(TAG, "STEP 3a: YoutubeDL init exception (may be already init): ${e.javaClass.name}: ${e.message}")
                    // Already initialized is OK, continue
                }
                try {
                    FFmpeg.getInstance().init(reactContext.applicationContext)
                    Log.e(TAG, "STEP 3b: FFmpeg init OK")
                } catch (e: Exception) {
                    Log.e(TAG, "STEP 3b: FFmpeg init exception (may be already init): ${e.javaClass.name}: ${e.message}")
                    // Already initialized is OK, continue
                }

                // 2. Download Video
                Log.e(TAG, "STEP 4: Downloading video...")
                val request = YoutubeDLRequest(url)
                request.addOption("-o", outputPath)
                request.addOption("-f", "best[ext=mp4]/best")
                val response = YoutubeDL.getInstance().execute(request, null)
                Log.e(TAG, "STEP 4 DONE: Download complete. Exit code=${response.exitCode}")

                val videoFile = File(outputPath)
                Log.e(TAG, "STEP 5: Video file exists=${videoFile.exists()}, size=${videoFile.length()}")

                // 3. Extract Frames & Run OCR
                Log.e(TAG, "STEP 6: Extracting frames...")
                val retriever = MediaMetadataRetriever()
                retriever.setDataSource(outputPath)
                
                val durationStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                val durationMs = durationStr?.toLongOrNull() ?: 0L
                Log.e(TAG, "STEP 6a: Video duration = ${durationMs}ms")
                
                val combinedText = StringBuilder()
                val repos = mutableSetOf<String>()
                val urls = mutableSetOf<String>()
                
                for (i in 1..4) {
                    val timeUs = (durationMs * 1000 * i) / 5
                    val bitmap = retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST)
                    Log.e(TAG, "STEP 6b: Frame $i at ${timeUs}us, bitmap=${bitmap != null}")
                    if (bitmap != null) {
                        val ocrRes = ocrEngine.processImage(bitmap)
                        Log.e(TAG, "STEP 6c: OCR frame $i text length=${ocrRes.fullText.length}")
                        combinedText.append(ocrRes.fullText).append("\n")
                        repos.addAll(ocrRes.detectedRepos)
                        urls.addAll(ocrRes.detectedUrls)
                    }
                }
                retriever.release()
                
                File(outputPath).delete()
                Log.e(TAG, "STEP 7: OCR complete. Combined text length=${combinedText.length}, repos=$repos")

                val finalOcr = OcrResult(
                    fullText = combinedText.toString(),
                    lines = emptyList(),
                    detectedRepos = repos.toList(),
                    detectedUrls = urls.toList()
                )
                
                Log.e(TAG, "STEP 8: Running FactCheckEngine...")
                val result = factCheckEngine.analyzeAndVerify(
                    reelId = url.hashCode().toString(),
                    sourceUrl = url,
                    title = "Instagram Reel",
                    author = "Creator",
                    rawTranscript = "Audio transcription bypassed for on-device limits. Relied on visual text.",
                    ocrResult = finalOcr
                )
                Log.e(TAG, "STEP 8 DONE: verdict=${result.verdict}, techName=${result.techName}")
                
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
                
                Log.e(TAG, "STEP 9: Resolving promise to JS")
                promise.resolve(map)
            } catch (e: Exception) {
                Log.e(TAG, "FATAL CRASH: ${e.javaClass.name}: ${e.message}", e)
                promise.reject("FACT_CHECK_ERROR", "${e.javaClass.name}: ${e.message ?: "unknown error"}", e)
            }
        }
    }
}
