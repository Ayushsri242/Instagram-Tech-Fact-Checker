"""
System 1 - ground truth capture.

Pulls an Instagram reel or carousel and lays out everything a human (or an agent
with eyes) needs to say what the post is actually about, WITHOUT running any of
the fact-checker's own OCR, STT, prompts or scoring.

That independence is the whole point. The mobile app and the Streamlit app share
prompts and logic, so if both are wrong they are wrong in the same way and
comparing them teaches nothing. This script only downloads and cuts frames -
the reading and the judging happen outside it.

Usage:
    python ground_truth.py "https://www.instagram.com/reel/XXXXXXXX/"
    python ground_truth.py "<url>" --frames 16

Output:
    ground_truth/<shortcode>/
        frame_00.jpg ... frame_NN.jpg   evenly spaced, readable size
        audio.wav                       16 kHz mono
        transcript.txt                  faster-whisper base, beam_size=5 (the reference ear)
        video.mp4                       the source, if it was a reel
        manifest.json                   caption, author, duration, frame timestamps
        REPORT.md                       blank template to fill in by hand
"""

import argparse
import json
import os
import shutil
import subprocess
import sys

from ingest import download_media, extract_shortcode

OUT_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ground_truth")


def find_ffmpeg():
    exe = shutil.which("ffmpeg")
    if not exe:
        sys.exit("ffmpeg not found on PATH. Install it, or add it to PATH, then retry.")
    return exe


def probe_duration(ffmpeg, path):
    """Duration via ffprobe if present, else parse ffmpeg's own stderr."""
    ffprobe = shutil.which("ffprobe")
    if ffprobe:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True)
        try:
            return float(out.stdout.strip())
        except ValueError:
            pass
    out = subprocess.run([ffmpeg, "-i", path], capture_output=True, text=True)
    for line in out.stderr.splitlines():
        if "Duration:" in line:
            clock = line.split("Duration:")[1].split(",")[0].strip()
            h, m, s = clock.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    return 0.0


def cut_frames(ffmpeg, video, out_dir, count):
    """
    Evenly spaced stills, one ffmpeg call each.

    One call per frame rather than a single fps filter because the reel's text
    often lives on a handful of frames only - on DchQA7CTapw just 1 of 10 - and
    exact, known timestamps make it obvious which second was missed.
    """
    duration = probe_duration(ffmpeg, video)
    if duration <= 0:
        sys.exit("Could not read video duration; cannot place frames.")

    frames = []
    for i in range(count):
        # Skip the very start and end, which are usually transitions.
        ts = duration * (i + 1) / (count + 1)
        name = "frame_{:02d}.jpg".format(i)
        path = os.path.join(out_dir, name)
        subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-ss", "{:.3f}".format(ts),
             "-i", video, "-frames:v", "1",
             # 720px wide keeps on-screen code and URLs readable while staying
             # small enough to look at quickly.
             "-vf", "scale=720:-2", "-q:v", "3", path],
            check=False)
        if os.path.exists(path):
            frames.append({"file": name, "at_seconds": round(ts, 2)})
        else:
            print("  warning: frame at {:.2f}s failed".format(ts))
    return duration, frames


def extract_audio(ffmpeg, video, out_dir):
    path = os.path.join(out_dir, "audio.wav")
    subprocess.run(
        [ffmpeg, "-y", "-loglevel", "error", "-i", video,
         "-vn", "-ac", "1", "-ar", "16000", path],
        check=False)
    return path if os.path.exists(path) else None


def transcribe_reference(audio_path, out_dir):
    """
    Reference transcript via faster-whisper.

    This is a different decoder from the mobile app's, not a copy of it: the app
    runs sherpa-onnx with greedy search and no fallback, while this runs
    faster-whisper base with beam_size=5 plus temperature fallback and a
    compression-ratio check that catches repetition loops. So comparing the two
    is not marking your own homework - it measures exactly the gap that Phase A
    of MIGRATION_PLAN.md exists to close.

    Optional: skipped with a note if faster-whisper is not importable, since the
    frames alone are still a usable ground truth.
    """
    try:
        from transcribe import transcribe_audio
    except ImportError as e:
        print("  transcript SKIPPED ({}). Run from the venv to enable it.".format(e))
        return None

    print("  transcribing with faster-whisper (this is the slow step)...")
    try:
        result = transcribe_audio(audio_path)
    except Exception as e:
        print("  transcript FAILED: {}".format(e))
        return None

    text = (result.get("text") or "").strip() if isinstance(result, dict) else str(result).strip()
    with open(os.path.join(out_dir, "transcript.txt"), "w", encoding="utf-8") as f:
        f.write(text)
    print("  transcript.txt written ({} chars)".format(len(text)))
    return {"text": text, "language": result.get("language") if isinstance(result, dict) else None}


