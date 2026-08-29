package com.techfactchecker.app.domain

import android.graphics.Bitmap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.regex.Pattern
import kotlin.coroutines.resume

data class OcrResult(
    val fullText: String,
    val lines: List<String>,
    val detectedRepos: List<String>,
    val detectedUrls: List<String>
)

class OcrEngine {
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private val urlPattern = Pattern.compile("(?:https?://|www\\.)[^\\s/$.?#].[^\\s]*|[a-zA-Z0-9-]+\\.(?:com|io|ai|org|dev|app|net|co)(?:/[^\\s]*)?", Pattern.CASE_INSENSITIVE)
    private val repoPattern = Pattern.compile("\\b([a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+)\\b")

    suspend fun processImage(bitmap: Bitmap): OcrResult = suspendCancellableCoroutine { continuation ->
        val image = InputImage.fromBitmap(bitmap, 0)
        recognizer.process(image)
            .addOnSuccessListener { visionText ->
                val rawLines = visionText.textBlocks.flatMap { block -> block.lines.map { it.text.trim() } }
                val stitchedLines = stitchBrokenLines(rawLines)
                val fullText = stitchedLines.joinToString(" | ")

                val urls = mutableSetOf<String>()
                val urlMatcher = urlPattern.matcher(fullText)
                while (urlMatcher.find()) {
                    urls.add(urlMatcher.group())
                }

                val repos = mutableSetOf<String>()
                val repoMatcher = repoPattern.matcher(fullText)
                while (repoMatcher.find()) {
                    val slug = repoMatcher.group(1)
                    if (slug != null && !slug.startsWith("http") && !slug.startsWith("pip/") && !slug.startsWith("api/")) {
                        repos.add(slug)
                    }
                }

                continuation.resume(
                    OcrResult(
                        fullText = fullText,
                        lines = stitchedLines,
                        detectedRepos = repos.toList(),
                        detectedUrls = urls.toList()
                    )
                )
            }
            .addOnFailureListener { e ->
                continuation.resume(
                    OcrResult(
                        fullText = "",
                        lines = emptyList(),
                        detectedRepos = emptyList(),
                        detectedUrls = emptyList()
                    )
                )
            }
    }

    private fun stitchBrokenLines(rawLines: List<String>): List<String> {
        if (rawLines.isEmpty()) return emptyList()
        val stitched = mutableListOf<String>()
        var i = 0
        while (i < rawLines.size) {
            var curr = rawLines[i]
            if (i + 1 < rawLines.size) {
                val nxt = rawLines[i + 1]
                if (curr.contains("/") && !nxt.startsWith("http") && nxt.length <= 12 && !nxt.startsWith("@") && !nxt.startsWith("$")) {
                    if (curr.endsWith("/") || (nxt.length <= 8 && nxt.all { it.isLetter() } && !nxt.all { it.isUpperCase() })) {
                        curr += nxt
                        i++
                    }
                } else if (curr.endsWith("-") && nxt.all { it.isLetter() }) {
                    curr = curr.dropLast(1) + nxt
                    i++
                }
            }
            stitched.add(curr)
            i++
        }
        return stitched
    }
}
