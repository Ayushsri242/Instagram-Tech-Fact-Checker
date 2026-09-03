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
import java.util.Collections
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume

/**
 * On-device Instagram media extractor.
 *
 * Loads the post's /embed/captioned/ page inside an offscreen WebView. Verified against the
 * live site (ig_probe): the permalink renders no media at all, while the embed page exposes
 * a plain <video src="....mp4"> for reels and display_url entries for carousel slides.
 * Both need JavaScript, so a plain HTTP fetch is not enough - hence the WebView.
 *
 *  Tier B - active: after the page settles, the rendered DOM is pulled out and parsed.
 *  Tier A - passive: shouldInterceptRequest records CDN media URLs as a safety net.
 *
 * Pure Kotlin + system WebView. No native binaries, so the youtubedl-android SIGILL failure
 * mode cannot recur.
 */
class InstagramExtractor(private val context: Context) {

    companion object {
        private const val TAG = "TFC_DEBUG"
        private const val HARD_TIMEOUT_MS = 25_000L
        private const val SETTLE_AFTER_LOAD_MS = 3_000L
        private const val MOBILE_UA =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/122.0.0.0 Mobile Safari/537.36"

        private val SHORTCODE_REGEX = Regex("(?:reels?|p|share/reel)/([A-Za-z0-9_-]+)")
        private val VIDEO_TAG_REGEX = Regex("<video[^>]*\\ssrc=\"([^\"]+)\"")
        private val VIDEO_URL_REGEX = Regex("\"video_url\":\"(.*?)\"")
        private val DISPLAY_URL_REGEX = Regex("\"display_url\":\"(.*?)\"")
        private val IMG_TAG_REGEX = Regex("<img[^>]*\\ssrc=\"(https://[^\"]+)\"")
        private val CAPTION_USER_REGEX = Regex("class=\"CaptionUsername\"[^>]*>([^<]+)</a>")
        private val OWNER_REGEX = Regex("\"username\":\"(.*?)\"")
        private val CAPTION_BLOCK_REGEX = Regex("class=\"Caption\"([\\s\\S]{0,6000}?)</div>")
        private val CAPTION_JSON_REGEX = Regex("\"edge_media_to_caption\".{0,120}?\"text\":\"(.*?)\"")
        private val TAG_STRIP_REGEX = Regex("<[^>]+>")
        private val UNICODE_REGEX = Regex("\\\\u([0-9a-fA-F]{4})")

        /** Profile pictures and thumbnails live under these paths - never real post media. */
        private val JUNK_IMAGE_MARKERS = listOf(
            "t51.2885-19",   // avatars
            "/s34x34/", "/s100x100/", "/s150x150/", "/s240x240/",
            "static.cdninstagram.com",
            "rsrc.php"
        )

        fun extractShortcode(url: String): String? =
            SHORTCODE_REGEX.find(url)?.groupValues?.get(1)

        private fun isJunkImage(url: String): Boolean =
            JUNK_IMAGE_MARKERS.any { url.contains(it) }
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
        val isReel = sourceUrl.contains("/reel")
        val slug = if (isReel) "reel" else "p"
        val embedUrl = "https://www.instagram.com/" + slug + "/" + shortcode + "/embed/captioned/"
        Log.i(TAG, "EXTRACT: start shortcode=" + shortcode + " isReel=" + isReel + " embed=" + embedUrl)

        val result = withContext(Dispatchers.Main) { runWebView(embedUrl, isReel, activity) }
        if (result == null || result.isEmpty) {
            Log.e(TAG, "EXTRACT: WebView produced nothing for " + shortcode)
            return null
        }
        // A reel must yield a video. Images only would mean we grabbed the poster frame,
        // which used to sail through as a bogus "image" post - fail loudly instead.
        if (isReel && result.videoUrl.isNullOrBlank()) {
            Log.e(TAG, "EXTRACT: reel had no video URL, rejecting so Render fallback runs")
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
    private suspend fun runWebView(
        embedUrl: String,
        isReel: Boolean,
        activity: Activity?
    ): ExtractResult? = suspendCancellableCoroutine { continuation ->
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
        // The WebView is never attached to a view tree, so give it an explicit viewport,
        // otherwise it measures 0x0 and the page skips loading media.
        webView.layout(0, 0, 1080, 1920)

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
                    } else if (isCdn &&
                        (bare.endsWith(".jpg") || bare.endsWith(".jpeg") || bare.endsWith(".webp"))
                    ) {
                        if (!isJunkImage(requestUrl) && !sniffedImages.contains(requestUrl)) {
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
                    Log.i(
                        TAG,
                        "EXTRACT: TIER_B html chars=" + html.length +
                            " videoTag=" + VIDEO_TAG_REGEX.containsMatchIn(html) +
                            " videoUrlKey=" + html.contains("\"video_url\"") +
                            " displayUrlKey=" + html.contains("\"display_url\"")
                    )
                    val parsed = parseHtml(html, isReel)
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

        Log.i(TAG, "EXTRACT: loading embed page in offscreen WebView")
        webView.loadUrl(embedUrl)
    }

    private fun parseHtml(html: String, isReel: Boolean): ExtractResult? {
        if (html.isBlank()) return null

        // contextJSON is embedded as a double-escaped string, so the display_url key never matches
        // the plain regexes. Unescape a working copy before parsing the JSON side.
        val json = normalizeEscapes(html)

        // Reels: the embed player carries a real progressive .mp4, no blob/DASH.
        val videoUrl = (VIDEO_TAG_REGEX.find(html)?.groupValues?.get(1)
            ?: VIDEO_URL_REGEX.find(json)?.groupValues?.get(1))
            ?.let { cleanUrl(it) }
            ?.takeIf { it.startsWith("http") }

        // Carousels: contextJSON lists every slide, including ones the DOM has not lazy-loaded,
        // so it is preferred over scraping <img> tags.
        val fromJson = DISPLAY_URL_REGEX.findAll(json)
            .map { cleanUrl(it.groupValues[1]) }
            .filter { it.startsWith("http") && !isJunkImage(it) }
            .distinct()
            .toList()
        val fromDom = IMG_TAG_REGEX.findAll(html)
            .map { cleanUrl(it.groupValues[1]) }
            .filter { it.startsWith("http") && !isJunkImage(it) }
            .distinct()
            .toList()
        val imageUrls = (if (fromJson.isNotEmpty()) fromJson else fromDom).take(12)
        Log.i(TAG, "EXTRACT: TIER_B slides json=" + fromJson.size + " dom=" + fromDom.size)

        val author = (CAPTION_USER_REGEX.find(html)?.groupValues?.get(1)
            ?: OWNER_REGEX.find(json)?.groupValues?.get(1)
            ?: "").trim().ifBlank { "Creator" }

        val captionBlock = CAPTION_BLOCK_REGEX.find(html)?.groupValues?.get(1)
            ?.let { TAG_STRIP_REGEX.replace(it, " ") }
            ?.replace("&nbsp;", " ")
            ?.replace(Regex("\\s+"), " ")
            ?.trim()
        val caption = decodeEntities(
            captionBlock?.takeIf { it.isNotBlank() }
                ?: CAPTION_JSON_REGEX.find(html)?.groupValues?.get(1)
                ?: ""
        )

        val hasVideo = !videoUrl.isNullOrBlank()
        if (!hasVideo && imageUrls.isEmpty()) return null
        // A reel's poster frame is an image; do not let it masquerade as a carousel.
        if (isReel && !hasVideo) return null

        return ExtractResult(
            type = if (hasVideo) "video" else "image",
            videoUrl = videoUrl,
            imageUrls = if (hasVideo) emptyList() else imageUrls,
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

    /** Collapses the double escaping that wraps contextJSON inside the page source. */
    private fun normalizeEscapes(value: String): String = value
        .replace("\\\\/", "/")
        .replace("\\\"", "\"")
        .replace("\\/", "/")

    private fun decodeUnicode(value: String): String =
        UNICODE_REGEX.replace(value) { match ->
            match.groupValues[1].toInt(16).toChar().toString()
        }

    private fun decodeEntities(value: String): String = value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&#x27;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")

    /**
     * CDN URLs carry percent-encoded signature params (ig_cache_key ends in %3D%3D), so they
     * must NOT be percent-decoded - only HTML/JSON escaping is undone.
     */
    private fun cleanUrl(value: String): String =
        decodeEntities(decodeUnicode(value))
            .replace("\\/", "/")
            .replace("\\\\", "")
            .trim()
}
