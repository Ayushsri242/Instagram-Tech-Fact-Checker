# Migration Plan — Off the APIs, onto a small local model

Written September 7, 2026. Companion to `HANDOFF_NOTES.md` (read section 10 there
first for current system state).

This plan replaces two rented dependencies with two owned ones:

- **sherpa-onnx Whisper** -> **whisper.cpp** (fixes the repetition loop, shrinks the model)
- **MediaPipe Gemma3-1B `.task`** -> **llama.cpp GGUF** (opens sub-500MB models and a real fine-tuning path)

and then trains that small model to do the three jobs the pipeline actually needs.

---

## 0. The goal, stated precisely

An app that runs its **reasoning** on the phone with no API key, small enough that
a friend can install it and try it, and reliable enough that it does not need a
fallback to Groq.

"No API key" does not mean air-gapped. The browser agent still calls DuckDuckGo
and GitHub. That is intended and unchanged.

### Why we are leaving the APIs

Not accuracy. Ownership. In order of how much each has actually cost:

1. Free tiers run out. The rate-limit badge exists because the wall gets hit.
2. Providers retire models without warning. `llama3-70b-8192` cost a day of
   debugging that looked like a dead API key.
3. Every provider has different quirks (NVIDIA rejects `response_format`, Cohere
   hides behind a different URL). Each new provider is a new bug tax.
4. The app cannot be given away. Either the author pays, or every friend must go
   get their own key.

Today's multi-provider auto-detection makes the juggling smoother. It does not
make the juggling stop.

---

## 1. The three jobs — the only thing the model has to learn

The LLM is not a chatbot and not a knowledge base. It has exactly three jobs:

| # | Job | Input | Output |
|---|---|---|---|
| 1 | **Structure & name** | OCR lines, transcript, caption | What is this post about; what does it claim |
| 2 | **Query** | The above | 1-3 web search queries |
| 3 | **Judge** | Claims + what the agent found | Verdict + summary |

All three are *shape* work, not *knowledge* work. Facts arrive from the web at
step 3. This is why a 0.6B model is a plausible target: it never has to know
what ForgeCode is, only how to read evidence about it.

### The rule that must survive the migration

`SourceEvidence.kt` decides the product name in **code**, from verified repos and
domains, scored by corroboration. It was built after the model produced
`TECH: Apache-2.0`, `TECH: TECH`, and `ain` on real runs. It now gets ForgeCode
right on `DchQA7CTapw` even when the speech transcript is unusable.

**That layer does not move and does not get replaced by the fine-tune.**

The division after migration:

- The model **proposes** a subject and a reading of the post.
- The code **checks** the proposal against verified repos and domains.
- If they disagree, code wins on hard evidence; the model's version is used only
  when there is no hard evidence to check against.
- If neither has anything, abstain. An empty answer still beats an invented one.

Nothing is trusted by position. That principle is the most expensive thing this
project has learned, and it applies to a fine-tuned model exactly as it applied
to Gemma and to Whisper.

---

## 2. Size budget

Current: **715 MB** (Gemma3-1B `.task` 555 MB + sherpa Whisper base int8 160 MB).

**All sizes below were confirmed with `curl -sIL` on September 7, 2026** — every
URL returned HTTP 200 and these are the real `content-length` values, not
estimates.

| Slot | File | Verified size |
|---|---|---|
| STT | `ggerganov/whisper.cpp` → `ggml-small-q5_1.bin` | **181.3 MB** |
| STT (light) | `ggerganov/whisper.cpp` → `ggml-base-q5_1.bin` | **56.9 MB** |
| STT (reference) | `ggml-small.bin` (unquantized) | 465.0 MB |
| LLM | `unsloth/Qwen3-0.6B-GGUF` → `Qwen3-0.6B-Q4_K_M.gguf` | **378.3 MB** |
| LLM (light) | `bartowski/SmolLM2-360M-Instruct-GGUF` → `Q4_K_M` | **258.1 MB** |
| LLM (alt) | `Qwen/Qwen2.5-0.5B-Instruct-GGUF` → `q4_k_m` | 468.6 MB |
| LLM (fallback) | `bartowski/Qwen2.5-1.5B-Instruct-GGUF` → `Q4_K_M` | 940.4 MB |

### The two pairs

| | LLM | STT | **Total** | vs today |
|---|---|---|---|---|
| **Recommended** | Qwen3-0.6B — 378 MB | small q5_1 — 181 MB | **559 MB** | −156 MB |
| **Light** | SmolLM2-360M — 258 MB | base q5_1 — 57 MB | **315 MB** | −400 MB |

Start with the recommended pair. Drop to light only if Phase B measurements say
the phone cannot carry it.

