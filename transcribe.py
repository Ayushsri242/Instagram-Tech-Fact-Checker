import os
from typing import Dict, Any, List
from faster_whisper import WhisperModel

def transcribe_audio(audio_path: str, model_size: str = "base") -> Dict[str, Any]:
    """
    Transcribe audio offline using faster-whisper.
    Auto-detects GPU (CUDA) and falls back safely to CPU.
    """
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    try:
        # Attempt GPU acceleration with float16 or int8
        model = WhisperModel(model_size, device="cuda", compute_type="float16")
    except Exception as e:
        # Fallback to CPU with int8 quantization (lightweight, fits 8GB RAM)
        print(f"CUDA initialization failed ({e}). Falling back to CPU.")
        model = WhisperModel(model_size, device="cpu", compute_type="int8")

    segments, info = model.transcribe(audio_path, beam_size=5)

    segment_list: List[Dict[str, Any]] = []
    full_text_parts: List[str] = []

    for seg in segments:
        text = seg.text.strip()
        segment_list.append({
            "start": round(seg.start, 2),
            "end": round(seg.end, 2),
            "text": text
        })
        full_text_parts.append(text)

    full_text = " ".join(full_text_parts).strip()

    return {
        "text": full_text,
        "language": info.language,
        "language_probability": round(info.language_probability, 2),
        "duration": round(info.duration, 2),
        "segments": segment_list
    }

if __name__ == "__main__":
    import sys
    test_audio = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "downloads", "DcXzQH5si-A.mp3")
    print(f"Testing transcription on: {test_audio}")
    try:
        res = transcribe_audio(test_audio)
        print("\nTranscription Result:")
        print(f"Language: {res['language']} (Prob: {res['language_probability']})")
        print(f"Duration: {res['duration']}s")
        print(f"Full Text:\n{res['text']}")
    except Exception as ex:
        print(f"Transcription error: {ex}")
