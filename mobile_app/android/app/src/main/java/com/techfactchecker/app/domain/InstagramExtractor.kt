package com.techfactchecker.app.domain

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.net.URLDecoder
import java.util.Collections
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume

/**
 * On-device Instagram media extractor.
 *
 * Loads the post permalink inside an offscreen WebView (real browser engine, phone's own
 * mobile IP and cookies) and recovers media URLs in two ways:
 *
 *  Tier A - passive: every network request the page fires passes through shouldInterceptRequest,
 *           so CDN .mp4 / image URLs get captured as they fly by.
 *  Tier B - active: once the page settles, the rendered HTML is pulled out and the hydration
 *           blob is regexed for video_url / display_url / caption / owner.
 *
 * Pure Kotlin + system WebView. No native binaries, no Python, so the youtubedl-android
 * SIGILL failure mode cannot recur.
 */
class InstagramExtractor(private val context: Context) {

    companion object {
        private const val TAG = "TFC_DEBUG"
        private const val HARD_TIMEOUT_MS = 25_000L
        private const val SETTLE_AFTER_LOAD_MS = 2_500L
        private const val MOBILE_UA =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/122.0.0.0 Mobile Safari/537.36"

        private val SHORTCODE_REGEX = Regex("(?:reels?|p|share/reel)/([A-Za-z0-9_-]+)")
        private val VIDEO_URL_REGEX = Regex("\"video_url\":\"(.*?)\"")
        private val DISPLAY_URL_REGEX = Regex("\"display_url\":\"(.*?)\"")
        private val OWNER_REGEX = Regex("\"owner\":\\{[^}]*?\"username\":\"(.*?)\"")
        private val CAPTION_REGEX = Regex("\"edge_media_to_caption\".{0,120}?\"text\":\"(.*?)\"")
        private val OG_DESC_REGEX = Regex("property=\"og:description\" content=\"(.*?)\"")
        private val UNICODE_REGEX = Regex("\\\\u([0-9a-fA-F]{4})")

        fun extractShortcode(url: String): String? =
            SHORTCODE_REGEX.find(url)?.groupValues?.get(1)
    }

    data class ExtractResult(
        val type: String,
        val videoUrl: String?,
        val imageUrls: List<String>,
        val caption: String,
        val author: String,
        val via: String
    ) {
        val isEmpty: Boolean get() = videoUrl.isNullOrBlank() && imageUrls.isEmpty()
    }

    /** Returns null when nothing usable was recovered, so the caller can fall back. */
    suspend fun extract(sourceUrl: String, activity: Activity?): ExtractResult? {
        val shortcode = extractShortcode(sourceUrl)
        if (shortcode == null) {
            Log.e(TAG, "EXTRACT: no shortcode in url=" + sourceUrl)
            return null
        }
        val permalink = if (sourceUrl.contains("/reel")) {
            "https://www.instagram.com/reel/" + shortcode + "/"
        } else {
            "https://www.instagram.com/p/" + shortcode + "/"
        }
        Log.i(TAG, "EXTRACT: start shortcode=" + shortcode + " permalink=" + permalink)

        val result = withContext(Dispatchers.Main) { runWebView(permalink, activity) }
        if (result == null || result.isEmpty) {
            Log.e(TAG, "EXTRACT: WebView produced nothing for " + shortcode)
            return null
        }
        Log.i(
            TAG,
            "EXTRACT: OK type=" + result.type + " via=" + result.via +
                " images=" + result.imageUrls.size +
                " hasVideo=" + (result.videoUrl != null) +
                " captionChars=" + result.caption.length
        )
        return result
    }

    @SuppressLint("SetJavaScriptEnabled")
    private suspend fun runWebView(permalink: String, activity: Activity?): ExtractResult? =
        suspendCancellableCoroutine { continuation ->
            val handler = Handler(Looper.getMainLooper())
            val finished = AtomicBoolean(false)
            val sniffedVideos = Collections.synchronizedList(mutableListOf<String>())
            val sniffedImages = Collections.synchronizedList(mutableListOf<String>())

            // Some OEMs crash when a WebView is built from the application context.
            val webContext: Context = activity ?: context
            val webView = try {
                WebView(webContext)
            } catch (e: Throwable) {
                Log.e(TAG, "EXTRACT: WebView construction failed: " + e.message, e)
                continuation.resume(null)
                return@suspendCancellableCoroutine
            }

            var timeoutRunnable: Runnable? = null
            var settleRunnable: Runnable? = null

            fun finish(result: ExtractResult?) {
                if (!finished.compareAndSet(false, true)) return
                timeoutRunnable?.let { handler.removeCallbacks(it) }
                settleRunnable?.let { handler.removeCallbacks(it) }
                handler.post {
                    try {
                        webView.stopLoading()
                        webView.webViewClient = WebViewClient()
                        webView.loadUrl("about:blank")
                        webView.destroy()
                    } catch (e: Throwable) {
                        Log.w(TAG, "EXTRACT: webview teardown warn: " + e.message)
                    }
                }
                if (continuation.isActive) continuation.resume(result)
            }

            fun buildFromSniff(): ExtractResult? {
                val video = sniffedVideos.firstOrNull()
                val images = sniffedImages.distinct()
                if (video == null && images.isEmpty()) return null
                return ExtractResult(
                    type = if (video != null) "video" else "image",
                    videoUrl = video,
                    imageUrls = if (video != null) emptyList() else images,
                    caption = "",
                    author = "Creator",
                    via = "TIER_A_SNIFF"
                )
            }

            with(webView.settings) {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                loadsImagesAutomatically = true
                mediaPlaybackRequiresUserGesture = false
                userAgentString = MOBILE_UA
                cacheMode = WebSettings.LOAD_NO_CACHE
            }
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

            webView.webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView?,
                    request: WebResourceRequest?
                ): WebResourceResponse? {
                    val requestUrl = request?.url?.toString().orEmpty()
                    if (requestUrl.isNotBlank()) {
                        val bare = requestUrl.substringBefore("?")
                        val isCdn = requestUrl.contains("cdninstagram") || requestUrl.contains("fbcdn.net")
                        if (isCdn && (bare.endsWith(".mp4") || requestUrl.contains("/o1/v/"))) {
                            if (!sniffedVideos.contains(requestUrl)) {
                                sniffedVideos.add(requestUrl)
                                Log.i(TAG, "EXTRACT: TIER_A sniffed video #" + sniffedVideos.size)
                            }
                        } else if (isCdn && (bare.endsWith(".jpg") || bare.endsWith(".jpeg") || bare.endsWith(".webp"))) {
                            // Ignore obvious avatar/sprite sizes so carousel slides stay clean.
                            if (!requestUrl.contains("/s150x150/") && !sniffedImages.contains(requestUrl)) {
                                sniffedImages.add(requestUrl)
                            }
                        }
                    }
                    return null // pass-through, response never modified
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    if (finished.get()) return
                    Log.i(TAG, "EXTRACT: page finished, settling " + SETTLE_AFTER_LOAD_MS + "ms")
                    val runnable = Runnable { scrapeHtml(view) }
                    settleRunnable = runnable
                    handler.postDelayed(runnable, SETTLE_AFTER_LOAD_MS)
                }

