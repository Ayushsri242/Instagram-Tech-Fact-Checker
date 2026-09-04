package com.techfactchecker.app.domain

import android.util.Log

/**
 * Decides *what product a post is about* using code, not the language model.
 *
 * Both of our inputs fail regularly and in opposite directions: Whisper-tiny
 * returns repetition loops or "[inaudible]" on hard audio, and OCR of a GitHub
 * page returns nothing but licence text and UI chrome. Earlier versions declared
 * one of them authoritative in the prompt, which only moved the bug to the other
 * side. So nothing is trusted by position here: each source is health-checked,
 * candidate names are mined from both, and a name wins by corroboration.
 */
object SourceEvidence {

    private const val TAG = "TFC_DEBUG"

    /** Words that are never a product name, however often OCR shouts them. */
    val BOILERPLATE_TOKENS = setOf(
        "apache", "mit", "bsd", "gpl", "agpl", "lgpl", "mpl", "licence", "license",
        "2.0", "3.0", "v2", "v3", "readme", "github", "gitlab", "star", "stars",
        "fork", "forks", "issue", "issues", "pull", "requests", "request", "commit",
        "commits", "branch", "contributor", "contributors", "copyright", "open",
        "source", "unknown", "none", "null", "documentation", "docs", "the", "a",
        "an", "and", "or", "of", "for", "tool", "tools", "app", "application",
        "project", "repository", "repo", "code", "software", "library", "framework",
        "name", "product", "technology", "tech", "this", "that", "with", "your",
        "you", "new", "best", "top", "free", "video", "reel", "follow", "link",
        "comment", "comments", "description", "below", "subscribe", "share",
        "install", "curl", "https", "http", "www", "com", "dev", "org", "net",
        "main", "master", "release", "releases", "download", "click", "here"
    )

    /** Hosts that appear on every tech post and identify nothing. */
    private val GENERIC_HOSTS = setOf(
        "github", "gitlab", "bitbucket", "instagram", "youtube", "youtu", "google",
        "twitter", "linkedin", "medium", "reddit", "npmjs", "pypi", "docker",
        "stackoverflow", "facebook", "discord", "notion", "substack", "bit"
    )

    data class Health(val usable: Boolean, val reason: String)

    data class Candidate(
        val name: String,
        val score: Int,
        val why: String
    )

    data class Decision(
        val techName: String?,
        val candidates: List<Candidate>,
        val speech: Health,
        val ocr: Health
    )

    // ------------------------------------------------------------------ health

    /**
     * Whisper does not fail loudly. On bad audio it emits either a near-empty
     * string or the same phrase dozens of times, and both read as a valid
     * transcript downstream. Catch each shape explicitly.
     */
    fun speechHealth(text: String): Health {
        val trimmed = text.trim()
        if (trimmed.length < 25) return Health(false, "too short (${trimmed.length} chars)")
        val words = trimmed.lowercase().split(Regex("[^a-z0-9']+")).filter { it.isNotBlank() }
        if (words.size < 6) return Health(false, "too few words (${words.size})")

        val wordDiversity = words.distinct().size.toFloat() / words.size
        if (wordDiversity < 0.30f) {
            return Health(false, "word repetition loop (diversity=${fmt(wordDiversity)})")
        }
        if (words.size >= 12) {
            val shingles = (0..words.size - 4).map { words.subList(it, it + 4).joinToString(" ") }
            val phraseDiversity = shingles.distinct().size.toFloat() / shingles.size
            if (phraseDiversity < 0.35f) {
                return Health(false, "phrase repetition loop (diversity=${fmt(phraseDiversity)})")
            }
        }
        return Health(true, "ok")
    }

    /** OCR is unusable when every readable token is licence or UI vocabulary. */
    fun ocrHealth(text: String): Health {
        val tokens = text.lowercase()
            .split(Regex("[^a-z0-9.+#/-]+"))
            .filter { it.length > 2 }
        if (tokens.isEmpty()) return Health(false, "no readable text")
        val meaningful = tokens.distinct()
            .filter { it !in BOILERPLATE_TOKENS && !it.all { c -> c.isDigit() || c == '.' } }
        if (meaningful.size < 2) return Health(false, "only boilerplate/UI text")
        return Health(true, "ok")
    }

