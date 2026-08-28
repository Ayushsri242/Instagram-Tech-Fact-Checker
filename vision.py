import os
import re
import glob
import subprocess
from typing import Dict, Any, List, Set
from rapidocr_onnxruntime import RapidOCR

_ocr_engine = None

def get_ocr_engine() -> RapidOCR:
    global _ocr_engine
    if _ocr_engine is None:
        _ocr_engine = RapidOCR()
    return _ocr_engine

def extract_frames(video_path: str, fps: float = 0.5, max_frames: int = 10) -> List[str]:
    """
    Extract 1 frame every 2 seconds using ffmpeg.
    """
    if not os.path.exists(video_path):
        return []

    base_dir = os.path.dirname(video_path)
    video_name = os.path.splitext(os.path.basename(video_path))[0]
    frames_dir = os.path.join(base_dir, "frames", video_name)
    os.makedirs(frames_dir, exist_ok=True)

    # Clean old frames
    for f in glob.glob(os.path.join(frames_dir, "*.jpg")):
        try:
            os.remove(f)
        except Exception:
            pass

    out_pattern = os.path.join(frames_dir, "frame_%03d.jpg")
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vf", f"fps={fps}",
        "-vframes", str(max_frames),
        "-q:v", "3",
        out_pattern
    ]

    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    except Exception as e:
        print(f"FFmpeg frame extraction error: {e}")

    return sorted(glob.glob(os.path.join(frames_dir, "*.jpg")))

def stitch_broken_ocr_lines(raw_lines: List[str]) -> List[str]:
    """
    Intelligently stitch broken words or repo slugs split across consecutive OCR bounding boxes.
    e.g. 'StarLightSearch/EmbedAnyth' + 'ing' -> 'StarLightSearch/EmbedAnything'
    """
    if not raw_lines:
        return []
    
    stitched: List[str] = []
    i = 0
    while i < len(raw_lines):
        curr = raw_lines[i]
        if i + 1 < len(raw_lines):
            nxt = raw_lines[i + 1]
            # Case 1: Repo slug split (e.g. 'Owner/Rep' + 'o' or 'Owner/' + 'Repo')
            if "/" in curr and not nxt.startswith("http") and len(nxt) <= 12 and not nxt.startswith("@") and not nxt.startswith("$"):
                # If current ends abruptly mid-word or next is a short suffix
                if curr.endswith("/") or (len(nxt) <= 8 and nxt.isalpha() and not nxt.isupper()):
                    curr = curr + nxt
                    i += 1
            # Case 2: Hyphenated word split
            elif curr.endswith("-") and nxt.isalpha():
                curr = curr[:-1] + nxt
                i += 1
        stitched.append(curr)
        i += 1
    return stitched

def extract_text_from_frames(frame_paths: List[str]) -> Dict[str, Any]:
    """
    Run RapidOCR on extracted video frames.
    Filters duplicates, extracts URLs, repo names, and on-screen code/text with line stitching.
    """
    engine = get_ocr_engine()
    seen_lines: Set[str] = set()
    detected_texts: List[str] = []
    urls_found: Set[str] = set()
    repos_found: Set[str] = set()

    url_regex = re.compile(r"(?:https?://|www\.)[^\s/$.?#].[^\s]*|[a-zA-Z0-9-]+\.(?:com|io|ai|org|dev|app|net|co)(?:/[^\s]*)?", re.IGNORECASE)
    repo_regex = re.compile(r"\b([a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+)\b")

    for img_path in frame_paths:
        try:
            result, _ = engine(img_path)
            if not result:
                continue
            
            frame_lines: List[str] = []
            for item in result:
                text = item[1].strip()
                score = float(item[2])
                if score >= 0.60 and len(text) > 1:
                    frame_lines.append(text)

            stitched_lines = stitch_broken_ocr_lines(frame_lines)

            for text in stitched_lines:
                if text.lower() not in seen_lines:
                    seen_lines.add(text.lower())
                    detected_texts.append(text)

                # Detect URLs
                for match in url_regex.finditer(text):
                    urls_found.add(match.group(0))

                # Detect GitHub-style owner/repo slugs
                for match in repo_regex.finditer(text):
                    slug = match.group(1)
                    if "/" in slug and not slug.startswith("http") and not slug.startswith("pip/"):
                        repos_found.add(slug)

        except Exception as e:
            print(f"OCR error on frame {img_path}: {e}")

    return {
        "frame_count": len(frame_paths),
        "on_screen_text": detected_texts,
        "combined_ocr_text": " | ".join(detected_texts),
        "urls_detected": list(urls_found),
        "repos_detected": list(repos_found)
    }

def analyze_media_frames(path_or_dir: str) -> Dict[str, Any]:
    """Extract and OCR text from either a video file or a directory of carousel image slides."""
    if not path_or_dir or not os.path.exists(path_or_dir):
        return {"frame_count": 0, "on_screen_text": [], "combined_ocr_text": "", "urls_detected": []}

    if os.path.isdir(path_or_dir):
        images = sorted(glob.glob(os.path.join(path_or_dir, "*.jpg")) + glob.glob(os.path.join(path_or_dir, "*.png")))
        return extract_text_from_frames(images)
    
    # Video file
    frames = extract_frames(path_or_dir, fps=0.5, max_frames=8)
    return extract_text_from_frames(frames)

def analyze_video_frames(video_path: str) -> Dict[str, Any]:
    """Backwards compatible alias."""
    return analyze_media_frames(video_path)

if __name__ == "__main__":
    import sys
    test_vid = sys.argv[1] if len(sys.argv) > 1 else ""
    if test_vid and os.path.exists(test_vid):
        res = analyze_video_frames(test_vid)
        print("Frames analyzed:", res["frame_count"])
        print("Detected text:", res["on_screen_text"])
        print("URLs detected:", res["urls_detected"])
    else:
        print("Please provide path to a .mp4 video file to test vision.py")
