package com.techfactchecker.app.data.model

enum class Verdict(val label: String, val colorHex: String) {
    TRUE("TRUE", "#4CAF50"),
    PARTIALLY_TRUE("PARTIALLY_TRUE", "#FFA000"),
    HYPE("HYPE", "#FF5722"),
    MISLEADING("MISLEADING", "#E53935"),
    FAKE("FAKE", "#D81B60"),
    UNKNOWN("UNKNOWN", "#78909C");

    companion object {
        fun fromString(value: String): Verdict {
            return entries.find { it.name.equals(value, ignoreCase = true) } ?: UNKNOWN
        }
    }
}

data class ToolClaim(
    val name: String,
    val githubRepo: String? = null,
    val pipCommand: String? = null,
    val claim: String,
    val isVerified: Boolean = false
)

data class EvidenceSource(
    val title: String,
    val url: String,
    val snippet: String
)

data class FactCheckResult(
    val reelId: String,
    val sourceUrl: String,
    val title: String,
    val author: String,
    val techName: String,
    val verdict: Verdict,
    val pricingModel: String = "Open Source",
    val githubUrl: String? = null,
    val factualReality: String = "",
    val summaryMarkdown: String = "",
    val tools: List<ToolClaim> = emptyList(),
    val claims: List<String> = emptyList(),
    val sources: List<EvidenceSource> = emptyList(),
    val rawTranscript: String = "",
    val ocrText: String = ""
)
