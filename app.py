import os
import sys
import json
import glob
import streamlit as st

# Ensure local imports work cleanly
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ingest import download_media, extract_shortcode
from transcribe import transcribe_audio
from vision import analyze_video_frames
from research import gather_evidence_for_queries
from verify import extract_claims_and_queries, synthesize_fact_check, get_groq_client, MODEL_NAME
import db

# Configure page
st.set_page_config(
    page_title="Instagram Tech Fact-Checker",
    page_icon="🔍",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS for styling
st.markdown("""
<style>
    .verdict-badge {
        display: inline-block;
        padding: 6px 14px;
        font-weight: bold;
        border-radius: 6px;
        font-size: 1.1rem;
        margin-bottom: 10px;
    }
    .verdict-TRUE { background-color: #1b5e20; color: #a5d6a7; border: 1px solid #4caf50; }
    .verdict-PARTIALLY_TRUE { background-color: #e65100; color: #ffe082; border: 1px solid #ffb300; }
    .verdict-HYPE { background-color: #bf360c; color: #ffccbc; border: 1px solid #ff7043; }
    .verdict-MISLEADING { background-color: #b71c1c; color: #ffcdd2; border: 1px solid #ef5350; }
    .verdict-FAKE { background-color: #880e4f; color: #f8bbd0; border: 1px solid #e91e63; }
    .verdict-UNKNOWN { background-color: #37474f; color: #cfd8dc; border: 1px solid #90a4ae; }
    
    .tech-title {
        font-size: 1.8rem;
        font-weight: 700;
        margin-bottom: 0.2rem;
    }
    .meta-pill {
        display: inline-block;
        background: #2b303c;
        padding: 3px 10px;
        border-radius: 12px;
        font-size: 0.85rem;
        margin-right: 6px;
        margin-bottom: 6px;
    }
</style>
""", unsafe_allow_html=True)

# Initialize database
db.init_db()

# Session State Initialization
if "current_reel_id" not in st.session_state:
    st.session_state.current_reel_id = None
if "preset_prompt" not in st.session_state:
    st.session_state.preset_prompt = None

def run_analysis_pipeline(url: str):
    """Execute the multimodal fact-checking pipeline with UI progress updates."""
    shortcode = extract_shortcode(url)
    
    # Check if already processed
    existing = db.get_reel(shortcode)
    if existing and existing.get("verdict"):
        st.info(f"Reel `{shortcode}` found in local database! Loading cached fact-check.")
        st.session_state.current_reel_id = shortcode
        st.rerun()

    progress_placeholder = st.empty()
    with progress_placeholder.container():
        st.write("### ⚙️ Processing Media...")
        step_box = st.status("Running Multimodal Fact-Check Pipeline...", expanded=True)
        
        try:
            # Step 1: Download Media
            step_box.write("📥 **[1/5] Ingesting media stream (Video / Slides)...**")
            reel_meta = download_media(url)
            step_box.write(f"✓ Downloaded: *{reel_meta.get('title', 'Unknown')}* by @{reel_meta.get('author', 'Unknown')}")
            
            # Step 2: Visual OCR
            step_box.write("👁️ **[2/5] Running RapidOCR on visual frames / slides...**")
            media_target = reel_meta.get("frames_dir") if reel_meta.get("is_carousel") else reel_meta.get("video_path", "")
            vision_res = analyze_video_frames(media_target)
            ocr_text = vision_res.get("combined_ocr_text", "")
            step_box.write(f"✓ Analyzed {vision_res.get('frame_count', 0)} frames. URLs detected: {len(vision_res.get('urls_detected', []))}")
            
            # Step 3: Transcription
            if reel_meta.get("is_carousel"):
                step_box.write("📝 **[3/5] Extracting carousel post caption...**")
                transcript = reel_meta.get("caption", "")
            else:
                step_box.write("🎙️ **[3/5] Transcribing speech offline with Whisper...**")
                t_res = transcribe_audio(reel_meta["audio_path"])
                transcript = t_res["text"]
            step_box.write(f"✓ Transcript length: {len(transcript)} chars")
            
            # Step 4: Web Research
            step_box.write("🔍 **[4/5] Extracting claims and researching live web docs...**")
            claims_data = extract_claims_and_queries(transcript, ocr_text=ocr_text)
            queries = claims_data.get("search_queries", [])
            evidence = gather_evidence_for_queries(queries)
            step_box.write(f"✓ Target Tech: **{claims_data.get('tech_name')}** | Gathered {len(evidence)} web evidence sources.")
            
            # Step 5: Synthesize Fact-Check
            step_box.write("🧠 **[5/5] Synthesizing verdict with Groq Cloud LLM...**")
            fact_check = synthesize_fact_check(transcript, claims_data, evidence, ocr_text=ocr_text)
            
            # Save to DB
            db.save_reel_and_verification(
                reel_meta=reel_meta,
                transcript=transcript,
                fact_check=fact_check,
                claimed_features=claims_data.get("claimed_features", [])
            )
            
            step_box.update(label="✅ Analysis Complete!", state="complete", expanded=False)
            st.session_state.current_reel_id = reel_meta["id"]
            st.rerun()

        except Exception as e:
            step_box.update(label="❌ Analysis Failed", state="error", expanded=True)
            st.error(f"Pipeline error: {str(e)}")

# ================= SIDEBAR =================
with st.sidebar:
    st.title("📚 Library")
    st.caption("Local SQLite Knowledge Base")
    
    if st.button("➕ Analyze New Reel / Post", use_container_width=True, type="primary"):
        st.session_state.current_reel_id = None
        st.rerun()
        
    st.divider()
    
    reels = db.list_all_reels()
    if reels:
        st.write(f"**Saved Verifications ({len(reels)})**")
        for r in reels:
            verdict = r.get("verdict") or "UNKNOWN"
            tech = r.get("tech_name") or r.get("id")
            title = r.get("title") or r.get("source_url")
            
            # Format label
            label = f"{tech} ({verdict})"
            is_active = (st.session_state.current_reel_id == r["id"])
            
            if st.button(
                f"{'👉 ' if is_active else ''}{label}\n_{title[:30]}..._",
                key=f"reel_btn_{r['id']}",
                use_container_width=True
            ):
                st.session_state.current_reel_id = r["id"]
                st.rerun()
    else:
        st.info("No saved fact-checks yet. Paste a link to begin!")

# ================= MAIN CONTENT =================
st.title("🔍 Instagram Tech Fact-Checker")
st.caption("100% Free • Local-First • Speech + OCR + Web Research + LLaMA 3.3")

# View Mode: Input New Reel or View Active Reel
if st.session_state.current_reel_id is None:
    # --- Ingestion Form ---
    st.subheader("Analyze an Instagram Reel or Carousel Post")
    
    col_input, col_btn = st.columns([4, 1])
    with col_input:
        target_url = st.text_input(
            "Enter URL",
            placeholder="https://www.instagram.com/reel/... or https://www.instagram.com/p/...",
            label_visibility="collapsed"
        )
    with col_btn:
        analyze_clicked = st.button("🚀 Analyze", use_container_width=True, type="primary")

    st.markdown("##### 💡 Try quick samples from tested cache:")
    col1, col2, col3 = st.columns(3)
    with col1:
        if st.button("🎬 Hindi Reel: OKF ('HYPE')", use_container_width=True):
            st.session_state.current_reel_id = "DcXzQH5si-A"
            st.rerun()
    with col2:
        if st.button("🎬 Prompt Reel: /eli5 ('PARTIAL')", use_container_width=True):
            st.session_state.current_reel_id = "DcYcqi5TePT"
            st.rerun()
    with col3:
        if st.button("📸 Carousel: DeepSeek dsh", use_container_width=True):
            st.session_state.current_reel_id = "DcYt-CxDV54"
            st.rerun()

    if analyze_clicked and target_url:
        run_analysis_pipeline(target_url.strip())

else:
    # --- Active Reel Display ---
    reel_id = st.session_state.current_reel_id
    reel = db.get_reel(reel_id)

    if not reel:
        st.error(f"Could not load data for Reel ID `{reel_id}`.")
        if st.button("Back"):
            st.session_state.current_reel_id = None
            st.rerun()
    else:
        # Header Row
        col_hdr, col_actions = st.columns([3, 1])
        with col_hdr:
            tech_name = reel.get("tech_name") or "Unknown Tech"
            verdict = reel.get("verdict") or "UNKNOWN"
            st.markdown(f'<div class="tech-title">{tech_name}</div>', unsafe_allow_html=True)
            st.markdown(f'<div class="verdict-badge verdict-{verdict}">VERDICT: {verdict}</div>', unsafe_allow_html=True)
            
            # Pills
            pricing = reel.get("pricing_model") or "Unknown"
            st.markdown(
                f'<span class="meta-pill">💰 Pricing: {pricing}</span>'
                f'<span class="meta-pill">👤 Author: @{reel.get("author", "Unknown")}</span>'
                f'<span class="meta-pill">🆔 {reel.get("id")}</span>',
                unsafe_allow_html=True
            )
            
        with col_actions:
            if reel.get("github_url"):
                st.link_button("⭐ GitHub Repository", reel["github_url"], use_container_width=True)
            if reel.get("source_url"):
                st.link_button("🔗 Original Post", reel["source_url"], use_container_width=True)
            if st.button("🔄 Analyze Another", use_container_width=True):
                st.session_state.current_reel_id = None
                st.rerun()

        st.divider()

        # Tabs for Fact-Check, Media & OCR, Interactive Chat
        tab_report, tab_media, tab_chat = st.tabs(["📊 Fact-Check Report", "🎬 Media & Visual Evidence", "💬 Interactive Chat"])

        with tab_report:
            # Fact-Check Markdown Report
            summary = reel.get("summary_markdown", "")
            if summary:
                st.markdown(summary)
            else:
                st.info("No formatted summary markdown available.")

            # Claimed Features & Evidence
            col_left, col_right = st.columns(2)
            with col_left:
                st.markdown("#### 🎯 Extracted Claims")
                try:
                    claims = json.loads(reel.get("claimed_features") or "[]")
                    if claims:
                        for c in claims:
                            st.markdown(f"- {c}")
                    else:
                        st.write("No specific claims listed.")
                except Exception:
                    st.write(reel.get("claimed_features", ""))

            with col_right:
                st.markdown("#### 🌐 Evidence Sources Consulted")
                try:
                    sources = json.loads(reel.get("evidence_sources") or "[]")
                    if sources:
                        for s in sources:
                            st.markdown(f"- [{s}]({s})")
                    else:
                        st.write("No external URLs recorded.")
                except Exception:
                    st.write(reel.get("evidence_sources", ""))

        with tab_media:
            # Display media
            col_media_left, col_media_right = st.columns([1, 1])
            
            downloads_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "downloads")
            video_path = os.path.join(downloads_dir, f"{reel_id}.mp4")
            audio_path = os.path.join(downloads_dir, f"{reel_id}.mp3")
            frames_dir = os.path.join(downloads_dir, "frames", reel_id)

            with col_media_left:
                st.markdown("#### 📱 Downloaded Media")
                if os.path.exists(video_path):
                    st.video(video_path)
                elif os.path.exists(frames_dir):
                    # Carousel image slides
                    slide_images = sorted(glob.glob(os.path.join(frames_dir, "*.jpg")) + glob.glob(os.path.join(frames_dir, "*.png")))
                    if slide_images:
                        st.write(f"**Carousel Slides ({len(slide_images)} images)**")
                        for idx, img_p in enumerate(slide_images):
                            st.image(img_p, caption=f"Slide {idx+1}", use_container_width=True)
                else:
                    st.warning("Media file not cached on local disk.")

                if os.path.exists(audio_path):
                    st.audio(audio_path)

            with col_media_right:
                st.markdown("#### 📝 Raw Transcript / Caption")
                st.text_area(
                    "Transcript",
                    value=reel.get("raw_transcript", "No transcript available."),
                    height=200,
                    disabled=True,
                    label_visibility="collapsed"
                )
                
                st.markdown("#### 👁️ On-Screen OCR Evidence")
                if os.path.exists(frames_dir):
                    frame_files = sorted(glob.glob(os.path.join(frames_dir, "*.*")))
                    st.caption(f"Saved {len(frame_files)} frames in `downloads/frames/{reel_id}/`")
                st.info("RapidOCR extracted code and links directly from visual frames during analysis.")

        with tab_chat:
            st.markdown(f"#### 💬 Ask Questions About {tech_name}")
            st.caption("Ask how to install, benchmark, or verify code from this reel.")

            # Load Chat History
            chat_history = db.get_chat_history(reel_id)
            
            # Display past messages
            for msg in chat_history:
                role = "assistant" if msg["sender"] == "assistant" else "user"
                with st.chat_message(role):
                    st.markdown(msg["message_text"])

            # Quick suggestion prompt buttons
            st.markdown("**Quick Prompts:**")
            q_cols = st.columns(3)
            with q_cols[0]:
                if st.button("📦 How do I install this?", key="qp1"):
                    st.session_state.preset_prompt = f"How do I install and run {tech_name} on Windows/Linux?"
                    st.rerun()
            with q_cols[1]:
                if st.button("💻 Show a 5-line code snippet", key="qp2"):
                    st.session_state.preset_prompt = f"Show me a 5-line code snippet for using {tech_name}."
                    st.rerun()
            with q_cols[2]:
                if st.button("⚠️ What are the main gotchas?", key="qp3"):
                    st.session_state.preset_prompt = f"What are the main limitations and gotchas of {tech_name}?"
                    st.rerun()

            prompt_to_send = None
            if st.session_state.preset_prompt:
                prompt_to_send = st.session_state.preset_prompt
                st.session_state.preset_prompt = None

            user_query = st.chat_input("Ask a follow-up question...")
            if user_query:
                prompt_to_send = user_query

            if prompt_to_send:
                # Display user message
                with st.chat_message("user"):
                    st.markdown(prompt_to_send)
                db.save_chat_message(reel_id, "user", prompt_to_send)

                # Generate AI response
                with st.chat_message("assistant"):
                    with st.spinner("Thinking..."):
                        try:
                            client = get_groq_client()
                            system_prompt = f"""
You are an expert AI & Mobile Engineer answering questions about a tech video reel/post.
Reel Tech: {tech_name}
Reel Transcript:
\"\"\"{reel.get('raw_transcript', '')}\"\"\"

Verified Fact-Check:
{reel.get('summary_markdown', '')}

Answer user follow-up questions concisely, accurately, and technically. Provide code snippets if requested.
"""
                            # Assemble messages
                            history = db.get_chat_history(reel_id)
                            messages = [{"role": "system", "content": system_prompt}]
                            for h in history[-8:]:
                                role = "assistant" if h["sender"] == "assistant" else "user"
                                messages.append({"role": role, "content": h["message_text"]})

                            response = client.chat.completions.create(
                                model=MODEL_NAME,
                                messages=messages,
                                temperature=0.3
                            )
                            reply = response.choices[0].message.content
                            st.markdown(reply)
                            db.save_chat_message(reel_id, "assistant", reply)
                            st.rerun()
                        except Exception as e:
                            st.error(f"Chat error: {str(e)}")