### Two things the numbers reveal

**Qwen3-0.6B is smaller than Qwen2.5-0.5B** (378 MB vs 469 MB) despite having
more parameters. Newer architecture, tighter quantization. This is why file size
must be measured, never inferred from parameter count — at this scale the token
embedding table dominates the file, so vocabulary size matters more than
parameter count.

**Quantization is doing most of the work on the STT side.** `ggml-small.bin` is
465 MB unquantized; `q5_1` brings the same model to 181 MB. That is how a
*bigger, better* Whisper fits in roughly today's footprint.

### Caveat: Qwen3 thinking mode

Qwen3 models emit `<think>...</think>` reasoning blocks by default. This must be
disabled (`enable_thinking=false`, or the `/no_think` directive in the prompt) or
it will burn the token budget and break the `TECH:`/`VERDICT:`/`SUMMARY:` format
parsing. Verify this on the very first Phase B run, before measuring anything
else.

### What to host in the HuggingFace repo

Current state of `Ayush-242/fact-checker-model` (~2 GB, of which ~1.5 GB is
unused):

| Present | Size | Status |
|---|---|---|
| `gemma-2b-it-cpu-int4.bin` | 1.35 GB | **Dead.** Old MediaPipe format, no code path references it. Delete. |
| `Gemma3-1B-IT_multi-prefill-seq_q4_ekv2048.task` | 555 MB | In use. Keep until Phase B proves out, then delete. |
| `fact-checker-sttwhisper-tiny/` | 104 MB | **Stale.** The app moved to Whisper `base` and pulls it from `csukuangfj/sherpa-onnx-whisper-base`, not from here. STT is not currently self-hosted at all. |

Target layout:

```
Ayush-242/fact-checker-model/
  stt/
    ggml-small-q5_1.bin                  # mirrored from ggerganov/whisper.cpp
  llm/
    Qwen3-0.6B-Q4_K_M.gguf               # stock, phase B baseline
    factchecker-0.6b-q4_k_m.gguf         # your fine-tune, phase D
```

Mirroring rather than hot-linking upstream is worth doing: it means an upstream
repo rename cannot break every installed copy of the app. That has already
happened once in this project, with a Groq model being retired underneath it.

Keep the stock model hosted even after the fine-tune ships. It is the control
group for every "is the fine-tune actually better" question.

---

## 3. Phase A — swap the transcriber (independent, do this first)

**Why first:** it is the only phase with a known, already-diagnosed bug behind
it, it does not touch the LLM, and it can be verified on its own.

**The finding it acts on:** the gap was never model size. sherpa-onnx offers
`greedy_search` only. whisper.cpp has beam search, temperature fallback, and a
compression-ratio + entropy check that *detects a repetition loop and retries the
segment* — the same machinery faster-whisper uses in the Python app. Whisper
`base` got "Claude" right and then looped "awal awal awal" for 26 seconds
precisely because nothing was watching for that.

### Steps

1. ~~`curl -sIL` the ggml model URLs~~ — **done Sept 7, sizes in section 2.**
2. Add `whisper.rn` (or link `whisper.cpp` directly through the existing JNI
   layer — the project already has native Kotlin, so a thin binding may be less
   work than a full RN module).
3. Rewrite `AudioTranscriber.kt` to call whisper.cpp with:
   - `beam_size = 5`
   - temperature fallback enabled
   - `language = null` (auto-detect). **Do not force `en`.** The audio is
     Hinglish, confirmed by OCR on the second test reel.
4. **Keep the audio decode path exactly as it is.** The `MediaCodec` fix —
   reading the real format from `INFO_OUTPUT_FORMAT_CHANGED` rather than
   believing the input format's 22050/mono lie — was a hard-won bug fix and is
   independent of which STT engine consumes the PCM.
5. Keep `dumpWav()`. Being able to listen to exactly what the model heard is the
   reason bug 1 was found at all.
6. Chunked decoding (`CHUNK_SECONDS = 12`) can likely be **removed** once beam
   search and the loop detector are in place, since it was a workaround for
   their absence. Remove it only after measuring both ways on the same reel.

### Exit test

Reel `DchQA7CTapw`. Success is the transcript containing a recognisable "forge
code" and no repetition loop. Compare side by side against the current sherpa
transcript, which is health-checked as `speech=false (word repetition loop)`.

### Off-ramp

If whisper.cpp still loops on this audio, the answer is not a bigger model — it
is that OCR-first is correct for Hinglish tech reels and speech is a bonus
signal. The system already survives a dead transcript by design. Ship Phase A
for the size win and move on.

---

## 4. Phase B — swap the LLM runtime, stock model, no training yet

