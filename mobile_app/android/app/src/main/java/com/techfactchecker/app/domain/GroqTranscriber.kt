package com.techfactchecker.app.domain

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.TimeUnit

/**
 * Speech to text through Groq's hosted Whisper, using the same API key as the LLM.
 *
 * Replaced the on-device sherpa-onnx Whisper: that needed a 160 MB model download
 * per tester and 11.5 MB of native libraries in the APK, and it ran Whisper
 * base, which gets proper nouns wrong - the product name is the whole job.
 * Groq runs whisper-large-v3.
 */
class GroqTranscriber {

    companion object {
        private const val TAG = "TFC_DEBUG"
        private const val ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions"
        private const val MODEL = "whisper-large-v3"
        /** Groq's free-tier upload cap. */
        private const val MAX_BYTES = 25L * 1024 * 1024
        /**
         * Whisper answers silence and music with confident filler ("Thank you.",
         * and on set 3, Welsh). Groq reports per segment how likely it is that
         * nobody was speaking; drop the segments it says are not speech.
         */
        private const val NO_SPEECH_MAX = 0.6
        /** Shorter than this is noise (music, a breath), not speech. */
        private const val MIN_SPEECH_CHARS = 20
        /** Groq's prompt limit is 224 tokens; the caption's opening is enough. */
        private const val PROMPT_CHARS = 500
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(90, TimeUnit.SECONDS)
        .build()

    /** One line for the CSV run log: what happened, so a blank transcript is explained. */
    var lastStats: String = ""
        private set

    /**
     * @param caption the post's caption, sent as Whisper's spelling hint so the
     *   product name the creator typed is the one the transcript spells.
     */
    fun transcribe(videoFile: File, apiKey: String, caption: String): String {
        lastStats = ""
        if (apiKey.isBlank()) {
            lastStats = "skipped: no api key"
            return ""
        }
        val audio = File(videoFile.parentFile, videoFile.nameWithoutExtension + ".m4a")
        try {
            // The audio track alone, copied without re-encoding: a reel's
            // audio is about 1 MB a minute, its video often over 25 MB.
            val upload = when {
                extractAudio(videoFile, audio) -> audio
                videoFile.length() <= MAX_BYTES -> videoFile
                else -> {
                    lastStats = "skipped: no audio track"
                    return ""
                }
            }
            if (upload.length() > MAX_BYTES) {
                lastStats = "skipped: audio ${upload.length() / 1024} kB over the 25 MB cap"
                return ""
            }

            val body = MultipartBody.Builder().setType(MultipartBody.FORM)
                .addFormDataPart("model", MODEL)
                .addFormDataPart("response_format", "verbose_json")
                .addFormDataPart("temperature", "0")
                .addFormDataPart("prompt", spellingHint(caption))
                .addFormDataPart("file", upload.name, upload.asRequestBody("audio/mp4".toMediaType()))
                .build()

            var json: JSONObject? = null
            for (attempt in 1..2) {
                val request = Request.Builder().url(ENDPOINT)
                    .header("Authorization", "Bearer $apiKey")
                    .post(body)
                    .build()
                client.newCall(request).execute().use { res ->
                    val text = res.body?.string() ?: ""
                    if (res.code == 429 && attempt == 1) {
                        // Groq says how long to wait; honour it once, briefly.
                        val wait = res.header("retry-after")?.toDoubleOrNull() ?: 5.0
                        Log.w(TAG, "STT: Groq rate limit, retrying in ${wait}s")
                        Thread.sleep((wait.coerceAtMost(20.0) * 1000).toLong())
                    } else if (!res.isSuccessful) {
                        lastStats = "groq error ${res.code}: ${text.take(120)}"
                        Log.w(TAG, "STT: $lastStats")
                        return ""
                    } else {
                        json = JSONObject(text)
                    }
                }
                if (json != null) break
            }
            val result = json ?: run { lastStats = "groq rate limited twice"; return "" }

            val segments = result.optJSONArray("segments")
            val kept = mutableListOf<String>()
            var dropped = 0
            if (segments != null) {
                for (i in 0 until segments.length()) {
                    val s = segments.getJSONObject(i)
                    val text = s.optString("text").trim()
                    if (s.optDouble("no_speech_prob", 0.0) > NO_SPEECH_MAX || isStockFiller(text)) dropped++
                    else kept.add(text)
                }
            }
            var transcript = if (segments != null) kept.joinToString(" ").trim()
                else result.optString("text").trim().let { if (isStockFiller(it)) "" else it }
            // A music-only reel still comes back with a scrap of text - the
            // PixelFriend demo (no voice at all) returned 1-6 characters of
            // Tamil script on each of three runs. Nobody says anything checkable
            // in under 20 characters; treat it as no speech.
            if (transcript.length in 1 until MIN_SPEECH_CHARS) {
                Log.i(TAG, "STT: dropped ${transcript.length}-char transcript as non-speech")
                transcript = ""
            }
            lastStats = "groq $MODEL upload=${upload.length() / 1024}kB " +
                "duration=${"%.1f".format(result.optDouble("duration", 0.0))}s " +
                "segments=${kept.size + dropped} dropped_no_speech=$dropped chars=${transcript.length}"
            Log.i(TAG, "STT: $lastStats")
            return transcript
        } catch (e: Exception) {
            lastStats = "error: ${e.javaClass.simpleName}: ${e.message?.take(100)}"
            Log.w(TAG, "STT: $lastStats", e)
            return ""
        } finally {
            audio.delete()
        }
    }

    /**
     * The caption as a spelling hint, minus what creators write for the
     * algorithm rather than the viewer: hashtags, @mentions, and "comment X /
     * follow / link in bio" lines. Whisper can echo prompt text into the
     * transcript, and those words are not what the video says.
     */
    private fun spellingHint(caption: String): String =
        caption.lines()
            .filterNot { Regex("(?i)\\b(comment|follow|link in bio|dm me|save this|share this)\\b").containsMatchIn(it) }
            .joinToString(" ")
            .replace(Regex("[#@][\\w.]+"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
            .take(PROMPT_CHARS)

    /**
     * Whisper's well-known inventions over music or silence - it was trained on
     * subtitled videos, so it "hears" their sign-offs. The "22 NLP techniques"
     * carousel (no voice at all) came back as "Thanks for watching!", exactly
     * 20 characters, which slipped past the length check.
     */
    private val STOCK_FILLERS = setOf(
        "thanks for watching", "thank you for watching", "thanks for watching and see you next time",
        "thank you", "thanks", "thank you so much", "please subscribe", "subscribe to my channel",
        "like and subscribe", "dont forget to like and subscribe", "see you next time", "bye", "you",
        "subtitles by the amaraorg community"
    )

    private fun isStockFiller(text: String): Boolean {
        val norm = text.lowercase().replace(Regex("[^a-z ]"), "").replace(Regex("\\s+"), " ").trim()
        return norm.isEmpty() || norm in STOCK_FILLERS
    }

    /** Copies the first audio track into an .m4a container. False if there is none. */
    private fun extractAudio(video: File, out: File): Boolean {
        val extractor = MediaExtractor()
        var muxer: MediaMuxer? = null
        try {
            extractor.setDataSource(video.absolutePath)
            val track = (0 until extractor.trackCount).firstOrNull {
                extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: return false
            extractor.selectTrack(track)
            val format = extractor.getTrackFormat(track)
            muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            val dst = muxer.addTrack(format)
            muxer.start()
            val buffer = ByteBuffer.allocate(1 shl 20)
            val info = MediaCodec.BufferInfo()
            while (true) {
                val size = extractor.readSampleData(buffer, 0)
                if (size < 0) break
                info.set(0, size, extractor.sampleTime, extractor.sampleFlags)
                muxer.writeSampleData(dst, buffer, info)
                extractor.advance()
            }
            muxer.stop()
            return out.length() > 0
        } catch (e: Exception) {
            // Not AAC, or a container the muxer refuses: the caller uploads the
            // video itself when it is small enough.
            Log.w(TAG, "STT: audio extraction failed, ${e.message}")
            out.delete()
            return false
        } finally {
            try { muxer?.release() } catch (e: Exception) { }
            extractor.release()
        }
    }
}
