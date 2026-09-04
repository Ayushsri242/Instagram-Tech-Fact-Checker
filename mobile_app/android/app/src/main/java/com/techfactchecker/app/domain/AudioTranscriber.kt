package com.techfactchecker.app.domain

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.util.Log
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineWhisperModelConfig
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

class AudioTranscriber(private val modelDir: File) {

    /** Decoded PCM plus everything we need to judge whether it is usable. */
    private data class Pcm(
        val samples: FloatArray,
        val sampleRate: Int,
        val channels: Int,
        val encoding: Int
    )

    private companion object {
        /**
         * Window length for chunked decoding. Short enough that a repetition
         * loop cannot swallow the whole clip, long enough to keep sentence
         * context. Whisper's own window is 30s and sherpa pads shorter input.
         */
        const val CHUNK_SECONDS = 12
    }

    /** Whisper sizes we know how to load, best first. */
    private val modelPrefixes = listOf("small", "base", "tiny")

    /**
     * Picks the largest Whisper model actually present. tiny hears the sentence
     * structure but gets every proper noun wrong, which is fatal here because
     * the product name is the whole job - so a bigger model, once downloaded,
     * should be used without any further code change.
     */
    private fun findModelSet(): Triple<File, File, File>? {
        for (prefix in modelPrefixes) {
            val encoder = File(modelDir, "$prefix-encoder.int8.onnx")
            val decoder = File(modelDir, "$prefix-decoder.int8.onnx")
            val tokens = File(modelDir, "$prefix-tokens.txt")
            if (encoder.exists() && decoder.exists() && tokens.exists()) {
                Log.i("TFC_DEBUG", "STT model: using '$prefix' (encoder=${encoder.length()} decoder=${decoder.length()})")
                return Triple(encoder, decoder, tokens)
            }
        }
        return null
    }

    fun transcribe(videoFile: File): String {
        val modelSet = findModelSet()
        if (modelSet == null) {
            Log.w("TFC_DEBUG", "STT skipped: Whisper model files missing")
            return ""
        }
        val (encoder, decoder, tokens) = modelSet
        return try {
            val pcm = decodeAudio(videoFile)
            if (pcm.samples.isEmpty()) return ""

            // Diagnostics: a wrong PCM encoding or a stereo mis-deinterleave turns
            // speech into noise, and Whisper answers noise with confident garbage
            // rather than an error. Log the shape and how loud it actually is.
            val peak = pcm.samples.fold(0f) { acc, s -> maxOf(acc, Math.abs(s)) }
            val rms = Math.sqrt(pcm.samples.fold(0.0) { acc, s -> acc + s * s } / pcm.samples.size)
            Log.i(
                "TFC_DEBUG",
                "STT audio: samples=${pcm.samples.size} rate=${pcm.sampleRate} ch=${pcm.channels} " +
                    "enc=${encodingName(pcm.encoding)} durationSec=${"%.1f".format(pcm.samples.size / pcm.sampleRate.toFloat())} " +
                    "peak=${"%.3f".format(peak)} rms=${"%.4f".format(rms)}"
            )
            dumpWav(pcm)

            val whisper = OfflineWhisperModelConfig(
                encoder = encoder.absolutePath,
                decoder = decoder.absolutePath,
                language = "",
                task = "transcribe"
            )
            val model = OfflineModelConfig(
                whisper = whisper,
                tokens = tokens.absolutePath,
                numThreads = 2,
                provider = "cpu"
            )
            val recognizer = OfflineRecognizer(null,
                OfflineRecognizerConfig(modelConfig = model, decodingMethod = "greedy_search")
            )
            val text = transcribeInChunks(recognizer, pcm)
            recognizer.release()
            Log.i("TFC_DEBUG", "STT complete: chars=${text.length}, sampleRate=${pcm.sampleRate}")
            text
        } catch (e: Exception) {
            Log.e("TFC_DEBUG", "STT failed: ${e.message}", e)
            ""
        }
    }

