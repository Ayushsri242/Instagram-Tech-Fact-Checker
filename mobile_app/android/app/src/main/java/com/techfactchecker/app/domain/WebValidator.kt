package com.techfactchecker.app.domain

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.techfactchecker.app.data.model.EvidenceSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import org.jsoup.Jsoup
import java.util.concurrent.TimeUnit

class WebValidator {
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .build()

    companion object {
        // GitHub allows 60 unauthenticated API calls per hour per IP. A normal
        // run uses a handful, but re-running the same reel paid again every
        // time. Repo metadata barely changes, so cache it for the session.
        private val repoCache = java.util.concurrent.ConcurrentHashMap<String, Optional>()
        private val readmeCache = java.util.concurrent.ConcurrentHashMap<String, String>()

        // True once GitHub has said we are out of budget.
        @Volatile
        var gitHubRateLimited: Boolean = false

        // Search engines that answered with a bot check, and until when we
        // leave them alone. Oct 8: DuckDuckGo answers the first quick search
        // and then serves an "anomaly / challenge" page (HTTP 202) to the
        // rest; the old code read that as "no results", and one side-hustle
        // reel was judged on 1 source with 85% confidence.
        @Volatile
        var ddgBlockedUntil: Long = 0L
        @Volatile
        var bingBlockedUntil: Long = 0L

        // Optional personal access token. Lifts 60/h to 5000/h.
        @Volatile
        var gitHubToken: String? = null
    }

    // ConcurrentHashMap cannot store null, so a miss is cached explicitly.
    class Optional(val value: EvidenceSource?)

    suspend fun verifyGitHubRepo(slug: String): EvidenceSource? = withContext(Dispatchers.IO) {
        val cleanSlug = slug.trim().trim('/').replace("https://github.com/", "").replace("http://github.com/", "")
        if (!cleanSlug.contains("/") || cleanSlug.split("/").size != 2) return@withContext null

        repoCache[cleanSlug]?.let {
            Log.i("TFC_DEBUG", "GH cache hit: " + cleanSlug)
            return@withContext it.value
        }

        try {
            val builder = Request.Builder()
                .url("https://api.github.com/repos/" + cleanSlug)
                .header("User-Agent", "TechFactChecker")
                .header("Accept", "application/vnd.github+json")
            val token = gitHubToken
            if (token != null && token.isNotBlank()) {
                builder.header("Authorization", "Bearer " + token)
            }

            client.newCall(builder.build()).execute().use { response ->
                // 403/429 with zero remaining means the budget is gone, not that
                // the repo is missing. Conflating those two is exactly how a real
                // tool gets reported as non-existent.
                val remaining = response.header("x-ratelimit-remaining")
                if ((response.code == 403 || response.code == 429) && remaining == "0") {
                    gitHubRateLimited = true
                    Log.w("TFC_DEBUG", "GH rate limited (60/h unauthenticated). Repos become UNVERIFIED, not missing.")
                    return@withContext null
                }
                if (response.isSuccessful) {
                    val body = response.body?.string() ?: ""
                    val json = JsonParser.parseString(body).asJsonObject
                    val fullName = json.get("full_name")?.asString ?: cleanSlug
                    val stars = json.get("stargazers_count")?.asInt ?: 0
                    val desc = json.get("description")?.let { if (!it.isJsonNull) it.asString else "" } ?: ""
                    val license = json.getAsJsonObject("license")?.get("spdx_id")?.asString ?: "Open Source"
                    val isFork = json.get("fork")?.asBoolean ?: false
                    val parent = json.getAsJsonObject("parent")?.get("full_name")?.asString

                    // A fork is real but almost never the right thing to cite.
                    // Three separate runs named an 18-star, a 4-star and a 0-star
                    // repo instead of the popular original.
                    val canonical = if (isFork && parent != null) parent else fullName
                    val forkNote = if (isFork && parent != null) " | FORK of " + parent + " - prefer the original" else ""

                    val result = EvidenceSource(
                        title = "GitHub - " + canonical,
                        url = "https://github.com/" + canonical,
                        snippet = "Stars: " + stars + " | License: " + license + forkNote + " | " + desc
                    )
                    repoCache[cleanSlug] = Optional(result)
                    Log.i("TFC_DEBUG", "GH verified: " + cleanSlug + " -> " + canonical + " stars=" + stars + " fork=" + isFork)
                    return@withContext result
                }
                if (response.code == 404) {
                    repoCache[cleanSlug] = Optional(null)
                    return@withContext null
                }
            }
        } catch (e: Exception) {
            Log.w("TFC_DEBUG", "GH verify failed for " + cleanSlug + ": " + e.message)
        }
        return@withContext null
    }

