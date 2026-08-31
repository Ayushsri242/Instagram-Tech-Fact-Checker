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

        // 2. Search web for any unverified tools if needed
        if (verifiedTools.isEmpty() && ocrResult.detectedUrls.isNotEmpty()) {
            for (url in ocrResult.detectedUrls.take(2)) {
                val results = webValidator.searchDuckDuckGo(url, maxResults = 2)
                evidenceList.addAll(results)
                Log.i("TFC_DEBUG", "FACT_CHECK web: query=$url, results=${results.size}")
            }
        }

        // 3. Determine default values
        var verdict = when {
            verifiedTools.size >= 3 -> Verdict.TRUE
            verifiedTools.isNotEmpty() -> Verdict.PARTIALLY_TRUE
            evidenceList.isNotEmpty() -> Verdict.PARTIALLY_TRUE
            rawTranscript.contains("open knowledge format", ignoreCase = true) -> Verdict.HYPE
            else -> Verdict.PARTIALLY_TRUE
        }
        var primaryTech = if (verifiedTools.size > 1) "${verifiedTools.size} Tech Libraries"
        else verifiedTools.firstOrNull()?.name ?: "Tech Tool"
        var summaryMarkdown = buildMarkdownReport(primaryTech, verdict, verifiedTools, evidenceList, rawTranscript, ocrResult.fullText)

        // 4. SMART Fact-Check via Local AI
        if (llamaEngine != null && llamaEngine.isLocalModelReady()) {
            try {
                Log.i("TFC_DEBUG", "FACT_CHECK LLM: generating local summary")
                val llmPrompt = "<start_of_turn>user\nYou are an expert tech analyzer. Read this text extracted from a video/image:\n\nOCR TEXT:\n" + ocrResult.fullText.take(500) + "\n\nCAPTION:\n" + rawTranscript.take(500) + "\n\nBased ONLY on the text above, identify the main technology being discussed. Keep the name under 3 words. Then provide a 3-sentence summary of what the video is claiming about this technology. Format your response exactly like this:\nTECH_NAME: [name]\nSUMMARY: [summary]\n<end_of_turn>\n<start_of_turn>model\n"
                
                val aiResponse = llamaEngine.generateResponse(llmPrompt)
                
                if (aiResponse.contains("TECH_NAME:")) {
                    val lines = aiResponse.split("\n")
                    val parsedTechName = lines.find { it.startsWith("TECH_NAME:") }?.substringAfter("TECH_NAME:")?.trim()
                    val parsedSummary = lines.find { it.startsWith("SUMMARY:") }?.substringAfter("SUMMARY:")?.trim()
                    
                    if (!parsedTechName.isNullOrBlank() && parsedTechName != "None" && parsedTechName != "[name]") {
                        primaryTech = parsedTechName
                    }
                    if (!parsedSummary.isNullOrBlank() && parsedSummary != "[summary]") {
                        summaryMarkdown = "### dY\"S AI Analysis\n$parsedSummary\n\n" + summaryMarkdown
                    }
                }
                Log.i("TFC_DEBUG", "FACT_CHECK LLM: responseChars=${aiResponse.length}")
            } catch (e: Exception) {
                Log.e("TFC_DEBUG", "FACT_CHECK LLM failed; using deterministic report", e)
            }
        } else {
            Log.w("TFC_DEBUG", "FACT_CHECK LLM skipped: local model not ready")
        }

        return@withContext FactCheckResult(
            reelId = reelId,
            sourceUrl = sourceUrl,
            title = title.ifBlank { "Instagram Reel Fact-Check" },
            author = author.ifBlank { "Creator" },
            techName = primaryTech,
            verdict = verdict,
            pricingModel = if (verifiedTools.isNotEmpty()) "Open Source" else "Unknown",
            githubUrl = verifiedTools.firstOrNull()?.let { "https://github.com/${it.githubRepo}" },
            factualReality = "Verified ${verifiedTools.size} live repositories from on-screen frames and transcript.",
            summaryMarkdown = summaryMarkdown,
            tools = verifiedTools,
            claims = verifiedTools.map { it.claim },
            sources = evidenceList,
            rawTranscript = rawTranscript,
            ocrText = ocrResult.fullText
        )
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