    /**
     * Transcribes the audio in short windows instead of one 28-second pass.
     *
     * sherpa-onnx only offers greedy decoding for Whisper. faster-whisper (the
     * web pipeline) survives the same audio because it adds beam search, a
     * temperature fallback and a compression-ratio check that detects a
     * repetition loop and retries. We have none of that, and on Hinglish audio
     * Whisper drifts, starts feeding its own output back, and emits the same
     * word for the rest of the clip - base produced "Claude Codec dindshad
     * pureon awal awal awal..." for 26 straight seconds.
     *
     * A fresh window resets that state, so a loop costs one chunk instead of
     * the whole transcript, and each chunk is checked before being kept.
     */
    private fun transcribeInChunks(recognizer: OfflineRecognizer, pcm: Pcm): String {
        val chunkSamples = pcm.sampleRate * CHUNK_SECONDS
        val minSamples = pcm.sampleRate                 // ignore a trailing sliver under 1s
        val kept = mutableListOf<String>()
        var start = 0
        var index = 0
        var dropped = 0

        while (start < pcm.samples.size) {
            val end = minOf(start + chunkSamples, pcm.samples.size)
            if (end - start < minSamples) break
            index++

            val slice = pcm.samples.copyOfRange(start, end)
            val stream = recognizer.createStream()
            val text = try {
                stream.acceptWaveform(slice, pcm.sampleRate)
                recognizer.decode(stream)
                recognizer.getResult(stream).text.trim()
            } finally {
                stream.release()
            }

            when {
                text.isBlank() ->
                    Log.i("TFC_DEBUG", "STT chunk $index: empty")
                isLooped(text) -> {
                    dropped++
                    Log.w("TFC_DEBUG", "STT chunk $index: dropped as repetition loop: ${text.take(80)}")
                }
                else -> {
                    kept.add(text)
                    Log.i("TFC_DEBUG", "STT chunk $index: kept ${text.length} chars: ${text.take(80)}")
                }
            }
            start = end
        }

        Log.i("TFC_DEBUG", "STT chunks: total=$index kept=${kept.size} dropped=$dropped")
        return kept.joinToString(" ")
    }

    /**
     * True when a chunk is mostly the same word or phrase over and over. Kept
     * separate from SourceEvidence.speechHealth because a legitimately short
     * chunk must not be thrown away for being short.
     */
    private fun isLooped(text: String): Boolean {
        val words = text.lowercase().split(Regex("[^a-z0-9']+")).filter { it.isNotBlank() }
        if (words.size < 8) return false
        if (words.distinct().size.toFloat() / words.size < 0.40f) return true
        if (words.size >= 12) {
            val shingles = (0..words.size - 3).map { words.subList(it, it + 3).joinToString(" ") }
            if (shingles.distinct().size.toFloat() / shingles.size < 0.50f) return true
        }
        return false
    }

    private fun encodingName(enc: Int): String = when (enc) {
        AudioFormat.ENCODING_PCM_8BIT -> "PCM_8BIT"
        AudioFormat.ENCODING_PCM_16BIT -> "PCM_16BIT"
        AudioFormat.ENCODING_PCM_FLOAT -> "PCM_FLOAT"
        else -> "UNKNOWN($enc)"
    }

    /**
     * Writes the exact mono float buffer we hand to Whisper as a 16-bit WAV, so a
     * bad transcript can be diagnosed by listening instead of by guessing:
     *   adb exec-out run-as com.techfactchecker.mobile \
     *       cat files/models/whisper-tiny/stt_debug.wav > stt_debug.wav
     */
    private fun dumpWav(pcm: Pcm) {
        try {
            val out = File(modelDir, "stt_debug.wav")
            val n = pcm.samples.size
            val dataBytes = n * 2
            val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
            header.put("RIFF".toByteArray())
            header.putInt(36 + dataBytes)
            header.put("WAVE".toByteArray())
            header.put("fmt ".toByteArray())
            header.putInt(16)
            header.putShort(1)                       // PCM
            header.putShort(1)                       // mono
            header.putInt(pcm.sampleRate)
            header.putInt(pcm.sampleRate * 2)        // byte rate
            header.putShort(2)                       // block align
            header.putShort(16)                      // bits per sample
            header.put("data".toByteArray())
            header.putInt(dataBytes)

            val body = ByteBuffer.allocate(dataBytes).order(ByteOrder.LITTLE_ENDIAN)
            for (s in pcm.samples) {
                body.putShort((s.coerceIn(-1f, 1f) * 32767f).toInt().toShort())
            }
            FileOutputStream(out).use {
                it.write(header.array())
                it.write(body.array())
            }
            Log.i("TFC_DEBUG", "STT audio dumped: ${out.absolutePath} bytes=${out.length()}")
        } catch (e: Exception) {
            Log.w("TFC_DEBUG", "STT audio dump failed: ${e.message}")
        }
    }

