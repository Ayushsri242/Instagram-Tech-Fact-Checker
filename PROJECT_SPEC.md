# Local-First Multimodal Instagram Tech Fact-Checker & Knowledge Agent
### Project Architecture, Micro-Agent Spec, and Handoff Document

**Target Directory:** `E:\RANDOM_BS\Instagram`  
**Author:** Ayushya Shrivastav  
**Role Target:** Forward Deployed Engineer (FDE) / Applied AI & Multimodal Engineer / Edge AI  
**Estimated Build Time:** 1–2 Weeks  
**Total Operating Cost:** **$0.00 (100% Free)**  

---

## 1. Executive Summary & Problem Statement

### The Problem
Tech updates, new AI libraries, and architectural frameworks are rapidly distributed via short-form video (Instagram Reels / YouTube Shorts / TikTok). However:
1. Videos are packed with marketing hype, outdated claims, or non-functional repos.
2. Developers currently must manually watch videos, transcribe claims, search GitHub, verify licenses/benchmarks, and test code.
3. No local-first, privacy-preserving tool exists to ingest video, extract technical claims, background-verify against live web docs, and store verified knowledge locally on the user's device.

### The Solution
An offline/local-first **Multimodal Micro-Agent System** that:
- Ingests Instagram Reel / Short video links.
- Transcribes speech **offline** using quantized Whisper (`faster-whisper` / `whisper.cpp`).
- Extracts on-screen text/code using OCR / Vision-Language embeddings.
- Deploys a background **Web Research Agent** (Headless Playwright / DuckDuckGo) to cross-verify claims against GitHub, official docs, and benchmarks.
- Produces a structured **Fact-Check Verdict** (TRUE / HYPE / FAKE / PRICING_CATCH).
- Persists all transcripts, claims, and chat history into a **Local SQLite Database** on the device.
- Provides a conversational multi-turn interface (Telegram Bot / Mobile APK / Local Web UI) to ask follow-up questions (*"How do I install this?", "Show me a 5-line code snippet"*).

---

## 2. Micro-Agent Architecture & Data Flow

```
                     ┌──────────────────────────────────────────────┐
                     │          User Input (Reel URL / Video)        │
                     └──────────────────────┬───────────────────────┘
                                            │
                                            ▼
                     ┌──────────────────────────────────────────────┐
                     │          Agent 1: Ingestion & Audio          │
                     │          • Downloads video via yt-dlp        │
                     │          • Extracts audio stream (.mp3)      │
                     │          • Offline Whisper transcription     │
                     └──────────────────────┬───────────────────────┘
                                            │
                                            ▼ (Raw Transcript + Meta)
                     ┌──────────────────────────────────────────────┐
                     │          Agent 2: Entity & Claim Extractor   │
                     │          • Identifies Tech/Repo names        │
                     │          • Extracts core functional claims   │
                     │          • Generates targeted search queries │
                     └──────────────────────┬───────────────────────┘
                                            │
                                            ▼ (Search Queries)
                     ┌──────────────────────────────────────────────┐
                     │          Agent 3: Background Web Researcher  │
                     │          • Silent Headless Search / Scrape   │
                     │          • Fetches GitHub READMEs, stars     │
                     │          • Extracts real pricing & limits    │
                     └──────────────────────┬───────────────────────┘
                                            │
                                            ▼ (Web Evidence Context)
                     ┌──────────────────────────────────────────────┐
                     │          Agent 4: Verification & Memory      │
                     │          • Synthesizes Verdict & Summary     │
                     │          • Writes to Local SQLite DB         │
                     │          • Answers multi-turn user queries   │
                     └──────────────────────────────────────────────┘
```

---

## 3. Technology Stack ($0 Free Tier)

