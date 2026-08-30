from flask import Flask, request, jsonify
import subprocess
import os
import tempfile

app = Flask(__name__)

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})

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
            return jsonify({"error": result.stderr.strip()}), 500
        
        video_url = result.stdout.strip()
        
        if not video_url:
            return jsonify({"error": "Could not extract video URL"}), 500
        
        return jsonify({"video_url": video_url})
    
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Request timed out"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)