                private fun scrapeHtml(view: WebView?) {
                    if (finished.get() || view == null) return
                    view.evaluateJavascript(
                        "(function(){return document.documentElement.outerHTML})();"
                    ) { raw ->
                        val html = unescapeJsPayload(raw)
                        Log.i(TAG, "EXTRACT: TIER_B html chars=" + html.length)
                        val parsed = parseHtml(html)
                        if (parsed != null && !parsed.isEmpty) {
                            finish(parsed)
                        } else {
                            val sniff = buildFromSniff()
                            if (sniff != null) {
                                Log.i(TAG, "EXTRACT: TIER_B empty, falling back to TIER_A sniff")
                                finish(sniff)
                            } else {
                                Log.e(TAG, "EXTRACT: both tiers empty (post may be login-gated)")
                                finish(null)
                            }
                        }
                    }
                }
            }

            val timeout = Runnable {
                if (finished.get()) return@Runnable
                val sniff = buildFromSniff()
                Log.e(TAG, "EXTRACT: hard timeout, sniffFallback=" + (sniff != null))
                finish(sniff)
            }
            timeoutRunnable = timeout
            handler.postDelayed(timeout, HARD_TIMEOUT_MS)

            continuation.invokeOnCancellation { finish(null) }

            Log.i(TAG, "EXTRACT: loading permalink in offscreen WebView")
            webView.loadUrl(permalink)
        }

    private fun parseHtml(html: String): ExtractResult? {
        if (html.isBlank()) return null

        val videoUrl = VIDEO_URL_REGEX.find(html)?.groupValues?.get(1)?.let { cleanUrl(it) }
        val imageUrls = DISPLAY_URL_REGEX.findAll(html)
            .map { cleanUrl(it.groupValues[1]) }
            .filter { it.isNotBlank() }
            .distinct()
            .take(12)
            .toList()

        val author = (OWNER_REGEX.find(html)?.groupValues?.get(1) ?: "").ifBlank { "Creator" }
        val rawCaption = CAPTION_REGEX.find(html)?.groupValues?.get(1)
            ?: OG_DESC_REGEX.find(html)?.groupValues?.get(1)
            ?: ""
        val caption = decodeUnicode(rawCaption)

        if (videoUrl.isNullOrBlank() && imageUrls.isEmpty()) return null

        return ExtractResult(
            type = if (!videoUrl.isNullOrBlank()) "video" else "image",
            videoUrl = videoUrl,
            imageUrls = if (!videoUrl.isNullOrBlank()) emptyList() else imageUrls,
            caption = caption,
            author = author,
            via = "TIER_B_HTML"
        )
    }

    /** evaluateJavascript returns a JSON string literal - strip quotes and unescape. */
    private fun unescapeJsPayload(raw: String?): String {
        if (raw.isNullOrBlank() || raw == "null") return ""
        var out = raw
        if (out.length > 1 && out.startsWith("\"") && out.endsWith("\"")) {
            out = out.substring(1, out.length - 1)
        }
        out = out.replace("\\\"", "\"").replace("\\n", "\n").replace("\\t", "\t")
        return decodeUnicode(out)
    }

    private fun decodeUnicode(value: String): String =
        UNICODE_REGEX.replace(value) { match ->
            match.groupValues[1].toInt(16).toChar().toString()
        }

    private fun cleanUrl(value: String): String {
        var out = decodeUnicode(value).replace("\\/", "/").replace("\\\\", "")
        if (out.contains("%")) {
            out = try {
                URLDecoder.decode(out, "UTF-8")
            } catch (e: Exception) {
                out
            }
        }
        return out.trim()
    }
}