**Why before training:** it separates two risks. If the runtime swap and the
fine-tune land together and the result is bad, there is no way to tell which one
is at fault.

### Steps

1. Add `llama.rn`. Confirm it builds for `arm64-v8a`.
2. Write `LocalGgufEngine.kt` behind the **same interface** as
   `LocalLlamaEngine` so `FactCheckEngine.kt` does not need to change. Keep both
   engines side by side behind a Settings toggle for as long as it takes to
   trust the new one.
3. Download stock Qwen3-0.6B Q4_K_M (378 MB) via the existing SettingsScreen
   download machinery (it already handles multi-file downloads with progress and
   legacy cleanup — reuse it, do not rewrite it).
4. Run the existing three-stage pipeline unchanged.

### Expected result — say this out loud now so it is not a surprise

**Stock Qwen3-0.6B will be worse than Gemma 1B.** Probably clearly worse. Stage 1 will
produce junk names again; stage 3 summaries will be thin. That is expected and is
not a reason to abandon the phase.

What matters at this gate is only (after confirming thinking mode is off):

- Does it load and run on the phone?
- How many tokens per second, on a real prompt of realistic length?
- Does it respect the output format (`TECH:`, `VERDICT:`, `SUMMARY:`) at all?

The last one is the real signal. Format obedience is the thing a fine-tune fixes
most reliably. Quality is what the fine-tune improves. If a stock model cannot
even be steered into the format, a different base model is the answer.

### Measure and write down

- tokens/sec on your phone, for each of the three prompt shapes
- peak RAM
- time from tap to verdict, end to end

This is the baseline that Phase D gets compared against. Without it, "the
fine-tune feels better" is not a claim anyone can check.

---

## 5. Phase C — build the dataset (the actual hard part)

**The key realisation: the dataset is generated on the PC, not collected from the
phone.** The Python web app plus Groq is already a working teacher. Point it at a
list of reels, let it run, and it produces labelled examples in bulk. There is no
need to wait for slow phone runs to accumulate.

### Shape of a record

Three separate training tasks, from one pipeline run. Do **not** collapse them
into one giant example — the model should learn three narrow shapes, not one
sprawling one.

```jsonl
{"task":"structure","input":"<OCR lines>\n<transcript>\n<caption>","output":"<subject + claims>"}
{"task":"query","input":"<subject + claims>","output":"<1-3 search queries>"}
{"task":"judge","input":"<claims>\n<evidence with page previews>","output":"<verdict + summary>"}
```

### Where the labels come from

| Field | Teacher | Confidence |
|---|---|---|
| Subject / product name | **`SourceEvidence.kt` logic**, not the LLM | Highest — it is verified against GitHub |
| Claims | Groq (`verify.py` prompts) | High |
| Queries | Groq, plus the deterministic repo-slug enrichment | High |
| Verdict + summary | Groq | High, but needs spot-checking |

Using the deterministic `SourceEvidence` result as the subject label is the
single most valuable decision in this phase. It means the fine-tuned model learns
the *correct* answer to job 1 — the one that survived seven identification
failures — instead of learning to imitate Groq's guess.

Port `SourceEvidence.kt` scoring to Python for this, or reuse
`scratchpad/evidence_sim.py`, which already mirrors it and is validated against
five real replay cases.

### How much data

- **300–500 examples per task** to see whether format obedience improves at all.
- **1,500–3,000 per task** for a fine-tune worth shipping.

At roughly 3 records per reel, that is **500–1,000 reels**. Achievable in batch
on a PC; impossible to collect by hand.

### Quality gates — cheap and non-negotiable

Bad data is worse than no data at this scale. Drop a record if:

- The verdict is `UNKNOWN` with no evidence (nothing to learn from).
- `SourceEvidence` abstained (score below 3) — no trustworthy subject label.
- The summary is under ~150 characters (the `summaryChars=0` failure class).
- The evidence list is empty.
- Groq's tech name and `SourceEvidence`'s decision disagree **and** hard evidence
  exists. Keep these in a separate file; they are the most interesting cases and
  worth reading by hand.

Hold back **10% as a test set, chosen by reel, not by record**, so the same reel
never appears in both train and test.

### Reel sources

Any Indian tech-creator account posting tool reels. Hinglish is the normal case
for this audience, not an edge case, so the dataset should be mostly Hinglish —
that is a feature.

---

## 6. Phase D — fine-tune

- **Method:** LoRA (rank 8-16) on the chosen base, then merge and quantize to
  `Q4_K_M`. LoRA because full fine-tuning a 0.6B is unnecessary and merging keeps
  the deployed file the same size as the stock one.
