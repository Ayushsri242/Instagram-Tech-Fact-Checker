from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import uvicorn
from dotenv import load_dotenv

from ingest import download_media, download_carousel, extract_shortcode
from transcribe import transcribe_audio
from vision import analyze_media_frames
from verify import extract_claims_and_queries, synthesize_fact_check
from research import gather_evidence_for_queries
from db import init_db, save_reel_and_verification, save_chat_message, get_chat_history, get_reel
from groq import Groq

load_dotenv()
init_db()

app = FastAPI(title="Tech Fact Checker Local Micro-Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AnalyzeRequest(BaseModel):
    url: str

class ChatRequest(BaseModel):
    reelId: str
    message: str
    techName: str

@app.post("/api/analyze")
def analyze_endpoint(req: AnalyzeRequest):
    url = req.url.strip()
    shortcode = extract_shortcode(url)

    # 1. Check SQLite Cache
    existing = get_reel(shortcode)
    if existing:
        return {
            "reelId": existing["id"],
            "sourceUrl": existing["source_url"],
            "title": existing["title"],
            "author": existing["author"],
            "techName": existing["tech_name"] or existing["title"],
            "verdict": existing["verdict"] or "PARTIALLY_TRUE",
            "pricingModel": existing["pricing_model"] or "Open Source",
            "githubUrl": existing["github_url"],
            "factualReality": existing["summary_markdown"],
            "summaryMarkdown": existing["summary_markdown"],
            "tools": [],
            "claims": existing["claimed_features"] or [],
            "rawTranscript": existing["raw_transcript"]
        }

    # 2. Ingest
    media_info = download_media(url)
    is_carousel = False
    carousel_dir = None

    if not media_info or not media_info.get("video_path"):
        carousel_dir = download_carousel(url)
        if carousel_dir:
            is_carousel = True
            media_info = {
                "id": shortcode,
                "title": f"Instagram Carousel ({shortcode})",
                "uploader": "Instagram Creator",
                "duration": 0,
                "video_path": None,
                "audio_path": None
            }
        else:
            raise HTTPException(status_code=400, detail="Could not ingest Instagram media.")

    # 3. Transcribe & OCR
    transcript = ""
    if media_info.get("audio_path"):
        transcript = transcribe_audio(media_info["audio_path"])
    
    ocr_data = analyze_media_frames(carousel_dir if is_carousel else media_info["video_path"])

    # 4. Synthesize Fact Check
    claims_data = extract_claims_and_queries(transcript, ocr_data["ocr_text"])
    evidence = gather_evidence_for_queries(claims_data.get("search_queries", []))
    verification_data = synthesize_fact_check(transcript, claims_data, evidence, ocr_data["ocr_text"])

    # 5. Save in SQLite
    save_reel_and_verification(media_info, transcript, verification_data)

    return {
      "reelId": shortcode,
      "sourceUrl": url,
      "title": media_info.get("title", f"Instagram Reel ({shortcode})"),
      "author": media_info.get("uploader", "Creator"),
      "techName": verification_data.get("tech_name", "Tech Library"),
      "verdict": verification_data.get("verdict", "PARTIALLY_TRUE"),
      "pricingModel": verification_data.get("pricing_model", "Open Source"),
      "githubUrl": verification_data.get("github_url"),
      "factualReality": verification_data.get("summary_markdown", ""),
      "summaryMarkdown": verification_data.get("summary_markdown", ""),
      "tools": [
          {
              "name": t.get("name", "Tool"),
              "githubRepo": t.get("github_repo"),
              "pipCommand": t.get("pip_command"),
              "isVerified": t.get("is_verified", True)
          }
          for t in verification_data.get("tools", [])
      ],
      "claims": verification_data.get("claimed_features", []),
      "rawTranscript": transcript
    }

@app.post("/api/chat")
def chat_endpoint(req: ChatRequest):
    save_chat_message(req.reelId, "user", req.message)
    existing = get_reel(req.reelId)
    tech_name = req.techName or (existing["tech_name"] if existing else "Technology")

    api_key = os.getenv("GROQ_API_KEY")
    if api_key:
        client = Groq(api_key=api_key)
        history = get_chat_history(req.reelId)
        messages = [
            {"role": "system", "content": f"You are a helpful technical coding assistant. Answer questions concisely for {tech_name}."},
        ]
        for msg in history[-6:]:
            role = "assistant" if msg["sender"] == "assistant" else "user"
            messages.append({"role": role, "content": msg["message_text"]})

        resp = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=messages,
            temperature=0.3
        )
        reply = resp.choices[0].message.content
    else:
        reply = f"{tech_name} is verified from on-screen evidence. You can inspect its documentation or clone the repository to test locally."

    save_chat_message(req.reelId, "assistant", reply)
    return {"reply": reply}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