| Component | Technology / Library | Purpose | Cost |
| :--- | :--- | :--- | :--- |
| **Ingestion** | `yt-dlp` | Video/Audio stream extraction from URLs | **$0** (FOSS) |
| **Offline Transcription** | `faster-whisper` / `whisper.cpp` | Offline Speech-to-Text (INT8 quantized) | **$0** (Local CPU/GPU) |
| **Vision OCR (Optional)** | `pytesseract` / `easyocr` | Extracts on-screen code snippets from frames | **$0** (Local) |
| **LLM & Reasoning** | **Groq Cloud API** (`llama-3.3-70b` / `llama-3.1-8b`) OR Local **Ollama** (`llama-3.2-3b`) | Claim extraction, verification synthesis | **$0** (Free API / Local) |
| **Web Research** | `duckduckgo-search` / `playwright` | Live web search and headless doc scraping | **$0** (No API keys needed) |
| **Local Memory** | `sqlite3` + `SQLAlchemy` | Local relational storage for reels, tags & chat history | **$0** (Local disk) |
| **Interface Options** | 1. `python-telegram-bot`<br>2. `Streamlit` / `FastAPI`<br>3. Native Android Kotlin APK | Mobile/Desktop interaction with push notifications | **$0** (Free) |

---

## 4. Local SQLite Database Schema

```sql
-- 1. Ingested Videos & Metadata
CREATE TABLE reels (
    id TEXT PRIMARY KEY,               -- Hash / Shortcode
    source_url TEXT UNIQUE NOT NULL,
    title TEXT,
    author TEXT,
    duration_seconds REAL,
    raw_transcript TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Extracted Entities & Verification
CREATE TABLE verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reel_id TEXT REFERENCES reels(id),
    tech_name TEXT NOT NULL,           -- e.g. "DSPy", "Cursor", "Ollama"
    claimed_features TEXT,            -- What the video claimed
    verdict TEXT NOT NULL,             -- TRUE / PARTIALLY_TRUE / HYPE / SCAM
    github_url TEXT,
    pricing_model TEXT,                -- Free / Freemium / Paid / Open-Source
    summary_markdown TEXT,
    evidence_sources TEXT              -- JSON array of URLs consulted
);

-- 3. Multi-Turn Conversational Memory
CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reel_id TEXT REFERENCES reels(id),
    sender TEXT NOT NULL,              -- "user" or "assistant"
    message_text TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 5. Step-by-Step Implementation Roadmap

### Phase 1: Core Python Pipeline (Days 1–3)
1. `ingest.py`: Download audio using `yt-dlp` directly into memory/temp buffer.
2. `transcribe.py`: Run `faster-whisper` (model: `base.en` or `small.en`) to obtain timestamped text.
3. `search.py`: Wrap `duckduckgo-search` to find top 3 relevant GitHub repos / docs.
4. `verifier.py`: Prompt LLaMA 3.3 (Groq API or local Ollama) to compare transcript claims against web results and format the final markdown report.

### Phase 2: Local Memory & Database (Days 4–5)
1. `db.py`: Initialize SQLite database schemas.
2. Build CRUD methods for storing transcripts, verifications, and chat history.
3. Add search queries (*e.g., query database by tag like "Computer Vision" or "LLM Tools"*).

### Phase 3: Mobile & Bot Interface (Days 6–8)
1. Build `telegram_bot.py`:
   - `/start` command initialization.
   - Message handler: listens for Instagram / Shorts URLs.
   - Sends animated typing / *"Verifying with web sources..."* status.
   - Returns structured markdown report with inline buttons (GitHub link, Docs link).
   - Handles text replies for interactive Q&A (*"How do I install this on Windows?"*).

### Phase 4: Polish & Packaging (Days 9–10)
1. Dockerize the entire application (`Dockerfile` + `docker-compose.yml`).
2. Add offline fallback mode (switches between Local Ollama and Groq API).
3. Record 60-second video demo showing mobile Reel share ➔ instant fact-check on phone.

---

## 6. Prompt to Launch in Fresh AGY Session

Copy and paste the prompt below when starting a new session in `E:\RANDOM_BS\Instagram`:

```text
I am starting a new project in E:\RANDOM_BS\Instagram: "Local-First Multimodal Instagram Tech Fact-Checker & Knowledge Agent".

Please read PROJECT_SPEC.md in this directory. 
We are building a 100% free, local-first micro-agent pipeline (yt-dlp -> faster-whisper -> DuckDuckGo Search -> Groq LLaMA 3.3 -> SQLite DB -> Telegram Bot / Web UI).

Let's begin Phase 1 by setting up the Python environment, dependencies, and building the ingestion and offline transcription module.
```