    // -------------------------------------------------------------- candidates

    /**
     * Mines product-name candidates from every source, scores them, and returns
     * the winner. A name gains most of its score from *corroboration* (appearing
     * in more than one source, or being an actual domain or repository name)
     * rather than from which source it came out of.
     */
    fun decide(
        caption: String,
        speech: String,
        ocrText: String,
        detectedRepos: List<String>,
        detectedUrls: List<String>
    ): Decision {
        val speechState = speechHealth(speech)
        val ocrState = ocrHealth(ocrText)
        Log.i(TAG, "EVIDENCE health: speech=${speechState.usable} (${speechState.reason}), ocr=${ocrState.usable} (${ocrState.reason})")

        val usableSpeech = if (speechState.usable) speech else ""
        val usableOcr = if (ocrState.usable) ocrText else ""
        val spoken = listOf(caption, usableSpeech).filter { it.isNotBlank() }.joinToString("\n")

        // name -> (score, reasons). Origin weights: something that is literally a
        // repository or a domain is far stronger evidence than a capitalised word.
        val scores = LinkedHashMap<String, Int>()
        val reasons = LinkedHashMap<String, MutableSet<String>>()

        fun add(raw: String?, points: Int, why: String) {
            val name = clean(raw ?: return) ?: return
            scores[name] = (scores[name] ?: 0) + points
            reasons.getOrPut(name) { linkedSetOf() }.add(why)
        }

        // Repository names and domains survive OCR noise well and are unambiguous.
        for (slug in detectedRepos) add(slug.substringAfterLast('/'), 4, "repo")
        for (url in detectedUrls) add(domainLabel(url), 4, "domain")
        // A domain can also be spoken or sit in the caption without being parsed
        // as a URL, so sweep the raw text for bare hostnames too.
        for (text in listOf(usableOcr, spoken)) {
            // OCR routinely inserts spaces around the dot ("forgecode. dev/cli"),
            // which is why OcrEngine's stricter URL pattern found nothing here.
            for (m in Regex("([A-Za-z][A-Za-z0-9-]{2,24})\\s*\\.\\s*(?:com|io|ai|dev|app|org|net|sh|co)\\b", RegexOption.IGNORE_CASE).findAll(text)) {
                add(m.groupValues[1], 4, "domain")
            }
        }

        // "This is called forge code" - the creator naming the thing outright.
        for (m in Regex("(?:is called|it's called|its called|called|named)\\s+([A-Za-z][A-Za-z0-9]{1,19}(?:\\s+[A-Za-z][A-Za-z0-9]{1,19})?)", RegexOption.IGNORE_CASE).findAll(spoken)) {
            add(m.groupValues[1], 3, "spoken-name")
        }

        // "Forge: AI-Enhanced Terminal Development" - a heading naming the product.
        for (line in usableOcr.lines()) {
            val m = Regex("^\\s*([A-Za-z][A-Za-z0-9+.#-]{2,20})\\s*:").find(line) ?: continue
            add(m.groupValues[1], 2, "heading")
        }

        // Hashtags are author-supplied labels, noisy but deliberate.
        for (m in Regex("#([A-Za-z][A-Za-z0-9_]{2,20})").findAll(caption)) {
            add(m.groupValues[1], 2, "hashtag")
        }

        // Weakest signal, kept only so a name mentioned nowhere else can still surface.
        for (m in Regex("\\b[A-Z][A-Za-z0-9]{2,19}\\b").findAll(usableOcr + "\n" + spoken)) {
            add(m.value, 1, "capitalised")
        }

        // Corroboration: the real product usually shows up on screen AND in what
        // the creator wrote or said. This is the signal that survives either
        // source going bad, because it simply scores zero when one side is dead.
        for (name in scores.keys.toList()) {
            val inOcr = contains(usableOcr, name)
            val inSpoken = contains(spoken, name)
            if (inOcr && inSpoken) {
                scores[name] = scores[name]!! + 3
                reasons[name]?.add("both-sources")
            }
            if (contains(caption, name)) {
                scores[name] = scores[name]!! + 2
                reasons[name]?.add("caption")
            }
        }

        val ranked = scores.entries
            .map { Candidate(it.key, it.value, reasons[it.key]?.joinToString("+") ?: "") }
            .filter { it.name.length >= 3 && !isBoilerplate(it.name) }
            .sortedWith(compareByDescending<Candidate> { it.score }.thenByDescending { it.name.length })
            .let { dedupe(it) }

        Log.i(TAG, "EVIDENCE candidates=" + ranked.take(6).joinToString(", ") { "${it.name}(${it.score}:${it.why})" })

        // Abstaining beats inventing. A score below 3 means the name came from a
        // single weak signal, which is how the "Big Brother" report happened.
        val best = ranked.firstOrNull()?.takeIf { it.score >= 3 }
        if (best == null) {
            Log.w(TAG, "EVIDENCE: no candidate scored high enough; abstaining")
        }
        return Decision(best?.name, ranked, speechState, ocrState)
    }