    private fun decodeAudio(videoFile: File): Pcm {
        val extractor = MediaExtractor()
        extractor.setDataSource(videoFile.absolutePath)
        var track = -1
        for (i in 0 until extractor.trackCount) {
            val format = extractor.getTrackFormat(i)
            if (format.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) {
                track = i
                break
            }
        }
        if (track < 0) {
            extractor.release()
            return Pcm(FloatArray(0), 16000, 1, AudioFormat.ENCODING_PCM_16BIT)
        }
        extractor.selectTrack(track)
        val format = extractor.getTrackFormat(track)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: throw Exception("Audio MIME missing")
        var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)

        // Ask for 16-bit explicitly. Some decoders (MediaTek included) otherwise
        // hand back PCM_FLOAT, and reading float bytes as shorts yields noise.
        format.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT)

        val codec = MediaCodec.createDecoderByType(mime)
        codec.configure(format, null, null, 0)
        codec.start()

        var encoding = AudioFormat.ENCODING_PCM_16BIT
        val output = ArrayList<Float>()
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var outputDone = false
        try {
            while (!outputDone) {
                if (!inputDone) {
                    val inputIndex = codec.dequeueInputBuffer(10_000)
                    if (inputIndex >= 0) {
                        val input = codec.getInputBuffer(inputIndex)!!
                        val size = extractor.readSampleData(input, 0)
                        if (size < 0) {
                            codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(inputIndex, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val outputIndex = codec.dequeueOutputBuffer(info, 10_000)
                if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    // The real layout is only known here; the input format lies.
                    val out = codec.outputFormat
                    if (out.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                        encoding = out.getInteger(MediaFormat.KEY_PCM_ENCODING)
                    }
                    if (out.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                        sampleRate = out.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    }
                    if (out.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                        channels = out.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    }
                    Log.i("TFC_DEBUG", "STT decoder output format: rate=$sampleRate ch=$channels enc=${encodingName(encoding)}")
                } else if (outputIndex >= 0) {
                    val buffer = codec.getOutputBuffer(outputIndex)
                    if (buffer != null && info.size > 0) {
                        buffer.position(info.offset)
                        buffer.limit(info.offset + info.size)
                        readSamples(buffer, encoding, channels, output)
                    }
                    codec.releaseOutputBuffer(outputIndex, false)
                    if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true
                }
            }
        } finally {
            codec.stop(); codec.release(); extractor.release()
        }
        return Pcm(output.toFloatArray(), sampleRate, channels, encoding)
    }

    /** Downmixes to mono in whatever sample format the decoder actually produced. */
    private fun readSamples(
        buffer: ByteBuffer,
        encoding: Int,
        channels: Int,
        output: ArrayList<Float>
    ) {
        val safeChannels = if (channels > 0) channels else 1
        when (encoding) {
            AudioFormat.ENCODING_PCM_FLOAT -> {
                val pcm = buffer.order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
                while (pcm.hasRemaining()) {
                    var sample = 0f
                    var read = 0
                    repeat(safeChannels) { if (pcm.hasRemaining()) { sample += pcm.get(); read++ } }
                    if (read > 0) output.add(sample / read)
                }
            }
            AudioFormat.ENCODING_PCM_8BIT -> {
                val pcm = buffer.order(ByteOrder.LITTLE_ENDIAN)
                while (pcm.hasRemaining()) {
                    var sample = 0f
                    var read = 0
                    repeat(safeChannels) {
                        if (pcm.hasRemaining()) {
                            // 8-bit PCM is unsigned, centred on 128.
                            sample += ((pcm.get().toInt() and 0xFF) - 128) / 128f
                            read++
                        }
                    }
                    if (read > 0) output.add(sample / read)
                }
            }
            else -> {
                val pcm = buffer.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
                while (pcm.hasRemaining()) {
                    var sample = 0f
                    var read = 0
                    repeat(safeChannels) { if (pcm.hasRemaining()) { sample += pcm.get() / 32768f; read++ } }
                    if (read > 0) output.add(sample / read)
                }
            }
        }
    }
}
