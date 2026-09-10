import json
from typing import Any, Dict, List

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from db import get_chat_history, get_reel, init_db, save_chat_message, save_reel_and_verification
from ingest import download_media, extract_shortcode
from research import gather_evidence_for_queries
from transcribe import transcribe_audio
from verify import FALLBACK_MODEL, MODEL_NAME, extract_claims_and_queries, get_groq_client, synthesize_fact_check
from vision import analyze_media_frames

load_dotenv()
init_db()

app = FastAPI(title="Tech Fact Checker Groq API")
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
    techName: str = ""


def _decode_list(value: Any) -> List[Any]:
    if isinstance(value, list):
        return value
    if not value:
        return []
    try:
        decoded = json.loads(value)
        return decoded if isinstance(decoded, list) else []
    except (TypeError, json.JSONDecodeError):
        return []


def _mobile_tools(tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "name": tool.get("name", "Tool"),
            "githubRepo": tool.get("github_repo") or tool.get("githubRepo"),
            "pipCommand": tool.get("pip_command") or tool.get("pipCommand"),
            "isVerified": tool.get("is_verified", tool.get("isVerified", False)),
        }
        for tool in tools
    ]


def _response_from_record(record: Dict[str, Any], ocr_text: str = "") -> Dict[str, Any]:
    return {
        "reelId": record["id"],
        "sourceUrl": record["source_url"],
        "title": record.get("title") or "Instagram Post",
        "author": record.get("author") or "Creator",
        "techName": record.get("tech_name") or record.get("title") or "Unknown Technology",
        "verdict": record.get("verdict") or "UNKNOWN",
        "pricingModel": record.get("pricing_model") or "Unknown",
        "githubUrl": record.get("github_url"),
        "factualReality": record.get("summary_markdown") or "",
        "summaryMarkdown": record.get("summary_markdown") or "",
        "tools": _mobile_tools(_decode_list(record.get("tool_details"))),
        "claims": _decode_list(record.get("claimed_features")),
        "sources": _decode_list(record.get("evidence_sources")),
        "rawTranscript": record.get("raw_transcript") or "",
        "ocrText": ocr_text,
    }


@app.post("/api/analyze")
def analyze_endpoint(req: AnalyzeRequest):
    url = req.url.strip()
    shortcode = extract_shortcode(url)
    existing = get_reel(shortcode)
    if existing:
        return _response_from_record(existing)

    try:
        media_info = download_media(url)
        transcript = media_info.get("caption", "") if media_info.get("is_carousel") else ""
        if media_info.get("audio_path") and not media_info.get("is_carousel"):
            transcript = transcribe_audio(media_info["audio_path"]).get("text", "")

        media_target = media_info.get("frames_dir") if media_info.get("is_carousel") else media_info.get("video_path")
        ocr_text = analyze_media_frames(media_target).get("combined_ocr_text", "")
        claims_data = extract_claims_and_queries(transcript, ocr_text)
        evidence = gather_evidence_for_queries(claims_data.get("search_queries", []))
        verification_data = synthesize_fact_check(transcript, claims_data, evidence, ocr_text)
        tools = claims_data.get("tools", [])

        save_reel_and_verification(
            media_info,
            transcript,
            verification_data,
            claims_data.get("claimed_features", []),
            tools,
        )
        saved = get_reel(media_info["id"])
        if not saved:
            raise RuntimeError("Fact-check was not saved.")
        return _response_from_record(saved, ocr_text)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Fact-check failed: {exc}") from exc


@app.post("/api/chat")
def chat_endpoint(req: ChatRequest):
    existing = get_reel(req.reelId)
    if not existing:
        raise HTTPException(status_code=404, detail="Analyze this post before asking questions.")

    save_chat_message(req.reelId, "user", req.message)
    tech_name = req.techName or existing.get("tech_name") or "Technology"
    source_urls = "\n".join(_decode_list(existing.get("evidence_sources"))[:5])
    system_prompt = f"""You are an expert AI and mobile engineer answering questions about one verified Instagram post.
Tech: {tech_name}

Transcript or caption:
{existing.get("raw_transcript", "")}

Verified fact-check:
{existing.get("summary_markdown", "")}

Evidence URLs:
{source_urls}

Answer concisely and technically. Use the supplied verified context. State uncertainty when the context does not support an answer."""

    messages = [{"role": "system", "content": system_prompt}]
    for message in get_chat_history(req.reelId)[-8:]:
        role = "assistant" if message["sender"] == "assistant" else "user"
        messages.append({"role": role, "content": message["message_text"]})

    last_error = None
    for model in [MODEL_NAME, FALLBACK_MODEL, "qwen/qwen3.6-27b"]:
        try:
            response = get_groq_client().chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.3,
            )
            reply = response.choices[0].message.content
            save_chat_message(req.reelId, "assistant", reply)
            return {"reply": reply}
        except Exception as exc:
            last_error = exc

    raise HTTPException(status_code=502, detail=f"Groq chat failed: {last_error}")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
