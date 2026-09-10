# Project Handoff Note: Local-First Multimodal Instagram Tech Fact-Checker & Knowledge Agent

**Last Updated:** September 4, 2026

> START HERE: read `TEST_LOG.md` first, then **section 11** of this file.
> Section 11 (Sept 7-8) supersedes section 10, which supersedes 9, which
> supersedes 7 and 8. Sections are not in chronological order.
> Ten recorded test cases now exist. Several fixes described in sections 9 and 10
> were shown to be wrong when measured against them - trust the measurements.

**Target Workspace:** `E:\RANDOM_BS\Instagram`  
**Hardware Environment:** Windows 10/11, NVIDIA GTX 1650 (4GB VRAM), 8GB System RAM  

---

## 1. What Was the Task?
Build a **100% free, local-first multimodal AI agent system** that ingests technical Instagram Reels and Carousel posts, transcribes audio offline (Whisper), extracts on-screen code/diagrams/URLs using lightweight OCR (RapidOCR), background-researches live documentation via DuckDuckGo, and verifies technical claims using Groq Cloud AI (`openai/gpt-oss-120b` / `openai/gpt-oss-20b`). All verifications and multi-turn chat history are stored in a local SQLite database (`knowledge.db`).

The long-term goal is to deploy this system as a **Native Android Mobile App (Kotlin + Jetpack Compose)** runnable 100% on the user's phone at $0 operating cost.

---

## 2. What Was Done (Completed Files & Exact Line Details)

