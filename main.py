import sys
import os
import argparse
from ingest import download_media
from transcribe import transcribe_audio
from vision import analyze_video_frames
from research import gather_evidence_for_queries
from verify import extract_claims_and_queries, synthesize_fact_check, get_groq_client, MODEL_NAME
import db

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

def process_reel(url: str, interactive: bool = True) -> None:
    print(f"\n========================================================")
    print(f"🎬 Processing Reel: {url}")
    print(f"========================================================")

    # 1. Ingest (Video + Audio)
    print("\n[1/5] 📥 Downloading media stream...")
    reel_meta = download_media(url)
    print(f"  ✓ ID: {reel_meta['id']}")
    print(f"  ✓ Title: {reel_meta['title']}")
    print(f"  ✓ Author: {reel_meta['author']}")

    # 2. Vision OCR (On-Screen Text & URLs from Video Frames or Carousel Slides)
    print("\n[2/5] 👁️ Analyzing visual frames (RapidOCR)...")
    media_target = reel_meta.get("frames_dir") if reel_meta.get("is_carousel") else reel_meta.get("video_path", "")
    vision_res = analyze_video_frames(media_target)
    ocr_text = vision_res.get("combined_ocr_text", "")
    print(f"  ✓ Frames/Slides Analyzed: {vision_res.get('frame_count', 0)}")
    if vision_res.get("urls_detected"):
        print(f"  ✓ URLs on screen: {vision_res['urls_detected']}")
    if ocr_text:
        print(f"  ✓ On-Screen Text Snippet: \"{ocr_text[:120]}...\"")

    # 3. Transcribe Speech or Use Post Caption
    if reel_meta.get("is_carousel"):
        print("\n[3/5] 📝 Using Carousel Post Caption (No audio stream)...")
        transcript = reel_meta.get("caption", "")
        print(f"  ✓ Caption Snippet: \"{transcript[:160]}...\"")
    else:
        print("\n[3/5] 🎙️ Transcribing speech offline (Whisper)...")
        t_res = transcribe_audio(reel_meta["audio_path"])
        transcript = t_res["text"]
        print(f"  ✓ Language: {t_res['language']} | Duration: {t_res['duration']}s")
        print(f"  ✓ Transcript Snippet: \"{transcript[:160]}...\"")

    # 4. Claim Extraction & Web Research (Multimodal Fusion)
    print("\n[4/5] 🔍 Extracting claims and searching web documentation...")
    claims_data = extract_claims_and_queries(transcript, ocr_text=ocr_text)
    print(f"  ✓ Target Tech: {claims_data.get('tech_name')}")
    print(f"  ✓ Queries: {claims_data.get('search_queries')}")

    evidence = gather_evidence_for_queries(claims_data.get("search_queries", []))
    print(f"  ✓ Gathered {len(evidence)} evidence sources.")

    # 5. Synthesize Fact Check
    print("\n[5/5] 🧠 Synthesizing Multimodal Fact-Check with Groq LLaMA...")
    fact_check = synthesize_fact_check(transcript, claims_data, evidence, ocr_text=ocr_text)

    # 5. Save to Local DB
    db.save_reel_and_verification(
        reel_meta=reel_meta,
        transcript=transcript,
        fact_check=fact_check,
        claimed_features=claims_data.get("claimed_features", [])
    )

    # 6. Display Result
    print("\n" + "="*56)
    print(f"📊 FACT-CHECK REPORT: {reel_meta['title']}")
    print("="*56)
    print(fact_check.get("summary_markdown", ""))
    print("="*56)
    print(f"💾 Persisted locally in SQLite (ID: {reel_meta['id']})\n")

    if interactive:
        chat_loop(reel_meta["id"], transcript, fact_check)

def chat_loop(reel_id: str, transcript: str, fact_check: dict) -> None:
    print("💬 Ask follow-up questions about this tech (or type 'exit' to quit):")
    client = get_groq_client()
    system_prompt = f"""
You are an expert AI & Mobile Engineer answering questions about a tech video reel.
Reel Transcript:
\"\"\"{transcript}\"\"\"

Verified Fact-Check:
{fact_check.get('summary_markdown', '')}
Factual Reality: {fact_check.get('factual_reality', '')}

Answer user follow-up questions concisely and technically accurately.
"""
    while True:
        try:
            user_input = input("\nYou > ").strip()
            if not user_input or user_input.lower() in ["exit", "quit", "q"]:
                break
            
            db.save_chat_message(reel_id, "user", user_input)
            
            # Fetch conversation context
            history = db.get_chat_history(reel_id)
            messages = [{"role": "system", "content": system_prompt}]
            for h in history[-6:]:
                role = "assistant" if h["sender"] == "assistant" else "user"
                messages.append({"role": role, "content": h["message_text"]})

            response = client.chat.completions.create(
                model=MODEL_NAME,
                messages=messages,
                temperature=0.3
            )
            reply = response.choices[0].message.content
            print(f"\nAgent > {reply}")
            db.save_chat_message(reel_id, "assistant", reply)
        except (KeyboardInterrupt, EOFError):
            break
        except Exception as e:
            print(f"Error in chat: {e}")
            break

def main():
    parser = argparse.ArgumentParser(description="Instagram Reel Tech Fact-Checker Agent")
    parser.add_argument("url", nargs="?", help="URL of Instagram Reel or YouTube Short")
    parser.add_argument("--list", action="store_true", help="List all processed reels in DB")
    parser.add_argument("--chat", type=str, help="Open interactive chat with a past reel ID")

    args = parser.parse_args()

    if args.list:
        reels = db.list_all_reels()
        print(f"\nSaved Reels in Database ({len(reels)}):")
        for r in reels:
            print(f"- [{r['id']}] {r['tech_name']} | Verdict: {r['verdict']} | {r['title']}")
        return

    if args.chat:
        reel = db.get_reel(args.chat)
        if not reel:
            print(f"Reel ID {args.chat} not found.")
            return
        chat_loop(reel["id"], reel["raw_transcript"], {"summary_markdown": reel["summary_markdown"], "factual_reality": ""})
        return

    if args.url:
        process_reel(args.url)
    else:
        # Default test URL
        process_reel("https://www.instagram.com/reel/DcXzQH5si-A/?igsi=OHppeWUyb2UyMQ==", interactive=False)

if __name__ == "__main__":
    main()
