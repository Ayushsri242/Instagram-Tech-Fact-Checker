# 🔍 Local-First Multimodal Instagram Tech Fact-Checker & Knowledge Agent

> A **100% Free, Local-First Multimodal AI Agent System** that ingests technical Instagram Reels and Carousel posts, transcribes speech offline (Whisper), extracts on-screen code & repositories (RapidOCR / Google ML Kit), background-researches live documentation, and verifies technical claims into a local SQLite knowledge base.

---

## 🚀 Key Features

* **$0 Operating Cost & 100% Free Tier:** Zero paid APIs required. Runs seamlessly on low-spec hardware (4GB VRAM / 8GB RAM / Android Mobile).
* **Multimodal Ingestion:** Ingests both **Video Reels** (`yt-dlp` + `ffmpeg`) and **Multi-Slide Photo Carousels** (`instaloader`).
* **Offline Speech-to-Text:** Faster-Whisper with automatic CUDA/CPU fallback for multilingual transcription (English, Hindi, Hinglish).
* **Visual OCR & Line Stitching:** RapidOCR ONNX Runtime with heuristic line-stitching to recover multi-line wrapped repository names and code.
* **Autonomous Web Research Agent:** Scrapes GitHub repositories, PyPI packages, and live docs via DuckDuckGo without API keys.
* **Streamlit Web UI (`app.py`):** Interactive dashboard with video/slides viewer, color-coded verdict badges, and multi-turn chat memory.
* **Native Android App (`android_app/`):** Kotlin + Jetpack Compose app with **Share Sheet integration** (share directly from Instagram app) and **Room Database**.
* **GitHub Actions Cloud CI/CD:** Builds Android APKs automatically in the cloud with zero laptop RAM/CPU overhead.

---

## 🏗️ Architecture & Data Flow

```
[ Instagram Reel / Carousel ] 
              │
              ├──► [ Audio Stream ] ──────► Offline Whisper STT ──────┐
              │                                                        ▼
              └──► [ Video / Slides ] ────► RapidOCR / ML Kit ──► Multimodal Fusion
                                                                       │
                                                                       ▼
                                                          Web Research Agent (DDGS / GitHub)
                                                                       │
                                                                       ▼
                                                          LLM Fact-Check Synthesis
                                                                       │
                                                                       ▼
                                                       [ Local SQLite / Room DB ]
                                                                       │
                                                       ┌───────────────┴───────────────┐
                                                       ▼                               ▼
                                               Streamlit Web UI                Native Android App
```

---

## 🛠️ Tech Stack

| Component | Desktop (Testing / Web) | Native Android (Mobile App) |
| :--- | :--- | :--- |
| **Ingestion** | `yt-dlp` + `instaloader` | Android Share Sheet (`ACTION_SEND`) + `youtubedl-android` |
| **Audio STT** | `faster-whisper` (INT8) | `sherpa-onnx` (Offline Whisper) |
| **Vision OCR** | `rapidocr-onnxruntime` | **Google ML Kit Text Recognition** (0 MB) |
| **Web Research** | `ddgs` + `BeautifulSoup` + `requests` | `OkHttp` + `Jsoup` + GitHub API |
| **Reasoning LLM** | Groq Cloud AI / Local Ollama | On-Device MediaPipe / Groq API |
| **Database** | `sqlite3` + `SQLAlchemy` | **Android Room Database** (SQLite) |
| **User Interface** | `Streamlit` (Web Dashboard) | **Jetpack Compose + Material 3** |
| **CI/CD** | Python `venv` | **GitHub Actions Cloud Runners** |

---

## 📦 Quickstart Guide

### 1. Web UI & Python Pipeline

1. **Clone repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/Instagram-Tech-Fact-Checker.git
   cd Instagram-Tech-Fact-Checker
   ```

2. **Create and activate virtual environment:**
   ```bash
   python -m venv venv
   # Windows
   .\venv\Scripts\activate
   # Linux/macOS
   source venv/bin/activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Set Groq API key in `.env`:**
   ```env
   GROQ_API_KEY=gsk_your_groq_api_key_here
   ```

5. **Launch Streamlit Web UI:**
   ```bash
   streamlit run app.py
   ```

6. **Or run via CLI:**
   ```bash
   python main.py "https://www.instagram.com/p/DcOJpsKDEht/"
   ```

---

### 2. Native Android App (Cloud CI/CD Build)

This repository includes a GitHub Actions workflow (`.github/workflows/android_build.yml`) that compiles the Android APK directly in the cloud:

1. **Push this repository to GitHub:**
   ```bash
   git add .
   git commit -m "feat: complete multimodal fact-checker and native android app"
   git push origin main
   ```
2. **Download APK:**
   - Go to your GitHub repository ➔ **Actions** tab.
   - Click on the latest **Android APK Build & Release** run.
   - Download `TechFactChecker-Debug-APK` from the **Artifacts** section and install on your phone!

---

## 🧪 Verified Smoke Tests

1. **Hindi/Hinglish Video Reel:** `https://www.instagram.com/reel/DcXzQH5si-A/`  
   *Result:* Transcribed Hindi audio, evaluated on-screen "OKF" diagram, flagged non-existent "Google Open Knowledge Format" as **`HYPE`**.
2. **Prompt Shorthand Reel:** `https://www.instagram.com/reel/DcYcqi5TePT/`  
   *Result:* RapidOCR extracted on-screen `/eli5` prompt shortcut, verdict **`PARTIALLY_TRUE`**.
3. **Multi-Slide Carousel (5 Tech Libraries):** `https://www.instagram.com/p/DcOJpsKDEht/`  
   *Result:* Instaloader downloaded 7 slides, OCR line-stitching extracted and verified all 5 repositories (`VectifyAI/PageIndex`, `StarlightSearch/EmbedAnything`, `confident-ai/deepteam`, `skypilot-org/skypilot`, `feyninc/chonkie`) with 100% accuracy.

---

## 📜 License
MIT License. Free for open-source and personal use.
