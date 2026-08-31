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

        // 1. Direct verify all detected GitHub slugs
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

        // 2. Search readable OCR/caption text, not raw OCR URLs.
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

        // 3. Determine default values
        var verdict = when {
            verifiedTools.size >= 3 -> Verdict.TRUE
            verifiedTools.isNotEmpty() -> Verdict.PARTIALLY_TRUE
            evidenceList.isNotEmpty() -> Verdict.PARTIALLY_TRUE
            rawTranscript.contains("open knowledge format", ignoreCase = true) -> Verdict.HYPE
            else -> Verdict.UNKNOWN
        }
        var primaryTech = if (verifiedTools.size > 1) "${verifiedTools.size} Tech Libraries"
        else verifiedTools.firstOrNull()?.name ?: "Unknown Technology"
        var summaryMarkdown = buildMarkdownReport(primaryTech, verdict, verifiedTools, evidenceList, rawTranscript, ocrResult.fullText)
        var aiSummary = ""

        // 4. SMART Fact-Check via Local AI
        if (llamaEngine != null && llamaEngine.isLocalModelReady()) {
            try {
                Log.i("TFC_DEBUG", "FACT_CHECK LLM: generating local summary")
                val evidenceText = evidenceList.take(5).joinToString("\n") { "- ${it.title}: ${it.snippet}" }
                val llmPrompt = "<start_of_turn>user\nYou are a precise technology fact-check assistant. Compare the source claims with the supplied web evidence. Use ONLY supplied text. Never invent facts. If evidence is insufficient, verdict must be UNKNOWN. Return exactly three lines, no markdown or extra text:\nTECH_NAME: <name, max 4 words>\nVERDICT: <TRUE, PARTIALLY_TRUE, HYPE, MISLEADING, FAKE, or UNKNOWN>\nSUMMARY: <2-3 short sentences explaining the comparison and uncertainty>\n\nOCR TEXT:\n" + ocrResult.fullText.take(1200) + "\n\nCAPTION:\n" + rawTranscript.take(800) + "\n\nWEB EVIDENCE:\n" + evidenceText.take(1800) + "\n<end_of_turn>\n<start_of_turn>model\n"
                
                val aiResponse = llamaEngine.generateResponse(llmPrompt)
                
                if (aiResponse.isNotBlank()) {
                    val lines = aiResponse.lines()
                    val parsedTechName = lines.find { it.trim().startsWith("TECH_NAME:", ignoreCase = true) }
                        ?.substringAfter(":")?.trim()?.takeIf { it.isNotBlank() }
                    val parsedSummary = lines.find { it.trim().startsWith("SUMMARY:", ignoreCase = true) }
                        ?.substringAfter(":")?.trim()?.takeIf { it.isNotBlank() }
                    val parsedVerdict = lines.find { it.trim().startsWith("VERDICT:", ignoreCase = true) }
                        ?.substringAfter(":")?.trim()?.let { Verdict.fromString(it) }
                    
                    if (!parsedTechName.isNullOrBlank() && !parsedTechName.equals("None", true) && !parsedTechName.equals("[name]", true)) {
                        primaryTech = parsedTechName
                    }
                    if (!parsedSummary.isNullOrBlank() && !parsedSummary.equals("[summary]", true)) {
                        aiSummary = parsedSummary
                    }
                    if (parsedVerdict != null && parsedVerdict != Verdict.UNKNOWN) {
                        verdict = parsedVerdict
                    }
                }
                Log.i("TFC_DEBUG", "FACT_CHECK LLM: responseChars=${aiResponse.length}")
            } catch (e: Exception) {
                Log.e("TFC_DEBUG", "FACT_CHECK LLM failed; using deterministic report", e)
            }
        } else {
            Log.w("TFC_DEBUG", "FACT_CHECK LLM skipped: local model not ready")
        }
        summaryMarkdown = buildMarkdownReport(primaryTech, verdict, verifiedTools, evidenceList, rawTranscript, ocrResult.fullText)
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
            factualReality = if (verifiedTools.isNotEmpty()) "Verified ${verifiedTools.size} live repositories from on-screen frames and transcript." else "No live repository was verified from the supplied evidence.",
            summaryMarkdown = summaryMarkdown,
            tools = verifiedTools,
            claims = verifiedTools.map { it.claim },
            sources = evidenceList,
            rawTranscript = rawTranscript,
            ocrText = ocrResult.fullText
        )
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
        ocrText: String
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
