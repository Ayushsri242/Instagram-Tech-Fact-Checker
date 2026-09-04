package com.techfactchecker.app.domain

import com.google.gson.Gson
import com.techfactchecker.app.data.model.EvidenceSource
import com.techfactchecker.app.data.model.FactCheckResult
import com.techfactchecker.app.data.model.ToolClaim
import com.techfactchecker.app.data.model.Verdict
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import android.util.Log

class FactCheckEngine(private val webValidator: WebValidator = WebValidator()) {
    private val gson = Gson()

    private companion object {
        val BOILERPLATE_TOKENS = setOf(
            "apache", "mit", "bsd", "gpl", "agpl", "lgpl", "mpl", "licence", "license",
            "2.0", "3.0", "v2", "v3", "readme", "github", "gitlab", "star", "stars",
            "fork", "forks", "issue", "issues", "pull", "requests", "request", "commit",
            "commits", "branch", "contributor", "contributors", "copyright", "open",
            "source", "unknown", "none", "null", "documentation", "docs", "the", "a",
            "an", "and", "or", "of", "for", "tool", "tools", "app", "application",
            "project", "repository", "repo", "code", "software", "library", "framework",
            "name", "product", "technology", "tech"
        )
    }

    /** Stage-1 output: what the post actually claims, and how to go check it. */
    private data class Structured(
        val techName: String?,
        val claims: List<String>,
        val queries: List<String>
    )