- **Where:** free Colab or Kaggle GPU is enough for 0.6B. `colab_script.txt` and
  `kaggle_script.py` already exist in the repo — check whether they can be reused.
- **Export:** merge LoRA into base, convert to GGUF, quantize with
  `llama-quantize`, upload to the HF repo.

### The gate

Compare on the held-out test set, against the Phase B baseline:

| Metric | How measured |
|---|---|
| Format obedience | % of outputs where `TECH:`/`VERDICT:`/`SUMMARY:` all parse |
| Subject accuracy | % matching the `SourceEvidence` label |
| Verdict agreement | % matching Groq's verdict |
| Summary length | % over 150 chars (the old failure mode) |
| Speed | tokens/sec, unchanged from Phase B |

**Ship only if it beats stock Qwen3-0.6B on format obedience and verdict agreement.**
If it beats Gemma 1B too, the migration has paid for itself twice.

---

## 7. Phase E — make it shareable

- One-tap "Download models" in Settings, resumable, with total size shown up
  front. A friend facing a silent 559 MB download will close the app.
- Ship with online mode **off** by default, since the point is that it works
  without a key.
- Keep the Groq path in the code as an optional power-user setting. It is the
  teacher for future dataset rounds and the reference for "is offline good yet".

RAM and speed on other people's phones is explicitly deferred. Your phone first.

---

## 8. Why GGUF works on both Dimensity and Snapdragon

llama.cpp runs on the **CPU** using ARM NEON, with hand-tuned kernels for
`dotprod` and `i8mm` — present on every Dimensity and Snapdragon of the last
several years. No vendor NPU, no Qualcomm SDK, no MediaTek SDK.

This is a portability *gain*, not a compromise. MediaPipe's GPU delegate behaves
differently across vendors; that is a risk currently being carried without being
noticed, and it would have surfaced the first time a friend installed the app.

The cost is that CPU inference is slower than NPU inference. For a 0.6B model on
short prompts this is expected to be fine. It gets measured in Phase B rather
than assumed.

---

## 9. Order of work, and why

1. **Phase A (STT)** — independent, fixes a known bug, wins size immediately.
2. **Phase B (runtime, stock model)** — establishes the baseline. Do not skip.
3. **Phase C (dataset)** — the long pole. Can start in parallel with A and B
   since it runs on the PC and touches no mobile code.
4. **Phase D (fine-tune)** — needs C finished and B's baseline recorded.
5. **Phase E (shareable)** — last.

A and C in parallel is the fastest honest path.

---

## 10. Risks, and what to do about each

| Risk | Signal | Response |
|---|---|---|
| 0.6B cannot hold the format even after tuning | Phase D format obedience below stock | Move up to Qwen2.5-1.5B Q4_K_M (940 MB, verified). Slower and bigger, still no API key. |
| Dataset too small to matter | Fine-tune ties with stock | More reels. This is a volume problem, not a method problem. |
| whisper.cpp still loops on Hinglish | Phase A exit test fails | Accept OCR-first. The pipeline already survives a dead transcript. |
| llama.rn build fights the existing native module | Gradle/CMake errors | The project already has working native Kotlin; bind `llama.cpp` directly instead of via the RN wrapper. |
| Fine-tune learns Groq's mistakes | Test-set verdicts wrong in the same way Groq is wrong | Why subject labels come from `SourceEvidence`, not Groq. Extend the same idea to other fields if needed. |

---

## 11. Constraints carried forward from `HANDOFF_NOTES.md`

- Do **not** run local Gradle. Use GitHub Actions `Build Debug APK (mobile_app)`
  — `workflow_dispatch` only, so push then `gh workflow run`.
- Debug APK does not bundle JS. Metro must be running.
- Never commit the Groq key, HF tokens, or Instagram cookies. `commands.txt` is
  tracked and contains live keys — do not delete it, do not push it.
- Bash heredocs collapse `\\` to `\`. This has broken a CI build. Use the
  Write/Edit tools for anything containing backslashes, then run
  `scratchpad/balance.py`.
- Replay `scratchpad/evidence_sim.py` before changing scoring logic.

---

## 12. Still true, still unverified

Carried from `HANDOFF_NOTES.md` section 10 — none of this is fixed by this plan
and all of it should be checked before or during Phase A:

- Chunked STT has **never run on the device**. Grep logcat for `STT chunks:`.
  If Phase A removes chunking, this becomes moot, but the current commit shipped
  unverified.
- Carousel posts under the current pipeline.
- Offline chat with airplane mode on.
- WebView extractor fails on `DchQA7CTapw` every run (`videoTag=false`), falls
  back to Render. Works on other reels, so reel-specific.