    /**
     * README straight off the raw CDN.
     *
     * github.com repo pages render client-side, so Jsoup scraped them to zero
     * characters - one run claimed "the repo and docs confirm" having read
     * nothing at all. raw.githubusercontent.com serves plain files and is NOT
     * the API, so it does not spend the 60/hour budget.
     */
    suspend fun fetchGitHubReadme(slug: String, maxChars: Int = 1500): String = withContext(Dispatchers.IO) {
        val cleanSlug = slug.trim().trim('/').replace("https://github.com/", "").replace("http://github.com/", "")
        if (cleanSlug.split("/").size != 2) return@withContext ""
        readmeCache[cleanSlug]?.let { return@withContext it }

        for (name in listOf("README.md", "readme.md", "README.rst", "README")) {
            try {
                val request = Request.Builder()
                    .url("https://raw.githubusercontent.com/" + cleanSlug + "/HEAD/" + name)
                    .header("User-Agent", "TechFactChecker")
                    .build()
                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        val raw = response.body?.string() ?: ""
                        // Strip badge images and link syntax; a README opens with
                        // a wall of shields.io badges that say nothing.
                        val text = raw
                            .replace(Regex("!\\[[^\\]]*\\]\\([^)]*\\)"), " ")
                            .replace(Regex("\\[([^\\]]*)\\]\\([^)]*\\)"), "$1")
                            .replace(Regex("[`*#>|]"), " ")
                            .replace(Regex("\\s+"), " ")
                            .trim()
                        if (text.isNotBlank()) {
                            val out = text.take(maxChars)
                            readmeCache[cleanSlug] = out
                            Log.i("TFC_DEBUG", "GH readme: " + cleanSlug + " " + out.length + " chars via " + name)
                            return@withContext out
                        }
                    }
                }
            } catch (e: Exception) {
                // try the next filename
            }
        }
        readmeCache[cleanSlug] = ""
        Log.w("TFC_DEBUG", "GH readme: " + cleanSlug + " not found")
        return@withContext ""
    }

    /**
     * Pulls readable text off a result page. The web pipeline feeds this to the
     * model as page context and it is the single biggest quality difference
     * between a snippet-only verdict and a grounded one.
     */
    suspend fun fetchPageText(url: String, maxChars: Int = 1200): String = withContext(Dispatchers.IO) {
        try {
            val doc = Jsoup.connect(url)
                .userAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
                .timeout(4000)
                .ignoreContentType(true)
                .get()
            doc.select("script, style, nav, footer, header, noscript").remove()
            val text = doc.body()?.text()?.replace(Regex("\\s+"), " ")?.trim() ?: ""
            return@withContext text.take(maxChars)
        } catch (e: Exception) {
            return@withContext ""
        }
    }

    /** Adds page context to the first [limit] results, leaving the rest untouched. */
    suspend fun enrichWithPageText(
        sources: List<EvidenceSource>,
        limit: Int = 3
    ): List<EvidenceSource> = sources.mapIndexed { index, source ->
        if (index >= limit || source.pagePreview.isNotBlank()) source
        else source.copy(pagePreview = fetchPageText(source.url))
    }

    /** One search: DuckDuckGo, or Bing when DuckDuckGo is blocking us. */
    data class SearchOutcome(val results: List<EvidenceSource>, val engine: String, val blocked: Boolean)

    suspend fun searchWeb(query: String, maxResults: Int = 4): SearchOutcome {
        val now = System.currentTimeMillis()
        if (now >= ddgBlockedUntil) {
            val ddg = searchDuckDuckGoChecked(query, maxResults)
            if (ddg != null) return SearchOutcome(ddg, "ddg", false)
            // Leave it alone for a while: asking again only extends the block.
            ddgBlockedUntil = now + 10 * 60_000L
            Log.w("WebValidator", "DuckDuckGo bot check - switching to Bing for 10 min")
        }
        if (now >= bingBlockedUntil) {
            val bing = searchBing(query, maxResults)
            if (bing != null) return SearchOutcome(bing, "bing", false)
            bingBlockedUntil = now + 2 * 60_000L
            Log.w("WebValidator", "Bing bot check too")
        }
        return SearchOutcome(emptyList(), "none", true)
    }

    /** Results, or null when DuckDuckGo answered with its bot check. */
    private suspend fun searchDuckDuckGoChecked(query: String, maxResults: Int): List<EvidenceSource>? = withContext(Dispatchers.IO) {
        try {
            val response = Jsoup.connect("https://html.duckduckgo.com/html/")
                .data("q", query)
                .userAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
                .timeout(4000)
                .ignoreHttpErrors(true)
                .execute()
            val doc = response.parse()
            val blocked = response.statusCode() == 202 || response.statusCode() == 429 ||
                (doc.select(".result__body").isEmpty() && doc.html().contains("anomaly", ignoreCase = true))
            if (blocked) null else parseDuckDuckGo(doc, maxResults)
        } catch (e: Exception) {
            emptyList() // offline or timeout: not a block
        }
    }

    /**
     * Bing's normal results page, no key. Each result is an li.b_algo: the
     * title in its h2, the real address on the a.tilk link (the h2 link can be
     * a bing.com/ck/a redirect with the address base64-encoded after "u=a1"),
     * the snippet in .b_caption p. Null when Bing answers with a captcha.
     */
    private suspend fun searchBing(query: String, maxResults: Int): List<EvidenceSource>? = withContext(Dispatchers.IO) {
        try {
            val doc = Jsoup.connect("https://www.bing.com/search")
                .data("q", query)
                .userAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36")
                .header("Accept-Language", "en-US,en;q=0.9")
                .timeout(6000)
                .ignoreHttpErrors(true)
                .get()
            val items = doc.select("li.b_algo")
            if (items.isEmpty()) {
                val html = doc.html()
                return@withContext if (html.contains("captcha", true) || html.contains("unusual traffic", true)) null else emptyList()
            }
            val results = mutableListOf<EvidenceSource>()
            for (item in items) {
                if (results.size >= maxResults) break
                val title = item.selectFirst("h2")?.text()?.trim().orEmpty()
                var url = item.selectFirst("a.tilk")?.attr("href").orEmpty()
                if (url.isBlank()) url = item.selectFirst("h2 a")?.attr("href").orEmpty()
                if (url.contains("bing.com/ck/a")) {
                    val encoded = Regex("[?&]u=a1([^&]+)").find(url)?.groupValues?.get(1)
                    url = try {
                        if (encoded == null) "" else String(
                            android.util.Base64.decode(encoded.replace('-', '+').replace('_', '/'), android.util.Base64.DEFAULT)
                        )
                    } catch (e: Exception) { "" }
                }
                val snippet = (item.selectFirst(".b_caption p") ?: item.selectFirst("p"))?.text()?.trim().orEmpty()
                if (title.isNotBlank() && url.startsWith("http")) {
                    results.add(EvidenceSource(title = title, url = url, snippet = snippet))
                }
            }
            results
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun parseDuckDuckGo(doc: org.jsoup.nodes.Document, maxResults: Int): List<EvidenceSource> {
        val results = mutableListOf<EvidenceSource>()
        for (elem in doc.select(".result__body").take(maxResults)) {
            val titleElem = elem.select(".result__title a").first()
            val title = titleElem?.text() ?: ""
            val rawUrl = titleElem?.attr("href") ?: ""
            val snippet = elem.select(".result__snippet").first()?.text() ?: ""
            val url = if (rawUrl.contains("uddg=")) {
                java.net.URLDecoder.decode(rawUrl.substringAfter("uddg=").substringBefore("&"), "UTF-8")
            } else rawUrl
            if (url.isNotBlank() && title.isNotBlank()) {
                results.add(EvidenceSource(title = title, url = url, snippet = snippet))
            }
        }
        return results
    }

    // Kept for older callers; goes through the same block-aware path.
    suspend fun searchDuckDuckGo(query: String, maxResults: Int = 3): List<EvidenceSource> =
        searchWeb(query, maxResults).results
}