### A. Environment & Configuration
- **[`.env`](file:///E:/RANDOM_BS/Instagram/.env)**: Configured with working Groq API key (`GROQ_API_KEY=...`).
- **[`.gitignore`](file:///E:/RANDOM_BS/Instagram/.gitignore)**: Configured to ignore `.env`, `venv/`, `downloads/`, `*.db`, `*.mp3`, `*.mp4`, `*.wav`.
- **Python Virtual Environment (`venv`)**: Configured with PyTorch (CPU clean wheel), `faster-whisper`, `rapidocr-onnxruntime`, `yt-dlp`, `instaloader`, `duckduckgo-search` (`ddgs`), `groq`, `beautifulsoup4`, `requests`.

### B. Core Python Pipeline
1. **[`ingest.py`](file:///E:/RANDOM_BS/Instagram/ingest.py)** (Lines 1–118):
   - `extract_shortcode(url)`: Extracts unique IDs from Reels (`/reel/`), Posts (`/p/`), and Shorts.
   - `download_media(url)`: Uses `yt-dlp` to download video (`.mp4`) and extracts 16kHz mono audio (`.mp3`) via `ffmpeg`.
   - `download_carousel(url)`: Automatic fallback using `instaloader` to download all image slides of multi-slide photo posts into `downloads/frames/<shortcode>/`.
2. **[`transcribe.py`](file:///E:/RANDOM_BS/Instagram/transcribe.py)** (Lines 1–58):
   - `transcribe_audio(audio_path)`: Uses `faster-whisper` (multilingual `base` model). Automatically runs on CUDA with CPU `int8` fallback. Fully tested on English, Hindi, and Hinglish speech.
3. **[`vision.py`](file:///E:/RANDOM_BS/Instagram/vision.py)** (Lines 1–122):
   - `extract_frames(video_path, fps=0.5, max_frames=8)`: Extracts keyframes using `ffmpeg`.
   - `extract_text_from_frames(frame_paths)`: Uses `RapidOCR` (ONNX Runtime, ~14MB footprint, <40MB RAM). Extracts on-screen code, text, and regex-detected URLs.
   - `analyze_media_frames(path_or_dir)`: Unified analyzer handling both `.mp4` video files and folders of carousel slides.
4. **[`research.py`](file:///E:/RANDOM_BS/Instagram/research.py)** (Lines 1–68):
   - `search_web(query)`: DuckDuckGo search without API keys.
   - `fetch_url_text(url)`: Scrapes live documentation and GitHub snippets via `BeautifulSoup`.
   - `gather_evidence_for_queries(queries)`: Enriches extracted search queries with live web context.
5. **[`verify.py`](file:///E:/RANDOM_BS/Instagram/verify.py)** (Lines 1–138):
   - `_call_groq_json(client, messages)`: Resilient model caller with automatic fallback across `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, and `qwen/qwen3.6-27b`.
   - `extract_claims_and_queries(transcript, ocr_text)`: Fuses audio transcript + on-screen OCR text to extract target tech and search queries.
   - `synthesize_fact_check(transcript, claims_data, evidence, ocr_text)`: Evaluates practical user utility (distinguishing practical shorthand prompts from fake tools), producing structured verdicts (`TRUE`, `PARTIALLY_TRUE`, `HYPE`, `MISLEADING`, `FAKE`) and markdown reports.
6. **[`db.py`](file:///E:/RANDOM_BS/Instagram/db.py)** (Lines 1–130):
   - `init_db()`: Creates SQLite tables: `reels`, `verifications`, `chat_messages`.
   - `save_reel_and_verification(...)`, `get_reel(...)`, `list_all_reels()`, `save_chat_message(...)`, `get_chat_history(...)`.
7. **[`main.py`](file:///E:/RANDOM_BS/Instagram/main.py)**: CLI pipeline runner (`python main.py <URL>`).
8. **[`app.py`](file:///E:/RANDOM_BS/Instagram/app.py)**: Full Streamlit Web UI dashboard with live progress, media/slides viewer, verdict badges, and interactive chat.
9. **[`android_app/`](file:///E:/RANDOM_BS/Instagram/android_app/)**: Complete Native Android project (Kotlin + Jetpack Compose + Material 3 + Room SQLite + Google ML Kit OCR + Google MediaPipe On-Device LLaMA 3.2 / Gemma LLM Inference + Agentic RAG Search in Chat). Supports Instagram `ACTION_SEND` Share Sheet receiver.
10. **[`.github/workflows/android_build.yml`](file:///E:/RANDOM_BS/Instagram/.github/workflows/android_build.yml)**: GitHub Actions cloud CI/CD workflow to build Android APK in the cloud with zero laptop RAM/CPU usage.

---

## 3. Verified Smoke Tests
- **Test 1 (Video Reel - Hindi/Hinglish):** `https://www.instagram.com/reel/DcXzQH5si-A/`  
  *Result:* Transcribed Hindi speech (73.8s), detected on-screen diagram acronyms `OKF`, correctly marked non-existent "Google Open Knowledge Format" as **`HYPE`**.
- **Test 2 (Video Reel - On-Screen Text):** `https://www.instagram.com/reel/DcYcqi5TePT/`  
  *Result:* RapidOCR extracted on-screen `/eli5` text, evaluated practical prompt effectiveness, verdict **`PARTIALLY_TRUE`**.
- **Test 3 (Carousel Post - 8 Image Slides):** `https://www.instagram.com/p/DcYt-CxDV54/`  
  *Result:* Instaloader fetched 8 slides, RapidOCR detected `github.com/deepseek-ai/deepseek-harness`, verified DeepSeek `dsh` agent as **`PARTIALLY_TRUE`**.
- **Test 4 (Multi-Tool Carousel - 7 Slides, 5 Libraries):** `https://www.instagram.com/p/DcOJpsKDEht/`  
  *Result:* Instaloader fetched 7 slides. Intelligent OCR line-stitching recovered `StarLightSearch/EmbedAnything`. Direct GitHub validator verified all 5 repositories (`VectifyAI/PageIndex`, `StarlightSearch/EmbedAnything`, `confident-ai/deepteam`, `skypilot-org/skypilot`, `feyninc/chonkie`) with 100% accuracy and structured comparative breakdown.

---

## 4. What Is Completed & Ready:
1. **Core Python Pipeline**: 100% Complete & Smoke-Tested.
2. **Streamlit Web UI (`app.py`)**: 100% Complete with live progress, media/slides viewer, and chat.
3. **Native Android App (`android_app/`)**: 100% Complete (Share Sheet, ML Kit, Room DB, Material 3).
4. **Cloud CI/CD Workflow (`.github/workflows/android_build.yml`)**: Automated cloud APK compiler.
5. **Documentation & Packaging**: Clean `requirements.txt`, updated `README.md`, `.gitignore`.

---

## 5. Blockers or Open Questions
- None. All dependencies, CUDA/CPU fallback, Whisper STT, RapidOCR, Groq API, and SQLite database are fully working on the machine.

---

## 6. Prompt to Paste in New Session to Resume

```text
I am continuing work on the "Local-First Multimodal Instagram Tech Fact-Checker & Knowledge Agent" in E:\RANDOM_BS\Instagram.

Please read HANDOFF_NOTES.md and PROJECT_SPEC.md.
Both the core Python pipeline, Streamlit Web UI, Native Android App, and React Native Expo App (mobile_app/) with FastAPI backend (api_server.py) are 100% complete and verified.

Session Rules to follow:
1. Reply in caveman style, keep short.
2. Explain only if asked.
3. Never assume — ask first, code only when 100% sure.
4. Two phases always: Phase 1 (analyze/plan) -> Phase 2 (implement + verify).
5. Hardware limits: Windows, GTX 1650 4GB VRAM, 8GB RAM.

We are currently iterating on the React Native mobile UI (mobile_app/) live over USB via Expo Dev Client.
```


---


## 8. Session Handoff - Direct Groq Mobile Flow


- No laptop FastAPI dependency.
- Phone does media/OCR/STT locally, then calls Groq directly.
- User pastes own Groq key in app Setup.
- Keep offline Gemma/STT code for later. Do not remove it.


### Implemented


- Added expo-secure-store and mobile_app/src/services/secrets.js.
- Groq key is encrypted in device storage: getGroqApiKey, saveGroqApiKey, deleteGroqApiKey.
- SettingsScreen has Groq API key field, Save, status, Delete.
- api.js calls Groq direct. No laptop FastAPI URL.
- Flow: native media/OCR/STT, Groq claims/queries, native DDG/GitHub evidence, Groq report, Groq chat.
- Groq fallback: openai/gpt-oss-120b, openai/gpt-oss-20b, qwen/qwen3.6-27b.
- TechFactCheckerModule has gatherEvidence(queries). It uses WebValidator.
- Native analysis uses llamaEngine = null. Do not trigger local Gemma in online flow.
- ChatScreen passes recent chat to Groq chat.
- app.json includes SecureStore plugin.


### Build/test


- JS Babel syntax check passed.
- Git diff check passed.
- Do NOT run local Gradle. Use GitHub Actions debug workflow only.
- Rebuild needed: SecureStore native module and TechFactCheckerModule changed.


### Intended files


- mobile_app/android/app/src/main/java/com/techfactchecker/mobile/TechFactCheckerModule.kt
- mobile_app/app.json, package.json, package-lock.json.
- mobile_app/src/services/secrets.js and api.js.
- mobile_app/src/screens/SettingsScreen.js and ResultScreen.js.


### Do not stage


- HANDOFF_NOTES.md, commands.txt, api_server.py, db.py.
- AndroidManifest.xml, FactCheckEngine.kt, logs, model files, scripts.


### Security


- Groq key was exposed in editor/chat. Revoke it. Make a new key.
- Never put Groq key in source, commands.txt, handoff note, or git.


### Test APK


1. Install GitHub Actions debug APK.
2. Setup: paste new Groq key, Save.
3. Home: test known reel/carousel.
4. Check report, sources, Ask AI.
5. If fail: collect TFC_DEBUG Logcat and Expo JS error.

---

## 7. Current Status Override — September 1, 2026

The sections above describe the older project state. Current priority is **web/mobile alignment first**, then offline mobile inference.

### Current Expo/RN mobile state

- `mobile_app/` is the active app. `android_app/` Compose project is not the active workflow.
- Mobile native pipeline currently downloads media through Render, performs frame OCR, and runs local MediaPipe Gemma.
- Sherpa ONNX multilingual Whisper STT was added in `mobile_app/android/app/src/main/java/com/techfactchecker/app/domain/AudioTranscriber.kt`.
- STT model files are hosted in HF under `fact-checker-stt/whisper-tiny/`:
  - `tiny-encoder.int8.onnx`
  - `tiny-decoder.int8.onnx`
  - `tiny-tokens.txt`
- `SettingsScreen.js` downloads Gemma plus the three STT files.
- `TechFactCheckerModule.kt` extracts Reel audio and calls Sherpa STT before fact checking.
- `FactCheckEngine.kt` has a Gemma search-query stage and evidence-aware report stage.
- `api.js` and `ChatScreen.js` send grounded evidence and recent chat to Ask AI.

### Build/crash history

- GitHub build `33489050542` first failed because Sherpa v1.13.4 uses Kotlin constructors, not builders.
- That was fixed in commit `39fde24`.
- Next build failed because `OfflineRecognizer` requires `(AssetManager?, config)`; fixed in commit `c378f7c`.
- Current origin includes prompt-size cap commit `8fb4c1e`.
- Device crash showed native MediaPipe `SIGABRT`, caused by `prompt_ids.size() >= max_seq_length`, not ordinary RAM OOM.
- Prompt caps were reduced further in local `FactCheckEngine.kt` and `api.js`; check `git status` before pushing.

### Important current design decision

Mobile report quality is weaker than the Python web report because small local Gemma has limited context and output quality. Recommended next direction:

1. Integrate the same Groq-backed analysis path used by the web app.
2. Make mobile and web return the same structured claims/evidence/verdict/report schema.
3. Test accuracy and readability against the web report.
4. Keep offline Gemma/STT as optional fallback after the online baseline is correct.

### Current uncommitted/unrelated files

Do not stage these unless explicitly needed: `HANDOFF_NOTES.md`, `commands.txt`, `adb_logcat.txt`, `colab_script.txt`, `kaggle_script.py`, `modal_compiler.py`, `terminal.txt`, model archives, and extracted model folders.

### Resume prompt

```text
Read E:\\RANDOM_BS\\Instagram\\HANDOFF_NOTES.md first. Current priority: align Expo/RN mobile reports with the working Python web report using Groq, then revisit offline Gemma/STT. Follow two phases: Phase 1 read/analyze/plan, then show exact diff, then Phase 2 implement and verify. Do not stage or push unrelated files. Check git status and current branch first. In Phase 1, fully read and analyze the web app files (`app.py`, `api_server.py`, `ingest.py`, `transcribe.py`, `vision.py`, `verify.py`, `research.py`, `db.py`, `main.py`, `requirements.txt`) and the relevant mobile files before proposing changes. Recent mobile fixes: Sherpa constructor/AssetManager fixes are committed; prompt-size crash was caused by MediaPipe max_seq_length. Local prompt-cap edits may still be uncommitted.
```

---

## 9. Current Status Override — September 4, 2026 (supersedes sections 7 and 8)

Everything below is newer than section 7. Where they disagree, this section wins.

### Where the project actually is

Online mode (Groq) works and is the default. Offline mode (on-device Gemma 3) is
built, runs end to end, and produces a report — but stage 1 entity extraction is
still unreliable. That is the single open problem.

### A. Media extraction — WORKING, with a caveat

On-device WebView extraction (`InstagramExtractor.kt`) replaced the Render cloud
dependency and was verified working on a reel (`SOURCE=WEBVIEW`, TIER_B_HTML).

CAVEAT: on reel `DchQA7CTapw` it has failed three runs in a row —
`TIER_B html chars=270047 videoTag=false videoUrlKey=false displayUrlKey=false`
— and falls back to Render every time. Render still works, so this is not
blocking, but the on-device extractor is degrading for reels and needs a look.

### B. Model swap — DONE

- Old: `gemma-2b-it-cpu-int4.bin`, ~1.3 GB, 512 ctx.
- New: `Gemma3-1B-IT_multi-prefill-seq_q4_ekv2048.task`, 554,661,246 bytes, 2048 ctx.
- Hosted at
  `https://huggingface.co/datasets/Ayush-242/fact-checker-model/resolve/main/Gemma3-1B-IT_multi-prefill-seq_q4_ekv2048.task`
  (verified HTTP 200).
- `tasks-genai` 0.10.14 -> 0.10.24.

Two things that will break a naive version bump, both already handled:

1. In 0.10.24 `setTopK`/`setTemperature` no longer exist on `LlmInferenceOptions`.
   They moved to `LlmInferenceSession`. `LocalLlamaEngine` now opens one throwaway
   session per call, which also stops pipeline stages leaking context into each other.
2. `setMaxTokens` must be 2048 to match the model's `ekv2048` KV cache. A mismatch
   here was the original native SIGABRT.

Backend is pinned to CPU deliberately (`LlmInference.Backend.CPU`) given this
device's MediaTek GPU history.

### C. Jetifier build failure — FIXED

`tasks-genai` 0.10.22+ ships Java 21 bytecode (class major 65). Jetifier's bundled
ASM cannot parse it and fails dependency resolution before compilation:
`Failed to transform tasks-genai-0.10.24.aar using Jetifier ... Unsupported class file major version 65`.

Fix in `mobile_app/android/gradle.properties`:

```properties
android.jetifier.ignorelist=tasks-genai
```

Do NOT downgrade to 0.10.21 to dodge this. 0.10.21 is the last Java 8 build but
predates Gemma 3, so it would fail at runtime on the device instead of in CI.
AGP here is 8.2.1 (pinned by `@react-native/gradle-plugin/gradle/libs.versions.toml`);
its D8 (8.2.42) was tested locally against the AAR and dexes Java 21 fine, so no
AGP bump is needed.

### D. Whisper STT — FIXED (was a hard native crash)

The download URLs used `fact-checker-stt/whisper-tiny/`, but the folder in the HF
dataset is literally named `fact-checker-sttwhisper-tiny` (no slash). All three
files 404'd. `FileSystem.downloadAsync` does not throw on 404 — it writes the
15-byte error body to disk. sherpa-onnx then called `exit(-1)` natively on the
unparseable tokens file, killing the app with no Java stack trace, no tombstone
and an empty crash buffer.

Fixed: correct URLs, HTTP-status and minimum-size validation on every download,
self-healing purge of undersized files when Settings opens, and a separate
"Download Speech Model" button (otherwise it was unreachable once Gemma existed).

STT now works: `STT complete: chars=551, sampleRate=22050`.

### E. Offline 3-stage pipeline — BUILT, stage 1 still unreliable

`FactCheckEngine.analyzeAndVerify` branches on whether a ready `LocalLlamaEngine`
was passed. Online mode passes null and keeps its old cheap path untouched.

- Stage 1 `stageStructure` — transcript/OCR -> TECH, CLAIM1/2, QUERY1/2
- Stage 2 — DuckDuckGo per query, anchored to the product name
- Stage 3 `stageCompare` — claims vs evidence -> TECH_NAME, VERDICT, SUMMARY

Timings: roughly 8s + 1s + 7s on device. Not a performance problem.

Three stage-1 failures observed, in order:

1. `TECH: Apache-2.0` — OCR captured the GitHub page's license badge.
   Fix: token-level boilerplate filter (`isBoilerplate`).
2. `TECH_NAME: Cline\nVERDICT: ...` — Gemma emitted a LITERAL backslash-n instead
   of a newline, so `lines()` returned one blob, the tech name swallowed the
   verdict field, and VERDICT was never parsed at all. Every offline "verdict" up
   to this point was actually the deterministic fallback.
   Fix: `normalizeNewlines()` + `sanitizeName()`.
3. `TECH: Ollama` with the example's exact claim and query — a few-shot example
   added to the prompt was copied verbatim by the 1B model.
   Fix: example removed; grounding check added.

The durable fix is `appearsInSource()`: the product name must actually occur in
the transcript or OCR, compared with punctuation and spacing stripped so
"ForgeCode" matches a spoken "forge code". Prompt wording alone has now failed
twice on a 1B model; this is deterministic code instead. An ungrounded name
discards the entire stage-1 result, because a model that echoed its instructions
produced worthless claims and queries too.

KNOWN GAP: "Claude Code" is spoken repeatedly in the test reel, so it passes
grounding. If stage 1 names the competitor instead of the product, grounding will
not catch it — the check proves a name was mentioned, not that it is the subject.
If that appears, prefer the name nearest "this is called" or the caption rather
than adding more prompt wording.

### F. Ground truth for the test reel (use this to judge any verdict)

`https://www.instagram.com/reel/DchQA7CTapw/` — verified by downloading the audio
with yt-dlp and transcribing locally with faster-whisper `base` (27.8s, 570 chars):

> "The next day of Claude code is going to be full because it is a open source
> coding agent which is performing better than Claude code and you can plug any
> coding model in it... This is called forge code. This is called forge. And it
> has better performance than Claude code on terminal bench 2 which is a
> benchmark for these coding agents. Link repository pin comment in the
> description box below."

- Uploader: `techie007.dev` (Sukhad Anand). Caption: "Forgecode is here".
- Product: **ForgeCode** — `tailcallhq/forgecode`, 7,608 stars, **Apache-2.0**,
  homepage `forgecode.dev`.
- Claims to check: open source; pluggable across any model; outperforms Claude
  Code; specifically beats it on Terminal-Bench 2.

Note the repo's license is Apache-2.0 — exactly the string OCR scraped. The
extractor found the right page and named the wrong thing on it.

Also note: on the Render path the Instagram caption comes back EMPTY, so the
speech transcript is the only text naming the product. That is why the prompt
now leads with "SPOKEN WORDS AND CAPTION (authoritative)".

### G. Settings / offline toggle

`Analysis Mode` switch, default Online. Refuses to enable until the model is
downloaded. `analyzeAndVerify(url, useLocalLlm)` now takes a second argument —
JS is the only caller. Offline mode skips Groq entirely for both analysis and chat.
The screen is wrapped in a `ScrollView` (three cards no longer fit).

### What to do next

1. Rebuild and run reel `DchQA7CTapw` in Offline mode.
2. Read `FACT_CHECK transcript preview=` and compare against section F. This shows
   what on-device Whisper-tiny heard versus the `base` model.
3. Read `FACT_CHECK stage1: tech=`. Expect "forge code"/"ForgeCode". A line reading
   `rejected TECH=... (not in source)` means grounding did its job.
4. If stage 1 keeps producing ungrounded output, stop iterating on the prompt.
   Make offline extraction code-driven — verified GitHub slug plus transcript
   keywords — and use the LLM only for the final summary.

### Verification habits that have paid off here

Do not guess and burn a ~5 minute CI cycle. What has worked:

- `javap` the actual AAR to confirm an API before bumping a version.
- Run AGP's own D8 locally against a dependency to test dexability.
- Replay real logged model output through a Python mirror of the Kotlin parser.
- Get ground truth (yt-dlp + faster-whisper locally) before judging the app.
- `scratchpad/balance.py` brace-checks Kotlin, since local Gradle is banned.

### Still unverified

- Carousel posts under the new pipeline.
- Offline chat with airplane mode on.
- Whether the Result screen renders the offline report acceptably.

### Constraints still in force

- Do NOT run local Gradle. GitHub Actions `Build Debug APK (mobile_app)` only.
- Debug APK does not bundle JS. Metro must be running (`npm start`).
- Never commit the Groq key, HF tokens, or Instagram cookies.
- `commands.txt` is tracked and contains a live HF token the user chose to keep.
  Do not delete it; do not push it. GitHub secret scanning would revoke it.
- Do not stage: `HANDOFF_NOTES.md`, `commands.txt`, `api_server.py`, `db.py`,
  logs, model files, scratch scripts.

### Resume prompt (replaces the one in section 7)

```text
Read E:\RANDOM_BS\Instagram\HANDOFF_NOTES.md, section 9 first — it supersedes
sections 7 and 8. Current priority: get offline stage-1 entity extraction to
name the right product. Online Groq mode already works and is the default.
Ground truth for the test reel is in section 9F: the product is ForgeCode
(tailcallhq/forgecode). Do not run local Gradle; use the GitHub Actions debug
workflow. Metro must be running for the debug APK. Check git status first.
Verify before building rather than guessing — see "Verification habits".
```

---

## 10. Session update — September 4, 2026, evening (supersedes section 9)

Section 9 described a pipeline that named the wrong product. That is fixed. Read
this section for current behaviour; section 9 is still useful for the history of
what was tried and why.

### Where it stands

Offline mode now identifies the right product and produces a report, verified on
reel `DchQA7CTapw`:

```
slugs detected=[dev/cli, rsin/ain]
slugs verified=[]
EVIDENCE health: speech=false (word repetition loop), ocr=true (ok)
EVIDENCE candidates=forgecode(7:domain), Development(1), Environment(1)
tech decided by evidence: forgecode
stage2: results=4+4, pageContext=3/8
stage3: verdict=PARTIALLY_TRUE, summaryChars=426
```

That result was produced with a completely useless speech transcript. The design
survived it, which is the point of everything below.

### A. The core design change — nothing is trusted by position

Earlier versions declared one input authoritative in the prompt ("the SPOKEN
words are authoritative"). That did not fix anything, it only moved the bug to
whichever source failed next. Both sources fail regularly and in opposite
directions:

- Whisper returns a repetition loop or "[inaudible]" on hard audio.
- OCR of a GitHub page returns nothing but licence text and UI chrome.

So `SourceEvidence.kt` (new file) decides the product name in **code**, not in
the model:

1. **Health-check each source independently.** Speech is rejected for being too
   short, too few words, low word diversity (<0.30) or low 4-gram shingle
   diversity (<0.35). OCR is rejected when every readable token is boilerplate.
   A dead source contributes nothing rather than being used anyway.
2. **Mine candidates from every source** — verified repo names, domains
   (including OCR's spaced form "forgecode. dev"), "this is called X" phrases,
   "Name:" headings, hashtags, capitalised words.
3. **Score by corroboration, not by source.** Hard evidence (verified repo or
   domain) scores 6; spoken name 3; heading 3; hashtag 2; capitalised 1. Then
   +3 for appearing in both OCR and speech/caption, +2 for the caption.
4. **Abstain below score 3.** An empty answer beats an invented one.
5. **Web tie-break** only when the top two are within a point and neither came
   from a repo or domain.

The model never picks the name. Stage 1 is given the name and only writes claims
and queries; stage 3 is given the name and only writes a verdict and summary.

### B. Every failure this design caught, in order

Each of these was a real run, and each fix is deterministic code, not prompt
wording. Prompt wording failed twice before this approach was adopted.

1. `TECH: Apache-2.0` — OCR read the licence badge. Fix: boilerplate token set.
2. `TECH_NAME: Cline\nVERDICT: ...` — Gemma wrote a literal backslash-n, so
   `lines()` returned one blob and VERDICT was never parsed. Every offline
   "verdict" before this was silently the deterministic fallback.
   Fix: `normalizeNewlines()`.
3. `TECH: Ollama` with the example's exact claim — a few-shot example in the
   prompt was copied verbatim by the 1B model. Fix: example deleted.
4. `TECH: TECH` — the model echoed the placeholder. Caught by the boilerplate
   filter, but then stage 2 searched the raw junk transcript, DuckDuckGo
   returned song lyrics, and stage 3 produced a confident fact-check of
   **Big Brother's "I'm Just Like You"**. Fixes: never search a raw transcript;
   abstain when no name is decided.
5. `Cloud and` / `on terminal` beat the real name — sloppy Whisper phrases
   scored like product names. Fix: reject any candidate containing a stopword.
6. `ain(9:repo+both-sources)` — an OCR fragment `rsin/ain` was scored as a repo,
   and `contains()` matched "ain" inside "again" for a corroboration bonus.
   Fixes: only GitHub-**verified** slugs score as repos; `contains()` matches on
   whole-token runs so "forge code" still equals "forgecode" but a mid-word
   fragment cannot match.
7. `summaryChars=0` — the model answered `VERDICT:` and stopped. Fix: retry
   asking for the summary alone, then a deterministic summary as last resort.

Pattern worth remembering: every one of these was a signal being looser than
assumed. If a fourth novel identification failure appears, stop tuning signals
and go whitelist-only (verified repo or verified domain, else abstain).

### C. Audio — two real bugs found, one limit that remains

**Bug 1 (fixed): the decoder format was a lie.** `MediaExtractor` reported
22050 Hz mono; the decoder actually emits **44100 Hz stereo**. The old code read
interleaved stereo as mono at half rate, i.e. noise. `AudioTranscriber` now
requests 16-bit, reads the real format from `INFO_OUTPUT_FORMAT_CHANGED`,
handles PCM_FLOAT/8-bit/16-bit, and logs rate/channels/encoding/peak/rms.

It also **dumps the exact buffer sent to Whisper as a WAV**, so a bad transcript
can be diagnosed by listening instead of guessing:

```
adb exec-out run-as com.techfactchecker.mobile cat files/models/whisper-tiny/stt_debug.wav > stt_debug.wav
```

**Bug 2 (fixed): tiny is unusable for names.** It heard the sentence structure
but got every proper noun wrong — "forge code" -> "4D", "Claude" -> "Cloud".
Names are the entire job here.

**Now on Whisper `base`**, downloaded straight from sherpa's own public repo
(`csukuangfj/sherpa-onnx-whisper-base`) — no re-hosting needed. Encoder 29.1 MB,
decoder 130.7 MB, tokens 0.8 MB. `AudioTranscriber` scans for `small` -> `base`
-> `tiny` and uses the largest present, so dropping `small-*` files in later
needs no code change. `SettingsScreen` deletes the old `tiny-*` files only after
a successful `base` download.

**The limit that remains.** `base` got "Claude" right, then collapsed into
"awal awal awal..." for 26 seconds. Model size was never the real gap:

> faster-whisper (the web pipeline) uses `beam_size=5` plus a temperature
> fallback and a compression-ratio check that *detects* a repetition loop and
> retries the segment. sherpa-onnx offers greedy decoding only. Same model,
> none of the machinery that makes it survive Hinglish.

Mitigation now implemented: **chunked transcription**. Audio is decoded in 12s
windows (`CHUNK_SECONDS`), each chunk checked by `isLooped()`, and only healthy
chunks are kept. A loop costs one chunk instead of the whole transcript.

**VERIFIED ON DEVICE September 7, 2026** (reel `Db9M3PYTcxq`, see `TEST_LOG.md`
case 2). It works exactly as designed:

```
STT chunk 1: kept 194 chars: Resumum a good unlimited project start like this...
STT chunk 2: dropped as repetition loop: aad, aad, aad, aad, aad, aad, aad...
STT chunk 3: kept 225 chars: And you have to verify all of that...
STT chunks: total=3 kept=2 dropped=1
```

Without chunking this run would have returned 35 seconds of "aad". The audio
decode fix is also holding: `rate=44100 ch=2 enc=PCM_16BIT, peak=0.953 rms=0.1383`.

Measured cost: the dropped window happened to contain the proper nouns. A
reference faster-whisper pass on the same audio caught "Lord code code x
anti-gravity" (Claude Code, Codex, Antigravity) inside that window; the app lost
all three. The trade is still worth it, but a dropped chunk is not free.

**The audio is Hinglish**, not English — confirmed by OCR on the other test reel
("tum koi 5", "slash exXamples likho"). Do NOT set `language = "en"`; that forces
English decoding on Hindi and makes it worse. `task = "translate"` is untried and
worth an experiment. For an audience of Indian tech creators, Hinglish is the
normal case, so OCR-first is the correct architecture, not a workaround.

### D. Web-pipeline parity (what was ported from the Python app)

| Gap | Status |
|---|---|
| Frames sampled | 4 -> **10**, evenly spaced, with cross-frame line dedupe |
| OCR line stitching | already existed in `OcrEngine.kt` — earlier note was wrong |
| Page scraping into evidence | **added** — `WebValidator.fetchPageText/enrichWithPageText` |
| Groq prompts | **full parity** with `verify.py` — multi-tool rubric, all five verdict definitions, practical-utility rule, deterministic repo-slug query enrichment |
| STT | `base` + chunking vs faster-whisper `base` + beam search |

Frame count mattered more than expected: on `DchQA7CTapw` only frame 7 of 10
carries any text at all (`newLines=18`), and the old 4-frame sampling missed it
in 3 of 4 slots. `uniqueLines` went 3 -> 19.

Page scraping is deliberately bounded: it runs **once over the merged result
list** (offline top 3, online top 4), never per query. Per-query scraping on a
10-query online run would have been ~20 fetches and a long stall.

### E. Verification habits that actually caught bugs

- **Replay real logged input through a Python mirror before building.**
  `scratchpad/evidence_sim.py` mirrors `SourceEvidence.kt` and holds five real
  cases (ChatGPT reel, junk-speech, healthy-speech/dead-OCR, and two ForgeCode
  runs). Every scoring change is checked against all five first. This caught
  regressions that would otherwise have cost a 5-minute CI cycle each.
- **`scratchpad/balance.py`** brace-checks Kotlin, since local Gradle is banned.
  IMPORTANT: it was rewritten after it gave a false OK on a genuinely broken
  file. Its old string-literal regex allowed newlines, so it happily matched
  across a literal broken by a stray real newline and reported balanced code.
  It now forbids newlines inside string literals and prints the offending lines.
- `javap` the actual AAR before bumping a dependency version.
- `curl -sIL` a model URL to confirm it exists and get its real size before
  wiring a download.

### F. Bash heredoc trap — this has now broken a CI build

In this environment a bash heredoc collapses `\\` to `\`. Writing a Python patch
that inserts `"...\\n"` into Kotlin therefore emits a **real newline inside a
string literal**, and Kotlin fails with `Expecting '"'` — one mistake produced
~40 cascading errors in `FactCheckEngine.kt`.

Use `B = chr(92)` and build escapes as `B + 'n'`, or use the Write/Edit tools
for anything containing backslashes. Then run `balance.py`.

### G. Still unverified

- Whether chunking recovers "forge code" from the Hinglish audio.
- Carousel posts under the current pipeline.
- Offline chat with airplane mode on.
- Whether the Result screen renders the offline report acceptably.
- `task = "translate"` as a Hinglish strategy.

### H. Known open issues

- **WebView extractor fails on `DchQA7CTapw`** every run — `videoTag=false`,
  falls back to Render. It works on other reels (`DcYcqi5TePT` gave
  `SOURCE=WEBVIEW`), so this is reel-specific, not broken.
- OCR produces junk slugs (`dev/cli`, `rsin/ain`). Harmless now that only
  GitHub-verified slugs score, but it means `repos=2` in the logs is noise.
- The 1B model pads summaries with scraped page text. Cosmetic.

### I. Constraints still in force

- Do NOT run local Gradle. Use GitHub Actions `Build Debug APK (mobile_app)`,
  which is `workflow_dispatch` only: push, then `gh workflow run`.
- Debug APK does not bundle JS. Metro must be running (`npm start`).
- Never commit the Groq key, HF tokens, or Instagram cookies.
- `commands.txt` is tracked and contains a live HF token the user chose to keep.
  Do not delete it; do not push it.
- Do not stage: `HANDOFF_NOTES.md`, `commands.txt`, `api_server.py`, `db.py`,
  logs, model files, scratch scripts.

### J. The project's actual goal, restated

The aim is an app that needs **no API keys**, not one that is air-gapped —
offline mode already calls DuckDuckGo and GitHub. All *reasoning* is on-device
and that is intact. Current on-device stack is at the small end of what is
possible: Whisper `base` and a **1B** Gemma. Whisper `small` and Gemma 3 4B are
available before "offline cannot do this" is actually true.

### Resume prompt (replaces the one in section 9)

```text
Read E:\RANDOM_BS\Instagram\HANDOFF_NOTES.md, section 10 first - it supersedes
section 9. Offline mode now correctly identifies ForgeCode on reel DchQA7CTapw
using OCR evidence, despite a useless speech transcript. Immediate next step:
verify chunked STT on device (grep logcat for "STT chunks:") and see whether it
recovers "forge code" from the Hinglish audio.

Rules: do not run local Gradle, use the GitHub Actions debug workflow
(workflow_dispatch, so push then `gh workflow run`). Metro must be running.
Before any Kotlin change, replay scratchpad/evidence_sim.py and run
scratchpad/balance.py. Beware the bash heredoc backslash trap - it has already
broken one build. Check git status first.
```

---

## 11. Session update — September 7–8, 2026 (supersedes section 10)

Section 10 described an app whose offline pipeline named products correctly. This
session worked almost entirely on the **online (Groq) path**, because the user
decided to ship the API version first — LinkedIn, GitHub, resume — and move to
the offline/LoRA plan afterwards. `MIGRATION_PLAN.md` is unchanged and still
correct for that later phase.

**The single most important thing in this file: a two-system test harness now
exists, with ten recorded cases in `TEST_LOG.md`. Read that file before changing
any pipeline code.** Everything below was learned from it, and several fixes in
earlier sections turned out to be wrong when measured against it.

### A. What the project is now

Paste an Instagram link → the app extracts media on-device, OCRs frames,
transcribes audio, gathers evidence, and renders a fact-check card.

Two modes, and this session touched only the first:

- **Online** (`useLocalLlm=false`): native extraction + OCR + STT, then all
  reasoning in JS via Groq (`openai/gpt-oss-120b`). This is what ships.
- **Offline**: the native 3-stage Gemma pipeline from section 10. **Untouched this
  session.** Do not assume fixes below apply to it — most are JS-only.

### B. The test harness — use it, do not skip it

`TEST_LOG.md` holds two sets of five real Instagram posts.

- **System 1** = ground truth. `ground_truth.py <url>` downloads the post, cuts 12
  evenly spaced frames, extracts audio, and transcribes with faster-whisper
  (`beam_size=5`). The agent then reads the frames **with its own eyes**, verifies
  claims against live APIs, and writes a verdict into `TEST_LOG.md` **before the
  app is run**. That ordering is the integrity guarantee; do not relax it.
- **System 2** = the app. One CSV row per run, written by
  `mobile_app/src/services/runlog.js` to the device and echoed to Metro as
  `===== TFC CSV ROW =====`.

Pull the CSV with:

```powershell
adb exec-out run-as com.techfactchecker.mobile cat files/factcheck_runs.csv | Out-File -Encoding utf8 runs_setN.csv
```

`Out-File -Encoding utf8`, never `>`. Plain `>` writes UTF-16 and corrupts the
file — the same trap that ruined a screenshot earlier in the session.

Archived: `runs_set1.csv`, `runs_set2.csv`. Device file cleared between sets.

**Batch, never one at a time.** The most expensive mistake of this session was
fixing against a single reel and re-testing on that same reel. The user caught it.
Run all five, then analyse.

### C. Results so far

**Set 1** (nanobot, paper2code, nemotron, five-repos, gemini-web2api): 3/5.
**Set 2** (prompts-leaks, magnitude, claude-limit, free-hosting): **the model got
3/4; a deterministic rule the agent added turned one correct answer into a miss.**

Three diseases were identified from set 1 and they still frame everything:

1. **The pipeline is blind and does not know it.** Carousel extraction sees ~4
   slides regardless of post length; `techName=Unknown Technology` was logged in
   three of five runs and silently overridden every time.
2. **Invented specifics**, 4 for 4 in set 1: an 18-star fork cited over a
   389k-star original, a fabricated project ("HybridMAS"), a fabricated hardware
   requirement ("4x H100" where NVIDIA documents 1x), a fabricated platform limit
   ("Windows only" for a Docker/Ubuntu-first project).
3. **The verdict does not engage with framing.** It reached FAKE only when it
   believed a subject did not exist; HYPE and MISLEADING — the verdicts that need
   judgement rather than lookup — were unreachable for a long time.

### D. What was built this session

All JS unless marked. **JS changes need only a Metro reload; Kotlin needs a
GitHub Actions build.**

**Multi-provider API support** (`api.js`). Seven providers detected from the key
alone — Groq/OpenRouter/NVIDIA/OpenAI/Google by prefix, Mistral (32 alnum) and
Cohere (40 alnum) by length. Verified against all six of the user's real keys.
An unrecognised key now raises a named error instead of silently falling back.
Cohere's URL was wrong (`api.cohere.com/v1/chat/completions`; the OpenAI-compatible
door is `api.cohere.ai/compatibility/v1/chat/completions`).

**Also found and fixed: the Provider and Model override boxes in
`SettingsScreen.js` had no `value` and no `onChangeText`.** Typing in them did
nothing; the feature had never worked.

**Rate-limit handling.** Groq's free tier is **8000 tokens per minute per
organisation**, not per model, so the model fallback chain hit the same wall
instantly. The code now parses Groq's own stated wait ("try again in 10.5075s")
and retries the same model, but does **not** wait on "request too large" — a
single oversized request never succeeds by waiting. Payload is budgeted: 12
evidence rows, 300-char page context, 3000-char transcript and OCR caps.

**Structured report + `ReportCard.js`.** The synthesis prompt used to ask for
markdown inside a JSON string, which React Native cannot render — tables arrived
as raw pipes and `ChatScreen.js` carried ten regexes trying to scrub them. The
model now returns **fields**; the app renders components. Verdict chip, tool
blocks with verified/not-found badges, tappable repo links, monospace install
commands. `verify.py` got the same treatment on the Python side.

**The claim router** (`verifiers.js`, new file). Search finds; structured APIs
verify. All keyless, which matches the project's no-API-key goal:

| Source | Answers |
|---|---|
| PyPI / npm | does this package exist, and is it the right one |
| OpenRouter `/api/v1/models` | is this model free, what is its context length |
| HuggingFace | does this model exist, how used |
| Hacker News Algolia | was this actually discussed, and when |
| GitHub search | a tool named without a slug |
| **GitHub redirect on `name/name`** | **renames** |
| **DDG via Jina** | **what people say about a technique** |
| OCR + pricing pages | billing catches |

Routing is regex in code — sub-millisecond, no extra model call. Never route with
an LLM; that gives back the latency this exists to save.

**The rename resolver deserves special mention.** `clawdbot/clawdbot` 301s to
`openclaw/openclaw` (389k stars). That single fact was missed in **every** run of
set 1, and search cannot find it — a rename changes the name, so searching
"clawdbot" returns only forks and ports.

**Jina Reader** (`r.jina.ai/<url>`). Half the evidence in every recorded run came
back with `pageChars=0`, because GitHub, DeepWiki and most doc sites render
client-side and Jsoup saw an empty shell. Jina returns clean text for those.
Bounded to 2 rows to limit latency.

**The subject picker** — the clearest win of the session. Order of trust: a repo
the evidence verified whose name the post shows → the model's name if it survives
chrome and headline filters. If nothing survives, the card says **"Could not
identify the tool"**. Set 1 named a **window title** (`sparkly-api`) and a
**caption headline** (`5 free GitHub repos`); set 2 scored **4/4** on reels it was
never tuned against.

**Kotlin** (needs a build): `WebValidator.kt` gained a session cache for repo
metadata and READMEs, README fetching from `raw.githubusercontent.com` (a CDN, so
it does not spend the 60/hour API budget), fork detection that rewrites a citation
to the parent repo, and honest degradation — on a 403 with
`x-ratelimit-remaining: 0` it marks `gitHubRateLimited` and returns null **without
caching that as "missing"**. `InstagramExtractor.kt` gained `EXTRACT: candidate[N]`
logging, which is **uncommitted and unbuilt**.

### E. Corrections the agent had to make to its own work

Record these; they are the pattern.

- **Ground truth was wrong once.** The agent called the Claude-Code-limit reel
  FAKE, reasoning from an *absence* of Hacker News discussion. The user proposed
  searching what people say *about* the technique. That revealed two different
  limits: **conversation length** (local, in log files — deleting them genuinely
  helps) and **usage quota** (server-side, 5-hour and weekly windows, with an
  official `/limit-reset` command). The reel conflates them, which is
  **MISLEADING**, not FAKE. Absence of evidence was the wrong instrument.
- **A deterministic rule was actively harmful.** A "MISLEADING → HYPE if all tools
  verified" rule fired twice and was wrong both times, most damagingly by
  softening a *correct* MISLEADING because "Claude Code" is a real tool. Tool
  existence says nothing about whether a claim *about* that tool is honest.
  Removed; the comment in `api.js` says do not re-add.
- **An install rule deleted a correct command.** It removed `pip install httpx`,
  which is gemini-web2api's own documented first step, because httpx's summary
  reads unrelated. A dependency is not a wrong package. It now drops only on
  *verified absence* (a 404 from PyPI).
- Two bugs were in the agent's own checks, found by testing rather than assuming:
  comparing against `pagePreview` (text the code writes itself, which repeats the
  package name, so "is it related" always passed), and an `ai|agent|bot` regex
  matching **"bot" inside "robot"**.
- **`\b` and `\s` inside a JS template literal** are a backspace character and the
  letter s. A regex built that way silently never matched, and fabricated packages
  sailed through.

**Standing lesson: prefer rules that fetch a fact over rules that adjust a
judgement.** The subject picker replaces a guess with a lookup and has never
misfired. Every rule that nudged a verdict has needed correcting.

### F. Two runtime crashes worth remembering

Both are runtime-only, so `babel.transformFileSync` passes them happily.

1. `ReferenceError: Property 'err' doesn't exist` — a `setMessages` updater closed
   over a **catch parameter**. Hermes cannot capture a catch binding inside a
   closure. Read the error outside the updater. (The emoji theory in the earlier
   Gemini handoff was a red herring; the emoji is gone anyway.)
2. A dangling `reportText` reference after a refactor.

**Use the scope-aware scan** — it catches both:

```
node -e "const babel=require('@babel/core');const traverse=require('@babel/traverse').default; ..."
```
It walks `ReferencedIdentifier` and reports anything with no binding. Run it on
every changed JS file. Full command is in this session's transcript and is worth
saving as a script.

Also fixed in `ChatScreen.js`: the analysis ran **twice** (the effect refired on
`setCurrentReel`), which duplicated messages and **paid Groq twice per reel**; and
a race where the post-analysis effect could reload an empty history and replace
the finished report with the generic welcome message.

### G. What needs doing next

**Immediately: run set 3.** Five fresh posts, ground truth first. Keep the shapes
that are still failing:

1. **A pricing claim.** The OCR billing-catch detector was added but has **never
   run on the device**. Tested offline only:
   `"Billed triennially" -> CATCH`, `"Free forever plan" -> clean`.
2. **A technique claim.** Same — `checkTechnique` works in isolation but is
   unverified on device.
3. A carousel with **more than four slides**, to confirm the blindness below.
4. Something genuinely fabricated. Across ten recorded cases the app has still
   never correctly identified a fake.
5. A news or company claim with no repo at all — the HN path is barely exercised.

**Known unfixed, in priority order:**

1. **Carousel blindness (structural).** Instagram's `/embed/captioned/`
   lazy-loads slides; the extractor reads the DOM once after 3000ms and gets ~4
   images regardless of post length. On a 9-slide listicle it saw 4 and then
   **denied that ComfyUI (131k stars) and Wan2.1 (16.9k) exist** — both were on
   slides it never loaded. `InstagramExtractor.kt:292` allows 12; the limit is the
   source, not the app. `ground_truth.py` gets all 9 via instaloader, so the data
   is reachable. Cheapest fix: OCR the "01 / 09" counter the slides print on
   themselves and, when the declared total exceeds images obtained, say the
   extraction was incomplete instead of answering confidently.
2. **Cross-post contamination.** The extractor also pulls images from *suggested
   posts*. On the nanobot carousel the OCR contained an unrelated data-science
   workshop and a Hidden Markov Model post, and stage 1 dutifully extracted claims
   from them. The agent spent three sessions calling "Hidden Markov Model
   framework" a hallucination; it was contamination. `isJunkImage` already filters
   avatars, but these are full-size media with the same CDN path shape. The
   `candidate[N]` logging was added to find the distinguishing field — **build and
   run it before writing any filter**, or you are guessing.
3. **Speed.** Set 1 mean 40.3s, set 2 mean **50.4s**. Jina cost more than
   parallelising the router saved, and the router now runs *after* search because
   the pricing check needs the results. Fifty seconds is past the patience line
   for "paste a link".
4. **Abstention is still ignored.** When `SourceEvidence` returns no name, that
   fact never reaches the report. The subject picker helps but does not close it.
5. **The offline path has none of this session's work.** Its `buildSearchQuery`
   still concatenates transcript first and truncates at 240 chars, so OCR — the
   better signal — falls off the end. `FactCheckEngine.kt:141` also still searches
   the raw transcript in online mode, the bug that once produced a confident
   fact-check of a Big Brother song.

### H. Constraints still in force

- **Do NOT run local Gradle.** Use GitHub Actions `Build Debug APK (mobile_app)`,
  which is `workflow_dispatch` only: push, then `gh workflow run`.
- Debug APK does not bundle JS. **Metro must be running** (`npm start`).
- Never commit the Groq key, HF tokens, or Instagram cookies. **`commands.txt` is
  tracked and contains live keys the user chose to keep** — do not delete it, do
  not push it. The user has pasted six live API keys into the chat; they are worth
  rotating.
- Do not stage: `HANDOFF_NOTES.md`, `TEST_LOG.md`, `MIGRATION_PLAN.md`,
  `commands.txt`, `api_server.py`, `db.py`, logs, model files, scratch scripts.
- **Bash heredocs collapse `\\` to `\`.** This has broken a CI build and, this
  session, corrupted a template literal three separate times. Use `B = chr(92)`,
  or the Write/Edit tools, then run `scratchpad/balance.py` for Kotlin.
- Reply style this session was "caveman, short". Check whether that still applies.

### I. File map

**JS (Metro reload only):**
- `mobile_app/src/services/api.js` — providers, rate limits, prompts, subject
  picker, evidence rules, normaliser, pipeline logging
- `mobile_app/src/services/verifiers.js` — the router (new)
- `mobile_app/src/services/runlog.js` — CSV (new)
- `mobile_app/src/components/ReportCard.js` — the card (new)
- `mobile_app/src/screens/ChatScreen.js` — report rendering, crash fixes
- `mobile_app/src/screens/SettingsScreen.js` — provider/model overrides

**Kotlin (needs an Actions build):**
- `.../domain/WebValidator.kt` — cache, raw README, fork detection *(built)*
- `.../mobile/TechFactCheckerModule.kt` — README into evidence *(built)*
- `.../domain/InstagramExtractor.kt` — candidate logging *(NOT built)*
- `.../domain/FactCheckEngine.kt`, `SourceEvidence.kt`, `AudioTranscriber.kt` —
  offline path, untouched this session

**Python:** `verify.py` (structured fields), `ground_truth.py` (System 1 capture)

**Docs:** `TEST_LOG.md` (read first), `MIGRATION_PLAN.md` (offline phase),
this file.

### J. Exact git state at handoff (September 8, 2026)

Last commit: `e9668a3 fix: read repo READMEs off the raw CDN, cache GitHub lookups,
prefer canonical repo over fork`. That commit is **built and installed** — the
GitHub cache, raw-CDN README fetching and fork detection are live on the device.

**Committed and built:** `WebValidator.kt`, `TechFactCheckerModule.kt`,
`ChatScreen.js`, `SettingsScreen.js`.

**Uncommitted and NOT built (Kotlin) — needs an Actions build to take effect:**
- `InstagramExtractor.kt` — the `EXTRACT: candidate[N] <url>` logging added to
  diagnose cross-post contamination. Useless until built.

**Uncommitted (JS) — live on a Metro reload, no build needed:**
- `api.js` — subject picker, evidence rules, router wiring, token budget,
  temperature 0, pipeline logging
- `verifiers.js` — **new, untracked**
- `runlog.js` — **new, untracked**
- `ReportCard.js` — modified since its commit

**Also uncommitted, deliberately:** `verify.py` (structured fields),
`ground_truth.py`, `TEST_LOG.md`, `MIGRATION_PLAN.md`, `runs_set1.csv`,
`runs_set2.csv`, `ground_truth/` captures.

So: **a fresh session can reload Metro and immediately test everything except the
extractor logging.** If set 3 includes a carousel with more than four slides,
commit and build `InstagramExtractor.kt` first so the candidate URLs are captured
on that run.

### Resume prompt (replaces the one in section 10)

```text
Read E:\RANDOM_BS\Instagram\TEST_LOG.md first, then HANDOFF_NOTES.md section 11.
Ten recorded test cases exist; every claim in section 11 was measured against
them, and several earlier "fixes" were wrong when tested.

Immediate task: run set 3. Five fresh Instagram posts. Capture ground truth with
ground_truth.py and write System 1 verdicts into TEST_LOG.md BEFORE running the
app - that ordering is the integrity guarantee. Then run all five in the app,
pull runs_set3.csv, and analyse the batch. Do not fix between cases.

Include a pricing claim and a technique claim: the OCR billing-catch detector and
checkTechnique were both added at the end of the last session and have never run
on a device.

Rules: JS changes need only a Metro reload; Kotlin needs the GitHub Actions
workflow (workflow_dispatch, so push then `gh workflow run`) - never local Gradle.
Run the scope-aware undefined-identifier scan on every changed JS file; two
runtime crashes this session passed a plain babel compile. Prefer rules that
fetch a fact over rules that adjust a judgement - every verdict-nudging rule
added so far has needed correcting, and one was actively harmful.
```

---

## 12. Session update — September 8–9, 2026 (supersedes section 11)

Section 11 ended with "run set 3". Sets 3 and 4 were run, the first real fixes to
the pipeline landed, and the way the project measures itself changed. **Read
`TEST_LOG.md` first** — it now holds nineteen recorded cases and the stage
scoreboard that replaced verdict-only scoring.

### A. The one-paragraph state of things

Four stages are scored per run — **seeing, naming, invention, verdict**. Set 4
(nine runs) scored **6/9, 6/9, 7/9, 4/9**. The plumbing improved and is
measurable; the verdict did not. On the five posts re-tested from set 3 the
verdict actually went **2/5 → 1/5**, so the headline 4/9 is flattered by four
easier new posts. Everything that is broken is now traceable to a named stage
instead of a general impression.

### B. What changed this session

**Cookies for System 1** (`ingest.py`). Some posts return an empty media response
to both yt-dlp and Instaloader while other posts fetch fine from the same IP in
the same minute — they are login-gated, not rate-limited. `ingest.py` now loads
`www.instagram.com_cookies.txt` (Netscape export, **gitignored**, never staged)
into yt-dlp's `cookiefile` and into Instaloader's session. This also closes case
2E, which had been unreachable for two sessions. Helpers: `cookie_file()` and
`load_cookies_into()` near the top of `download_carousel`.

**The run log carries the whole run** (39 columns, going to 40). Three sets were
scored from counters, and every disease-level finding needed the report text,
which no column held. Now in the CSV: `reportJson`, `evidenceJson`, `claimsJson`,
`transcript`, `ocrText`, `subjectName`, `subjectWhy`, `verifiersFired`,
`stageMs`, `mediaSource`, `extractVia`, `slidesJson`, `slidesDom`, `imagesUsed`,
`ocrLens`, `sttStats`, `candidates`, `coverage`. **A batch is now analysable from
one file — no logcat, no screenshots, no Metro scrollback.** That matters because
the logcat buffer rolls within minutes and set 3's native logs were gone before
the batch was analysed.

**The replay harness** — `mobile_app/tools/replay.js`, expectations in
`mobile_app/tools/expected.json`. Replays any run CSV through `pickSubject` and
`normalizeReport` on the laptop, no device, no network, in under a second, and
prints the four-stage scoreboard:

```
cd mobile_app
node tools/replay.js ../runs_set4.csv
```

It stubs `react-native`, `axios`, `expo-secure-store` and `expo-file-system`, and
loads the real `api.js` through `@babel/register`, so there is one source of
truth. `api.js:729` exports `__test` for it. **It found three defects in fixes
that reasoning had passed**, and it killed a fourth fix that turned out to fire on
zero recorded cases.

**Fixes that landed, and what each is worth (measured, not assumed):**

| Fix | File | Result |
|---|---|---|
| Thumbnail/rendition filter | `InstagramExtractor.kt:91-94, 328-334` | **Cross-post contamination eliminated.** Same post: 5 images → 2, stage-1 tools `BASE, Graphify, Claude, FABLE 5.1` → `BASE, Graphify`. The flat denial "BASE has no public repository" became `ChristopherKahler/base`, verified |
| Silence gate | `AudioTranscriber.kt:41, 109-113` | Both silent carousels now `silent=true, speechChars=0`. The `"Iw'n gweld."` hallucination is gone; a 6-second music reel at peak 0.470 was correctly **not** silenced |
| Picker: rank by mentions, hyphen-normalise, reject <4-char repo names | `api.js:609+` | `rlm` → **prime-agent** |
| Picker: demote a tool the post dismisses | same | `graphify` → **base** on "Smart Devs Don't Use Graphify" |
| Picker: abstain at zero OCR mentions | same | `Sachifinance` (a creator's handle) → honest blank |
| `checkTechnique` trigger widened to money/method words | `verifiers.js:479` | **Fired on a device for the first time in four sets**, on both earnings posts and neither tool post. Produced the app's first real rate check |
| `runVerifiers` returns `{rows, fired}` | `verifiers.js:403, 493` | `verifiersFired` proves whether a router ran at all |
| Slide-coverage warning | `api.js:346` (`slideCoverage`), `:391` (prompt line), `:821` (call site) | Reads the post's own `01/08` counter; when the declared total exceeds images fetched, the synthesis prompt is told not to conclude a tool is absent. **Unverified on device** — see blockers |

**Two measurement bugs found and fixed** (they are why some earlier analysis was
guesswork):
- `evidenceRules` was blank in **every set ever recorded**: `normalized.__rules`
  was read by the run log and never assigned. Now set at `api.js:566`.
- `coverage` was passed to `logRun` but missing from `COLUMNS` in `runlog.js`, so
  it was silently dropped from set 4.

### C. Corrections the agent made to its own work — the pattern continues

- **"Mindrift appears 7 times in the OCR"** was wrong. It appears **once**, inside
  a URL. The 7 was counted over a scratch file that contained System 1's own
  notes — the reference tool contaminating its own measurement. Corrected in
  `TEST_LOG.md`.
- **A domain-based picker rule was written and deleted.** It read a brand out of
  `mindrift.toloka.ai`, but the harness showed it firing on no recorded case and
  choosing `toloka` (the parent company) when it did. Machinery no case exercises
  will be wrong the first time it matters.
- **The heredoc trap struck twice.** `\b` inside a bash heredoc feeding Python
  becomes a literal **backspace character** in the output file — invisible in an
  editor, and it silently disabled two word boundaries in a regex. Detect with
  `s.count(chr(8))`; the sweep is in `TEST_LOG.md`'s fixes section. **Use the
  Write/Edit tools for anything containing backslashes.**

### D. Open questions the user asked, answered here so the next session inherits them

**1. How to improve accuracy other than testing and development?**

Ranked by expected value against the recorded failures:

- **Feed it better input, not better prompts.** Every remaining verdict failure
  traces to something the pipeline could not see: 2 of 7 and 2 of 8 carousel
  slides, a repo slug that lives in a pinned comment or a DM. Carousel pagination
  and reading the first comment are worth more than any prompt edit. Three
  sessions of prompt tightening produced the note at `api.js:477` — *"Asking more
  firmly does not work"*.
- **Change the model.** Everything runs on Groq's free `openai/gpt-oss-120b` with
  an 8,000-token-per-minute organisation cap, which is why the payload is
  budgeted to 12 evidence rows and 300-character page context. There are six
  live keys and seven providers wired in `api.js` `PROVIDERS`. A stronger model
  on a larger context is a one-line change and has never been tried — and the
  CSV now makes it measurable in one batch.
- **Use the test log as few-shot examples.** Nineteen cases with correct verdicts
  and stated reasons exist. Two or three in the synthesis prompt — especially a
  HYPE and a MISLEADING — target the one stage that has not moved, without adding
  another verdict rule.
- **Split the verdict into two questions.** "Are the tools real" is decidable from
  evidence; "is the framing honest" is a judgement. The comment at `api.js:531`
  already says this. Asking one model for one word is what produced first a
  PARTIALLY_TRUE reflex and then a MISLEADING reflex.
- **Rank evidence by canonicality.** Stars and `fork: true` are one API field
  away and would have prevented three set-1 failures.
- **Improve OCR input quality** — upscale before recognition. The set-3 OCR read
  `Polyforn Noncornnercial` for "PolyForm Noncommercial" and `hdrift` for
  "mindrift"; the licence catch survived only because the word was repeated ten
  times.

**2. Is there a saturation point, after which local-model training starts?**

Yes, and it is definable — but the current failures are **not** model failures, so
training now would be measuring the wrong thing. A fine-tuned local model cannot
see a slide the extractor never fetched.

Proposed exit criteria, all readable from one CSV via the replay harness:

| Stage | Gate |
|---|---|
| seeing | ≥ 8/9 — carousels paginated, coverage declared when incomplete |
| naming | ≥ 8/9 — with abstention consumed, so a blank is honest rather than overridden |
| invention | 9/9 — every repo, install, price and spec traceable to a fetched row |
| verdict | this is then the **only** free variable |

When the first three are green and the verdict still misses, the miss is
attributable to the model, and that is the moment a swap or a fine-tune is
measurable. `MIGRATION_PLAN.md` is still correct for that phase.

Two practical notes for it. First, the corpus is already being built: every run
CSV stores `transcript`, `ocrText`, `evidenceJson` and `reportJson`, which is
exactly an input→output training pair, and `TEST_LOG.md` holds the corrected
target verdict. Nineteen cases is a test set, not a training set — a realistic
fine-tune needs a few hundred, so keep batching. Second, the hardware: a **GTX
1650 with 4 GB VRAM** cannot fine-tune anything near 120B, and QLoRA on even a 7B
is tight. Training belongs on Colab/Kaggle/Modal — `colab_script.txt`,
`kaggle_script.py` and `modal_compiler.py` are already in the repo from the
earlier offline phase. Inference on device stays with the sherpa-onnx Whisper
model and the Gemma pipeline described in section 10.

### E. Blockers and open questions

1. **Abstention is still ignored — fifth set running, and now the top item.** The
   picker abstains correctly and the report fact-checks the model's guess anyway:
   set 4 published a FAKE verdict about `Sachifinance`, a creator's Instagram
   handle, on a run where the picker had already returned a blank. The fix has two
   halves: tell the synthesis prompt there is no confirmed subject, and let the
   card say so.
2. **Carousels still yield 2 slides.** The filter removed junk; it did not add the
   missing. `DcbFunokXyI` 2 of 7, `DW7TbBXmey3` 2 of 8. This blocked two separate
   findings in set 4, including a live rename test (`safishamsi/graphify` →
   `Graphify-Labs/graphify`, 116,130 stars) that never happened because the slug
   was on slide 4. The embed lazy-loads; the extractor reads the DOM once after
   3000 ms. Driving the carousel's next control in the WebView is the real fix.
3. **The coverage warning is unverified on device** — the column was dropped by
   the `COLUMNS` bug, so there is no evidence it reached the model. The next run
   answers it.
4. **The verdict has not improved.** 3C (HYPE) and 3D (MISLEADING) both failed
   while the report's own gotchas contained the right facts. It is the only stage
   nothing structural has been done to.
5. **One verdict-nudging rule is still live** (`api.js:545-549`): `TRUE` →
   `PARTIALLY_TRUE` when no tool was verified. It fired on the YC post and matched
   System 1 — but only because a credits programme contains no software. It
   punishes any subject that is not a repo. Watch it.
6. **Speed regressed** to a **54.3s** mean (set 3: 45.9s). `stageMs` attributes
   about 26s of that to native extraction, OCR and STT — half the wall clock, and
   nothing has ever been optimised there.
7. **Ordering was violated for four cases.** Set 4's new posts were run in the app
   before System 1 wrote ground truth. Agreement on those four is softer evidence
   and `TEST_LOG.md` says so. Do not let it happen again.

### F. Git state

Last commit: `8615e59 fix: drop thumbnail renditions from carousel slides, never
transcribe silence` — **built and installed**, so the thumbnail filter and the
silence gate are live on the device.

**Committed and built (Kotlin):** `InstagramExtractor.kt`, `AudioTranscriber.kt`,
`TechFactCheckerModule.kt`.

**Uncommitted (JS) — live on a Metro reload, no build needed:** `api.js`
(picker rewrite, slide coverage, `__test` export, `__rules` assignment, stage
timings, new log fields), `verifiers.js` (**untracked**, technique trigger,
`{rows, fired}`), `runlog.js` (**untracked**, 40 columns),
`mobile_app/tools/` (**untracked**: `replay.js`, `expected.json`).

**Uncommitted, deliberately:** `ingest.py` (cookies), `.gitignore`,
`TEST_LOG.md`, `HANDOFF_NOTES.md`, `MIGRATION_PLAN.md`, `ground_truth.py`,
`ground_truth/`, `runs_set1..4.csv`, `www.instagram.com_cookies.txt`
(**gitignored — full Instagram session, never commit or share**).

Nothing needs a build to continue. The next Kotlin change is carousel
pagination.

### G. File map (unchanged paths from section 11, plus new)

**JS — Metro reload only:**
- `mobile_app/src/services/api.js` — providers, prompts, `slideCoverage:346`,
  `synthesizeFactCheck:361`, `applyEvidenceRules:484`, `pickSubject:609`,
  `normalizeReport:686`, `__test:729`, pipeline at `:800+`
- `mobile_app/src/services/verifiers.js` — router; `checkTechnique:310`,
  `checkPricing:344`, `runVerifiers:403`, `TECHNIQUE_HINT:479`
- `mobile_app/src/services/runlog.js` — 40-column CSV
- `mobile_app/src/components/ReportCard.js`, `src/screens/ChatScreen.js`
- `mobile_app/tools/replay.js`, `mobile_app/tools/expected.json` — the harness

**Kotlin — needs an Actions build:**
- `.../app/domain/InstagramExtractor.kt` — `isThumbnail:91-94`, filter `:328-334`
- `.../app/domain/AudioTranscriber.kt` — `SILENCE_PEAK:41`, gate `:109-113`,
  `lastStats:73`
- `.../mobile/TechFactCheckerModule.kt` — bridge diagnostics `:337+`
- `.../app/domain/FactCheckEngine.kt`, `SourceEvidence.kt` — offline path,
  untouched for three sessions

**Python:** `ground_truth.py` (System 1 capture), `ingest.py` (cookies),
`verify.py`

**Data:** `runs_set1.csv` … `runs_set4.csv`, `ground_truth/<shortcode>/`

**Docs:** `TEST_LOG.md` (read first), `MIGRATION_PLAN.md`, this file

### H. Constraints still in force

- **Never run local Gradle.** GitHub Actions `Build Debug APK (mobile_app)`,
  `workflow_dispatch`: push, then `gh workflow run "Build Debug APK (mobile_app)"`.
- Debug APK does not bundle JS — **Metro must be running** (`npm start`).
- Pull the CSV with `Out-File -Encoding utf8`, never plain `>` (UTF-16 corrupts it).
- Clear the device CSV between sets:
  `adb shell run-as com.techfactchecker.mobile rm -f files/factcheck_runs.csv`
- Do not stage: `HANDOFF_NOTES.md`, `TEST_LOG.md`, `MIGRATION_PLAN.md`,
  `commands.txt` (**tracked and contains live keys — never push**),
  `www.instagram.com_cookies.txt`, `api_server.py`, `db.py`, logs, model files,
  scratch scripts, run CSVs.
- **Bash heredocs collapse backslashes and turn `\b` into a backspace character.**
  Use the Write/Edit tools for anything containing backslashes; sweep with
  `chr(8)` afterwards.
- Run the scope-aware undefined-identifier scan on every changed JS file — two
  Hermes-only crashes passed a plain babel compile.
- **Prefer rules that fetch a fact over rules that adjust a judgement.** Every
  verdict-nudging rule added to this project has needed correcting and one was
  actively harmful.
- Reply style: caveman, short. Explain only when asked.
- The folder cannot be renamed without losing session history; the user asked and
  decided against it. It stays `E:\RANDOM_BS\Instagram`.


### I. Token budget, provider choice, and why truncation is the wrong knob

Added after the section-12 handoff was written, from questions the user asked at
the end of the session. None of this has been implemented; it is the reasoning
the next session should not have to redo.

#### What the 8,000 limit actually is

Groq's free tier allows **8,000 tokens per minute per organisation**, counting
**input and output added together**, summed across every request in that minute.
It is a rate limit, not a context window — `openai/gpt-oss-120b` itself holds far
more (~131k). Two consequences the code already reflects:

- A single request must fit under the cap or it is **rejected outright**, not
  queued: the untrimmed synthesis payload was refused at 9,050 tokens. That is
  why `rateLimitWaitMs` (`api.js:101`) deliberately does **not** wait on "request
  too large" — waiting cannot shrink one oversized request.
- Each run makes two calls (claims, then synthesis) which **share the same
  minute's budget**.

**Which side gets cut: the reading, not the writing.** The output is short by
instruction — the prompt asks for a card a reader scans in five seconds, capping
`factual_reality` at 220 characters and four claims. The input is short by
necessity, at `api.js:288-291`:

```
MAX_EVIDENCE_ROWS = 12
MAX_PAGE_PREVIEW  = 300
MAX_TRANSCRIPT    = 3000
MAX_OCR           = 3000
```

So the model is not truncating its verdict. **It is answering from a
deliberately shortened view of the evidence.** On 4G the OCR was **9,522
characters** and two thirds of it never reached the model.

#### Switching provider is already supported

`api.js` `PROVIDERS` wires seven: Groq, OpenRouter, NVIDIA, OpenAI, Mistral,
Cohere, Google. The provider is detected from the key prefix, and the
Provider/Model override boxes in `SettingsScreen.js` work (they had no `value` or
`onChangeText` until last session, so the feature had never functioned). Pasting
a different key is enough — no code change, no rebuild, not even a Metro reload.

**Recommended experiment: Google (Gemini).** Free tier with a much larger
per-minute budget than 8k, ~1M context, already wired, and the `AIza` prefix is
already detected. Type a current model into the Model Override box rather than
relying on the wired default (`gemini-2.0-flash`), which is old. **OpenRouter** is
the better choice if the aim is to compare three or four models, since one key
reaches many.

Run it as a clean experiment: **the same nine posts, one provider changed,
nothing else**, then `runs_set5.csv` and a stage-by-stage diff against set 4.
Changing two things at once makes the result unattributable, which is how the
last three sessions lost time.

#### The better fix: stop truncating blindly

Raising the budget treats the symptom. The real defect is that `MAX_PAGE_PREVIEW`
keeps the **first** 300 characters of a page — the nav bar and the badge row —
while the decisive sentence sits thousands of characters in. Measured example:
graphify's README states **71.5x** twice, once in the opening line and once in a
benchmark table; the app kept the first 300 characters of the fetched page, saw
neither, and reported *"No official documentation confirms the 71.5x claim"*.

Four alternatives, cheapest first. The first three **reduce tokens while
increasing signal**, so they help the local-model phase too, where the constraint
becomes device memory and prefill latency rather than a provider's meter.

1. **Claim-anchored extraction.** Instead of the first 300 characters, search each
   fetched page for the claim's key terms — the numbers, the licence name, the
   repo slug, the price — and keep one sentence either side of each hit. Same
   budget, the *right* 300 characters. Deterministic, no extra model call, no
   latency. This is the highest-value item in this section.
2. **Deterministic pre-answers.** Let code answer the sub-question and pass a
   one-line fact instead of raw page text: *"README contains '71.5x': yes, in a
   benchmark table"*, *"npm licence field: PolyForm-Noncommercial-1.0.0"*. Fifteen
   tokens instead of three hundred, and it matches the standing lesson — fetch a
   fact rather than adjust a judgement.
3. **Dedupe the payload.** 3B's OCR is the same 609-character README header
   repeated **ten times** across ten frames. Frame OCR dedupes by line within a
   frame (`TechFactCheckerModule.kt`, `seenLines`), but nothing dedupes across the
   whole assembled payload. Free saving, no information lost.
4. **Map-reduce synthesis** — summarise evidence in batches, then combine. Nothing
   is cut, but it is three or four calls sharing one per-minute pool and adds
   roughly ten seconds. Last resort.

**Ordering note:** these come *after* carousel pagination. A page that was never
fetched cannot be compressed, and two of the four remaining verdict failures are
slides the extractor never loaded.

#### Does any of this go away with a local model?

The rate limit does — no 8k ceiling, no 429s, no "request too large". The
*trimming* does not; it changes shape. A quantised 3-4B model on the phone has a
smaller usable context than 131k, and every extra 1,000 tokens costs real seconds
of prefill on a mid-range chip. The caps at `api.js:288-291` survive the
migration; they simply get tuned against latency and RAM instead of a billing
meter. Expect to raise `MAX_PAGE_PREVIEW` (nothing is charged per token) while
keeping a row limit for speed.

One caution worth carrying into `MIGRATION_PLAN.md`: a small local model is
**weaker at judgement** than `gpt-oss-120b`, and judgement — the verdict — is the
one stage that has not improved across four sets. Local wins on cost, privacy and
rate limits. It does not automatically win on accuracy, and the four-stage
scoreboard is what will show the difference honestly.

### Resume prompt (replaces the one in section 11)

```text
Read E:\RANDOM_BS\Instagram\TEST_LOG.md first, then HANDOFF_NOTES.md section 12.
Nineteen recorded cases exist across four sets. Scoring is per-stage - seeing,
naming, invention, verdict - not one verdict word; set 4 scored 6/9, 6/9, 7/9,
4/9, and on the five posts re-tested from set 3 the verdict went 2/5 to 1/5. The
plumbing is improving and the verdict is not.

Do not re-run anything on the device to start. Everything is replayable:
  cd mobile_app && node tools/replay.js ../runs_set4.csv
That prints the four-stage scoreboard from the CSV alone, no phone, no API call.
Ground truth lives in mobile_app/tools/expected.json.

Work in this order:
1. Consume the abstention. mobile_app/src/services/api.js:609 pickSubject now
   returns {name: null} honestly, and the report ignores it - set 4 published a
   FAKE verdict about "Sachifinance", a creator's Instagram handle, on a run
   where the picker had already abstained. Tell the synthesis prompt there is no
   confirmed subject and let the card say so. Fifth set with this bug.
2. Carousel pagination in InstagramExtractor.kt - the embed lazy-loads and the
   extractor reads the DOM once after 3000ms, so a 7-slide post yields 2 and an
   8-slide post yields 2. Kotlin, so it needs the Actions build.
3. Confirm the slide-coverage warning reaches the model (api.js:346 and :391).
   Its CSV column was dropped by a COLUMNS bug in set 4, now fixed.
4. Require two OCR mentions, not one, in picker rule 2 - "Side Hustles" with a
   single hit became a subject and broke a correct abstention.
5. Evidence gate for repos: both set-4 inventions were integrations the post
   merely mentions (cursor/cursor, lmstudio-ai/lm-studio) promoted to tool rows.
6. Then section 12I: claim-anchored page extraction instead of keeping the first
   300 chars of a page, and the provider experiment (same nine posts, one key
   changed, nothing else). Read 12I before touching MAX_PAGE_PREVIEW - the size
   is not the defect, keeping the wrong 300 characters is.

Rules: JS changes need only a Metro reload; Kotlin needs the GitHub Actions
workflow "Build Debug APK (mobile_app)" (workflow_dispatch - push, then
gh workflow run) - never local Gradle. Metro must be running. Run the
scope-aware undefined-identifier scan on every changed JS file, then sweep for
chr(8): bash heredocs turn a backslash-b into a literal backspace character and
that has silently broken a regex twice. Prefer rules that fetch a fact over
rules that adjust a judgement - every verdict-nudging rule added so far has
needed correcting and one was harmful. Do not stage commands.txt (live keys),
www.instagram.com_cookies.txt (live Instagram session), the run CSVs or the
three markdown docs.

Reply caveman style, short. Explain only if asked.
```
