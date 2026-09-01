package com.techfactchecker.app.domain

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.util.Log
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineWhisperModelConfig
import java.io.File
import java.nio.ByteOrder

class AudioTranscriber(private val modelDir: File) {
    fun transcribe(videoFile: File): String {
        val encoder = File(modelDir, "tiny-encoder.int8.onnx")
        val decoder = File(modelDir, "tiny-decoder.int8.onnx")
        val tokens = File(modelDir, "tiny-tokens.txt")
        if (!encoder.exists() || !decoder.exists() || !tokens.exists()) {
            Log.w("TFC_DEBUG", "STT skipped: Whisper model files missing")
            return ""
        }
        return try {
            val (samples, sampleRate) = decodeAudio(videoFile)
            if (samples.isEmpty()) return ""
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
            val stream = recognizer.createStream()
            stream.acceptWaveform(samples, sampleRate)
            recognizer.decode(stream)
            val text = recognizer.getResult(stream).text.trim()
            stream.release()
            recognizer.release()
            Log.i("TFC_DEBUG", "STT complete: chars=${text.length}, sampleRate=$sampleRate")
            text
        } catch (e: Exception) {
            Log.e("TFC_DEBUG", "STT failed: ${e.message}", e)
            ""
        }
    }

    private fun decodeAudio(videoFile: File): Pair<FloatArray, Int> {
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
        if (track < 0) { extractor.release(); return Pair(FloatArray(0), 16000) }
        extractor.selectTrack(track)
        val format = extractor.getTrackFormat(track)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: throw Exception("Audio MIME missing")
        val sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        val channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        val codec = MediaCodec.createDecoderByType(mime)
        codec.configure(format, null, null, 0)
        codec.start()
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
                if (outputIndex >= 0) {
                    val buffer = codec.getOutputBuffer(outputIndex)
                    if (buffer != null && info.size > 0) {
                        buffer.position(info.offset)
                        buffer.limit(info.offset + info.size)
                        val pcm = buffer.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
                        while (pcm.hasRemaining()) {
                            var sample = 0f
                            repeat(channels) { if (pcm.hasRemaining()) sample += pcm.get() / 32768f }
                            output.add(sample / channels)
                        }
                    }
                    codec.releaseOutputBuffer(outputIndex, false)
                    if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true
                }
            }
        } finally {
            codec.stop(); codec.release(); extractor.release()
        }
        return Pair(output.toFloatArray(), sampleRate)
    }
}
