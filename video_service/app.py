from flask import Flask, request, jsonify, send_file
import subprocess
import os
import re
import tempfile
import shutil
import http.cookiejar
import instaloader

app = Flask(__name__)


def instaloader_with_cookies():
    """An Instaloader that uses the same Instagram session as yt-dlp.

    Only the yt-dlp (video) path used INSTAGRAM_COOKIES. Image posts went to
    Instaloader anonymously, and from a cloud server Instagram refuses that:
    every image/carousel fallback failed with "Fetching Post metadata failed"
    (Oct 7) while reels on the same service worked. Loading the cookie file
    into Instaloader's session is the difference.
    """
    L = instaloader.Instaloader(
        download_videos=False,
        save_metadata=False,
        download_comments=False,
        download_geotags=False,
        quiet=True
    )
    cookies_content = os.environ.get("INSTAGRAM_COOKIES", "")
    if cookies_content:
        cookie_file = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False)
        try:
            cookie_file.write(cookies_content)
            cookie_file.close()
            jar = http.cookiejar.MozillaCookieJar(cookie_file.name)
            jar.load(ignore_discard=True, ignore_expires=True)
            for cookie in jar:
                L.context._session.cookies.set_cookie(cookie)
        except Exception as e:
            print("Could not load INSTAGRAM_COOKIES into Instaloader:", e)
        finally:
            os.unlink(cookie_file.name)
    return L

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})

def extract_shortcode(url):
    match = re.search(r"(?:reel|p|share/reel)/([A-Za-z0-9_-]+)", url)
    if match:
        return match.group(1)
    return None

@app.route("/extract", methods=["POST"])
def extract_video_url():
    data = request.get_json()
    url = data.get("url", "")
    
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    # /p/ posts (carousels, image posts, feed videos): Instaloader first. It
    # returns every slide, the caption and the author. yt-dlp only knows single
    # videos and answered a 13-video-slide carousel with "Could not extract
    # video URL" (Oct 7). If Instaloader fails, yt-dlp still gets its turn below.
    if "/p/" in url:
        resp = extract_image_post(url)
        status = resp[1] if isinstance(resp, tuple) else 200
        if status == 200:
            return resp

    try:
        cmd = ["yt-dlp", "--dump-json", "-f", "best[ext=mp4]/best", "--no-warnings", "--no-check-certificates"]
        
        # Use Instagram cookies if available
        cookies_content = os.environ.get("INSTAGRAM_COOKIES", "")
        cookie_file = None
        
        if cookies_content:
            cookie_file = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False)
            cookie_file.write(cookies_content)
            cookie_file.close()
            cmd.extend(["--cookies", cookie_file.name])
        
        cmd.append(url)
        
        result = subprocess.run(
            cmd,
            capture_output=True, text=True, timeout=30
        )
        
        # Cleanup cookie file
        if cookie_file:
            os.unlink(cookie_file.name)
        
        if result.returncode != 0:
            error_msg = result.stderr.strip()
            # If no video formats found, it's likely an image/carousel post
            if "No video formats found" in error_msg or "/p/" in url:
                return extract_image_post(url)
            return jsonify({"error": error_msg}), 500
        
        import json
        try:
            info = json.loads(result.stdout.strip())
            video_url = info.get("url", "")
            caption = info.get("description", "")
        except json.JSONDecodeError:
            video_url = ""
            caption = ""
        
        if not video_url:
            return jsonify({"error": "Could not extract video URL"}), 500
        
        return jsonify({"video_url": video_url, "caption": caption, "type": "video"})
    
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Request timed out"}), 504
    except Exception as e:
        # Fallback to image extraction on any error
        try:
            return extract_image_post(url)
        except Exception as e2:
            return jsonify({"error": str(e2)}), 500


def extract_image_post(url):
    """Download Instagram image/carousel post via Instaloader and return image URLs."""
    shortcode = extract_shortcode(url)
    if not shortcode:
        return jsonify({"error": "Could not extract shortcode from URL"}), 400
    
    try:
        L = instaloader_with_cookies()
        post = instaloader.Post.from_shortcode(L.context, shortcode)
        
        # A single video posted to the feed (/p/ link): return the video, so the
        # app transcribes it, rather than its cover picture.
        if post.typename == "GraphVideo" and post.video_url:
            return jsonify({
                "type": "video",
                "video_url": post.video_url,
                "caption": post.caption or "",
                "author": post.owner_username or "Unknown",
                "shortcode": shortcode
            })

        image_urls = []
        if post.typename == "GraphSidecar":
            # Carousel post - multiple images
            for node in post.get_sidecar_nodes():
                image_urls.append(node.display_url)
        else:
            # Single image post
            image_urls.append(post.url)
        
        caption = post.caption or ""
        owner = post.owner_username or "Unknown"
        
        return jsonify({
            "type": "image",
            "image_urls": image_urls,
            "caption": caption,
            "author": owner,
            "shortcode": shortcode
        })
    except Exception as e:
        return jsonify({"error": f"Image extraction failed: {str(e)}"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)
