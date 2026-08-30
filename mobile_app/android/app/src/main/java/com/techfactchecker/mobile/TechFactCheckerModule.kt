package com.techfactchecker.mobile

import android.graphics.BitmapFactory
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.util.Log
import com.facebook.react.bridge.*
import com.techfactchecker.app.domain.FactCheckEngine
import com.techfactchecker.app.domain.LocalLlamaEngine
import com.techfactchecker.app.domain.OcrEngine
import com.techfactchecker.app.domain.OcrResult
import kotlinx.coroutines.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

class TechFactCheckerModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "TFC_DEBUG"
        private const val VIDEO_SERVICE_URL = "https://instagram-tech-fact-checker.onrender.com/extract"
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val factCheckEngine = FactCheckEngine()
    private val llamaEngine = LocalLlamaEngine(reactContext)
    private val ocrEngine = OcrEngine()
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(60, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

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

                // 1. Call Render service to get media info
                Log.e(TAG, "STEP 2: Calling video extraction service...")
                val jsonBody = JSONObject().put("url", url).toString()
                val requestBody = jsonBody.toRequestBody("application/json".toMediaType())
                val extractRequest = Request.Builder()
                    .url(VIDEO_SERVICE_URL)
                    .post(requestBody)
                    .build()

                val extractResponse = httpClient.newCall(extractRequest).execute()
                val responseBody = extractResponse.body?.string() ?: throw Exception("Empty response from video service")
                Log.e(TAG, "STEP 2a: Service response: ${responseBody.take(200)}")
                
                val responseJson = JSONObject(responseBody)
                if (responseJson.has("error")) {
                    throw Exception("Video service error: ${responseJson.getString("error")}")
                }

                val mediaType = responseJson.optString("type", "video")
                Log.e(TAG, "STEP 3: Media type = $mediaType")

                val combinedText = StringBuilder()
                val repos = mutableSetOf<String>()
                val urls = mutableSetOf<String>()
                var author = "Creator"
                var caption = ""

                if (mediaType == "image") {
                    // Handle image/carousel post
                    author = responseJson.optString("author", "Creator")
                    caption = responseJson.optString("caption", "")
                    combinedText.append(caption).append("\n")
                    
                    val imageUrls = responseJson.getJSONArray("image_urls")
                    Log.e(TAG, "STEP 4: Downloading ${imageUrls.length()} images for OCR...")
                    
                    for (i in 0 until imageUrls.length()) {
                        val imgUrl = imageUrls.getString(i)
                        val imgRequest = Request.Builder().url(imgUrl).build()
                        val imgResponse = httpClient.newCall(imgRequest).execute()
                        val imgBytes = imgResponse.body?.bytes()
                        if (imgBytes != null) {
                            val bitmap = BitmapFactory.decodeByteArray(imgBytes, 0, imgBytes.size)
                            if (bitmap != null) {
                                val ocrRes = ocrEngine.processImage(bitmap)
                                Log.e(TAG, "STEP 4a: OCR image $i text length=${ocrRes.fullText.length}")
                                combinedText.append(ocrRes.fullText).append("\n")
                                repos.addAll(ocrRes.detectedRepos)
                                urls.addAll(ocrRes.detectedUrls)
                            }
                        }
                    }
                } else {
                    // Handle video/reel
                    val videoUrl = responseJson.getString("video_url")
                    Log.e(TAG, "STEP 4: Got direct video URL, downloading...")
                    
                    val tempDir = File(reactContext.cacheDir, "video_tmp")
                    tempDir.mkdirs()
                    val outputFile = File(tempDir, "reel_${System.currentTimeMillis()}.mp4")

                    val videoRequest = Request.Builder().url(videoUrl).build()
                    val videoResponse = httpClient.newCall(videoRequest).execute()
                    val videoBytes = videoResponse.body?.bytes() ?: throw Exception("Failed to download video")
                    FileOutputStream(outputFile).use { it.write(videoBytes) }
                    Log.e(TAG, "STEP 4a: Downloaded ${videoBytes.size} bytes")

                    val retriever = MediaMetadataRetriever()
                    retriever.setDataSource(outputFile.absolutePath)
                    
                    val durationStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                    val durationMs = durationStr?.toLongOrNull() ?: 0L
                    Log.e(TAG, "STEP 4b: Video duration = ${durationMs}ms")
                    
                    for (i in 1..4) {
                        val timeUs = (durationMs * 1000 * i) / 5
                        val bitmap = retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST)
                        if (bitmap != null) {
                            val ocrRes = ocrEngine.processImage(bitmap)
                            Log.e(TAG, "STEP 4c: OCR frame $i text length=${ocrRes.fullText.length}")
                            combinedText.append(ocrRes.fullText).append("\n")
                            repos.addAll(ocrRes.detectedRepos)
                            urls.addAll(ocrRes.detectedUrls)
                        }
                    }
                    retriever.release()
                    outputFile.delete()
                }

                Log.e(TAG, "STEP 5: OCR complete. Combined text length=${combinedText.length}")

                val finalOcr = OcrResult(
                    fullText = combinedText.toString(),
                    lines = emptyList(),
                    detectedRepos = repos.toList(),
                    detectedUrls = urls.toList()
                )
                
                // Verify
                Log.e(TAG, "STEP 6: Running FactCheckEngine...")
                val result = factCheckEngine.analyzeAndVerify(
                    reelId = url.hashCode().toString(),
                    sourceUrl = url,
                    title = "Instagram Post",
                    author = author,
                    rawTranscript = if (caption.isNotEmpty()) caption else "Visual text extracted via on-device OCR.",
                    ocrResult = finalOcr
                )
                Log.e(TAG, "STEP 6 DONE: verdict=${result.verdict}, techName=${result.techName}")
                
                // Return to JS
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
                
                Log.e(TAG, "STEP 7: Resolving promise to JS")
                promise.resolve(map)
            } catch (e: Exception) {
                Log.e(TAG, "FATAL CRASH: ${e.javaClass.name}: ${e.message}", e)
                promise.reject("FACT_CHECK_ERROR", "${e.javaClass.name}: ${e.message ?: "unknown error"}", e)
            }
        }
    }
}