REPORT_TEMPLATE = """# Ground truth - {shortcode}

Source: {url}
Author: {author}
Duration: {duration}s
Frames: {n_frames}

Fill this in from the frames and the audio. Do NOT look at the app's output
first - that defeats the comparison.

## What is this post actually about?

(one sentence)

## What does it claim?

-

## Is it true?

Verdict (TRUE / PARTIALLY_TRUE / HYPE / MISLEADING / FAKE):

Why:

## Which frames carried the useful text?

(e.g. "only frame_07")

## Notes

(anything the app would plausibly get wrong)
"""


def main():
    ap = argparse.ArgumentParser(description="Capture ground truth for one Instagram post.")
    ap.add_argument("url")
    ap.add_argument("--frames", type=int, default=12, help="how many stills to cut (default 12)")
    ap.add_argument("--no-transcript", action="store_true", help="skip faster-whisper (frames only, much faster)")
    args = ap.parse_args()

    ffmpeg = find_ffmpeg()
    shortcode = extract_shortcode(args.url)
    out_dir = os.path.join(OUT_ROOT, shortcode)
    os.makedirs(out_dir, exist_ok=True)
    print("Capturing {} -> {}".format(shortcode, out_dir))

    media = download_media(args.url)
    print("  downloaded: {}".format("carousel" if media.get("is_carousel") else "video"))

    manifest = {
        "shortcode": shortcode,
        "source_url": args.url,
        "title": media.get("title", ""),
        "author": media.get("author", ""),
        "caption": media.get("caption", ""),
        "is_carousel": bool(media.get("is_carousel")),
        "frames": [],
        "duration_seconds": media.get("duration_seconds", 0.0),
    }

    if media.get("is_carousel"):
        # Slides are already images; copy them in rather than re-encoding.
        src = media.get("frames_dir") or ""
        n = 0
        for name in sorted(os.listdir(src)) if os.path.isdir(src) else []:
            if name.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                dst = "frame_{:02d}{}".format(n, os.path.splitext(name)[1])
                shutil.copyfile(os.path.join(src, name), os.path.join(out_dir, dst))
                manifest["frames"].append({"file": dst, "slide": n})
                n += 1
        print("  slides copied: {}".format(n))
    else:
        video = media.get("video_path")
        if not video or not os.path.exists(video):
            sys.exit("No video file produced by ingest.download_media.")
        local_video = os.path.join(out_dir, "video.mp4")
        if os.path.abspath(video) != os.path.abspath(local_video):
            shutil.copyfile(video, local_video)
        duration, frames = cut_frames(ffmpeg, local_video, out_dir, args.frames)
        manifest["duration_seconds"] = round(duration, 2)
        manifest["frames"] = frames
        print("  frames cut: {} over {:.1f}s".format(len(frames), duration))
        audio = extract_audio(ffmpeg, local_video, out_dir)
        if audio:
            print("  audio.wav written (16 kHz mono)")
            if not args.no_transcript:
                ref = transcribe_reference(audio, out_dir)
                if ref:
                    manifest["reference_transcript"] = ref["text"]
                    manifest["reference_transcript_language"] = ref.get("language")
                    manifest["reference_transcript_engine"] = "faster-whisper base, beam_size=5"

    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    report = os.path.join(out_dir, "REPORT.md")
    if not os.path.exists(report):
        with open(report, "w", encoding="utf-8") as f:
            f.write(REPORT_TEMPLATE.format(
                shortcode=shortcode, url=args.url,
                author=manifest["author"] or "unknown",
                duration=manifest["duration_seconds"],
                n_frames=len(manifest["frames"])))

    print("\nDone. Next:")
    print("  {}".format(out_dir))
    print("  Caption captured: {} chars".format(len(manifest["caption"])))
    print("  Give that folder path to the agent for the System 1 reading.")


if __name__ == "__main__":
    main()
