from flask import Flask, request, jsonify
import subprocess
import os
import re
import json
import random
import tempfile
import threading
import time
import http.cookiejar
import instaloader

app = Flask(__name__)

# Instagram cookies are OFF by default.
#
# Oct 7: the owner's personal Instagram session, used from this US cloud server
# while the same account was in use on a phone in India, got the account logged
# out with a "suspicious automation" warning. The phone app never needs a login
# (it reads posts anonymously from the user's own connection); this server is
# only its fallback. So it now works anonymously. INSTAGRAM_COOKIES is honoured
# only for a THROWAWAY account, and only up to COOKIE_HOURLY_CAP requests an
# hour, with a random pause before each one. Never put a personal account here.
COOKIE_HOURLY_CAP = int(os.environ.get("COOKIE_HOURLY_CAP", "15"))
_cookie_uses = []
_cookie_lock = threading.Lock()


def _cookie_text():
    """The cookie file contents if allowed right now, else "" (anonymous)."""
    content = os.environ.get("INSTAGRAM_COOKIES", "")
    if not content:
        return ""
    with _cookie_lock:
        now = time.time()
        while _cookie_uses and now - _cookie_uses[0] > 3600:
            _cookie_uses.pop(0)
        if len(_cookie_uses) >= COOKIE_HOURLY_CAP:
            print("cookie cap reached (%d/hour) - going anonymous" % COOKIE_HOURLY_CAP)
            return ""
        _cookie_uses.append(now)
    # Bursts are what automation looks like; space logged-in requests out.
    time.sleep(random.uniform(2, 6))
    return content


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

    cookie_file = None
    try:
        cmd = ["yt-dlp", "--dump-json", "-f", "best[ext=mp4]/best", "--no-warnings", "--no-check-certificates"]
        cookies_content = _cookie_text()
        if cookies_content:
            cookie_file = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False)
            cookie_file.write(cookies_content)
            cookie_file.close()
            cmd.extend(["--cookies", cookie_file.name])
        cmd.append(url)

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

        if result.returncode != 0:
            error_msg = result.stderr.strip()
            # Image/carousel posts have no video for yt-dlp; try Instaloader.
            if "No video formats found" in error_msg or "/p/" in url:
                return extract_image_post(url)
            return jsonify({"error": "Instagram refused the backup server (no login): " + error_msg[-300:]}), 502

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
        try:
            return extract_image_post(url)
        except Exception as e2:
            return jsonify({"error": str(e2)}), 500
    finally:
        if cookie_file:
            os.unlink(cookie_file.name)


def extract_image_post(url):
    """Image/carousel post via Instaloader (anonymous unless a capped throwaway session is set)."""
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
        cookies_content = _cookie_text()
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
            for node in post.get_sidecar_nodes():
                image_urls.append(node.display_url)
        else:
            image_urls.append(post.url)

        return jsonify({
            "type": "image",
            "image_urls": image_urls,
            "caption": post.caption or "",
            "author": post.owner_username or "Unknown",
            "shortcode": shortcode
        })
    except Exception as e:
        return jsonify({"error": f"Image extraction failed: {str(e)}"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)