    suspend fun analyzeAndVerify(
        reelId: String,
        sourceUrl: String,
        title: String,
        author: String,
        rawTranscript: String,
        ocrResult: OcrResult,
        llamaEngine: LocalLlamaEngine? = null
    ): FactCheckResult = withContext(Dispatchers.Default) {
        Log.i("TFC_DEBUG", "FACT_CHECK start: reelId=$reelId, ocrChars=${ocrResult.fullText.length}, repos=${ocrResult.detectedRepos.size}, urls=${ocrResult.detectedUrls.size}, transcriptChars=${rawTranscript.length}")
        val evidenceList = mutableListOf<EvidenceSource>()
        val verifiedTools = mutableListOf<ToolClaim>()

        // Offline mode = the caller handed us a ready local model. Online mode
        // passes null here because Groq does the reasoning on the JS side.
        val offline = llamaEngine != null && llamaEngine.isLocalModelReady()
        Log.i("TFC_DEBUG", "FACT_CHECK mode: ${if (offline) "OFFLINE_3STAGE" else "ONLINE_DETERMINISTIC"}")

        // 0. Direct verify all detected GitHub slugs (cheap, no LLM needed).
        for (slug in ocrResult.detectedRepos) {
            val ev = webValidator.verifyGitHubRepo(slug)
            if (ev != null) {
                evidenceList.add(ev)
                val toolName = slug.substringAfter("/")
                verifiedTools.add(
                    ToolClaim(
                        name = toolName,
                        githubRepo = slug,
                        pipCommand = "pip install ${toolName.lowercase()}",
                        claim = "Open-source tool/repository detected on screen",
                        isVerified = true
                    )
                )
            }
        }

        var structured: Structured? = null

        if (offline) {
            // STAGE 1 - structure the noisy OCR/caption into claims + search queries.
            structured = stageStructure(llamaEngine!!, ocrResult.fullText, rawTranscript)
            Log.i("TFC_DEBUG", "FACT_CHECK stage1: tech=${structured?.techName}, claims=${structured?.claims?.size}, queries=${structured?.queries?.size}")

            // STAGE 2 - web agent runs every query the model asked for.
            val baseQueries = structured?.queries?.takeIf { it.isNotEmpty() }
                ?: listOf(buildSearchQuery(ocrResult.fullText, rawTranscript))
            // Anchor every query to the product name, otherwise a vague query
            // pulls back evidence about something else entirely.
            val tech = structured?.techName
            val queries = baseQueries.map { query ->
                if (tech != null && !query.contains(tech, ignoreCase = true)) "$tech $query" else query
            }
            for (query in queries.take(3)) {
                if (query.isBlank()) continue
                val results = webValidator.searchDuckDuckGo(query, maxResults = 4)
                evidenceList.addAll(results)
                Log.i("TFC_DEBUG", "FACT_CHECK stage2: query=$query, results=${results.size}")
            }
        } else {
            // Online mode keeps the original cheap behaviour: only search when
            // nothing was verified straight from a GitHub slug.
            if (verifiedTools.isEmpty()) {
                val query = buildSearchQuery(ocrResult.fullText, rawTranscript)
                if (query.isNotBlank()) {
                    val results = webValidator.searchDuckDuckGo(query, maxResults = 5)
                    evidenceList.addAll(results)
                    Log.i("TFC_DEBUG", "FACT_CHECK web: query=$query, results=${results.size}")
                } else {
                    Log.w("TFC_DEBUG", "FACT_CHECK web skipped: no readable query text")
                }
            }
        }

        // Deterministic defaults, used as-is online and as a floor offline.
        var verdict = when {
            verifiedTools.size >= 3 -> Verdict.TRUE
            verifiedTools.isNotEmpty() -> Verdict.PARTIALLY_TRUE
            evidenceList.isNotEmpty() -> Verdict.PARTIALLY_TRUE
            rawTranscript.contains("open knowledge format", ignoreCase = true) -> Verdict.HYPE
            else -> Verdict.UNKNOWN
        }
        var primaryTech = if (verifiedTools.size > 1) "${verifiedTools.size} Tech Libraries"
        else verifiedTools.firstOrNull()?.name ?: structured?.techName ?: "Unknown Technology"
        var aiSummary = ""

        if (offline) {
            // STAGE 3 - compare the structured claims against the gathered evidence.
            val compared = stageCompare(llamaEngine!!, structured, ocrResult.fullText, rawTranscript, evidenceList)
            if (compared != null) {
                compared.first?.let { primaryTech = it }
                compared.second?.let { if (it != Verdict.UNKNOWN) verdict = it }
                compared.third?.let { aiSummary = it }
            }
            Log.i("TFC_DEBUG", "FACT_CHECK stage3: tech=$primaryTech, verdict=$verdict, summaryChars=${aiSummary.length}")
        }

        val claimList = structured?.claims?.takeIf { it.isNotEmpty() } ?: verifiedTools.map { it.claim }
        var summaryMarkdown = buildMarkdownReport(primaryTech, verdict, verifiedTools, evidenceList, rawTranscript, ocrResult.fullText, claimList)
        if (aiSummary.isNotBlank()) summaryMarkdown = "### AI Analysis\n$aiSummary\n\n$summaryMarkdown"

        return@withContext FactCheckResult(
            reelId = reelId,
            sourceUrl = sourceUrl,
            title = title.ifBlank { "Instagram Reel Fact-Check" },
            author = author.ifBlank { "Creator" },
            techName = primaryTech,
            verdict = verdict,
            pricingModel = if (verifiedTools.isNotEmpty()) "Open Source" else "Unknown",
            githubUrl = verifiedTools.firstOrNull()?.let { "https://github.com/${it.githubRepo}" },
            factualReality = if (aiSummary.isNotBlank()) aiSummary
            else if (verifiedTools.isNotEmpty()) "Verified ${verifiedTools.size} live repositories from on-screen frames and transcript."
            else "No live repository was verified from the supplied evidence.",
            summaryMarkdown = summaryMarkdown,
            tools = verifiedTools,
            claims = claimList,
            sources = evidenceList,
            rawTranscript = rawTranscript,
            ocrText = ocrResult.fullText
        )
    }

    // ---------------------------------------------------------------- stage 1

