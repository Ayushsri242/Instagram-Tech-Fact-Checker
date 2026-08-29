from flask import Flask, request, jsonify
import subprocess
import json

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
        result = subprocess.run(
            ["yt-dlp", "--get-url", "-f", "best[ext=mp4]/best", "--no-warnings", url],
            capture_output=True, text=True, timeout=30
        )
        
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