    /**
     * "forge" and "forgecode" are the same product seen twice. Fold a shorter
     * candidate into a longer one that contains it, keeping the combined score.
     */
    private fun dedupe(ranked: List<Candidate>): List<Candidate> {
        val kept = mutableListOf<Candidate>()
        for (c in ranked) {
            val squashed = squash(c.name)
            val parent = kept.indexOfFirst { squash(it.name).contains(squashed) || squashed.contains(squash(it.name)) }
            if (parent >= 0) {
                val existing = kept[parent]
                val name = if (squash(existing.name).length >= squashed.length) existing.name else c.name
                kept[parent] = Candidate(name, existing.score + c.score, existing.why)
            } else {
                kept.add(c)
            }
        }
        return kept.sortedWith(compareByDescending<Candidate> { it.score }.thenByDescending { it.name.length })
    }

    // ------------------------------------------------------------------ shared

    fun squash(s: String): String = s.lowercase().replace(Regex("[^a-z0-9]"), "")

    /** Punctuation-insensitive containment, so "ForgeCode" matches "forge code". */
    fun contains(haystack: String, needle: String): Boolean {
        val n = squash(needle)
        return n.length >= 3 && squash(haystack).contains(n)
    }

    fun isBoilerplate(value: String): Boolean {
        val tokens = value.lowercase()
            .split(Regex("[^a-z0-9.+#]+"))
            .filter { it.isNotBlank() }
        if (tokens.isEmpty()) return true
        return tokens.all { it in BOILERPLATE_TOKENS }
    }

    private fun clean(raw: String): String? {
        val name = raw.trim()
            .trim('*', '"', '`', '.', ',', ':', '-', '_', '(', ')', '[', ']')
            .replace(Regex("\\s+"), " ")
        if (name.length < 3 || name.length > 40) return null
        if (!name.first().isLetter()) return null
        if (name.any { !it.isLetterOrDigit() && it != ' ' && it != '-' && it != '.' && it != '+' && it != '#' }) return null
        return name
    }

    /** forgecode.dev/cli -> forgecode; github.com/x -> null (identifies nothing). */
    private fun domainLabel(url: String): String? {
        val host = url.removePrefix("https://").removePrefix("http://").removePrefix("www.")
            .substringBefore('/')
            .substringBefore('?')
        val parts = host.split('.').filter { it.isNotBlank() }
        if (parts.size < 2) return null
        val label = parts[parts.size - 2]
        if (label.lowercase() in GENERIC_HOSTS) return null
        return label
    }

    private fun fmt(v: Float): String = ((v * 100).toInt() / 100f).toString()
}