    private suspend fun stageStructure(
        llamaEngine: LocalLlamaEngine,
        ocrText: String,
        transcript: String
    ): Structured? {
        return try {
            val prompt = buildString {
                append("<start_of_turn>user\n")
                append("You extract structured facts from a tech social-media post.\n")
                append("TECH must be the product the post is promoting.\n")
                append("The SPOKEN words come from the creator and are authoritative for that name.\n")
                append("The OCR is screen text and is full of noise: never answer with a licence\n")
                append("name (Apache, MIT, GPL), a GitHub UI label (stars, forks, issues, README),\n")
                append("a file name, or a URL. Those are never the product.\n")
                append("Use ONLY the supplied text. Never invent names.\n\n")
                append("Example reply:\n")
                append("TECH: Ollama\n")
                append("CLAIM1: Runs large language models locally with one command\n")
                append("CLAIM2: NONE\n")
                append("QUERY1: Ollama run LLM locally single command\n")
                append("QUERY2: NONE\n\n")
                append("Reply with exactly those five lines and nothing else.\n\n")
                append("SPOKEN WORDS AND CAPTION (authoritative):\n").append(transcript.take(900)).append("\n\n")
                append("OCR (noisy screen text):\n").append(ocrText.take(900)).append("\n")
                append("<end_of_turn>\n<start_of_turn>model\n")
            }
            val response = llamaEngine.generateResponse(prompt)
            Log.i("TFC_DEBUG", "FACT_CHECK stage1 raw=${response.take(300)}")

            val rawTech = lineValue(response, "TECH")
                ?.let { sanitizeName(it) }
                ?.takeIf { !it.equals("NONE", true) }
            val rejected = rawTech != null && isBoilerplate(rawTech)
            if (rejected) {
                Log.w("TFC_DEBUG", "FACT_CHECK stage1 rejected boilerplate TECH=$rawTech")
            }
            val tech = if (rejected) null else rawTech

            val claims = listOfNotNull(lineValue(response, "CLAIM1"), lineValue(response, "CLAIM2"))
                .filter { !it.equals("NONE", true) && it.length > 4 }

            // If the name was rejected, any query built around it is worthless too.
            val queries = listOfNotNull(lineValue(response, "QUERY1"), lineValue(response, "QUERY2"))
                .filter { !it.equals("NONE", true) && it.length >= 8 && !isBoilerplate(it) }
                .filter { q -> !(rejected && rawTech != null && q.contains(rawTech, ignoreCase = true)) }
                .map { it.take(200) }

            if (tech == null && claims.isEmpty() && queries.isEmpty()) null
            else Structured(tech, claims, queries)
        } catch (e: Exception) {
            Log.w("TFC_DEBUG", "FACT_CHECK stage1 failed: ${e.message}")
            null
        }
    }

    // ---------------------------------------------------------------- stage 3

    private suspend fun stageCompare(
        llamaEngine: LocalLlamaEngine,
        structured: Structured?,
        ocrText: String,
        transcript: String,
        evidence: List<EvidenceSource>
    ): Triple<String?, Verdict?, String?>? {
        return try {
            val claimsText = structured?.claims?.takeIf { it.isNotEmpty() }
                ?.joinToString("\n") { "- $it" }
                ?: ocrText.take(500)
            val evidenceText = evidence.take(5)
                .joinToString("\n") { "- ${it.title}: ${it.snippet.take(220)}" }
                .take(1600)

            val prompt = buildString {
                append("<start_of_turn>user\n")
                append("You are a technical fact-checker. Compare the post's claims against the web evidence.\n")
                append("Use ONLY the evidence below. Never invent facts. If the evidence does not cover the claims, answer UNKNOWN.\n")
                append("Reply with exactly these three lines and nothing else:\n")
                append("TECH_NAME: <at most 4 words>\n")
                append("VERDICT: <TRUE|PARTIALLY_TRUE|HYPE|MISLEADING|FAKE|UNKNOWN>\n")
                append("SUMMARY: <two sentences explaining the verdict>\n\n")
                append("CLAIMS:\n").append(claimsText).append("\n\n")
                append("WHAT THE CREATOR SAID:\n").append(transcript.take(400)).append("\n\n")
                append("WEB EVIDENCE:\n").append(evidenceText.ifBlank { "(none found)" }).append("\n")
                append("<end_of_turn>\n<start_of_turn>model\n")
            }
            val response = llamaEngine.generateResponse(prompt)
            Log.i("TFC_DEBUG", "FACT_CHECK stage3 raw=${response.take(300)}")

            val tech = lineValue(response, "TECH_NAME")
                ?.let { sanitizeName(it) }
                ?.takeIf {
                    it.isNotBlank() && !it.equals("None", true) &&
                        !it.equals("[name]", true) && !isBoilerplate(it)
                }
            val verdict = lineValue(response, "VERDICT")?.let { Verdict.fromString(it) }
            val summary = lineValue(response, "SUMMARY")
                ?.takeIf { it.isNotBlank() && !it.equals("[summary]", true) }

            Triple(tech, verdict, summary)
        } catch (e: Exception) {
            Log.e("TFC_DEBUG", "FACT_CHECK stage3 failed; using deterministic report", e)
            null
        }
    }

