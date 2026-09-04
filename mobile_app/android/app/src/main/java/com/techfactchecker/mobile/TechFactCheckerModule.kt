package com.techfactchecker.mobile

import android.graphics.BitmapFactory
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.util.Log
import com.facebook.react.bridge.*
import com.techfactchecker.app.domain.FactCheckEngine
import com.techfactchecker.app.domain.InstagramExtractor
import com.techfactchecker.app.domain.LocalLlamaEngine
import com.techfactchecker.app.domain.OcrEngine
import com.techfactchecker.app.domain.OcrResult
import com.techfactchecker.app.domain.AudioTranscriber
import com.techfactchecker.app.domain.WebValidator
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
    private val webValidator = WebValidator()
    private val llamaEngine = LocalLlamaEngine(reactContext)
    private val ocrEngine = OcrEngine()
    private val instagramExtractor = InstagramExtractor(reactContext)
    private val audioTranscriber = AudioTranscriber(File(reactContext.filesDir, "models/whisper-tiny"))
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
    fun gatherEvidence(queries: ReadableArray, promise: Promise) {
        scope.launch {
            try {
                val seenUrls = mutableSetOf<String>()
                val evidence = Arguments.createArray()
                val repoPattern = Regex("\\b([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)\\b")

                suspend fun addEvidence(title: String, url: String, snippet: String) {
                    if (url.isBlank() || !seenUrls.add(url)) return
                    val item = Arguments.createMap()
                    item.putString("title", title)
                    item.putString("url", url)
                    item.putString("snippet", snippet)
                    evidence.pushMap(item)
                }

                for (index in 0 until queries.size()) {
                    val query = queries.getString(index)?.trim().orEmpty()
                    if (query.isBlank()) continue

                    for (match in repoPattern.findAll(query)) {
                        webValidator.verifyGitHubRepo(match.groupValues[1])?.let {
                            addEvidence(it.title, it.url, it.snippet)
                        }
                    }
                    for (result in webValidator.searchDuckDuckGo(query, maxResults = 4)) {
                        addEvidence(result.title, result.url, result.snippet)
                    }
                }
                promise.resolve(evidence)
            } catch (e: Exception) {
                Log.e(TAG, "Evidence search failed: " + e.message, e)
                promise.reject("EVIDENCE_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun analyzeAndVerify(url: String, useLocalLlm: Boolean, promise: Promise) {
        scope.launch {
            try {
                Log.e(TAG, "STEP 1: Starting analyzeAndVerify with url=$url, useLocalLlm=$useLocalLlm")

                // 1. Media extraction: on-device WebView first, Render cloud only as fallback.
                val combinedText = StringBuilder()
                val repos = mutableSetOf<String>()
                val urls = mutableSetOf<String>()
                var mediaSource: String
                var mediaType = "video"
                var videoUrlValue = ""
                val imageUrlList = mutableListOf<String>()
                var author = "Creator"
                var caption = ""
                // Kept separate from the caption: each source is health-checked on
                // its own, and a dead transcript must not poison a good caption.
                var audioTranscript = ""

                Log.e(TAG, "STEP 2: Extracting media on-device via offscreen WebView...")
                val webResult = try {
                    instagramExtractor.extract(url, currentActivity)
                } catch (e: Exception) {
                    Log.e(TAG, "STEP 2a: WebView extractor threw: ${e.message}", e)
                    null
                }

                if (webResult != null) {
                    mediaSource = "WEBVIEW"
                    mediaType = webResult.type
                    videoUrlValue = webResult.videoUrl ?: ""
                    imageUrlList.addAll(webResult.imageUrls)
                    author = webResult.author
                    caption = webResult.caption
                    Log.e(TAG, "STEP 2b: SOURCE=WEBVIEW via=${webResult.via} type=$mediaType images=${imageUrlList.size}")
                } else {
                    mediaSource = "RENDER"
                    Log.e(TAG, "STEP 2b: SOURCE=RENDER (WebView returned nothing, calling cloud service)")
                    val jsonBody = JSONObject().put("url", url).toString()
                    val requestBody = jsonBody.toRequestBody("application/json".toMediaType())
                    val extractRequest = Request.Builder()
                        .url(VIDEO_SERVICE_URL)
                        .post(requestBody)
                        .build()

                    val extractResponse = httpClient.newCall(extractRequest).execute()
                    val responseBody = extractResponse.body?.string() ?: throw Exception("Empty response from video service")
                    Log.i(TAG, "STEP 2c: Render HTTP=${extractResponse.code}, responseBytes=${responseBody.length}")
                    Log.d(TAG, "STEP 2d: Render response preview=${responseBody.take(200)}")

                    val responseJson = JSONObject(responseBody)
                    if (responseJson.has("error")) {
                        throw Exception("Video service error: ${responseJson.getString("error")}")
                    }

                    mediaType = responseJson.optString("type", "video")
                    author = responseJson.optString("author", "Creator")
                    caption = responseJson.optString("caption", "")
                    if (mediaType == "image") {
                        val renderImages = responseJson.getJSONArray("image_urls")
                        for (i in 0 until renderImages.length()) {
                            imageUrlList.add(renderImages.getString(i))
                        }
                    } else {
                        videoUrlValue = responseJson.getString("video_url")
                    }
                }

                Log.e(TAG, "STEP 3: Media type = $mediaType (SOURCE=$mediaSource)")

                if (mediaType == "image") {
                    // Handle image/carousel post
                    combinedText.append(caption).append("\n")

                    Log.i(TAG, "STEP 4: Downloading ${imageUrlList.size} images for OCR (SOURCE=$mediaSource)")

                    for (i in imageUrlList.indices) {
                        val imgUrl = imageUrlList[i]
                        val imgRequest = Request.Builder().url(imgUrl).build()
                        val imgResponse = httpClient.newCall(imgRequest).execute()
                        val imgBytes = imgResponse.body?.bytes()
                        Log.i(TAG, "STEP 4a: Image $i HTTP=${imgResponse.code}, bytes=${imgBytes?.size ?: 0}")
                        if (imgBytes != null) {
                            val bitmap = BitmapFactory.decodeByteArray(imgBytes, 0, imgBytes.size)
                            if (bitmap != null) {
                                val ocrRes = ocrEngine.processImage(bitmap)
                                Log.i(TAG, "STEP 4b: OCR image $i textLength=${ocrRes.fullText.length}, repos=${ocrRes.detectedRepos.size}, urls=${ocrRes.detectedUrls.size}")
                                combinedText.append(ocrRes.fullText).append("\n")
                                repos.addAll(ocrRes.detectedRepos)
                                urls.addAll(ocrRes.detectedUrls)
                            }
                        }
                    }
                } else {
                    // Handle video/reel
                    val videoUrl = videoUrlValue
                    if (videoUrl.isBlank()) throw Exception("No video URL recovered (SOURCE=$mediaSource)")
                    Log.e(TAG, "STEP 4: Got direct video URL from SOURCE=$mediaSource, downloading...")
                    
                    val tempDir = File(reactContext.cacheDir, "video_tmp")
                    tempDir.mkdirs()
                    val outputFile = File(tempDir, "reel_${System.currentTimeMillis()}.mp4")

                    val videoRequest = Request.Builder().url(videoUrl).build()
                    val videoResponse = httpClient.newCall(videoRequest).execute()
                    val videoBytes = videoResponse.body?.bytes() ?: throw Exception("Failed to download video")
                    Log.i(TAG, "STEP 4a: Video HTTP=${videoResponse.code}, bytes=${videoBytes.size}")
                    FileOutputStream(outputFile).use { it.write(videoBytes) }

                    val retriever = MediaMetadataRetriever()
                    retriever.setDataSource(outputFile.absolutePath)
                    
                    val durationStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                    val durationMs = durationStr?.toLongOrNull() ?: 0L
                    Log.e(TAG, "STEP 4b: Video duration = ${durationMs}ms")
                    
                    var framesProcessed = 0
                    for (i in 1..4) {
                        val timeUs = (durationMs * 1000 * i) / 5
                        val bitmap = retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST)
                        if (bitmap != null) {
                            val ocrRes = ocrEngine.processImage(bitmap)
                            framesProcessed++
                            Log.i(TAG, "STEP 4c: OCR frame $i textLength=${ocrRes.fullText.length}, repos=${ocrRes.detectedRepos.size}, urls=${ocrRes.detectedUrls.size}")
                            combinedText.append(ocrRes.fullText).append("\n")
                            repos.addAll(ocrRes.detectedRepos)
                            urls.addAll(ocrRes.detectedUrls)
                        }
                    }
                    Log.i(TAG, "STEP 4d: Frames processed=$framesProcessed/$4")
                    val transcriptFromAudio = audioTranscriber.transcribe(outputFile)
                    Log.i(TAG, "STEP 4e: Audio transcript chars=${transcriptFromAudio.length}")
                    retriever.release()
                    outputFile.delete()
                    audioTranscript = transcriptFromAudio
                    caption = listOf(caption, transcriptFromAudio).filter { it.isNotBlank() }.joinToString("\n")
                }

                Log.i(TAG, "STEP 5: OCR complete. textLength=${combinedText.length}, repos=${repos.size}, urls=${urls.size}")

                val finalOcr = OcrResult(
                    fullText = combinedText.toString(),
                    lines = emptyList(),
                    detectedRepos = repos.toList(),
                    detectedUrls = urls.toList()
                )
                
                // Verify
                val transcript = caption
                Log.i(TAG, "STEP 6: Running FactCheckEngine. transcriptSource=${if (transcript.isEmpty()) "none" else "caption"}, transcriptLength=${transcript.length}")
                val result = factCheckEngine.analyzeAndVerify(
                    reelId = url.hashCode().toString(),
                    sourceUrl = url,
                    title = "Instagram Post",
                    author = author,
                    rawTranscript = transcript,
                    ocrResult = finalOcr,
                    llamaEngine = if (useLocalLlm) llamaEngine else null,
                    caption = caption.removeSuffix(audioTranscript).trim(),
                    speech = audioTranscript
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
                map.putString("ocrText", result.ocrText)
                
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

                val claimsArray = Arguments.createArray()
                result.claims.forEach { claimsArray.pushString(it) }
                map.putArray("claims", claimsArray)

                val sourcesArray = Arguments.createArray()
                result.sources.forEach { source ->
                    val sourceMap = Arguments.createMap()
                    sourceMap.putString("title", source.title)
                    sourceMap.putString("url", source.url)
                    sourceMap.putString("snippet", source.snippet)
                    sourcesArray.pushMap(sourceMap)
                }
                map.putArray("sources", sourcesArray)
                
                Log.e(TAG, "STEP 7: Resolving promise to JS")
                promise.resolve(map)
            } catch (e: Exception) {
                Log.e(TAG, "FATAL CRASH: ${e.javaClass.name}: ${e.message}", e)
                promise.reject("FACT_CHECK_ERROR", "${e.javaClass.name}: ${e.message ?: "unknown error"}", e)
            }
        }
    }
}
