package com.techfactchecker.mobile

import com.facebook.react.bridge.*
import com.techfactchecker.app.domain.FactCheckEngine
import com.techfactchecker.app.domain.LocalLlamaEngine
import com.techfactchecker.app.domain.OcrEngine
import com.techfactchecker.app.domain.OcrResult
import kotlinx.coroutines.*

class TechFactCheckerModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val factCheckEngine = FactCheckEngine()
    private val llamaEngine = LocalLlamaEngine(reactContext)
    
    // We mock OCR logic for URL-based direct calls since downloading MP4 in Kotlin isn't fully set up yet.
    // The previous app passed local File URIs to OcrEngine.
    // To make this fully offline without yt-dlp, we can accept video paths OR we can rely on React Native to pass text.

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
    fun analyzeAndVerify(url: String, title: String, author: String, rawTranscript: String, ocrText: String, detectedReposStr: String, detectedUrlsStr: String, promise: Promise) {
        scope.launch {
            try {
                val detectedRepos = detectedReposStr.split(",").filter { it.isNotBlank() }
                val detectedUrls = detectedUrlsStr.split(",").filter { it.isNotBlank() }
                
                val ocrResult = OcrResult(
                    fullText = ocrText,
                    lines = emptyList(),
                    detectedRepos = detectedRepos,
                    detectedUrls = detectedUrls
                )
                
                val result = factCheckEngine.analyzeAndVerify(
                    reelId = url.hashCode().toString(),
                    sourceUrl = url,
                    title = title,
                    author = author,
                    rawTranscript = rawTranscript,
                    ocrResult = ocrResult
                )
                
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
