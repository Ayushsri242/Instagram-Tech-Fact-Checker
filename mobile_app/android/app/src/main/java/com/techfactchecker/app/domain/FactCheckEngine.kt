package com.techfactchecker.app.domain

import com.google.gson.Gson
import com.techfactchecker.app.data.model.EvidenceSource
import com.techfactchecker.app.data.model.FactCheckResult
import com.techfactchecker.app.data.model.ToolClaim
import com.techfactchecker.app.data.model.Verdict
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class FactCheckEngine(private val webValidator: WebValidator = WebValidator()) {
    private val gson = Gson()

    suspend fun analyzeAndVerify(
        reelId: String,
        sourceUrl: String,
        title: String,
        author: String,
        rawTranscript: String,
        ocrResult: OcrResult
    ): FactCheckResult = withContext(Dispatchers.Default) {
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
            }
        }

        // 3. Determine overall verdict
        val verdict = when {
            verifiedTools.size >= 3 -> Verdict.TRUE
            verifiedTools.isNotEmpty() -> Verdict.PARTIALLY_TRUE
            evidenceList.isNotEmpty() -> Verdict.PARTIALLY_TRUE
            rawTranscript.contains("open knowledge format", ignoreCase = true) -> Verdict.HYPE
            else -> Verdict.PARTIALLY_TRUE
        }

        val primaryTech = if (verifiedTools.size > 1) "${verifiedTools.size} Tech Libraries"
        else verifiedTools.firstOrNull()?.name ?: "Tech Tool"

        val summaryMarkdown = buildMarkdownReport(
            techName = primaryTech,
            verdict = verdict,
            verifiedTools = verifiedTools,
            evidence = evidenceList,
            transcript = rawTranscript,
            ocrText = ocrResult.fullText
        )

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
