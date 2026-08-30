from flask import Flask, request, jsonify, send_file
import subprocess
import os
import re
import tempfile
import shutil
import instaloader

app = Flask(__name__)

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
    
    try:
        cmd = ["yt-dlp", "--get-url", "-f", "best[ext=mp4]/best", "--no-warnings", "--no-check-certificates"]
        
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
        
        video_url = result.stdout.strip()
        
        if not video_url:
            return jsonify({"error": "Could not extract video URL"}), 500
        
        return jsonify({"video_url": video_url, "type": "video"})
    
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
        L = instaloader.Instaloader(
            download_videos=False,
            save_metadata=False,
            download_comments=False,
            download_geotags=False,
            quiet=True
        )
        
        post = instaloader.Post.from_shortcode(L.context, shortcode)
        
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
