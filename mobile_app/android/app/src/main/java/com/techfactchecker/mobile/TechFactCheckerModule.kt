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
import com.techfactchecker.app.domain.GroqTranscriber
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

        /** Frames sampled per video, matching the web pipeline's 10. */
        private const val FRAME_SAMPLES = 10

        /** One slot for the progress line, so it is replaced and can be cleared. */
        private const val PROGRESS_NOTIFICATION_ID = 1001
        /** Verdicts get their own ids, derived from the reel, so several can coexist. */
        private const val VERDICT_NOTIFICATION_ID_BASE = 2000

        private const val FLOW = com.techfactchecker.app.domain.AnalysisService.FLOW_TAG

        /**
         * OEM screens that control background auto-start. These vendors run
         * their own freezers on top of Android's battery rules - the OnePlus
         * test phone froze the app with `OplusHansManager: freeze uid` - and none
         * of them is reachable through a standard intent. First match wins.
         */
        private val AUTOSTART_SCREENS = listOf(
            "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
            "com.coloros.safecenter" to "com.coloros.safecenter.startupapp.StartupAppListActivity",
            "com.oplus.safecenter" to "com.oplus.safecenter.permission.startup.StartupAppListActivity",
            "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
            "com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity",
            "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
            "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager",
            "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
            "com.asus.mobilemanager" to "com.asus.mobilemanager.autostart.AutoStartActivity",
        )
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val factCheckEngine = FactCheckEngine()
    private val webValidator = WebValidator()
    private val llamaEngine = LocalLlamaEngine(reactContext)
    private val ocrEngine = OcrEngine()
    private val instagramExtractor = InstagramExtractor(reactContext)
    private val transcriber = GroqTranscriber()
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

    private val bubbleReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: android.content.Context, intent: android.content.Intent) {
            if (intent.action == "com.techfactchecker.REEL_COPIED") {
                val url = intent.getStringExtra("url") ?: return
                // If this line is missing after a "bubble: reel link copied" line,
                // the process was frozen between the two.
                Log.i(FLOW, "module: reel link received from bubble, emitting to JS")
                reactContext.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit("ON_REEL_COPIED", url)
            }
        }
    }

    init {
        val filter = android.content.IntentFilter("com.techfactchecker.REEL_COPIED")
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            reactContext.registerReceiver(bubbleReceiver, filter, android.content.Context.RECEIVER_NOT_EXPORTED)
        } else {
            reactContext.registerReceiver(bubbleReceiver, filter)
        }
    }

    @ReactMethod
    fun startDoomscrollMode(promise: Promise) {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M && !android.provider.Settings.canDrawOverlays(reactContext)) {
            val intent = android.content.Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION)
            intent.data = android.net.Uri.parse("package:${reactContext.packageName}")
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
            promise.reject("PERMISSION_DENIED", "Please grant 'Display over other apps' permission and try again.")
            return
        }
        val intent = android.content.Intent(reactContext, com.techfactchecker.app.domain.FloatingBubbleService::class.java)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            reactContext.startForegroundService(intent)
        } else {
            reactContext.startService(intent)
        }
        promise.resolve(true)
    }

    @ReactMethod
    fun stopDoomscrollMode(promise: Promise) {
        val intent = android.content.Intent(reactContext, com.techfactchecker.app.domain.FloatingBubbleService::class.java)
        reactContext.stopService(intent)
        promise.resolve(true)
    }



    /** JS side of the TFC_FLOW log, so one `adb logcat -s TFC_FLOW` tells the whole story on a release build. */
    @ReactMethod
    fun trace(message: String) {
        Log.i(FLOW, "js: " + message)
    }

    /**
     * A wait that also ends while the app is in the background. React Native
     * pauses JS timers when no activity is visible, so a setTimeout cooldown
     * only fired once the user reopened the app (bubble stuck orange).
     */
    /**
     * Writes the run log to one fixed file, replacing the previous copy, so it
     * can be pulled at any time without the Share sheet:
     *   adb pull /sdcard/Android/data/com.techfactchecker.mobile/files/runlog.csv
     * App-specific external storage: no permission needed, and adb can read it.
     */
    @ReactMethod
    fun saveRunLogCopy(csv: String, promise: Promise) {
        scope.launch {
            try {
                val dir = reactContext.getExternalFilesDir(null) ?: throw IllegalStateException("external storage unavailable")
                val file = File(dir, "runlog.csv")
                file.writeText(csv)
                promise.resolve(file.absolutePath)
            } catch (e: Exception) {
                promise.reject("SAVE_ERROR", e.message)
            }
        }
    }

    @ReactMethod
    fun sleep(ms: Double, promise: Promise) {
        scope.launch {
            delay(ms.toLong())
            promise.resolve(null)
        }
    }

    // ---- Permissions the app needs to work while the user is in another app ----

    @ReactMethod
    fun getPermissionState(promise: Promise) {
        try {
            val map = Arguments.createMap()
            val power = reactContext.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
            map.putBoolean(
                "batteryUnrestricted",
                android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.M ||
                    power.isIgnoringBatteryOptimizations(reactContext.packageName)
            )
            map.putBoolean(
                "overlay",
                android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.M ||
                    android.provider.Settings.canDrawOverlays(reactContext)
            )
            map.putBoolean(
                "notifications",
                androidx.core.app.NotificationManagerCompat.from(reactContext).areNotificationsEnabled()
            )
            map.putString("manufacturer", android.os.Build.MANUFACTURER.orEmpty())
            map.putBoolean("hasAutostartScreen", findAutostartIntent() != null)
            map.putInt("sdk", android.os.Build.VERSION.SDK_INT)
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("PERM_STATE", e.message)
        }
    }

    /** The standard system dialog: "Let app always run in background?" */
    @ReactMethod
    fun requestBatteryUnrestricted(promise: Promise) {
        try {
            val direct = android.content.Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(android.net.Uri.parse("package:" + reactContext.packageName))
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            val list = android.content.Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            startFirstAvailable(listOf(direct, list), "battery")
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PERM_BATTERY", e.message)
        }
    }

    @ReactMethod
    fun openOverlaySettings(promise: Promise) {
        try {
            val intent = android.content.Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION)
                .setData(android.net.Uri.parse("package:" + reactContext.packageName))
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            startFirstAvailable(listOf(intent, appDetailsIntent()), "overlay")
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PERM_OVERLAY", e.message)
        }
    }

    /**
     * Android stops showing the notification prompt after it has been denied
     * twice, so the only way back is the app's notification settings page.
     */
    @ReactMethod
    fun openNotificationSettings(promise: Promise) {
        try {
            val intent = android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, reactContext.packageName)
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            startFirstAvailable(listOf(intent, appDetailsIntent()), "notifications")
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PERM_NOTIF", e.message)
        }
    }

    @ReactMethod
    fun openAutostartSettings(promise: Promise) {
        try {
            val oem = findAutostartIntent()
            startFirstAvailable(listOfNotNull(oem, appDetailsIntent()), "autostart")
            promise.resolve(if (oem != null) "oem" else "app_details")
        } catch (e: Exception) {
            promise.reject("PERM_AUTOSTART", e.message)
        }
    }

    private fun appDetailsIntent(): android.content.Intent =
        android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(android.net.Uri.parse("package:" + reactContext.packageName))
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)

    private fun findAutostartIntent(): android.content.Intent? {
        val pm = reactContext.packageManager
        for ((pkg, cls) in AUTOSTART_SCREENS) {
            val intent = android.content.Intent()
                .setComponent(android.content.ComponentName(pkg, cls))
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            if (intent.resolveActivity(pm) != null) return intent
        }
        return null
    }

    /** Vendors export some of these screens and lock others; try each until one opens. */
    private fun startFirstAvailable(intents: List<android.content.Intent>, label: String) {
        var last: Exception? = null
        for (intent in intents) {
            try {
                reactContext.startActivity(intent)
                Log.i(FLOW, "permissions: opened " + label + " via " + (intent.component?.className ?: intent.action))
                return
            } catch (e: Exception) {
                last = e
            }
        }
        throw last ?: IllegalStateException("no screen available for " + label)
    }

    /**
     * Holds the process alive while JS analyses a reel, with an ongoing
     * "analysing" notification. See AnalysisService for why this exists.
     */
    @ReactMethod
    fun startAnalysisService(message: String, promise: Promise) {
        try {
            val intent = android.content.Intent(reactContext, com.techfactchecker.app.domain.AnalysisService::class.java)
                .setAction(com.techfactchecker.app.domain.AnalysisService.ACTION_START)
                .putExtra(com.techfactchecker.app.domain.AnalysisService.EXTRA_MESSAGE, message)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent)
            } else {
                reactContext.startService(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            // Never block an analysis because the keep-alive could not start -
            // the fact check still runs, it is just more exposed to being killed.
            Log.w(TAG, "startAnalysisService failed: " + e.message)
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun stopAnalysisService(promise: Promise) {
        try {
            // stopService, not startService(ACTION_STOP): starting a service
            // from the background can throw on Android 8+, and this is called
            // exactly when the app is most likely to be in the background.
            // Destroying a foreground service also removes its notification.
            val intent = android.content.Intent(reactContext, com.techfactchecker.app.domain.AnalysisService::class.java)
            reactContext.stopService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.w(TAG, "stopAnalysisService failed: " + e.message)
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun setBubbleColor(colorHex: String, promise: Promise) {
        try {
            val intent = android.content.Intent("com.techfactchecker.SET_BUBBLE_COLOR")
            intent.putExtra("color", colorHex)
            intent.setPackage(reactContext.packageName)
            reactContext.sendBroadcast(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("COLOR_ERROR", e.message)
        }
    }

    @ReactMethod
    fun showNotification(title: String, message: String, promise: Promise) {
        try {
            val channelId = "doomscroll_updates"
            val manager = reactContext.getSystemService(android.app.NotificationManager::class.java)
            
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                val channel = android.app.NotificationChannel(
                    channelId, 
                    "Doomscroll Updates", 
                    android.app.NotificationManager.IMPORTANCE_HIGH
                )
                manager?.createNotificationChannel(channel)
            }
            
            val launchIntent = reactContext.packageManager.getLaunchIntentForPackage(reactContext.packageName)?.apply {
                addFlags(android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            val pendingIntent = if (launchIntent != null) {
                android.app.PendingIntent.getActivity(
                    reactContext, 0, launchIntent,
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
                )
            } else null
            
            val notification = androidx.core.app.NotificationCompat.Builder(reactContext, channelId)
                .setContentTitle(title)
                .setContentText(message)
                .setSmallIcon(android.R.drawable.ic_menu_search)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .build()

            // A fixed id, so "Processing Reel..." is REPLACED on the next reel
            // instead of stacking, and so the verdict can clear it.
            //
            // Both notification methods used System.currentTimeMillis().toInt()
            // as the id, which is unique every call. setAutoCancel only clears a
            // notification when it is tapped, and nobody taps a progress line -
            // so every processed reel left its "Processing" notification in the
            // panel for ever, beside the verdict that had already arrived.
            manager?.notify(PROGRESS_NOTIFICATION_ID, notification)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("NOTIF_ERROR", e.message)
        }
    }

    @ReactMethod
    fun showNotificationWithLink(title: String, message: String, deepLink: String, promise: Promise) {
        try {
            val channelId = "doomscroll_updates"
            val manager = reactContext.getSystemService(android.app.NotificationManager::class.java)
            
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                val channel = android.app.NotificationChannel(channelId, "Doomscroll Updates", android.app.NotificationManager.IMPORTANCE_HIGH)
                manager?.createNotificationChannel(channel)
            }
            
            val launchIntent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(deepLink)).apply {
                setPackage(reactContext.packageName)
                addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            
            val pendingIntent = android.app.PendingIntent.getActivity(
                reactContext, 1, launchIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
            )
            
            val notification = androidx.core.app.NotificationCompat.Builder(reactContext, channelId)
                .setContentTitle(title)
                .setContentText(message)
                .setSmallIcon(android.R.drawable.ic_menu_search)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .build()

            // The verdict replaces the progress line rather than sitting next to
            // it, then keeps its own id per reel so two finished verdicts can
            // both stay in the panel.
            manager?.cancel(PROGRESS_NOTIFICATION_ID)
            manager?.notify(VERDICT_NOTIFICATION_ID_BASE + (deepLink.hashCode() and 0xFFFF), notification)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("NOTIF_ERROR", e.message)
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
                val collected = mutableListOf<com.techfactchecker.app.data.model.EvidenceSource>()
                val repoPattern = Regex("\\b([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)\\b")

                fun collect(source: com.techfactchecker.app.data.model.EvidenceSource) {
                    if (source.url.isBlank() || !seenUrls.add(source.url)) return
                    collected.add(source)
                }

                for (index in 0 until queries.size()) {
                    val query = queries.getString(index)?.trim().orEmpty()
                    if (query.isBlank()) continue

                    for (match in repoPattern.findAll(query)) {
                        webValidator.verifyGitHubRepo(match.groupValues[1])?.let { verified ->
                            // Attach the README straight away. github.com repo
                            // pages render client-side, so the page scraper got
                            // zero characters off them and the model ended up
                            // asserting "the repo confirms..." having read
                            // nothing. raw.githubusercontent.com is a plain file
                            // host, so this costs no GitHub API budget.
                            val slug = verified.url.removePrefix("https://github.com/")
                            val readme = webValidator.fetchGitHubReadme(slug)
                            collect(if (readme.isBlank()) verified else verified.copy(pagePreview = readme))
                        }
                    }
                    for (result in webValidator.searchDuckDuckGo(query, maxResults = 4)) {
                        collect(result)
                    }
                }

                // Scrape page text once, for the best few results overall. Doing
                // it per query would multiply into a long stall on a 10-query run.
                val enriched = webValidator.enrichWithPageText(collected, limit = 4)
                Log.i(TAG, "Evidence: results=${enriched.size}, pageContext=${enriched.count { it.pagePreview.isNotBlank() }}, ghRateLimited=${WebValidator.gitHubRateLimited}")

                val evidence = Arguments.createArray()
                for (source in enriched) {
                    val item = Arguments.createMap()
                    item.putString("title", source.title)
                    item.putString("url", source.url)
                    item.putString("snippet", source.snippet)
                    item.putString("pagePreview", source.pagePreview)
                    evidence.pushMap(item)
                }
                promise.resolve(evidence)
            } catch (e: Exception) {
                Log.e(TAG, "Evidence search failed: " + e.message, e)
                promise.reject("EVIDENCE_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun analyzeAndVerify(url: String, useLocalLlm: Boolean, groqApiKey: String, promise: Promise) {
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
                // Native-side diagnostics travel to the JS run log and end up as
                // CSV columns. Reading them out of logcat does not work: the
                // buffer rolls within minutes, and a batch of five posts is
                // analysed long after the last run. Everything needed to name
                // the failing stage has to survive in the file.
                var slidesJson = 0
                var slidesDom = 0
                var extractVia = ""
                var candidateUrls = listOf<String>()
                val ocrLens = mutableListOf<Int>()

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
                    slidesJson = webResult.slidesJson
                    slidesDom = webResult.slidesDom
                    extractVia = webResult.via
                    candidateUrls = webResult.candidates
                    Log.e(TAG, "STEP 2b: SOURCE=WEBVIEW via=${webResult.via} type=$mediaType images=${imageUrlList.size}")
                } else {
                    mediaSource = "RENDER"
                    // What the WebView read before it handed over: Render sends no
                    // caption, and the caption is the picker's strongest signal.
                    val partial = instagramExtractor.lastPartial
                    Log.e(TAG, "STEP 2b: SOURCE=RENDER (WebView returned nothing usable, calling cloud service; partial=${partial != null})")
                    try {
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
                    } catch (e: Exception) {
                        // A /p/ post with one image goes to Render only to ask "is
                        // this really a video?". If Render cannot answer, the image
                        // the WebView found is still a valid post - use it rather
                        // than failing an analysis that used to succeed.
                        // Never for a reel: its "images" are the cover plus thumbnails
                        // of OTHER suggested posts. On Oct 2 a Render timeout sent
                        // AutoShorts down this path and the app fact-checked a
                        // different post ("AA, ASTRA, OPUS, JEV"), titled "opus".
                        // A failed run is honest; a wrong post is not.
                        if (partial == null || partial.imageUrls.isEmpty() || url.contains("/reel")) throw e
                        Log.w(TAG, "STEP 2e: Render failed (${e.message}); using the WebView's ${partial.imageUrls.size} image(s)")
                        mediaSource = "WEBVIEW"
                        mediaType = partial.type
                        imageUrlList.clear()
                        imageUrlList.addAll(partial.imageUrls)
                        videoUrlValue = partial.videoUrl ?: ""
                        extractVia = partial.via
                        slidesJson = partial.slidesJson
                        slidesDom = partial.slidesDom
                        candidateUrls = partial.candidates
                    }
                    if (partial != null) {
                        if (caption.isBlank()) caption = partial.caption
                        if (author.isBlank() || author == "Creator") author = partial.author
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
                                ocrLens.add(ocrRes.fullText.length)
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
                    
                    // Ten evenly spaced frames, matching the web pipeline's
                    // ffmpeg fps=0.5 sampling. Four was too few: on a 28s reel
                    // three of the four came back completely blank.
                    var framesProcessed = 0
                    val seenLines = mutableSetOf<String>()
                    for (i in 1..FRAME_SAMPLES) {
                        val timeUs = (durationMs * 1000 * i) / (FRAME_SAMPLES + 1)
                        val bitmap = retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST)
                        if (bitmap != null) {
                            val ocrRes = ocrEngine.processImage(bitmap)
                            framesProcessed++
                            // Frames repeat the same on-screen text, so dedupe by
                            // line rather than pasting the same block ten times.
                            val fresh = ocrRes.lines.filter { seenLines.add(it.lowercase()) }
                            Log.i(TAG, "STEP 4c: OCR frame $i textLength=${ocrRes.fullText.length}, newLines=${fresh.size}, repos=${ocrRes.detectedRepos.size}, urls=${ocrRes.detectedUrls.size}")
                            ocrLens.add(ocrRes.fullText.length)
                            if (fresh.isNotEmpty()) combinedText.append(fresh.joinToString(" | ")).append("\n")
                            repos.addAll(ocrRes.detectedRepos)
                            urls.addAll(ocrRes.detectedUrls)
                        }
                    }
                    Log.i(TAG, "STEP 4d: Frames processed=$framesProcessed/$FRAME_SAMPLES, uniqueLines=${seenLines.size}")
                    val transcriptFromAudio = transcriber.transcribe(outputFile, groqApiKey, caption)
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
                val captionOnly = caption.removeSuffix(audioTranscript).trim()
                Log.i(TAG, "STEP 6: Running FactCheckEngine. captionChars=${captionOnly.length}, speechChars=${audioTranscript.length}, transcriptLength=${transcript.length}")
                val result = factCheckEngine.analyzeAndVerify(
                    reelId = url.hashCode().toString(),
                    sourceUrl = url,
                    title = "Instagram Post",
                    author = author,
                    rawTranscript = transcript,
                    ocrResult = finalOcr,
                    llamaEngine = if (useLocalLlm) llamaEngine else null,
                    caption = captionOnly,
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
                // The JS run log used to read `media.caption` and
                // `media.speechChars`, neither of which the bridge ever sent, so
                // two CSV columns were blank on every run in three test sets and
                // read as "STT produced nothing" rather than "nobody wired it".
                map.putString("caption", captionOnly)
                map.putInt("speechChars", audioTranscript.length)
                map.putString("mediaSource", mediaSource)
                map.putString("mediaType", mediaType)
                map.putString("extractVia", extractVia)
                map.putInt("slidesJson", slidesJson)
                map.putInt("slidesDom", slidesDom)
                map.putInt("imagesUsed", imageUrlList.size)
                // Image posts have no audio; do not carry over the previous video's line.
                map.putString("sttStats", if (mediaType == "image") "" else transcriber.lastStats)
                map.putString("ocrLens", ocrLens.joinToString(","))
                // Cross-post contamination: the embed renders suggested posts
                // beside the real one and their images share the CDN path shape,
                // so the distinguishing field has to be read off real runs.
                map.putString(
                    "candidates",
                    candidateUrls.take(12).joinToString(" | ") { it.take(160) }
                )
                
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
                var msg = e.message ?: "unknown error"
                if (msg.contains("Instagram sent an empty media response") || msg.contains("login to view")) {
                      msg = "Instagram blocked media download (login required or rate-limited). Configure INSTAGRAM_COOKIES on backend to bypass."
                  } else if (msg.contains("Video service error:")) {
                      msg = "Cloud extraction failed: " + msg.substringAfter("Video service error:").take(120)
                  } else {
                      msg = "${e.javaClass.name}: ${msg}"
                  }
                  promise.reject("FACT_CHECK_ERROR", msg, e)
            }
        }
    }
}

