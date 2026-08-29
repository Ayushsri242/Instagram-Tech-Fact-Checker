package com.techfactchecker.app.domain

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.techfactchecker.app.data.model.EvidenceSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.jsoup.Jsoup
import java.util.concurrent.TimeUnit

class WebValidator {
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .build()

    suspend fun verifyGitHubRepo(slug: String): EvidenceSource? = withContext(Dispatchers.IO) {
        val cleanSlug = slug.trim().trim('/').replace("https://github.com/", "").replace("http://github.com/", "")
        if (!cleanSlug.contains("/") || cleanSlug.split("/").size != 2) return@withContext null

        try {
            val request = Request.Builder()
                .url("https://api.github.com/repos/$cleanSlug")
                .header("User-Agent", "Mozilla/5.0")
                .build()

            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val body = response.body?.string() ?: ""
                    val json = JsonParser.parseString(body).asJsonObject
                    val fullName = json.get("full_name")?.asString ?: cleanSlug
                    val stars = json.get("stargazers_count")?.asInt ?: 0
                    val desc = json.get("description")?.let { if (!it.isJsonNull) it.asString else "" } ?: ""
                    val license = json.getAsJsonObject("license")?.get("spdx_id")?.asString ?: "Open Source"

                    return@withContext EvidenceSource(
                        title = "GitHub - $fullName",
                        url = "https://github.com/$cleanSlug",
                        snippet = "⭐ Stars: $stars | License: $license | Description: $desc"
                    )
                }
            }

            // Fallback to HTML check
            val htmlRequest = Request.Builder()
                .url("https://github.com/$cleanSlug")
                .header("User-Agent", "Mozilla/5.0")
                .build()

            client.newCall(htmlRequest).execute().use { response ->
                if (response.isSuccessful) {
                    return@withContext EvidenceSource(
                        title = "GitHub - $cleanSlug",
                        url = "https://github.com/$cleanSlug",
                        snippet = "Verified live GitHub repository: https://github.com/$cleanSlug"
                    )
                }
            }
        } catch (e: Exception) {
            // Ignore network errors on offline mode
        }
        return@withContext null
    }

    suspend fun searchDuckDuckGo(query: String, maxResults: Int = 3): List<EvidenceSource> = withContext(Dispatchers.IO) {
        val results = mutableListOf<EvidenceSource>()
        try {
            val doc = Jsoup.connect("https://html.duckduckgo.com/html/")
                .data("q", query)
                .userAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
                .timeout(4000)
                .get()

            val links = doc.select(".result__body")
            for (elem in links.take(maxResults)) {
                val titleElem = elem.select(".result__title a").first()
                val snippetElem = elem.select(".result__snippet").first()
                val title = titleElem?.text() ?: ""
                val rawUrl = titleElem?.attr("href") ?: ""
                val snippet = snippetElem?.text() ?: ""

                // Extract actual target url from DuckDuckGo redirect
                val url = if (rawUrl.contains("uddg=")) {
                    java.net.URLDecoder.decode(rawUrl.substringAfter("uddg=").substringBefore("&"), "UTF-8")
                } else rawUrl

                if (url.isNotBlank() && title.isNotBlank()) {
                    results.add(EvidenceSource(title = title, url = url, snippet = snippet))
                }
            }
        } catch (e: Exception) {
            // Offline fallback
        }
        return@withContext results
    }
}
