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

    /** Stage-1 output: what the post claims, and how to go check it. */
    private data class Structured(
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
        llamaEngine: LocalLlamaEngine? = null,
        caption: String = "",
        speech: String = ""
    ): FactCheckResult = withContext(Dispatchers.Default) {
        Log.i("TFC_DEBUG", "FACT_CHECK start: reelId=$reelId, ocrChars=${ocrResult.fullText.length}, repos=${ocrResult.detectedRepos.size}, urls=${ocrResult.detectedUrls.size}, transcriptChars=${rawTranscript.length}")
        Log.i("TFC_DEBUG", "FACT_CHECK transcript=${rawTranscript.take(700)}")
        Log.i("TFC_DEBUG", "FACT_CHECK ocr=${ocrResult.fullText.take(700)}")
        val evidenceList = mutableListOf<EvidenceSource>()
        val verifiedTools = mutableListOf<ToolClaim>()

        // Offline mode = the caller handed us a ready local model. Online mode
        // passes null here because Groq does the reasoning on the JS side.
        val offline = llamaEngine != null && llamaEngine.isLocalModelReady()
        Log.i("TFC_DEBUG", "FACT_CHECK mode: ${if (offline) "OFFLINE_3STAGE" else "ONLINE_DETERMINISTIC"}")

        // 0. Direct verify all detected GitHub slugs (cheap, no LLM needed).
        Log.i("TFC_DEBUG", "FACT_CHECK slugs detected=${ocrResult.detectedRepos}")
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

        Log.i("TFC_DEBUG", "FACT_CHECK slugs verified=${verifiedTools.mapNotNull { it.githubRepo }}")

        var structured: Structured? = null
        var decidedTech: String? = null
        var abstainReason: String? = null

        if (offline) {
            // Split the inputs back apart. The caller used to hand us one merged
            // blob, which made it impossible to tell a dead transcript from a
            // dead OCR pass - and impossible to ignore only the dead one.
            val captionPart = caption.ifBlank { if (speech.isBlank()) rawTranscript else "" }
            val speechPart = speech

            val decision = SourceEvidence.decide(
                caption = captionPart,
                speech = speechPart,
                ocrText = ocrResult.fullText,
                // Only slugs that GitHub actually confirmed. A raw OCR slug is
                // often a fragment ("dev/cli", ".../ain") and scoring those as
                // hard evidence let "ain" beat the real product name.
                detectedRepos = verifiedTools.mapNotNull { it.githubRepo },
                detectedUrls = ocrResult.detectedUrls
            )

            // The name is chosen by code from corroborating evidence. The model
            // never gets to pick it: given junk input it will always invent
            // something confident rather than admit it does not know.
            decidedTech = decision.techName?.let {
                resolveDispute(it, decision, captionPart, speechPart, ocrResult.fullText)
            }

            // Only feed the model sources that passed their health check.
            val usableSpeech = if (decision.speech.usable) speechPart else ""
            val usableOcr = if (decision.ocr.usable) ocrResult.fullText else ""
            val spokenText = listOf(captionPart, usableSpeech).filter { it.isNotBlank() }.joinToString("\n")

            if (decidedTech == null) {
                // Nothing corroborated. Searching the raw transcript at this point
                // is what once turned a broken transcript into a report on a song.
                abstainReason = "Could not identify the product discussed in this post. " +
                    "Speech: ${decision.speech.reason}. On-screen text: ${decision.ocr.reason}."
                Log.w("TFC_DEBUG", "FACT_CHECK abstain: $abstainReason")
            } else {
                Log.i("TFC_DEBUG", "FACT_CHECK tech decided by evidence: $decidedTech")

                // STAGE 1 - the model structures claims and queries only.
                structured = stageStructure(llamaEngine!!, decidedTech, usableOcr, spokenText)
                Log.i("TFC_DEBUG", "FACT_CHECK stage1: claims=${structured?.claims?.size}, queries=${structured?.queries?.size}")

                // STAGE 2 - every query is anchored to the decided name. Raw
                // transcript text is never used as a query any more.
                val baseQueries = structured?.queries?.takeIf { it.isNotEmpty() }
                    ?: listOf("$decidedTech review", "$decidedTech github")
                val queries = baseQueries.map { query ->
                    if (!query.contains(decidedTech, ignoreCase = true)) "$decidedTech $query" else query
                }
                for (query in queries.take(3)) {
                    if (query.isBlank()) continue
                    val results = webValidator.searchDuckDuckGo(query, maxResults = 4)
                    evidenceList.addAll(results)
                    Log.i("TFC_DEBUG", "FACT_CHECK stage2: query=$query, results=${results.size}")
                }

                // The model's queries can be nonsense ("ain What does 4D refer?").
                // Fall back to the bare product name rather than proceeding with
                // no evidence at all.
                if (evidenceList.isEmpty()) {
                    Log.w("TFC_DEBUG", "FACT_CHECK stage2: all queries empty, retrying with bare name")
                    evidenceList.addAll(webValidator.searchDuckDuckGo(decidedTech, maxResults = 4))
                    Log.i("TFC_DEBUG", "FACT_CHECK stage2: fallback query=$decidedTech, results=${evidenceList.size}")
                }

                // Scrape page text once, for the best few results overall.
                // Doing it per query would multiply into a long stall.
                val enriched = webValidator.enrichWithPageText(evidenceList.toList(), limit = 3)
                evidenceList.clear()
                evidenceList.addAll(enriched)
                Log.i("TFC_DEBUG", "FACT_CHECK stage2: pageContext=${enriched.count { it.pagePreview.isNotBlank() }}/${enriched.size}")
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
            offline && decidedTech == null -> Verdict.UNKNOWN
            verifiedTools.size >= 3 -> Verdict.TRUE
            verifiedTools.isNotEmpty() -> Verdict.PARTIALLY_TRUE
            evidenceList.isNotEmpty() -> Verdict.PARTIALLY_TRUE
            rawTranscript.contains("open knowledge format", ignoreCase = true) -> Verdict.HYPE
            else -> Verdict.UNKNOWN
        }
        var primaryTech = decidedTech
            ?: if (verifiedTools.size > 1) "${verifiedTools.size} Tech Libraries"
            else verifiedTools.firstOrNull()?.name ?: "Unknown Technology"
        var aiSummary = ""

        if (offline && decidedTech != null) {
            // STAGE 3 - compare the structured claims against the gathered evidence.
            if (evidenceList.isEmpty()) {
                // A fact-check with nothing to check against is not a verdict.
                verdict = Verdict.UNKNOWN
                aiSummary = "Identified $decidedTech from the post, but no web evidence " +
                    "could be retrieved to verify its claims."
                Log.w("TFC_DEBUG", "FACT_CHECK stage3 skipped: no evidence gathered")
            } else {
                val compared = stageCompare(llamaEngine!!, decidedTech, structured, ocrResult.fullText, rawTranscript, evidenceList)
                if (compared != null) {
                    compared.first?.let { if (it != Verdict.UNKNOWN) verdict = it }
                    compared.second?.let { aiSummary = it }
                }
                if (aiSummary.isBlank()) {
                    // Both model attempts failed. Say what we actually did rather
                    // than showing an empty analysis section.
                    aiSummary = "Identified $decidedTech from the post and checked it against " +
                        "${evidenceList.size} web sources. The local model could not produce a " +
                        "reliable summary, so the verdict below comes from the evidence gathered."
                    Log.w("TFC_DEBUG", "FACT_CHECK stage3: falling back to deterministic summary")
                }
            }
            Log.i("TFC_DEBUG", "FACT_CHECK stage3: tech=$primaryTech, verdict=$verdict, summaryChars=${aiSummary.length}")
        } else if (offline) {
            aiSummary = abstainReason ?: "Could not identify the product discussed in this post."
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

    // ------------------------------------------------------------ tie-breaking

    /**
     * When the top two candidates score within a point of each other the local
     * evidence genuinely cannot separate them, so ask the web. The winner is the
     * one whose search results echo back distinctive words from the other
     * sources: a real product page talks about what the creator was talking about.
     */
    private suspend fun resolveDispute(
        leader: String,
        decision: SourceEvidence.Decision,
        caption: String,
        speech: String,
        ocrText: String
    ): String {
        val top = decision.candidates.take(2)
        if (top.size < 2) return leader
        val first = top[0]
        val second = top[1]
        if (first.score - second.score > 1 || second.score < 3) return leader
        // A repo or domain read off the screen is hard evidence; do not let a
        // fuzzy web-snippet count overturn it in favour of transcript chatter.
        if (first.why.contains("repo") || first.why.contains("domain")) return leader

        val cross = listOf(
            if (decision.ocr.usable) ocrText else "",
            if (decision.speech.usable) speech else "",
            caption
        ).joinToString(" ")
        val crossTokens = cross.lowercase()
            .split(Regex("[^a-z0-9]+"))
            .filter { it.length > 3 && it !in SourceEvidence.BOILERPLATE_TOKENS }
            .distinct()
            .take(40)
        if (crossTokens.isEmpty()) return leader

        var bestName = leader
        var bestHits = -1
        for (candidate in top) {
            val results = webValidator.searchDuckDuckGo(candidate.name, maxResults = 3)
            val blob = results.joinToString(" ") { "${it.title} ${it.snippet}" }.lowercase()
            val hits = crossTokens.count { blob.contains(it) }
            Log.i("TFC_DEBUG", "FACT_CHECK tiebreak: ${candidate.name} corroborated=$hits/${crossTokens.size}")
            if (hits > bestHits) {
                bestHits = hits
                bestName = candidate.name
            }
        }
        if (bestName != leader) Log.i("TFC_DEBUG", "FACT_CHECK tiebreak: $leader -> $bestName")
        return bestName
    }

    // ---------------------------------------------------------------- stage 1

    private suspend fun stageStructure(
        llamaEngine: LocalLlamaEngine,
        techName: String,
        ocrText: String,
        spokenText: String
    ): Structured? {
        return try {
            val prompt = buildString {
                append("<start_of_turn>user\n")
                append("A social-media post is promoting a product called \"").append(techName).append("\".\n")
                append("Read the post text below and write down what it claims about ")
                append(techName).append(".\n")
                append("Use ONLY the supplied text. Never invent facts.\n")
                append("If a source section is empty, ignore it.\n\n")
                append("Reply with exactly these four lines and nothing else:\n")
                append("CLAIM1: <one concrete claim the post makes about ").append(techName).append(">\n")
                append("CLAIM2: <another claim, or NONE>\n")
                append("QUERY1: <short web search query that would verify CLAIM1>\n")
                append("QUERY2: <short web search query that would verify CLAIM2, or NONE>\n\n")
                append("WHAT THE CREATOR WROTE OR SAID:\n").append(spokenText.take(900)).append("\n\n")
                append("TEXT VISIBLE ON SCREEN:\n").append(ocrText.take(900)).append("\n")
                append("<end_of_turn>\n<start_of_turn>model\n")
            }
            val response = llamaEngine.generateResponse(prompt)
            Log.i("TFC_DEBUG", "FACT_CHECK stage1 raw=${response.take(300)}")

            val claims = listOfNotNull(lineValue(response, "CLAIM1"), lineValue(response, "CLAIM2"))
                .filter { !it.equals("NONE", true) && it.length > 4 }
            val queries = listOfNotNull(lineValue(response, "QUERY1"), lineValue(response, "QUERY2"))
                .filter { !it.equals("NONE", true) && it.length >= 8 && !SourceEvidence.isBoilerplate(it) }
                // Gemma sometimes leaves a stray escape at the end of a line.
                .map { it.trim().trimEnd('\\', '"', '.').take(200) }

            if (claims.isEmpty() && queries.isEmpty()) null else Structured(claims, queries)
        } catch (e: Exception) {
            Log.w("TFC_DEBUG", "FACT_CHECK stage1 failed: ${e.message}")
            null
        }
    }

    // ---------------------------------------------------------------- stage 3

    /** Returns verdict + summary. The product name is not the model's to choose. */
    private suspend fun stageCompare(
        llamaEngine: LocalLlamaEngine,
        techName: String,
        structured: Structured?,
        ocrText: String,
        transcript: String,
        evidence: List<EvidenceSource>
    ): Pair<Verdict?, String?>? {
        return try {
            val claimsText = structured?.claims?.takeIf { it.isNotEmpty() }
                ?.joinToString("\n") { "- $it" }
                ?: listOf(transcript.take(400), ocrText.take(300))
                    .filter { it.isNotBlank() }
                    .joinToString("\n")
            // Page context, not just the search snippet: this is what lets a
            // small model say something specific instead of hedging.
            val evidenceText = evidence.take(5)
                .joinToString("\n") { source ->
                    val context = source.pagePreview.take(400)
                    "- ${source.title}: ${source.snippet.take(220)}" +
                        if (context.isNotBlank()) "\n  Page: $context" else ""
                }
                .take(2400)

            val prompt = buildString {
                append("<start_of_turn>user\n")
                append("You are a technical fact-checker. The product is \"").append(techName).append("\".\n")
                append("Compare the post's claims against the web evidence.\n")
                append("Use ONLY the evidence below. Never invent facts. If the evidence does not cover the claims, answer UNKNOWN.\n")
                append("Reply with exactly these two lines and nothing else:\n")
                append("VERDICT: <TRUE|PARTIALLY_TRUE|HYPE|MISLEADING|FAKE|UNKNOWN>\n")
                append("SUMMARY: <two sentences about ").append(techName).append(" explaining the verdict>\n\n")
                append("CLAIMS:\n").append(claimsText).append("\n\n")
                append("WEB EVIDENCE:\n").append(evidenceText.ifBlank { "(none found)" }).append("\n")
                append("<end_of_turn>\n<start_of_turn>model\n")
            }
            val response = llamaEngine.generateResponse(prompt)
            Log.i("TFC_DEBUG", "FACT_CHECK stage3 raw=${response.take(300)}")

            val verdict = lineValue(response, "VERDICT")?.let { Verdict.fromString(it) }
            var summary = validSummary(lineValue(response, "SUMMARY"), techName)

            // A 1B model regularly answers the first requested line and stops.
            // Asking again for the summary alone is far more reliable than
            // rewording a two-line instruction it has already ignored.
            if (summary == null) {
                Log.w("TFC_DEBUG", "FACT_CHECK stage3: no summary in reply, retrying summary alone")
                summary = validSummary(stageSummaryOnly(llamaEngine, techName, claimsText, evidenceText), techName)
            }

            Pair(verdict, summary)
        } catch (e: Exception) {
            Log.e("TFC_DEBUG", "FACT_CHECK stage3 failed; using deterministic report", e)
            null
        }
    }

    /**
     * Second attempt at the summary, asking for prose only. No key prefix, no
     * second field - just the sentences, which is the one thing a small model
     * reliably produces.
     */
    private suspend fun stageSummaryOnly(
        llamaEngine: LocalLlamaEngine,
        techName: String,
        claimsText: String,
        evidenceText: String
    ): String? {
        return try {
            val prompt = buildString {
                append("<start_of_turn>user\n")
                append("Write exactly two sentences about ").append(techName).append(".\n")
                append("Say whether the web evidence below supports the claims made about it.\n")
                append("Use ONLY the evidence. Do not invent facts. Do not add any heading or label.\n")
                append("Mention ").append(techName).append(" by name.\n\n")
                append("CLAIMS:\n").append(claimsText).append("\n\n")
                append("WEB EVIDENCE:\n").append(evidenceText.ifBlank { "(none found)" }).append("\n")
                append("<end_of_turn>\n<start_of_turn>model\n")
            }
            val reply = normalizeNewlines(llamaEngine.generateResponse(prompt)).trim()
            Log.i("TFC_DEBUG", "FACT_CHECK stage3 summary retry raw=${reply.take(220)}")
            reply.lines()
                .map { it.trim().removePrefix("*").removePrefix("#").trim() }
                .filter { it.isNotBlank() }
                .joinToString(" ")
                .removePrefix("SUMMARY:")
                .trim()
                .takeIf { it.isNotBlank() }
        } catch (e: Exception) {
            Log.w("TFC_DEBUG", "FACT_CHECK stage3 summary retry failed: ${e.message}")
            null
        }
    }

    /**
     * A summary that never mentions the product is about something else - that
     * is what produced the report on a pop song - and a one-clause fragment is
     * not worth showing either.
     */
    private fun validSummary(raw: String?, techName: String): String? {
        val summary = raw?.trim()?.takeIf { it.isNotBlank() && !it.equals("[summary]", true) } ?: return null
        if (summary.length < 40) {
            Log.w("TFC_DEBUG", "FACT_CHECK stage3 summary rejected: too short (${summary.length})")
            return null
        }
        if (!SourceEvidence.contains(summary, techName)) {
            Log.w("TFC_DEBUG", "FACT_CHECK stage3 summary rejected: does not mention $techName")
            return null
        }
        return summary
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
