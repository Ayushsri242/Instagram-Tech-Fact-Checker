import os
import re
from typing import Dict, Any, Optional
import yt_dlp

DOWNLOADS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "downloads")

def extract_shortcode(url: str) -> str:
    """Extract a short identifier or hash from URL."""
    ig_match = re.search(r"(?:reel|p|share/reel)/([A-Za-z0-9_-]+)", url)
    if ig_match:
        return ig_match.group(1)
    
    yt_match = re.search(r"(?:shorts/|v=)([A-Za-z0-9_-]+)", url)
    if yt_match:
        return yt_match.group(1)
    
    import hashlib
    return hashlib.md5(url.encode()).hexdigest()[:10]

COOKIE_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "www.instagram.com_cookies.txt")


def cookie_file() -> str:
    """Path to the exported Instagram cookie jar, or "" when it is absent.

    Some posts return an empty media response to both yt-dlp and Instaloader
    while other posts fetch fine from the same IP in the same minute, so the
    cause is the post being login-gated, not rate limiting. A logged-in session
    is the only keyless way past that. The file is gitignored and never staged.
    """
    return COOKIE_FILE if os.path.exists(COOKIE_FILE) else ""


def load_cookies_into(L) -> None:
    """Give an Instaloader instance the exported browser session."""
    path = cookie_file()
    if not path:
        return
    import http.cookiejar
    jar = http.cookiejar.MozillaCookieJar(path)
    jar.load(ignore_discard=True, ignore_expires=True)
    L.context._session.cookies.update(jar)


def download_carousel(url: str, output_dir: str = DOWNLOADS_DIR) -> Dict[str, Any]:
    """Download Instagram carousel / image post slides via Instaloader."""
    import instaloader
    shortcode = extract_shortcode(url)
    frames_dir = os.path.join(output_dir, "frames", shortcode)
    os.makedirs(frames_dir, exist_ok=True)

    L = instaloader.Instaloader(
        dirname_pattern=os.path.join(output_dir, "frames", "{target}"),
        download_videos=False,
        save_metadata=False,
        download_comments=False,
        download_geotags=False,
        quiet=True
    )
    load_cookies_into(L)

    post = instaloader.Post.from_shortcode(L.context, shortcode)
    L.download_post(post, target=shortcode)
    
    return {
        "id": shortcode,
        "source_url": url,
        "title": (post.caption[:80] + "...") if post.caption else "Instagram Carousel Post",
        "author": post.owner_username or "Unknown",
        "duration_seconds": 0.0,
        "is_carousel": True,
        "caption": post.caption or "",
        "frames_dir": frames_dir,
        "video_path": None,
        "audio_path": None
    }

def download_media(url: str, output_dir: str = DOWNLOADS_DIR) -> Dict[str, Any]:
    """
    Download video stream and audio from Instagram Reel or YouTube Short using yt-dlp.
    Falls back to Instaloader for multi-slide Image/Carousel posts.
    """
    os.makedirs(output_dir, exist_ok=True)
    video_id = extract_shortcode(url)
    out_template = os.path.join(output_dir, f"{video_id}.%(ext)s")

    ydl_opts = {
        "format": "best[ext=mp4]/best",
        "outtmpl": out_template,
        "quiet": True,
        "no_warnings": True,
    }
    if cookie_file():
        ydl_opts["cookiefile"] = cookie_file()

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            if info is None:
                raise ValueError("No video info returned")
            
            video_file = os.path.join(output_dir, f"{video_id}.mp4")
            audio_file = os.path.join(output_dir, f"{video_id}.mp3")
            
            if os.path.exists(video_file) and not os.path.exists(audio_file):
                import subprocess
                cmd = ["ffmpeg", "-y", "-i", video_file, "-vn", "-ar", "16000", "-ac", "1", "-b:a", "128k", audio_file]
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            
            return {
                "id": video_id,
                "source_url": url,
                "title": info.get("title") or info.get("description", "")[:80] or "Instagram Reel",
                "author": info.get("uploader") or info.get("channel") or "Unknown",
                "duration_seconds": info.get("duration", 0.0),
                "is_carousel": False,
                "video_path": video_file,
                "audio_path": audio_file if os.path.exists(audio_file) else video_file
            }
    except Exception as e:
        # Fallback to carousel downloader
        if "/p/" in url or "No video formats found" in str(e):
            return download_carousel(url, output_dir)
        raise e

def download_audio(url: str, output_dir: str = DOWNLOADS_DIR) -> Dict[str, Any]:
    """Backwards compatible alias for download_media."""
    return download_media(url, output_dir)

if __name__ == "__main__":
    import sys
    test_url = sys.argv[1] if len(sys.argv) > 1 else "https://www.instagram.com/reel/DcXzQH5si-A/?igsi=OHppeWUyb2UyMQ=="
    print(f"Testing ingest on: {test_url}")
    try:
        result = download_audio(test_url)
        print("Success:")
        for k, v in result.items():
            print(f"  {k}: {v}")
    except Exception as e:
        print(f"Error during ingestion: {e}")