    /**
     * OCR of a GitHub page is mostly licence text, UI labels and counts. A 1B
     * model happily answers "Apache License 2.0" when asked to name the product,
     * so reject any answer made up entirely of that vocabulary. Multi-word names
     * survive as long as one token is distinctive ("GitHub Copilot" is fine).
     */
    private fun isBoilerplate(value: String): Boolean {
        val tokens = value.lowercase()
            .split(Regex("[^a-z0-9.+#]+"))
            .filter { it.isNotBlank() }
        if (tokens.isEmpty()) return true
        return tokens.all { it in BOILERPLATE_TOKENS }
    }

    /**
     * Gemma sometimes writes the two-character sequence backslash-n instead of a
     * real line break, which makes lines() return one giant line and swallows
     * every field after the first. Normalise both forms before parsing.
     */
    private fun normalizeNewlines(response: String): String {
        return response
            .replace("\\r\\n", "\n")
            .replace("\\n", "\n")
            .replace("\\t", " ")
    }

    /** Pulls "KEY: value" out of a small-model reply, tolerating stray markdown. */
    private fun lineValue(response: String, key: String): String? {
        return normalizeNewlines(response).lines()
            .map { it.trim().removePrefix("*").removePrefix("#").trim() }
            .firstOrNull { it.startsWith("$key:", ignoreCase = true) }
            ?.substringAfter(":")
            ?.trim()
            ?.trim('*', '"', '`')
            ?.takeIf { it.isNotBlank() }
    }

    /** A product name is one short line, never a paragraph or a stray field. */
    private fun sanitizeName(value: String): String? {
        return value.lineSequence().firstOrNull()
            ?.trim()
            ?.trim('*', '"', '`', '.', ',')
            ?.split(Regex("\\s+"))
            ?.take(4)
            ?.joinToString(" ")
            ?.takeIf { it.isNotBlank() }
    }

    private fun buildSearchQuery(ocrText: String, transcript: String): String {
        return ("$transcript $ocrText")
            .replace(Regex("https?://\\S+|www\\.\\S+", RegexOption.IGNORE_CASE), " ")
            .replace(Regex("[^A-Za-z0-9+#._ -]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
            .take(240)
    }

    private fun buildMarkdownReport(
        techName: String,
        verdict: Verdict,
        verifiedTools: List<ToolClaim>,
        evidence: List<EvidenceSource>,
        transcript: String,
        ocrText: String,
        claims: List<String>
    ): String {
        val sb = StringBuilder()
        sb.append("### 🎯 Verdict: **${verdict.label}**\n\n")

        sb.append("### 🔍 What Was Analyzed\n")
        if (verifiedTools.isNotEmpty()) {
            sb.append("- Detected **${verifiedTools.size}** distinct tools & repositories from visual frames.\n")
        }
        if (transcript.isNotBlank()) {
            sb.append("- Analyzed speech transcript (${transcript.length} characters).\n")
        }
        sb.append("\n")

        if (claims.isNotEmpty()) {
            sb.append("### 📌 What Was Claimed\n")
            for (claim in claims.take(5)) {
                sb.append("- $claim\n")
            }
            sb.append("\n")
        }

        if (verifiedTools.isNotEmpty()) {
            sb.append("### 💡 Verified Tools Breakdown\n")
            sb.append("| Tool | GitHub Repository | Pip Command | Status |\n")
            sb.append("| :--- | :--- | :--- | :--- |\n")
            for (tool in verifiedTools) {
                sb.append("| **${tool.name}** | https://github.com/${tool.githubRepo} | `${tool.pipCommand}` | ✅ Verified |\n")
            }
            sb.append("\n")
        }

        sb.append("### ⚠️ Gotchas & Practical Tips\n")
        sb.append("- Always verify package names on PyPI before executing `pip install`.\n")
        sb.append("- Check repo license and recent commit activity for production readiness.\n\n")

        if (evidence.isNotEmpty()) {
            sb.append("### 🔗 References\n")
            for (ev in evidence.take(5)) {
                sb.append("- [${ev.title}](${ev.url})\n")
            }
        }

        return sb.toString()
    }
}
