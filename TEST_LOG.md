# Two-system test log

**Rule: the app build is FROZEN until case 5 is done.** Changing it mid-run makes
cases 1-5 measure different systems, and the whole point is to find a pattern
across them.

- **System 1** = `ground_truth.py` + independent reading (agent reads frames
  directly, faster-whisper for audio, own web checks). Never uses the app's OCR,
  prompts or scoring.
- **System 2** = the mobile app.
- The user says what the truth actually is. Then the failing stage gets named.

## Coverage target

Five cases, deliberately mixed, so a pattern is not just one post's quirk:

| # | Type | Signal | Language | Status |
|---|---|---|---|---|
| 1 | Carousel | OCR only, no audio | English | **done** |
| 2 | Reel | audio-heavy | Hinglish | todo |
| 3 | Reel | **hype / exaggeration** | English | **done** |
| 4 | Carousel | multi-tool listicle (5 tools) | English | **done** |
| 5 | Reel | **free-unlimited claim** | Urdu/Hindi | **done** |

Case 5 matters most: every case so far has been a real tool. If the app has
never been shown a fake one, "PARTIALLY_TRUE" might just be its favourite answer
rather than a judgement.

## Per-case capture

```powershell
.\venv\Scripts\python.exe ground_truth.py "<url>"
# run same url in app, then:
adb logcat -d | Select-String TFC_DEBUG
```
Plus a screenshot of the report.

---

## Case 1 - Dc8bV14lHsk (carousel, OCR only, English)

`instagram.com/p/Dc8bV14lHsk/` - @quantscience_ reposting 3 tweet screenshots
from Matt Dancho (@mdancho84) about **nanobot**.

**Ground truth:** nanobot is real (`HKUDS/nanobot`, 47.8k stars, MIT, Python).
"R.I.P. openclaw" is idiom for *obsolete*, not *dead* - correction from the user;
the agent had wrongly read it literally. Judged as "nanobot obsoletes openclaw"
it is still overstated: nanobot is a ~4k-line Python chat agent, openclaw is a
3.85 GB cross-platform product.

**Both systems: PARTIALLY_TRUE. Product named right: nanobot.** Headline pass.

**App passed:**
- Carousel extraction via WebView, no Render fallback (4 images)
- OCR 1403 chars, caught `HKUDS/nanobot` on slide 2
- Rejected junk slug `l/github.com`, GitHub-verified the real one
- **Got `pip install nanobot-ai` right** - the trap System 1 predicted it would
  fail, since PyPI `nanobot` is an unrelated robot-navigation library

**App failed - all in stage 3 synthesis:**
1. Cited `shanselman/clawdbot` as the Clawdbot baseline. Real repo, but an
   **18-star fork**. Canonical is `clawdbot/clawdbot`, which **redirects to
   `openclaw/openclaw`, 389k stars**.
2. Because of (1), never realised **Clawdbot IS openclaw** - same project,
   renamed. That is the central fact of the post, and it was missed.
3. Invented an install command for that fork (`git clone ... && pip install -r`).
   Not present in any evidence.
4. "ZArchitecture" promoted to a tool row with a fabricated docs path. That is
   OCR noise from the "Architecture" heading.
5. "nanobot is newer (2024-2026), fewer contributors" - unsourced. Repo created
   2026-02-01.
6. Markdown table in the report. RN `<Text>` cannot render tables. `*quoted*`
   asterisks leaked through the regex chain too.

**Stage verdict:** extraction PASS, OCR PASS, `SourceEvidence` PASS, evidence
gathering PASS (22 results, 4 with page context), **stage 3 synthesis FAIL**,
formatting FAIL.

---

## Case 2 - Db9M3PYTcxq (reel, Hinglish audio + on-screen docs)

`instagram.com/reel/Db9M3PYTcxq/` - Sukhad Anand (@techie007.dev), 35.3s,
faster-whisper detected `lang=hi`.

### System 1 reading (recorded BEFORE the app was run)

**What it is about:** using AI coding agents to turn research papers into working
code, pitched as a way to produce portfolio projects for a resume. Shows a
"Paper2Code Skill for Claude Code" doc and a 12-step workflow poster.

**Verified independently:**

| Thing | Finding |
|---|---|
| `issol14/paper2code-skill` | **The skill actually shown in frame 03.** 38 stars, "A Claude Code Skill that converts research papers into executable code". Doc is English/Korean, matching the screenshot |
| `HKUDS/DeepCode` | Real, 16,497 stars. Named in the doc as the thing being **dismissed** ("great tools like DeepCode, but they require separate API costs") |
| `going-doer/Paper2Code` | Real, 4,946 stars, the original research project. Named in the frame-11 workflow poster |

**System 1 verdict: PARTIALLY_TRUE.** Tools are real and the workflow is sound -
frame 11 explicitly warns "Do not ask an AI coding agent to implement this paper
in one giant step" and includes verification steps, which is honest, not hype.
The overstated part is the framing "Unlimited good projects for resume".

### Traps this case sets for the app

1. **The repo slug appears in NO frame.** The transcript says "link pin comment",
   so the identifier is in the pinned comment, which the pipeline never reads.
   The app must find the tool by search or not at all. Case 1's win came from
   OCR catching `HKUDS/nanobot` on a slide; that crutch is gone here.
2. **Whisper garbled every proper noun**, exactly as predicted:
   `"Lord code code x anti-gravity"` = **Claude Code, Codex, Antigravity**.
   Also `"golo paper to code skill"` = "install the paper-to-code skill".
3. **Audio names a tool the frames do not.** Antigravity is spoken but appears in
   no frame; frame 11 says only "Paper2Code, Codex or Claude Code". So OCR and
   speech genuinely disagree here, which is the exact case `SourceEvidence` was
   built for.
4. **Name ambiguity.** "Paper2Code" resolves to two legitimate repos - the
   research project `going-doer/Paper2Code` and the skill actually shown,
   `issol14/paper2code-skill`. Picking either is defensible; picking neither is
   not.
5. **Stance trap (new).** DeepCode is mentioned *in order to be dismissed*. If the
   app lists DeepCode as a recommended tool, it has read the mention but missed
   the stance.

### System 2 result - app run 09-07 15:25

**Verdict PARTIALLY_TRUE - matches System 1. Report named `issol14/paper2code-skill`
correctly.** But the logcat shows the report was right for reasons the pipeline
does not deserve full credit for.

#### WIN: chunked STT verified on device for the first time

`HANDOFF_NOTES.md` section 10 listed this as UNVERIFIED. It is now verified, and
it did exactly what it was designed to do:

```
STT chunk 1: kept 194 chars: Resumum a good unlimited project start like this...
STT chunk 2: dropped as repetition loop: aad, aad, aad, aad, aad, aad, aad...
STT chunk 3: kept 225 chars: And you have to verify all of that...
STT chunks: total=3 kept=2 dropped=1
```

A loop cost **one 12-second window instead of the whole transcript**. Before
chunking this run would have produced 35 seconds of "aad".

Also confirmed healthy: `rate=44100 ch=2 enc=PCM_16BIT`, `peak=0.953 rms=0.1383`
- the stereo/rate decode fix is holding.

#### What the dropped chunk cost

Chunk 2 was where the tool names lived. Compare the two ears on the same audio:

- faster-whisper: `"...install golo paper to code skill In your anything Lord
  code code x anti-gravity And ask Lord code code x to build this paper..."`
- app (chunk 2 dropped): `"...install this paper to code skill in your anything
  And you have to verify all of that..."`

So **Antigravity was lost to the dropped chunk, not to synthesis.** That answers
the open question from the report review. It is the designed trade-off working
as intended, but the cost is now measured: the loop sat exactly on top of the
proper nouns.

#### FAIL 1 - the online path still searches the raw transcript

```
FACT_CHECK web: query=techie007.dev Best projects for your resume View all 290
comments Resumum a good unlimited project start like this simply convert
research papers to code now you can do it simply find a good research paper
then install this paper to code sk, results=5
```

**This is the "Big Brother song" bug.** Section 10 of `HANDOFF_NOTES.md` records
the fix as "never search a raw transcript" - but that fix only landed on the
OFFLINE path. `FactCheckEngine.kt:141-149` says so in its own comment:

```kotlin
} else {
    // Online mode keeps the original cheap behaviour: only search when
    // nothing was verified straight from a GitHub slug.
    if (verifiedTools.isEmpty()) {
        val query = buildSearchQuery(ocrResult.fullText, rawTranscript)
```

#### FAIL 2 - buildSearchQuery truncates away the good signal

`FactCheckEngine.kt:455`:

```kotlin
return ("$transcript $ocrText")   // transcript FIRST
    ...
    .take(240)                     // OCR falls off the end
```

Transcript is concatenated first and the result is cut at 240 characters. The
caption plus transcript alone exceeded 240, so **the OCR text was truncated away
entirely** - including "Paper2Code Skill for Claude Code", the single most
useful string on screen. The better signal was thrown away in favour of the
worse one, by ordering.

#### FAIL 3 - the deterministic layer and the report disagree, silently

```
FACT_CHECK slugs detected=[]
FACT_CHECK slugs verified=[]
STEP 6 DONE: verdict=PARTIALLY_TRUE, techName=Unknown Technology
```

`SourceEvidence` correctly abstained - no repo slug appears in any frame, exactly
as System 1 predicted. But the final report then confidently named
`issol14/paper2code-skill`, `PrathamLearnsToCode/paper2code` and a fabricated
"HybridMAS". **Nothing reconciles the two.** The abstention is logged and then
ignored, so the one signal that says "I do not know" never reaches the user.

The correct repo came from the JS-side Groq call (23 results, pageContext 4),
not from the deterministic layer. The report was right, but not because the
identification pipeline worked.

#### Minor findings

- Caption carries UI chrome: `"techie007.dev Best projects for your resume View
  all 290 comments"`. "View all 290 comments" is not caption text and pollutes
  the query.
- OCR found text on frames 3 and 10 of 10, matching System 1's frames 03 and 11
  of 12. Consistent, and confirms the sparsity pattern again.
- **`ground_truth.py` got caption=0 chars; the app got 67.** The app's WebView
  extraction beats instaloader here. That is a gap in System 1, not System 2 -
  worth fixing so the reference tool is not weaker than the thing it audits.

### Frame sparsity - now a confirmed pattern

Only **2 of 12 frames** carry text (03 and 11). On `DchQA7CTapw` it was 1 of 10.
Talking-head reels put text on a small minority of frames, which is why the
4-frame sampling missed it entirely and 10-12 is the right floor.

### Tooling note

Reading 12 frames one by one is wasteful. A contact sheet is one image:

```
ffmpeg -y -i frame_%02d.jpg -vf "scale=360:-1,tile=4x3" -frames:v 1 contact_sheet.jpg
```

Read that first, then open only the frames that show text at full size.

---

## Case 3 - Db8MTU8sdXb (reel, English, HYPE case)

`instagram.com/reel/Db8MTU8sdXb/` - Ajay Yadav (@thevibefounder), 44.7s,
`lang=en`. Deliberately chosen to break the PARTIALLY_TRUE streak.

### System 1 reading (recorded BEFORE the app was run)

**What it is about:** NVIDIA's Nemotron 3.5 Lightning being available free inside
**Cline**, framed as an existential threat to Google / OpenAI / Anthropic.
AI-generated images of Sundar Pichai, Sam Altman and Dario Amodei digging graves.

**System 1 verdict: HYPE.** The tool is real and genuinely free. The framing is
theatre, and it contains one clear factual error.

**Everything verified live (the model postdates the agent's training cutoff, so
none of this is recall):**

| Claim | Finding |
|---|---|
| Nemotron 3.5 Lightning is real | **TRUE.** `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16`, created **2026-08-01**, 1.2M downloads on the NVFP4 variant. 30B total / 3B active MoE, `NemotronHForCausalLM` |
| Free in Cline | **TRUE.** OpenRouter lists `nvidia/nemotron-3.5-lightning:free` at prompt $0 / completion $0. Frame 04 shows Cline's "Select a free model" with a Free badge |
| "A million tokens of memory" | **TRUE but the video contradicts itself.** OpenRouter's `:free` variant is ctx 1,000,000; the paid one is 262,144. **Frame 04's own sidebar reads "Context: 262.144k"** |
| "Runs on one graphics card in your room" | **TRUE with a caveat.** GGUF quants exist (unsloth, ggml-org) down to IQ1_M/IQ2_XXS. Q4 of a 30B is ~17 GB, so realistically a 24 GB card; smaller cards need IQ2/IQ3 and lose quality. Not "any" GPU |
| "Take it, change it, sell what you build" | **Mostly TRUE.** HF license field is `other` (NVIDIA Open Model License), not MIT/Apache. Commercial use permitted but terms apply |
| "No card, no bill, no subscription" | **Mostly TRUE**, but frame 04 shows a "Create my Account" button, and free OpenRouter tiers carry rate limits |
| "4x faster output" | **UNVERIFIED.** Plausible for a 3B-active MoE, but no source found. Not called false |
| "Google, OpenAI and Anthropic all buy their chips from Nvidia" | **PARTLY FALSE.** Google designs and runs its own TPUs; Anthropic uses TPUs and AWS Trainium substantially. Clearest factual error in the reel |
| "CEOs digging their own graves" | **HYPE.** A 30B open model does not threaten any of the three |

### Traps this case sets for the app

1. **The model postdates most LLM training cutoffs** (released 2026-08-01). If the
   synthesis model answers from memory instead of the fetched evidence, it will
   conclude Nemotron 3.5 Lightning does not exist and return **FAKE**. This is
   the most likely failure, and it is the mirror image of the invented-detail
   pattern: hallucinating absence rather than presence.
2. **Whisper garbled "Cline" to "Klein"** - proper nouns failing again, third case
   running. There is no repo slug on screen either.
3. **The self-contradiction (1M vs 262.144k) is only catchable by OCR** of frame
   04's small sidebar. A good report should notice the video disagrees with its
   own screenshot.
4. **The Google/TPU error needs reasoning, not lookup.** No search result will say
   "this reel is wrong about chips".
5. **Will it ever say HYPE?** Two cases, two PARTIALLY_TRUE. If this returns
   PARTIALLY_TRUE as well, that verdict is a reflex, not a judgement - and the
   five-verdict rubric is decorative.

### System 2 result - app run

**App verdict: PARTIALLY_TRUE. System 1 said HYPE.** Third PARTIALLY_TRUE in
three cases - see the reflex finding below.

#### The app was right where System 1 was sloppy

Two honest corrections to the System 1 reading above:

- **License.** System 1 read the top-level HF field as `other` and left it there.
  The app said **OpenMDW-1.1**, and it is correct: `cardData.license_name` is
  `openmdw-1.1`, link `https://openmdw.ai/license/1-1/`. The app was more precise.
- **URLs all real this time**, including a deep path:
  `github.com/NVIDIA-NeMo/Nemotron/tree/main/usage-cookbook/Nemotron-3.5-Lightning`
  returns **HTTP 200**. Also `cline/cline` (67.6k) and `vllm-project/vllm` (91.1k).
  No fabricated repo in this case - a real improvement on case 1.

It also identified **Cline** correctly even though Whisper heard "Klein", and it
correctly refused to endorse the unproven "4x faster" claim.

#### The decisive fact - which NEITHER system found at first

NVIDIA's own model card settles the whole reel:

```
Context Length        | Up to 1M tokens (for single H100 deployment, we use 256K)
Single-GPU Deployment | 1x H100 80GB (or 1x A100 80GB)
Supported Hardware    | Blackwell (GB200, B200); Hopper (H100, H200); Ampere (A100)
Hopper - H100 (8x, TP8 + EP) | BF16 | vLLM | 1M (--max-model-len 1048576)
```

So the reel's two headline claims are **mutually exclusive**:

- 1M context requires **8x H100**.
- Single-GPU deployment gives you **256K** - which is exactly the
  **262.144k** shown in Cline's sidebar in the reel's own frame 04.

You get a million tokens, or you get one GPU. Not both. That is the sharpest
finding in the whole test, and it is checkable from the screenshot the creator
put in his own video.

(System 1's earlier line "TRUE for the :free variant" was too generous, and is
superseded by this. Community GGUF quants at IQ2/IQ3 do let a 30B run on a
consumer 24GB card, but that is a community path, not NVIDIA's, and not at 1M
context.)

#### What the app got wrong

1. **Verdict PARTIALLY_TRUE, not HYPE.** Three for three. See below.
2. **"NVIDIA recommends at least 4x H100" - FABRICATED.** The card documents
   **1x H100 80GB** single-GPU deployment. The app invented a requirement four
   times harsher than reality. Its *direction* was right (this needs a datacenter
   card, not a desktop GPU), but it arrived there with a made-up number.
3. **"Cline is model-agnostic: it does not magically provide free compute; you
   must host the model yourself" - FALSE, and it inverts the reel's actual
   claim.** Frame 04 shows Cline's built-in "Select a free model" picker with
   `nemotron-3.5-lightning` badged **Free**; OpenRouter lists
   `nvidia/nemotron-3.5-lightning:free` at $0/$0. The app fact-checked
   self-hosting, which the reel never claimed.
4. **Missed the internal contradiction** (1M vs the 262.144k in the video's own
   screenshot).
5. **Missed the factual error** about Google/OpenAI/Anthropic all buying NVIDIA
   chips.
6. **Markdown table again** - third case running.

#### The PARTIALLY_TRUE reflex is now confirmed

| Case | System 1 | App |
|---|---|---|
| 1 nanobot | PARTIALLY_TRUE | PARTIALLY_TRUE |
| 2 paper2code | PARTIALLY_TRUE | PARTIALLY_TRUE |
| 3 Nemotron (deliberate hype) | **HYPE** | PARTIALLY_TRUE |

Case 3 was chosen specifically to break the streak: AI-generated images of three
CEOs digging graves, "digging their own graves", "they have been paying for the
shovel". It still came back PARTIALLY_TRUE. **The five-verdict rubric is
decorative** - in practice the app has one verdict.

Likely cause: the rubric defines PARTIALLY_TRUE as "real tools exist, but with
minor technical caveats", and something real is nearly always in frame. Nothing
forces the model to weigh the *framing* of the post. HYPE is defined but never
reachable in practice.

---

## Case 4 - DajCWEUjktT (carousel, 9 slides, multi-tool listicle)

`instagram.com/p/DajCWEUjktT/` - @sebastianhardy_. Caption captured this time
(312 chars): *"THESE 5 REPOS FEEL F*CKING ILLEGAL. 5 free GitHub repos that
replace ElevenLabs, HeyGen, Nano Banana, Runway and Wispr Flow."*

### System 1 reading (recorded BEFORE the app was run)

Five tools, each slide giving a repo, a star count, and the monthly price of the
paid product it supposedly kills. Every number is checkable, which makes this the
best-specified case so far.

| # | Slide says | Repo | Verified | Slide stars | Actual stars |
|---|---|---|---|---|---|
| 01 | "The HeyGen killer" | `HeyGem` -> repo `Duix-Avatar` | **REAL** `duixcom/Duix-Avatar` | 13.8k | 15,042 |
| 02 | "The Runway killer" | `Wan-Video/Wan2.1` | **REAL** | 16.5k | 16,945 |
| 03 | "The ElevenLabs killer" | `debpalash/OmniVoice-Studio` | **REAL, but RENAMED** -> `debpalash/VoiceStudio` | 8.1k | 20,242 |
| 04 | "The Nano Banana killer" | `Comfy-Org/ComfyUI` | **REAL** | 120k | 131,881 |
| 05 | "The Wispr Flow killer" | `cjpais/Handy` | **REAL** | 26k | 31,129 |

**All five repos are real.** Every star count in the post is *lower* than current,
consistent with the post being a few weeks old - the creator understated rather
than inflated. That is honest.

Two renames sit in this post:
- `debpalash/OmniVoice-Studio` -> **`debpalash/VoiceStudio`** (the post uses the
  old name)
- `GuijiAI/HeyGem.ai` -> **`duixcom/Duix-Avatar`** (the post already uses the new
  one, and labels it correctly as "HeyGem, repo: Duix-Avatar")

**System 1 verdict: PARTIALLY_TRUE.** Real repos, correctly attributed, honest
star counts, genuinely free. The overstatement is in the framing and one omission:

- "Killer" / "replace" glosses over that **all five need a capable local GPU**,
  which the slides only imply ("your own GPU", "on your own machine").
- **Slide 04 is a category error.** ComfyUI is a *GUI*, not an image model. The
  models are FLUX.2 and Qwen-Image, which the slide itself names. ComfyUI does
  not "kill Nano Banana"; the open models running inside it might.
- "Comment CANCEL and I'll DM you the setup" is engagement bait, not a claim.

### Why this case matters most so far

**It is a direct retest of case 1's worst failure.** In case 1 the app could not
resolve `clawdbot` -> `openclaw` and cited an 18-star fork instead. This post
contains a live rename (`OmniVoice-Studio` -> `VoiceStudio`) sitting right on a
slide. Same bug class, fresh instance.

Things to watch:
1. **Does it list all five tools, or collapse to one?** `verify.py` has a whole
   multi-tool rubric that has never been exercised in this run.
2. **Does it resolve `OmniVoice-Studio` -> `VoiceStudio`?**
3. Does it invent anything? Pattern A is 3 for 3.
4. Does it notice the ComfyUI category error?
5. A caution for scoring: System 1 also says PARTIALLY_TRUE here, so if the app
   agrees it may still be the reflex rather than judgement. **A right answer from
   a broken process is not a pass.** Judge the tool list and the renames, not the
   verdict.

### Tooling note - `ground_truth.py` bug found

Instaloader returned **mixed slide resolutions** (1080x1350 and 720x900), and
`ffmpeg`'s image2 demuxer silently stops at the first size change - the first
contact sheet showed only slides 6-9 and gave no error. Normalise before tiling:

```
mkdir norm && i=0; for f in frame_0*.jpg; do
  ffmpeg -y -i "$f" -vf "scale=430:538" "norm/n_$(printf %02d $i).jpg"; i=$((i+1)); done
ffmpeg -y -start_number 0 -i norm/n_%02d.jpg -vf "tile=3x3" -frames:v 1 sheet_all.jpg
```

Silent truncation is the dangerous part: the sheet looked fine and was missing
more than half the post.

### System 2 result - app run 09-07 16:37

**App verdict: PARTIALLY_TRUE, matching System 1 - but the process was broken,
and this is the worst result of the five.** A right answer from a blind pipeline
is not a pass.

#### ROOT CAUSE: the app saw 4 of 9 slides

```
EXTRACT: TIER_B slides json=0 dom=4
EXTRACT: OK type=image via=TIER_B_HTML images=4 hasVideo=false captionChars=350
STEP 4b: OCR image 0 textLength=107     <- cover slide
STEP 4b: OCR image 1 textLength=1490    <- slide 2, Duix-Avatar
STEP 4b: OCR image 2 textLength=98
STEP 4b: OCR image 3 textLength=84
```

**It never saw slides containing Wan2.1, VoiceStudio, ComfyUI or Handy.** Of the
five tools the post is about, it had OCR evidence for exactly **one**.

This is not an app-side cap: `InstagramExtractor.kt:292` takes up to **12**
slides. The limit is the source. Instagram's `/embed/captioned/` carousel
**lazy-loads slides as the user swipes**; the extractor loads the page, waits
3000 ms, reads the DOM once, and never paginates. A server-side fetch of the same
embed URL returns **zero** image URLs at all (all JS-injected), which confirms the
images only exist after render - and only the first few render.

`ground_truth.py` (instaloader) got all 9. So the data is reachable; the WebView
path just cannot reach it.

**This is structural, not a prompt problem, and it is the most valuable finding
of the five cases.**

#### What blindness caused downstream

With four fifths of the post invisible, the model filled the gaps by search - and
every gap-fill was wrong in the same direction:

| Post's actual tool | Stars | What the app said instead | Stars |
|---|---|---|---|
| `cjpais/Handy` | 31,129 | `zachlatta/freeflow` (real, but not in the post) | 2,639 |
| `Comfy-Org/ComfyUI` | 131,881 | *"No single repo matches Nano Banana"*, cites `NanoBananaAI/Nano-Banana-AI` | **4** |
| `Wan-Video/Wan2.1` | 16,945 | *"No dedicated repo that replicates Runway"* | - |
| `debpalash/VoiceStudio` | 20,242 | **`debpalash/VoiceStudio` - CORRECT** | 20,242 |
| `duixcom/Duix-Avatar` | 15,042 | `duixcom/Duix-Avatar` - correct (the one slide it saw) | 15,042 |

Two flat denials of tools that are on the slides, and a **4-star** repo cited
where a **131k-star** one belonged. That 4-star citation is the same shape as
case 1's 18-star fork: technically real, practically worthless.

**The sharpest detail: `#comfyui` was in the caption the app DID read** (350
chars, logged in full). It had the hint and still concluded no repo matches.

#### Also fabricated

**"Duix-Avatar runs only on Windows"** - false. Its README mentions Docker 33
times, Ubuntu 9, Linux 4, Windows 6. It is Docker/Ubuntu-first. Pattern A, now
**4 for 4**.

#### Genuine wins

- **`debpalash/VoiceStudio` is correct**, and the post uses the old name
  `OmniVoice-Studio`. Case 1's rename failure did not repeat - though note it
  reached the right repo by *search*, not by resolving a redirect, because it
  never saw the slide with the old name on it.
- `slugs detected=[29/mo]` - it parsed "$29/mo" as a repo slug, but
  `slugs verified=[]` correctly threw it away. The GitHub verification gate is
  doing its job.

#### Repeat offenders, unchanged

- Raw caption used as the web query again (`query=sebastianhardy_ THESE 5 REPOS
  FEEL F CKING ILLEGAL...`), same as case 2.
- `techName=Unknown Technology` again, and the report again names specifics
  anyway.
- Markdown table again - **four for four**.

---

## Case 5 - DbgSN0gzwJ8 (reel, Urdu/Hindi, "free unlimited" claim)

`instagram.com/reel/DbgSN0gzwJ8/` - Sparkly Deep (@sparklydeeps), **88.8s** (longest
yet), faster-whisper reported `lang=hi`.

### NEW STT failure mode: script mismatch

faster-whisper detected Hindi but **emitted Urdu in Arabic script**:

```
اگر آپ ڈیلی بیسس میں انٹیگریوٹی کو یوز کرتے ہو ... یہ ریپو کا نام ہے جیمینائی ویب اے پی آئی
```

Readable, but useless to every downstream stage: `SourceEvidence` tokenises on
`[a-z0-9]`, so an Arabic-script transcript contributes **zero** candidates, and it
cannot be matched against OCR for corroboration. Neither the health check nor the
loop detector catches this - the text is perfectly coherent, just in the wrong
alphabet. **A script check belongs next to `speechHealth()`.**

Translated, the claims are: Antigravity's Gemini limit runs out in about an hour;
this repo gives you **1 billion tokens daily**, free, with Gemini 3.6 Flash / 3.5 /
3.1; install is copy-paste one line; needs Python.

### System 1 reading (recorded BEFORE the app was run)

**The tool is real.** `Sophomoresty/gemini-web2api` - **3,124 stars, 686 forks,
MIT**. "Convert Google Gemini web into OpenAI-compatible API. Zero auth,
cross-platform, single file." The video's on-screen 2.3k stars / 525 forks are
*lower* than current - understated again, consistent with post age.

**But its own README contradicts the reel on every material point:**

| Reel claims | README says |
|---|---|
| "1 billion tokens daily" | The word "billion" **does not appear anywhere** in the README. No token quota is claimed at all |
| Escapes Antigravity's hourly limit | *"**Rate limits**: Google may throttle high-frequency requests... sustained heavy use may be blocked"* |
| Free access to the good models | *"**Not real Pro/Ultra**: Without a paid subscription cookie, `gemini-3.1-pro` routes to the same Flash model. The 'Pro' label is a UI preference, not a backend model switch"* |
| Just copy-paste and go | Real Pro routing needs a **Gemini Advanced (paid) account cookie** |

**What the reel never mentions at all:** to get anything beyond anonymous Flash you
must export `SID`, `HSID`, `SSID`, `APISID`, `SAPISID` and `__Secure-1PSID` from
your logged-in browser into a text file. Those are **full Google session cookies** -
they authenticate your entire Google account, not just Gemini. The sibling repo
describes the technique plainly as 反代 (reverse-proxying) Gemini's web protocol,
which is a Terms of Service matter and an account-ban risk.

**System 1 verdict: MISLEADING.** Rubric fit is exact - *"omits critical
limitations, severe pricing catches, or misrepresents functionality."* Not FAKE
(the repo is real and works). Not HYPE (this is not just excitable framing - the
headline number is unsupported and the central promise is contradicted by the
project's own docs).

### What this case tests

1. **Can the app ever leave PARTIALLY_TRUE?** Four for four so far. This one is
   not a judgement call - the README refutes the reel in writing.
2. **Does it read the README at all?** `pageContext` exists precisely for this.
   Every refuting quote above came from the first 10 KB of one page.
3. **Does it flag the credential-exfiltration risk?** A fact-checker that
   recommends pasting your Google session cookies into a third-party script has
   failed at something more important than accuracy.
4. **Does an Arabic-script transcript break identification?** The repo name is on
   screen in Latin text, so OCR should carry it alone.

### System 2 result - app run 09-07 18:01

**App verdict: FAKE. System 1: MISLEADING.**

*Caveat for comparability: this run used the trimmed synthesis payload (12
evidence rows, 300-char page context). Same model, less input. Cases 1-4 sent the
full payload. Groq's free tier refused the untrimmed request outright at 9,050
tokens against an 8,000 cap, so there was no untrimmed run to compare with.*

#### The reflex is broken - the rubric CAN reach other verdicts

Four cases of PARTIALLY_TRUE, then FAKE. So the five-verdict rubric is not
decorative after all, and the earlier conclusion needs softening: the model will
leave PARTIALLY_TRUE, but apparently only when it believes the subject does not
exist. It still never chose HYPE or MISLEADING - the two verdicts that require
judging *framing* rather than *existence*.

#### But it fact-checked a window title

**`sparkdly-api` is not a product.** It is the creator's own local server name in
his IDE title bar, derived from his handle @sparklydeeps. OCR read it off the
chrome:

```
FACT_CHECK ocr=sparkdly-api | Ask anything, (R) to mention, / for actions | Gemini 3.6 Flash (Low) | ...
```

The app made that string **the subject of the fact-check**, then correctly
concluded no such tool exists. A right answer about the wrong thing. The real
subject, `Sophomoresty/gemini-web2api` (3,124 stars), was demoted to "related".

This is case 1's "ZArchitecture" failure again, but far more damaging: last time
OCR noise became a table row; this time it became the entire verdict.

#### Cited a 0-star fork over the 3,124-star original

The report gives `https://github.com/doublecurry/gemini-web2api`. Verified:

```
doublecurry/gemini-web2api   -> "forked from Sophomoresty/gemini-web2api", 0 stars
Sophomoresty/gemini-web2api  -> 3,124 stars
```

Where did `doublecurry` come from? A **commit message visible in the frames**:
*"Merge pull request #51 from doublecu[rry]/fix/str..."*. The app took a
contributor's fork name out of the commit log and treated it as the canonical
repo.

**This is the third instance of one bug**: case 1 cited an 18-star fork over
openclaw's 389k; case 4 cited a 4-star repo over ComfyUI's 131k; case 5 cites a
0-star fork over the 3,124-star original. **Popularity/canonicality is never
checked.**

#### Factual errors, all inverting the truth

| Report says | Reality |
|---|---|
| "requires API key handling" | README: *"Optional API Keys: **no auth** when `api_keys` is empty"* |
| **"still incurs Google Gemini usage fees; it is not truly zero-cost"** | **The exact opposite.** The project's own tagline is *"Zero cost"*; it works by reverse-proxying your Gemini **web session**, not the paid API |
| "respects Gemini's usage limits" | It exists specifically to route around the web UI's limits |

And it missed the entire real story: the 1-billion-token claim appears **nowhere**
in the README, `gemini-3.1-pro` silently routes to Flash without a paid cookie,
and using it at all requires exporting full Google session cookies. System 1
found all three in the first 10 KB of one page.

#### NEW STT finding: the health check has a short-garbage hole

```
STT chunk 1: kept 4 chars: dhbc
STT chunk 2: kept 1 chars: ,
STT chunk 4: kept 4 chars: dhpk
STT chunk 6: kept 3 chars: dhk
STT chunks: total=8 kept=8 dropped=0
```

Half the chunks are 1-4 characters of noise and **all were kept**. `isLooped()`
returns false for anything under 8 words, so *degenerate short* output passes as
healthy - the guard only catches repetition, not collapse. A minimum-content
check belongs beside it.

Two silver linings: **"1 billion tokens" survived, twice** - the one claim that
mattered. And `rate=48000 ch=2` decoded correctly, so the format-reading fix
generalises beyond the 44100 case it was written for.

#### The GitHub gate did its job again

```
slugs detected=[v1/chat, v1/model, v1/responses, vibeta/models, 8881/v1,
                v1beta/models, 8081/v1, 8081/v1Model, mub/workflowsdflare,
                doublecurry/fix, github/workflows]
slugs verified=[]
```

Eleven junk slugs from OCR, **all correctly rejected**. Note `doublecurry/fix` is
in that list and was thrown out - and then the synthesis model reintroduced
`doublecurry` anyway. The deterministic layer caught it; nothing downstream
listened.

#### Repeat offenders

- `techName=Unknown Technology` - third time. Abstention logged, ignored again.
- Raw caption + transcript used as the web query - third time.
- Markdown table - five for five.

---

## Running tally of failure modes

Update after every case. A mode seen once is an anecdote; three times is a bug
worth designing against.

| Mode | Cases seen | Notes |
|---|---|---|
| **Invented specifics in synthesis** | **1, 2, 3, 4** | Wrong-fork repo (1); fake "HybridMAS" (2); fabricated "4x H100" (3); false "Windows only" (4). **4 for 4 - the defining bug** |
| **Verdict reflex: always PARTIALLY_TRUE** | **1, 2, 3, 4** | Never reached HYPE, even on a deliberate hype reel. Rubric is decorative |
| Markdown that RN cannot render | 1, 2, 3, 4 | tables, asterisks |
| Unsourced factual assertion in summary | 1, 2, 3, 4 | contributor counts, "HybridMAS", "4x H100", "Windows only" |
| **Carousel truncated to ~4 slides by the embed** | **4** | **Structural.** 4 of 9 slides seen; embed lazy-loads, extractor reads DOM once |
| **Denied a tool that was on an unseen slide** | **4** | "No repo replicates Runway" (Wan2.1, 16.9k); "no repo matches Nano Banana" (ComfyUI, 131k, and `#comfyui` was in the caption it read) |
| Cited a trivial repo over the real one | 1, 4 | 18-star fork (1); 4-star Nano-Banana-AI over 131k ComfyUI (4) |
| Raw transcript/caption used as a web query | 2, 4 | The Big Brother bug, fixed offline only |
| Abstention logged then ignored | 2, 4 | `techName=Unknown Technology`, report claims specifics anyway |
| Fact-checked a claim the post never made | 3 | Checked self-hosting; reel claimed free-in-Cline |
| Missed a contradiction visible on screen | 3 | 1M context vs 262.144k in frame 04 |
| Renamed/redirected repo not resolved | 1 | clawdbot -> openclaw (resolved correctly in case 4) |
| OCR noise promoted to a tool entry | 1 | "ZArchitecture" |
| OCR truncated out of the query by ordering | 2 | `buildSearchQuery` puts transcript first, cuts at 240 |
| Proper nouns lost or garbled by STT | 2, 3 | Antigravity lost to dropped chunk (2); "Cline" heard as "Klein" (3) |

## Pending fixes - HELD until case 5

Do not apply these before the run is finished.

1. Port the fixed `verify.py` synthesis prompt to
   `mobile_app/src/services/api.js` - fields not markdown, references drawn only
   from fetched evidence. Closes modes 3 and 6.
2. **Repo gate:** a repo URL may appear in the report only if it was in the
   gathered evidence, and every emitted slug gets GitHub-verified **following
   redirects**. Closes modes 1 and 2 - `clawdbot/clawdbot` resolves to
   `openclaw/openclaw` on its own.
3. Once (1) lands, delete the 10-regex markdown scrub in `ChatScreen.js`.
4. **Apply the offline "never search a raw transcript" rule to the online path
   too** (`FactCheckEngine.kt:141-149`). One fix, one line of policy, and it
   closes a bug that already produced a fully wrong report once.
5. **Reorder `buildSearchQuery`**: OCR first, transcript second, and cap each
   separately so neither can truncate the other away.
6. **Surface abstention.** When `SourceEvidence` returns no name, that must reach
   the report instead of being overwritten by whatever the model guessed.
7. Give `ground_truth.py` a caption fallback - the app currently extracts
   captions better than the reference tool does.
8. **Force the verdict to engage with framing, not just tool existence.** Three
   for three PARTIALLY_TRUE on posts including a deliberate hype reel means the
   rubric never bites. Options: make the model score the framing separately from
   the tools, or require an explicit reason when it declines HYPE/MISLEADING on a
   post containing superlatives ("replaces", "dead", "digging their graves",
   "nobody is talking about").
9. **Ban hardware/pricing/requirement numbers that are not in the evidence.**
   Same gate as the repo gate: a spec quoted in the report must be traceable to a
   fetched page.
10. **HIGHEST PRIORITY - fix carousel slide coverage.** The embed page lazy-loads;
    reading the DOM once yields ~4 slides regardless of post length. Options, in
    order of effort:
    (a) Detect the slide counter that is printed on the slides themselves
        ("01 / 09") in OCR. If the declared total exceeds the number of images
        obtained, the extraction is incomplete - fall back to Render, or at
        minimum say so in the report instead of answering confidently.
    (b) Drive the embed carousel's next control in the WebView and re-read the
        DOM between swipes.
    (a) is cheap and turns a silent wrong answer into an honest one.
11. **Never deny a tool's existence on partial evidence.** "No dedicated repo
    replicates Runway" was stated while the answer sat on a slide the app never
    loaded. Absence of evidence must be reported as such, not as absence.

---

# CONCLUSION - what five cases actually proved

## The healthy half

These worked in every case and should not be touched:

- **Media extraction for reels.** WebView succeeded on all three reels, no Render
  fallback needed. Audio decode read `44100 ch=2` and `48000 ch=2` correctly, so
  the format-reading fix generalises.
- **Chunked STT.** Verified on device (case 2). A repetition loop cost one
  12-second window instead of the whole transcript.
- **The GitHub verification gate.** It rejected `29/mo` (case 4) and all eleven
  junk slugs including `doublecurry/fix` (case 5). Zero false positives across
  five cases.
- **Frame sampling at 10-12.** Text lives on 1-2 frames out of 10-12 in every
  talking-head reel measured. The old 4-frame sampling would have missed it.

## The three real diseases

Everything that went wrong reduces to three causes, not eleven symptoms.

### Disease 1 - the pipeline is blind and does not know it

| Case | What it could not see | What it did instead |
|---|---|---|
| 4 | 5 of 9 carousel slides | Denied ComfyUI (131k) and Wan2.1 (16.9k) exist |
| 5 | The real subject; grabbed IDE chrome | Fact-checked `sparkdly-api`, a window title |
| 2 | Repo slug (was in a pinned comment) | `techName=Unknown Technology`, report named 3 repos anyway |

The common failure is not the blindness - some blindness is unavoidable. It is
that **blindness is never reported**. `techName=Unknown Technology` was logged in
three of five cases and overridden silently every time. The system computes "I do
not know" and then throws it away.

### Disease 2 - invented specifics, 4 for 4

| Case | Invention |
|---|---|
| 1 | `shanselman/clawdbot` (18-star fork) + a fabricated install command |
| 2 | "HybridMAS", a project that does not exist |
| 3 | "NVIDIA recommends at least 4x H100" (the card says **1x** H100 80GB) |
| 4 | "Duix-Avatar runs only on Windows" (README: Docker x33, Ubuntu x9) |
| 5 | `doublecurry/gemini-web2api` (**0-star fork** of a 3,124-star original); "still incurs Google Gemini usage fees" when the tagline is *Zero cost* |

Every invention is plausible, specific, and unsourced. **Three of the five are
the same sub-bug: a fork or trivial repo cited over the canonical one** (18 stars
over 389k; 4 stars over 131k; 0 stars over 3,124). Popularity and fork status are
never checked, though both are one API field away.

### Disease 3 - the verdict does not engage with framing

Four PARTIALLY_TRUE, then FAKE. So the rubric is reachable - but only through
*existence*. It never chose HYPE or MISLEADING, the two verdicts that require
judging how a claim is *framed*:

- Case 3: CEOs digging graves, "they have been paying for the shovel" -> PARTIALLY_TRUE
- Case 5: "1 billion tokens daily" (absent from the README), Pro silently routing
  to Flash, and exporting full Google session cookies -> the app said FAKE about
  the wrong subject and never mentioned the credential risk at all

The rubric defines PARTIALLY_TRUE as "real tools exist, with minor caveats", and
something real is nearly always on screen. Nothing forces the model to weigh the
post's framing, so it never does.

## Ranked fixes

Ordered by evidence, not by ease. **The synthesis prompt was originally ranked
first; it is not first. No prompt helps a pipeline that cannot see the post.**

1. **Carousel coverage.** Detect the "01 / 09" counter the slides print on
   themselves; when the declared total exceeds images obtained, fall back to
   Render or declare the extraction incomplete. (Case 4)
2. **Surface abstention.** When `SourceEvidence` returns no name, that must reach
   the report. Three of five runs logged "Unknown Technology" and published
   confident specifics anyway. (Cases 2, 4, 5)
3. **Canonicality gate.** Resolve redirects and reject forks: if `fork: true`, name
   the parent. One GitHub field closes three failures. (Cases 1, 4, 5)
4. **Evidence gate.** A repo, install command, price or hardware spec may appear
   in the report only if it is traceable to a fetched page. (All five)
5. **Structured synthesis output.** Fields in, components out. (All five)
6. **Query building.** Never search a raw transcript; the offline path already
   refuses to, the online path still does. And `buildSearchQuery` puts transcript
   first then cuts at 240 chars, so OCR - the better signal - is truncated away.
   (Cases 2, 4, 5)
7. **STT health holes.** `isLooped()` needs >=8 words, so 1-4 character garbage
   passes as healthy (case 5). And an Arabic-script transcript scores zero
   candidates against a `[a-z0-9]` tokeniser (case 5). Add a minimum-content check
   and a script check.
8. **Make the verdict judge framing**, separately from whether the tools exist.

## Applied on September 7 (after case 5)

- (5) Structured synthesis output in `mobile_app/src/services/api.js` +
  `normalizeReport()`, and a new `src/components/ReportCard.js`. The ten-regex
  markdown scrub in `ChatScreen.js` is deleted. References are built from fetched
  evidence, so they cannot be invented.
- Token budgeting: 12 evidence rows, 300-char page context, rows carrying scraped
  page text ranked first. Groq's free tier refused a 9,050-token request against
  an 8,000 cap.
- Rate-limit retry that honours Groq's stated wait, and does not wait on
  "request too large" - waiting cannot fix a single oversized request.
- Two Hermes crashes: a `setMessages` updater closing over a catch parameter
  (`err`), and a dangling `reportText` reference. Both are runtime-only, so
  `babel.transformFileSync` passed them. **Added a scope-aware undefined-identifier
  scan** - it is what would have caught both.

Still outstanding: 1, 2, 3, 4, 6, 7, 8.

---

# SET 2 - System 1 verdicts, recorded BEFORE any app run

Captured September 8, 2026. Locked in before System 2 was run, so the comparison
cannot be rationalised afterwards. Set 1 (`runs_set1.csv`) is archived; these
reels are new and were never used for tuning.

## 2A - DdAwhV3GXWi (carousel, 3 slides, @simplifyinai)

**Subject:** `asgeirtj/system_prompts_leaks` - a repo of extracted system prompts.

| Claim | Finding |
|---|---|
| Repo exists | **TRUE.** 64,406 stars, created 2025-05-03, CC0-1.0 |
| "System prompts behind GPT-6 Astra and Fable 5.1" | **Supported.** The repo's own table lists `Codex GPT-6-Astra` (Sept 4 2026) and `Claude Fable 5.1` (Sept 1 2026), plus Grok 4.6 and Gemini 3.7 Flash |
| "401 prompt files across 16 providers" | Plausible and specific; not independently counted |
| "100% free and open-source" | **TRUE** - CC0-1.0 |

**System 1: PARTIALLY_TRUE.** Everything checkable is accurate. The omission is
that "leaked" implies verified authenticity: these are user-extracted prompts,
which can be model confabulations, and nobody outside the vendors can confirm
them. The post presents them as definitive.

## 2B - Dc8wTn4SaGg (reel, 28s, English, Julian Goldie)

**Subject:** `magnitudedev/magnitude` - "Open source inference server that runs
the best local models for your hardware, plugged into the agent you already use."
4,141 stars, Apache-2.0.

Note: "Hermes" is **not** a Whisper garble. Magnitude's own README lists
"Pi, OpenCode, Hermes, OpenClaw, Codex, Claude Code, Oh My Pi, and Cline".

| Claim | Finding |
|---|---|
| Magnitude is real and open source | **TRUE.** Apache-2.0, HN "Magnitude - Open-source AI coding agent that runs local models offline" |
| "100% free, no API bill" | **TRUE** for local inference - no per-token cost |
| "Fully offline, unlimited tokens" | **TRUE**, with the README's own caveat: "There's no fixed minimum... more memory lets you run larger models" |
| **"Stop paying to run Claude Code"** | **Overstated.** You cannot run Claude offline. Magnitude points the *harness* at a local model instead - you are substituting a weaker model, not running the same one free |

**System 1: PARTIALLY_TRUE.** Real tool, works as described. The framing implies
equivalence with Claude that local models do not deliver.

## 2C - DXPBYItAXnL (reel, 48s, English) - THE FALSE ONE

Family Guy AI-slop skit. On-screen: "No more Claude AI Limits?"

**Claim:** Claude Code's usage limit lives in a local session log; `cd ~/.claude`,
delete everything except the first line, save, restart - "the limit disappears...
it was never really global."

| Check | Finding |
|---|---|
| Hacker News for any such technique | **No story exists.** Searches return the opposite: "Claude Code 2.1.234 continues your session automatically once usage limit resets", "Anthropic raises Claude Code usage limits" - both describing a server-side, time-based limit |
| Plausibility | Usage limits are enforced per account on Anthropic's servers. A local log file cannot govern them |
| Harm | Following it deletes your local session history for no benefit |

**System 1: FAKE.** The mechanism described does not exist. (MISLEADING is a
defensible second choice under the rubric, since Claude Code itself is real and
what is fabricated is the *technique* rather than a tool.)

**This is the case the app has never passed: it has never once correctly called
something false.**

## 2D - DZMqdC0Ronu (reel, 69s, Hindi, Chandan Shaw)

On-screen title: **"FREE HOSTING & FREE DOMAIN - 100% REAL"**

| Claim | Finding |
|---|---|
| Free domain via `DigitalPlatDev/FreeDomain` | **TRUE.** Real, AGPL-3.0, screenshot shows 174k stars, **actually 198,144 now** - understated, as in every honest post so far |
| Free hosting via HOSTOMY | **FALSE as stated.** Hostomy's Basic plan is **Rs 95/month, "Billed triennially"** - roughly Rs 3,420 paid three years upfront. Plus is Rs 195/month |
| "Promo code makes it free for a month" | A one-month promo on a three-year contract is not free hosting |
| Free charity hosting | **TRUE, but narrow** - only for registered non-profits/NGOs, by email application with proof of status |

**System 1: MISLEADING.** The domain half is genuinely free and correctly
credited. The hosting half is a paid three-year commitment presented under a
"FREE HOSTING - 100% REAL" banner, and the triennial billing is never mentioned.
Omitting a pricing catch is the textbook case for this verdict.

## 2E - Dc8b0ghDcd9 - CAPTURE FAILED, no System 1

Instagram returned an empty media response to **both** yt-dlp and instaloader,
twice, ten minutes apart. Login-gated or rate-limited.

Worth watching for its own sake: the app's WebView extractor runs inside a real
browser context, so it may succeed where the PC tools failed. **If the app
returns a report for this one, there is no ground truth to score it against** -
report it, do not score it.

## What set 2 tests that set 1 could not

- **2C is outright false.** Set 1 contained no fabrication; every post was about
  a real tool. Four of five app runs in set 1 could be "right" by assuming things
  are real. That assumption fails here.
- **2D is a pricing claim**, verifiable only by reading a pricing page - exactly
  what Jina Reader was added for.
- **2B and 2D both hinge on framing**, not existence, which is the half the
  verdict split was built to handle.
- Expected spread: **PARTIALLY_TRUE, PARTIALLY_TRUE, FAKE, MISLEADING** - no two
  the same reflex would satisfy.

---

# SET 2 RESULTS + a correction to System 1

## CORRECTION: 2C was MISLEADING, not FAKE. The agent's ground truth was wrong.

System 1 called the Claude-Code-limit reel FAKE on the grounds that "no such
technique exists", reasoning from an *absence* of Hacker News discussion. The
user proposed searching for the technique itself and reading what people say
about whether it works. That found the opposite of silence:

- *"Claude Code stores conversation history in log files. When you hit the
  **conversation limit**, you can actually delete the beginning of the log file
  and continue"*
- *"/limit-reset in Claude Code: what it actually resets - clears your **5-hour
  session limit** once a week, but not your weekly cap"*

There are two different limits. **Conversation length** is local, living in log
files, so deleting the log genuinely helps. **Usage quota** is server-side on
5-hour and weekly windows, with an official `/limit-reset` command.

The reel takes the real trick for the first and sells it as defeating the second.
That is misapplication, not fabrication: **MISLEADING**.

Method note: absence of evidence was the wrong instrument. Searching for
discussion *about* a technique beats searching for the technique's existence, and
it is what corrected this entry.

## Scoreboard, against the corrected truth

| Case | Model raw | After code rules | Truth | |
|---|---|---|---|---|
| 2A prompts-leaks | PARTIALLY_TRUE | PARTIALLY_TRUE | PARTIALLY_TRUE | correct |
| 2B magnitude | PARTIALLY_TRUE | PARTIALLY_TRUE | PARTIALLY_TRUE | correct |
| 2C claude-limit | **MISLEADING** | HYPE | MISLEADING | **model right, rule broke it** |
| 2D free-hosting | PARTIALLY_TRUE | PARTIALLY_TRUE | MISLEADING | miss |

**The model got 3 of 4. The deterministic layer turned one of them into a miss.**

## What worked

- **Subject picker: 4/4.** `Magnitude`, `system_prompts_leaks`, `FreeDomain`,
  `Claude Code` - all correct, on reels it was never tuned against. Set 1 had two
  wrong (a window title and a caption headline).
- **Page text: 9-12 of 12 rows** carried real content, up from 7-11. Jina Reader
  is doing its job.

## What failed

**1. The MISLEADING -> HYPE softening rule.** Two firings, two errors. It moved a
correct MISLEADING to HYPE because "Claude Code" is a real tool. Tool existence
says nothing about whether a claim *about* that tool is honest - exactly what the
verdict split was built to separate. **Removed.**

**2. 2D pricing.** Hostomy was never extracted as a subject, so the paid half of
"FREE HOSTING" was never examined. The app answered the half that was true.
`FreeDomain` is genuinely free; Hostomy is Rs 95/month **billed triennially**.

**3. Speed regressed:** set 1 mean 40.3s, set 2 mean **50.4s**. Parallelising the
router saved less than Jina cost.

## Standing lesson

Every deterministic rule added since the verdict split has needed correcting, and
one was actively harmful. The subject picker - which replaces a *guess* with a
*lookup* - has been the only unambiguous win. **Prefer rules that fetch a fact
over rules that adjust a judgement.**

## Sources checked and closed

- **Reddit is unusable**: 403 direct, and 403 through Jina. No keyless path.
  DuckDuckGo surfaces the Reddit threads anyway, so nothing is lost.
- **Hacker News comment search** (`tags=comment`) works and adds context, but is
  weaker than a plain DDG query about the technique.

---

# SET 3 - System 1 verdicts, recorded BEFORE any app run

Captured September 8, 2026. Ground truth written first, as in set 2. Device CSV
was cleared before this set (`runs_set2.csv` archived and verified identical,
5 lines, before deletion).

Shapes deliberately covered, per the "what needs doing next" list in
`HANDOFF_NOTES.md` section 11 G:

| # | Shortcode | Type | Shape being tested |
|---|---|---|---|
| 3A | `DbtJytsumrO` | reel, 38.6s | **benchmark claim** - a self-reported score 0.1 points over the human baseline |
| 3B | `Dcz98y7mbA1` | carousel, 3 slides | **licence / commercial-use catch**, and a slide that contradicts its own screenshot |
| 3C | `DcbFunokXyI` | carousel, **7 slides** | **>4 slides** (carousel blindness), unsourced multipliers, a named competitor dismissed |
| 3D | `DcwJq4tp6Fz` | reel, 57.7s, Urdu/Hindi | **pricing / earnings claim, no repo at all** - four real companies, wrong rates |
| 3E | `DcqopiqvtRw` | reel, 50.6s, Urdu/Hindi | **pricing catch visible on screen**, platform real |

`checkTechnique` gets its exercise on 3D and 3E (both sell a *method*, not a
tool) and the OCR billing-catch detector gets its first device run on 3B and 3E.

## 3A - DbtJytsumrO (reel, 38.6s, English, @Wassim Younes) - Prime Agent

**Captured on the third attempt, with cookies.** The first two failures were not
rate limiting: at the moment `DbtJytsumrO` failed, `DcqopiqvtRw` fetched fine
from the same IP, so the post is login-gated. `ingest.py` now loads an exported
Netscape cookie jar (`www.instagram.com_cookies.txt`, gitignored, never staged)
into both yt-dlp (`cookiefile`) and Instaloader. **That also closes case 2E's
failure**, and System 1 no longer has a class of post it cannot reach.

**Subject:** `PrimeIntellect-ai/prime-agent` - shown on screen as the repo README
("Prime Agent: A Self-Improving RLM Agent", MIT licence tab visible) plus an
embedded X post from @MTSlive quoting Prime Intellect.

| Claim (spoken or on screen) | Finding |
|---|---|
| The repo exists, open source | **TRUE.** `PrimeIntellect-ai/prime-agent`, **20,258 stars**, 2,212 forks, **MIT**, created 2026-05-08, pushed 2026-09-08. Description matches the frame verbatim: "A self-improving RLM agent for coding workflows and long-running autonomous tasks" |
| "Opus 5 baseline: 30% -> 95.5%" (green overlay) | **TRUE.** ARC Prize's own independently verified score for Claude Opus 5 (High) on ARC-AGI-3 is **30.16%**. Prime Intellect reports **95.5% RHAE Best@1** with the same model under their harness |
| "95.5% on ARC-AGI-3, above the human baseline" | **TRUE as stated, but on a 0.1-point margin.** The ARC-reported human expert baseline is **95.4%** |
| **The margin is best-of-three** | **The catch, and it is in the vendor's own table.** Three runs scored **[95.0, 95.2, 95.5]**. Only the best run clears 95.4; the other two are **below** the human baseline. The reel quotes the maximum as the result |
| "Self-improving / rewrites its own prompts, memory, and its tests" | **Mostly TRUE, one term wrong.** The Continual Harness is `H = (rho, G, K, M)` = **prompt, sub-agents, skills, memory**, each with create/read/update/delete, refined online from the agent's own trajectory. **"Tests" is not one of the four** - the fourth is *skills* |
| "Extremely token-efficient" / "increased 70% of quality and less tokens" | **Supported in direction.** The blog states it "saves tokens by programmatically running functions over data rather than spending tokens reading data using tools", and reports higher maximum scores at lower total token usage than native harnesses. The specific "70%" is not a figure the source states; the measured gain is 30.16 -> 95.5, i.e. **+65 points**, so the number is loose rather than invented |
| "The best self-improving harness out there" | **Contestable.** A July 2026 paper reports the **Tycho** agent at 100 RHAE on the public ARC-AGI-3 games with both GPT-5.6 Sol and Opus 5 under its orchestration policy |
| "It's not the model, it's the harness" | **This is the source's own framing**, and the blog agrees the gain is not benchmark-specific. Also worth recording: the blog says **no model has yet been trained around Prime Agent**, so the headline is a scaffolding result on an untrained-for model |
| Independent verification | **Absent, and this is the real limitation.** 95.5% is self-reported by Prime Intellect (blog + arXiv 2608.23552). ARC Prize verified only the 30.16% base-model figure. A harness score is a **model-plus-harness** result and is not interchangeable with a leaderboard score |
| "Comment 'agent' I'll send harness" | Engagement funnel, not a claim |

**System 1 verdict: PARTIALLY_TRUE.** This is the most accurate post in set 3.
The repo is real and large, the licence is MIT as shown, the 30% and 95.5%
figures are both correct, and the mechanism is described roughly right. What
keeps it from TRUE is that the one thing the whole reel rests on - *beating the
human baseline* - survives on **0.1 points from the best of three runs**, while
the median run does not clear it, and the result is vendor-reported rather than
ARC-Prize-verified. Plus one wrong component ("tests" for *skills*).

**What this case tests:**
1. **A benchmark claim** - a shape no previous case had. The subject is not
   "does the tool exist" but "is the number right, and what does it mean".
2. **Reading a vendor's own results table for the caveat.** [95.0, 95.2, 95.5]
   against a 95.4 baseline is exactly the "1M vs 262.144k" shape from case 3,
   which the app missed - except here the refutation lives on the linked blog,
   not in a frame.
3. **Self-reported vs independently verified.** ARC Prize verified 30.16%;
   nobody external verified 95.5%. A fact-checker that treats a vendor blog as
   settled evidence fails this.
4. **The repo slug is on screen** (README header + MIT licence tab), so
   `SourceEvidence` has its best possible case - unlike 3C, where the slug is
   only in a DM.
5. **Clean English STT.** The transcript is coherent, so any identification
   failure here cannot be blamed on Whisper.

## 3B - Dcz98y7mbA1 (carousel, 3 slides, @simplifyinai) - GitNexus

**Subject:** `abhigyanpatwari/GitNexus`, "the Zero-Server Code Intelligence
Engine".

| Claim | Finding |
|---|---|
| Repo exists | **TRUE.** `abhigyanpatwari/GitNexus`, **47,135 stars**, 5,157 forks, created 2025-08-02, pushed 2026-09-08, not a fork |
| "Builds a knowledge graph of your repo: every dependency, call chain, cluster" | **TRUE.** README: knowledge graph, blast-radius analysis, cross-file renaming, taint tracking with `--pdg` |
| "Works inside Claude Code, Cursor, Codex, and more" | **TRUE.** README lists Claude Code, Cursor, Codex, Antigravity, OpenCode, CodeBuddy, Qoder, Windsurf via MCP |
| `npx gitnexus analyze` | **TRUE.** npm `gitnexus` exists, latest **1.6.11**; slide 1 shows v1.6.10, i.e. slightly older, understated - honest |
| "Try the web version with zero install" | **TRUE.** homepage `gitnexus.vercel.app`, client-side in the browser |
| "GitHub Trending #1 Repository Of The Day" (badge, slide 1) | Plausible, and the README refers to trending; not independently re-verified |
| **Slide 2: "100% free & open-source."** | **FALSE on the second half.** Licence is **PolyForm Noncommercial 1.0.0** - confirmed three ways: the badge in the post's own slide 1, the README licence section, and npm's `license` field `PolyForm-Noncommercial-1.0.0`. PolyForm Noncommercial is *source-available*, not open source; commercial use needs a separate licence |
| Caption: "free for personal use, commercial use needs a separate license, it's not fully open source" | **TRUE, and honest.** The caption states exactly what slide 2 denies |

**System 1 verdict: PARTIALLY_TRUE.** The tool is real, popular, and does what is
claimed; the install command and the editor list are both correct. The single
error is "100% free & open-source" on slide 2, and the post's own caption *and*
its own slide-1 licence badge contradict it. That combination - a caption which
discloses the catch the graphic hides - is why this is not MISLEADING.

**What this case tests:**
1. **The OCR billing/licence catch detector's first device run.** The string that
   should fire it is `License PolyForm Noncommercial`, rendered small inside a
   screenshot of a README badge row, not as body text.
2. **Does the app notice the post contradicting itself?** Same shape as case 3's
   "1M context vs 262.144k in its own frame 04", which the app missed. Here the
   refutation is on slide 1 and the claim on slide 2.
3. **Canonicality:** `abhigyanpatwari/GitNexus` has 5,157 forks and a same-named
   sibling `tintinweb/pi-gitnexus` (201 stars). Three of five set-1 failures were
   a fork or trivial repo cited over the canonical one.
4. Whether "not fully open source" from the caption survives into the report at
   all - the caption is the only place the catch is written in plain text.

## 3C - DcbFunokXyI (carousel, **7 slides**, @charlieautomates) - BASE / basemode

Slides are numbered on themselves: **01/07 ... 07/07**. That printed counter is
exactly the signal fix (10a) in this file proposes to use, so this post measures
both the disease and the proposed cure.

**Subject:** `ChristopherKahler/base` - "BASE = Builder's Automated State Engine",
homepage `docs.basemode.ai`.

| Claim | Finding |
|---|---|
| The repo exists | **TRUE.** `ChristopherKahler/base`, **171 stars**, 17 forks, created 2026-06-02, pushed 2026-09-08 |
| "Rules are activated on keywords through hooks & MCP" | **TRUE.** README: session-start hook, four injection points, MCP, domain rules by keyword |
| "BASE can ping other sessions / send tasks to other running sessions" | **TRUE.** README documents `base relay register|send|ping|task|board|wait`, local relay, session codenames |
| "It also comes with Dev Mode" | **TRUE.** documented |
| "Remembers every project every session" | **TRUE.** that is the stated product |
| **"90% Better Ouput" (slide 03, sic)** | **UNSOURCED.** The string "90%" appears nowhere in the README and no numeric performance claim appears in `docs.basemode.ai` |
| **"Saving 70x on tokens while 90x'ing output" (slide 04)** | **UNSOURCED.** No "70x", no token-savings multiplier anywhere in the project's own docs |
| Caption: "70x fewer tokens. Behavior that holds." | Same unsourced number, repeated |
| "Smart Devs Don't Use Graphify. They Use BASE." | **Graphify is real and far larger.** `Graphify-Labs/graphify`, **115,867 stars**, Apache-2.0. BASE has 171. The README does argue against "graph-in-a-folder" tools on design grounds (batch export vs self-maintaining hooks), which is a fair argument - but not a measured one |
| Licence | README badge and licence section: **FSL-1.1-ALv2** (Functional Source License 1.1, Apache 2.0 future licence). **Commercial use is permitted**; only reselling base itself is withheld |

**Note against a wrong answer that is easy to reach:** a web search summary
claimed BASE is "PolyForm Noncommercial", which is what *GitNexus* (3B) uses. The
repo's own README says FSL-1.1-ALv2 with commercial use permitted. Search
summaries conflated two tools; the licence file is the authority. If the app
reports PolyForm for BASE, that is a fabrication with a traceable cause.

**System 1 verdict: HYPE.** Every *feature* claim checks out against the
project's own documentation - this is a real, working, actively pushed tool. What
does not check out is the arithmetic: **70x fewer tokens** and **90% better
output** are the two headline numbers, they are the reason to swipe, and neither
appears in the README, the docs site, or anywhere else. Add a 171-star project
declaring that "smart devs" have abandoned a 115k-star one, and the framing is
doing work the evidence does not support.

**What this case tests:**
1. **Carousel coverage, 7 slides.** If the extractor still reads the DOM once and
   gets ~4, it will see 01/07-04/07 and miss Dev Mode and the relay entirely.
   `EXTRACT: candidate[N]` logging must be built for this run.
2. **The printed 01/07 counter** - can OCR see it, so fix (10a) is actually
   implementable?
3. **Unsourced multipliers.** Fix (9) bans hardware/pricing numbers not in
   evidence; 70x and 90% are the same species. The app fabricated "4x H100" in
   case 3; here the number is in the *post* and absent from the *evidence*, which
   is the mirror image, and the correct behaviour is to say so.
4. **The stance trap, second instance** (case 2's DeepCode was the first).
   Graphify is named *in order to be dismissed*. Listing Graphify as a
   recommended tool means the mention was read and the stance missed.
5. **Canonicality on an ambiguous name.** "Graphify" resolves to
   `Graphify-Labs/graphify` (115,867) and `rhanka/graphify` (21). Picking the
   21-star one is exactly the set-1 failure.
6. **Subject naming.** "BASE" and "basemode" are generic words, and the repo slug
   `ChristopherKahler/base` appears in **no frame** - slide 07 says "Comment BASE
   and I'll DM you the repo link", so the identifier is in the DM, like case 2's
   pinned comment. Finding it requires search, not OCR.

## 3D - DcwJq4tp6Fz (reel, 57.7s, Urdu/Hindi, @Saurabh "Making AI Simple")

**On-screen title: "How to make $100 per day with Laptop & Wi-Fi".** Four
platforms are named, each with a rate. No repo, no GitHub, nothing to verify with
a slug - the whole case runs on company and pricing lookups.

| # | Platform (frame) | Reel says | Finding |
|---|---|---|---|
| 1 | **Arise** (frame 02, `arise` site: "Remarkable customer experience is driven by you") | customer support work, "number one" | **Real company, but not a job.** Arise is a platform for *independent contractors* who must register a business, pass a paid background check, and pay a **$19.75 platform fee twice monthly**; reported startup cost $250-700. Serves clients in the **US, UK and Canada** |
| 2 | **Preply** (spoken: "platform called Preply") | teach maths/programming/English, **"$25 per hour easily"** | **Real, rate overstated.** New tutors pay **33% commission** (falling to 18% only after 400+ hours), and **trial lessons are 100% commission** - the first lesson with each new student pays the tutor nothing. $25/hr advertised is ~$16.75 kept, minus currency conversion |
| 3 | **Rev** (frame 07: "Freelance With Rev. Get Paid Weekly.", frame 05 caption "3. Transcription Rev") | transcription/captions, generate captions, fix mistakes | **Real, and "paid weekly" is correct.** Pay is **$0.40-$1.10 per audio/video minute** (captioner $0.54-$1.10), *not* per working hour. Transcription typically runs 4-6x real time, so the realistic hourly figure is far below the reel's framing |
| 4 | **KellyConnect** (frame 09, green Kelly branding) | technical support, **"pays you around $50 per hour"** | **Real company, rate roughly 2.5x too high.** Reported averages: **$18.80/hr** (work-from-home customer service) and **$21.81/hr** across remote KellyConnect roles, most between $15 and $24 |
| - | Headline | **"$100 per day with Laptop & Wi-Fi"** | **Not supported by any of the four.** At real rates, $100/day is a full 5-6 hour shift at the *best* of them, and three of the four are hiring inside US/UK/CA |
| - | CTA | "If you want the link and guide, join my Broadcast Channel" | Engagement funnel, not a claim |

**System 1 verdict: MISLEADING.** Every company named is real and every one of
them does pay - nothing here is fabricated. What is wrong is everything a viewer
would act on: **$50/hr where the market says ~$19**, "$25/hr easily" from a
platform that takes 33% and pays zero on trial lessons, per-audio-minute
transcription piece rates presented as an hourly wage, and a platform that
charges *you* a recurring fee presented as employment. The eligibility catch is
never mentioned once: this is a Hindi/Urdu reel selling US-and-UK-only contractor
work. Textbook "omits critical limitations and misrepresents functionality".

**What this case tests:**
1. **`checkTechnique` on a method, not a tool** - its first device run. There is
   no repo, no package, no model. If the pipeline can only fact-check things with
   slugs, it has nothing to hold here.
2. **The pricing path against four different pricing pages** - Arise's fee
   structure, Preply's commission, Rev's per-minute rates, Kelly's hourly range.
   Jina Reader exists for exactly this.
3. **The HN path** - barely exercised across ten cases, and this is the first post
   with no GitHub anything.
4. **STT.** faster-whisper produced Urdu in Arabic script *again* (case 5's
   failure), plus a hard repetition loop - `seu seu seu...` and `Tha Tha Tha...`
   inside the first 20 seconds. "Preply", "Rev" and "Kelly Connect" survive only
   as `پریپلی`, `ریو` and a Latin-script `Kelly Connect`. The one clean Latin
   string in the entire transcript is `which pays you around $50 per hour`.
5. **Does the app check a rate at all**, or accept "$50 per hour" because
   KellyConnect exists? Existence is not the claim here; the number is.

## 3E - DcqopiqvtRw (reel, 50.6s, Urdu/Hindi, @Sachi Finance) - Mindrift

**Subject:** **Mindrift** (`mindrift.ai`, also reached at `mindrift.toloka.ai`),
built by **Toloka**. Screen-recorded on a tablet throughout.

**Claim:** you can train AI on this site and earn; the creator shows completing
sample image-comparison tasks and a balance of **$14.70**.

| Thing on screen | Finding |
|---|---|
| "Get paid to train AI... project-based platform" | **TRUE.** Mindrift is real, built by Toloka, an established AI data company |
| **"Entry-level: $15-30 per hour / Domain experts: $60-100+/hr"** (frame 00) | **This is Mindrift's own advertised headline**, quoted verbatim from `mindrift.ai`. Independent reviews put beginners at roughly **$5-20/hr**, with location-based rates of **$8-15/hr** in lower-cost regions, and realistic beginner earnings of **$50-100 per month** |
| **"~$0.50 per task" and "~$0.35 per task"** (frames 08, 10) | **The post's own screenshots refute its own banner.** At $0.35-0.50 per task, the advertised $15-30/hr requires 30-85 completed tasks per hour |
| **"[Feather] Get Paid $6/hour to Record Narrated Video"** (frames 07, 11) | Also from the platform: a live project at **$6/hour**, a fifth of the advertised floor |
| Creator's shown balance **$14.70** | Consistent with the real rates, and **honest** - he shows a small number rather than inventing a big one |
| Withdrawal: Payoneer $20 min / $1 fee; PayPal via Tipalti $5 min / 2% + EUR 0.60 (frame 10) | **Real terms, shown plainly.** Note $20 Payoneer minimum against a $14.70 balance - he cannot withdraw yet |
| "941,246 seats" on the Feather project | Platform text, not a creator claim |
| Task work shown (pick better generated image, selfie upload tasks) | Genuine Mindrift task types |

**System 1 verdict: PARTIALLY_TRUE.** The platform is real, the payouts are real,
the task screens are genuine, and the creator's own number is small and truthful -
this is the most honest of the four. What keeps it from TRUE is that the reel
leads with the platform's $15-30/hr banner and never reconciles it with the
$0.35-per-task and $6/hour projects it then shows on screen, and never mentions
that the $14.70 balance is below the $20 Payoneer withdrawal minimum.

**What this case tests:**
1. **A pricing catch that is visible in the frames rather than on a website** -
   the refutation is a screenshot of the platform's own task price, so this is an
   OCR-reading test before it is a web-lookup test.
2. **A second self-contradiction case**, after 3B. The app has missed one before
   (case 3, 1M vs 262.144k).
3. **Subject picking with no repo and no package** - "Mindrift" and "Toloka" are
   companies. Set 1 fact-checked a window title on exactly this kind of screen
   recording; the frames here are full of chrome (`Explore`, `Projects`,
   `Complete your profile`, `Get started`, `Set up withdrawal method`).
4. **Arabic-script STT again**, and short: 368 characters for a 50-second reel.
   The Latin strings that survive are `AI`, `website`, `14.70`.

## What set 3 tests that sets 1 and 2 could not

- **Two posts with no repo, no package and no model at all** (3D, 3E). Every one
  of the ten recorded cases so far had a GitHub artefact somewhere. If the
  identification pipeline is really a slug pipeline, it will show here.
- **A 7-slide carousel that numbers its own slides** (3C) - measures the
  blindness and the proposed cure in one run.
- **Two unsourced multipliers** (3C: 70x, 90%) - the mirror of the invented-number
  disease: the number is in the post and absent from the evidence.
- **Two self-contradicting posts** (3B slide 1 vs slide 2, 3E banner vs task
  price) where the refuting evidence is inside the post itself.
- **A licence trap** (3B) that the caption discloses and the graphic denies.

**Expected spread: PARTIALLY_TRUE (3A), PARTIALLY_TRUE (3B), HYPE (3C),
MISLEADING (3D), PARTIALLY_TRUE (3E).** No single reflex answer scores well. HYPE has never once been produced
by the app; 3C is the cleanest chance it has been given.

---

# SET 3 RESULTS

Two runs exist. `runs_set3.csv` was captured with the 21-column log; the app was
then rebuilt with native diagnostics and the same five posts re-run into
`runs_set3b.csv` (39 columns). **Verdicts were identical across both runs** -
temperature 0 is holding, and the analysis below uses 3b, which carries the
report text, the evidence list, the slide counts and the STT health.

## Scoreboard

| Case | System 1 | App raw | App final | |
|---|---|---|---|---|
| 3A Prime Agent | PARTIALLY_TRUE | MISLEADING | MISLEADING | miss (near) |
| 3B GitNexus | PARTIALLY_TRUE | PARTIALLY_TRUE | PARTIALLY_TRUE | **correct** |
| 3C BASE | **HYPE** | MISLEADING | MISLEADING | miss |
| 3D side hustles | MISLEADING | MISLEADING | MISLEADING | **correct** |
| 3E Mindrift | PARTIALLY_TRUE | FAKE | MISLEADING | miss |

**2 of 5.** And the two correct ones were not correct for the right reasons -
see 3B's two fabrications and 3D's swapped numbers below.

## The headline: the reflex moved, it did not go away

| Set | Reflex | Count |
|---|---|---|
| 1 | PARTIALLY_TRUE | 4 of 5 |
| 2 | PARTIALLY_TRUE | 2 of 4 (best set so far, 3 of 4 correct) |
| 3 | **MISLEADING** | **4 of 5** |

Set 1's conclusion was "the rubric is decorative, it only says PARTIALLY_TRUE".
That is now clearly wrong as a diagnosis. The verdict is not stuck on a
particular word - it is stuck on **whatever the prompt most recently made
attractive**. HYPE remains unreachable: 3C was built for it and returned
MISLEADING, which makes HYPE 0 for 2 across the two sets that deliberately
targeted it.

## Disease 1 - blindness, now with numbers instead of inference

The new columns turn the biggest open bug from an inference into a measurement.

### 3C - a 7-slide carousel, of which **2 slides were the real post**

```
slidesJson=0  slidesDom=5  imagesUsed=5  ocrLens=0,179,262,76,449
```

Five images were fetched. Reading the `candidates` column, only **two** belong
to this post:

| # | URL marker | ocrLen | What it actually is |
|---|---|---|---|
| 0 | `stp=dst-jpg_s100x100_tt6` | 0 | **the author's avatar**, 100x100 |
| 1 | `stp=dst-jpg_e35_tt6` | 179 | slide 01/07 - real |
| 2 | `stp=dst-jpg_e35_tt6` | 262 | slide 02/07 - real |
| 3 | `stp=dst-jpg_e35_p240x240_tt6` | 76 | **a suggested post** thumbnail |
| 4 | `stp=dst-jpg_e15_p240x240_tt6` | 449 | **a suggested post** thumbnail |

So the app saw **2 of 7 slides**, not 4 or 5, and the two it did see are the
setup slides. Everything the post is actually claiming - "90% Better Ouput"
(03/07), "Saving 70x on tokens while 90x'ing output" (04/07), the relay (05/07),
Dev Mode (06/07) - was never loaded.

### Cross-post contamination is solved, and the fix is one line

Handoff section 11 G item 2 says to build the candidate logging and read the
distinguishing field off real runs rather than guessing. Done, and it is in the
URL:

- **real slides** carry `_e35_tt6` or `_e15_tt6` with **no size suffix**
- **the avatar** carries `s100x100`
- **suggested posts** carry `p240x240`

The damage from those two thumbnails is visible in the OCR, which contains an
entirely different post about Claude pricing:

```
FABLE 5.1 IS NOT CHEAPER | Cache reads | $10/MTok $12.50/MTok $20/MTok
STOP THE WATERMARKS | Get the watermark removal prompt on last slide
```

Stage 1 then extracted **"Claude"** and **"FABLE 5.1"** as tools of this post and
spent 3 of its 10 search queries on them. This is the "Hidden Markov Model
framework" ghost from three earlier sessions, caught in the act with URLs.
`isJunkImage` cannot see it because these are full-size media on the same CDN;
the size suffix is what separates them.

### 3B - a 3-slide carousel that the app processed as a 60-second video

```
mediaType=video  imagesUsed=0  slidesDom=4  ocrLens=609,609,609,604,605,607,606,607,606,610
sttStats: rate=44100 ch=2 durationSec=60.0 peak=0.000 rms=0.0000
```

Ten frames, each ~609 characters, all the same README header. The app OCR'd
**slide 1 ten times** and never saw slides 2 or 3. Slide 2 is where
**"100% free & open-source"** - the post's only false statement - is written.

The verdict came out right anyway, because the caption (775 chars, captured
correctly) states the licence catch in plain text. A right answer from a blind
pipeline, for the third set running.

### 3E - the subject was in the OCR seven times and lost anyway

**Correction to an earlier draft of this entry**, caught by re-reading the OCR
column rather than the case file: `Mindrift` appears **once** in the app's OCR,
inside the URL `mindrift.toloka.ai`, plus a garbled `hdrift.toloka.ai`. An
earlier count of "7 times" was measured over the whole scratch file, which
included System 1's own notes - the reference tool contaminating its own
measurement. `$0.50`, `$0.35` and `$6/hour` are all in the OCR.

Even so, the app fact-checked **"Sachifinance"**, the creator's Instagram
handle, and reported "Sachifinance has no public repository, package, or
verifiable website confirming it pays users". That is case 5's `sparkdly-api`
window-title failure repeating exactly, one set later.

## Disease 1b - the subject picker, and why set 2's 4/4 did not generalise

This is the clearest new finding, and it is a code bug, not a model failure.
`pickSubject` (`api.js:571`) now reports its own reasoning:

| Case | Picked | Why (verbatim) | Correct? |
|---|---|---|---|
| 3A | `rlm` | verified repo alexzhang13/rlm named in the post | **no** - `Prime Agent` appears **23x** in OCR, `rlm` **once** |
| 3B | `GitNexus` | verified repo abhigyanpatwari/GitNexus named in the post | yes |
| 3C | `graphify` | verified repo Graphify-Labs/graphify named in the post | **no** - Graphify is the competitor the post **dismisses** |
| 3D | *(none)* | rejected "4 Side Hustles" as chrome or headline | **yes, it abstained correctly** |
| 3E | `Sachifinance` | **model name, not found in OCR** | **no** - and it said so itself |

Three separate defects, all cheap to close:

1. **Rule 1 has no ranking.** It returns the *first* evidence row whose GitHub
   repo name appears anywhere in the OCR. Evidence order is arbitrary, so a
   one-mention repo beats a 23-mention one. Ranking by occurrence count -
   already computed by the function - fixes 3A.
2. **Rule 1 cannot tell a subject from a rival.** `Graphify` is on slides 01 and
   02 *as the thing being replaced*. Rule 1 only asks "is this name on screen".
3. **Rule 2 returns a name it has just proved is absent.** The branch literally
   reads `return { name: modelName, why: 'model name, not found in OCR' }`.
   Zero occurrences in the post is the definition of "not the subject", and it
   is the one case where abstaining is free. This single branch produced 3E.

And the abstention hole is unchanged: **3D abstained correctly and the report
still published `techName = 4 Side Hustles`.** That is four sets of a computed
"I do not know" being discarded.

## Disease 2 - invented specifics: still 5 for 5

| Case | Invention | Reality |
|---|---|---|
| 3A | "Opus 5's advertised improvement is token efficiency, not higher capability" | Incoherent - Opus 5 is the model being *scaffolded*; the token-efficiency claim is Prime Agent's |
| 3A | "Self-modifying claims lack public evidence or reproducible tests" | The blog documents `H = (rho, G, K, M)` with CRUD per component; the reel shows the README |
| 3B | **"The published npm package named gitnexus is for file removal, not this tool"** | **False.** npm `gitnexus` 1.6.11 is *"Graph-powered code intelligence for AI agents"*, licence `PolyForm-Noncommercial-1.0.0` - the same project |
| 3B | "No official docs confirm seamless integration with Claude Code, Cursor, or Codex" | The README names Claude Code, Cursor, Codex, Antigravity, OpenCode, CodeBuddy, Qoder and Windsurf |
| 3C | "BASE cannot be installed because no public repository is available" | `ChristopherKahler/base`, 171 stars, FSL-1.1-ALv2, pushed the same day |
| 3C | "RENAMED: graphify/graphify redirects to kbastani/graphify (448 stars)" | A real redirect, but to an unrelated 2014 Neo4j project. Presented as a gotcha about this post |
| 3D | "Arise pays $13-25/hr", "Preply up to $50/hr", "Rev $1-2 per audio minute", "KellyConnect $30-50/hr" | The reel said **$25/hr for Preply** and **$50/hr for KellyConnect**. The app **swapped the numbers between platforms** and invented two more |
| 3E | `pip install toloka-kit` | Real package, wrong artefact: the reel is a signup website, never Python. Mindrift is not toloka-kit |

3B is the sharpest of these. It is the one case scored **correct**, and it
contains a confident, specific, entirely false statement about a package it had
already verified - the CSV shows `pypi:GitNexus` fired. The verdict being right
hid two fabrications.

## Disease 3 - denial on partial evidence, third instance

- Case 4: *"No dedicated repo replicates Runway"* while Wan2.1 sat on an unseen slide.
- Case 4: *"No single repo matches Nano Banana"* while ComfyUI sat on an unseen slide.
- **3C: "no public repository, package, or documentation exists"** for BASE, while
  five of seven slides were never loaded and the repo has 171 stars.

Absence of evidence keeps being reported as evidence of absence, and it now has a
measured cause each time: the slides were never fetched.

## What actually worked

- **`checkPricing` ran on device for the first time.** `verifiersFired` shows
  `pricing` on 3B, 3C and 3E. On 3D the pay-rate reasoning in the report is
  correct and sourced: *"Rev typically pays $0.30-$1 per audio minute and
  KellyConnect often pays $15-$30/hr"* - both match System 1's independent
  lookups ($0.40-$1.10, $18.80-$21.81). **This is the first time the app has
  beaten a claim on a number rather than on existence.**
- **3D is the best result in the set**, and it is the case with no repo at all -
  the shape the pipeline was supposed to be worst at.
- **3A found the caveat System 1 rated highest**: *"Performance numbers come from
  the project's own blog, not third-party evaluation."* Correct, and it is the
  reason System 1 withheld TRUE.
- **The abstention branch fired correctly once** (3D), the first time it has.
- **3E's privacy gotcha** - *"Providing selfies and personal data raises privacy
  risks"* - is a genuinely good observation about a task type the platform does
  push, and no other system flagged it.
- **The GitHub verification gate** still shows zero false positives.

## `checkTechnique` still has never run

`verifiersFired` carries no `tech:` key on any of the five. Its trigger is

```
/\b(delete|remove|reset|bypass|unlock|trick|hack|disable|edit|patch|unlimited|forever|no limit)\b/i
```

and 3D and 3E - both pure technique posts, "here is a method to earn money" -
contain none of those words. The regex was written against case 2C, a
delete-the-log trick, and it only recognises that one shape. **Two sets have now
been designed to exercise this and it has not fired once.**

## Speed - the cost is native, not the model

`stageMs`, mean across the five runs:

| Stage | Mean | Share |
|---|---|---|
| **native** (extract + OCR + STT) | **22.5s** | **49%** |
| search | 9.4s | 20% |
| pagefill (Jina) | 6.1s | 13% |
| claims | 3.4s | 7% |
| synthesis | 3.4s | 7% |
| verifiers | 1.1s | 2% |

Run mean **45.9s** (set 1: 40.3s, set 2: 50.4s). Worst was 3A at 72.3s, of which
**41.4s was native** - that post fell back to `mediaSource=RENDER`, the cloud
extractor, because the WebView could not read the same login-gated post that
blocked System 1.

Set 2's conclusion ("Jina cost more than parallelising the router saved") was
measuring the wrong half. Jina is 6.1s. **Half of every run is on-device
extraction, OCR and STT**, and no optimisation has ever been aimed there.

## New STT finding: silence produces speech, and nothing catches it

Both carousels went down the video path with a silent track:

```
3B  peak=0.000 rms=0.0000  chunks=5 kept=5 dropped=0 keptLens=[11,11,11,11,11]
3C  peak=0.000 rms=0.0000  chunks=5 kept=5 dropped=0 keptLens=[11,11,11,11,11]
```

Whisper turned **pure digital silence** into `"Iw'n gweld."` - Welsh for "I see"
- five times, and all five chunks were **kept**. `isLooped()` needs 8 words, so
11-character output passes; nothing checks amplitude at all, though `peak` and
`rms` are already computed two lines earlier and printed to the log.

This is the third distinct hole in the same guard: repetition loops (caught),
short garbage (case 5, uncaught), and now **silence-to-hallucination**
(uncaught). A `peak < 0.01` check would close this one for free.

Healthy audio on the three real reels: `peak` 0.899-0.965, `rms` 0.132-0.148,
`44100 ch=2` decoding correctly every time. One repetition loop was dropped on
3D exactly as designed.

## The run log now answers the questions

`runs_set3b.csv` is 39 columns and every finding above came out of it - no
logcat, no screenshots, no Metro scrollback. The columns that did the work:
`candidates` (contamination), `slidesDom`/`imagesUsed`/`ocrLens` (coverage),
`subjectWhy` (three picker defects), `verifiersFired` (pricing ran, technique
never has), `sttStats` (silence), `stageMs` (native is half the wall clock),
`reportJson` (every fabrication in disease 2).

Two columns were dead in `runs_set3.csv` and are alive in 3b: `speechChars` and
`captionChars` were being read off bridge keys the native module never sent, so
three test sets recorded blanks that looked like STT failures.

## Ranked fixes after set 3

Reordered by what the measurements now show, not by what was assumed.

1. **Filter carousel candidates by URL size suffix.** Drop `s100x100` (avatars)
   and `p240x240` (suggested posts). Two lines, and it removes an entire class of
   phantom claims. Evidence-based, no longer a guess.
2. **Paginate the embed carousel.** 2 real slides of 7 is the ceiling today. The
   printed `01/07` counter **is** being OCR'd, so the cheap half of the fix
   (declare the extraction incomplete when the counter's total exceeds the images
   obtained) is implementable right now.
3. **Three one-line picker fixes.** Rank rule 1 by OCR occurrence count; never
   return a name with zero occurrences (rule 2); and prefer a name the post
   *promotes* over one it *dismisses*.
4. **Let abstention reach the report.** Four sets, unchanged.
5. **Silence gate in `speechHealth`**: `peak < 0.01` means no speech, whatever
   Whisper returns.
6. **Widen `checkTechnique`'s trigger** to money and method claims ("earn",
   "per hour", "make $", "side hustle", "free hosting"), or it will keep not
   running.
7. **The evidence gate for numbers.** 3D's swapped pay rates and 3B's npm claim
   are both statements no fetched page supports.
8. **Do not deny existence when coverage is known-partial** - the pipeline now
   *knows* it is partial, because `imagesUsed` is in the same row.

Speed, separately: any real gain has to come out of the 22.5s native stage.

---

# FIXES APPLIED AFTER SET 3 (September 8, 2026)

Scored on the four stages, not the verdict word. Baseline is `runs_set3b.csv`
replayed through `mobile_app/tools/replay.js`:

| | before | after |
|---|---|---|
| seeing | 3/5 | unchanged until the next device run - the fixes are in extraction |
| naming | 2/5 | **3/5**, and the two failures now **abstain** instead of naming the wrong thing |
| no-invention | 4/5 | 4/5 |
| verdict | 2/5 | measured on the next set |

## Batch 0 - the replay harness (`mobile_app/tools/replay.js`)

The reason three sets produced no fixes is that every measurement cost a build,
an Instagram fetch and a paid model call, so the affordable move was always to
tune against one reel. The 39-column run log stores the whole input, so the pure
stages can now be re-run on a laptop in under a second against every recorded
case.

```
node tools/replay.js ../runs_set3b.csv
```

`tools/expected.json` holds the System 1 ground truth. `api.js` exports
`__test = { pickSubject, normalizeReport, looksLikeSubject, applyEvidenceRules }`
for it. Nothing about the app's behaviour changes; the harness stubs
`react-native`, `axios` and the storage layer, so no network call is possible
from it.

It paid for itself immediately: **three separate defects below were found by the
harness disagreeing with a fix, not by reasoning.**

## Batch 1 - seeing (Kotlin, needs a build)

**Thumbnail filter.** `InstagramExtractor.kt` now drops any candidate whose
`stp` parameter carries an `NNNxNNN` rendition. Measured on `DcbFunokXyI`:

```
dst-jpg_e35_tt6                  real slide 01/07   kept
dst-jpg_e35_tt6                  real slide 02/07   kept
dst-jpg_s100x100_tt6             author avatar      dropped
dst-jpg_e35_p240x240_sh2.08_tt6  suggested post     dropped
dst-jpg_e15_p240x240_tt6         suggested post     dropped
```

The two suggested posts are where "FABLE 5.1 IS NOT CHEAPER" and "STOP THE
WATERMARKS" entered the OCR, and why stage 1 listed `Claude` and `FABLE 5.1`
as tools of a post about BASE. `isJunkImage` could not catch them: it matches
path segments such as `/s150x150/`, while these sizes live in the query string.
If every candidate looks like a thumbnail the filter stands down and keeps the
originals, because half a post beats none of it.

**Silence gate.** `AudioTranscriber.kt` returns an empty transcript when
`peak < 0.01`. Both carousels in set 3 had `peak=0.000` and Whisper answered the
silence with `"Iw'n gweld."` five times, every chunk kept, because `isLooped()`
needs eight words. The amplitude was already computed two lines above the
decision and never consulted. Measured headroom: silence 0.000, quietest real
reel 0.899.

**Slide-coverage warning** (`api.js`, JS). Carousels print `01/07` on
themselves and the OCR reads it. When the highest declared total exceeds the
images actually fetched, the synthesis prompt is told so in plain terms, with an
instruction not to conclude that a tool is absent. This is the cheap half of
fix 10a from the set-1 list, and it is a *fact* handed to the model, not a
verdict nudge. Unit-checked against a price (`Rs 95/mo`), a fraction (`1/2`) and
a date (`12/07/2026`): no false positives. It also writes a `coverage` column.

## Batch 2 - naming (JS, Metro reload)

`pickSubject` had three defects, all visible only once `subjectWhy` was logged.

1. **No ranking.** Rule 1 returned the *first* evidence row whose repo name
   appeared in the OCR, and evidence order is arbitrary. It now collects every
   candidate and sorts by occurrence count.
2. **Slug vs display name.** `prime-agent` scored **zero** against a post that
   writes "Prime Agent", so the subject fell through to `rlm` - a three-letter
   acronym for the technique. Occurrence counting now also tries the name with
   `-`/`_`/`.` replaced by spaces, and rule-1 candidates must be at least four
   characters.
3. **A dismissed rival could win.** The post reading "Smart Devs Don't Use
   Graphify. They Use BASE." had `Graphify` picked as its subject. A dismissal
   check now demotes any candidate the post argues against
   (`don't use X`, `stop using X`, `X killer`, `replaces X`, `X is dead`...).
   The OCR joins lines with `" | "`, so the text is flattened before matching -
   without that the phrase never matched and the fix looked like it worked while
   doing nothing.
4. **Returning a name it had just disproved.** The old rule 2 ended with
   `return { name: modelName, why: 'model name, not found in OCR' }`. Zero
   occurrences is the definition of not being the subject. It now abstains, which
   is what turned `Sachifinance` - a creator's Instagram handle published as the
   product under test - into an honest blank.

A **domain-based rule was written and then deleted**. It would have read the
brand out of `mindrift.toloka.ai`, but the harness showed it firing on no
recorded case (the OCR contains `mindrift` once, not the seven times an earlier
draft of this file claimed) and picking `toloka`, the parent company, when it
did fire. Machinery no case exercises is machinery that will be wrong the first
time it matters.

## Batch 3 - `checkTechnique` finally fires (JS)

Its trigger was written against one case - a delete-the-log-file trick - and
recognised only that shape:

```
delete|remove|reset|bypass|unlock|trick|hack|disable|edit|patch|unlimited|forever|no limit
```

Two sets were then built to exercise it with earnings posts, and it fired on
neither, because "make $100 a day with a laptop" contains none of those verbs.
Added: `earn`, `income`, `get paid`, `pays you/around/up to`, `per hour`,
`per day`, `an hour`, `a day`, `side hustle`, `work from home`, `withdraw`,
`payout`, `legit`.

Replayed against the recorded stage-1 claims:

| case | fires on |
|---|---|
| 3A Prime Agent | 0 claims |
| 3B GitNexus | 0 claims |
| 3C BASE | 0 claims |
| **3D side hustles** | **4 claims** |
| **3E Mindrift** | **2 claims** |

Exactly the two posts that needed it, none of the three that did not.

## Not done, deliberately

- **Carousel pagination.** Driving the embed's next control is the real fix for
  seeing 2 of 7 slides; the coverage warning only makes the blindness honest.
- **The numbers gate** (a rate or spec must trace to a fetched page). 3D's
  swapped pay rates and 3B's false npm claim both need it, and it is the change
  most likely to misfire, so it waits until the cheap fixes are measured.
- **No verdict rule was added or changed.** Every verdict-nudging rule added in
  this project has needed correcting and one was actively harmful. The standing
  lesson holds: prefer rules that fetch a fact.

## Verification performed

- Scope-aware undefined-identifier scan: PASS on `api.js`, `verifiers.js`,
  `runlog.js`.
- Bracket and string balance: OK on all three Kotlin files.
- Control-character sweep: the heredoc trap the handoff warns about struck
  twice in this session. `\\b` inside a Python heredoc string became a literal
  **backspace character** in `api.js` - invisible when read back, and it silently
  disabled two word boundaries in the slide-counter regex. Found by grepping for
  chr(8), fixed, and re-checked; all four files are clean.
- `slideCoverage` unit-checked on a real slide counter, a price, a fraction and
  a date.

---

# SET 4 - System 1 verdicts

`runs_set4.csv`, nine runs: the five from set 3 re-tested against the fixed build,
plus four new posts.

## Ordering caveat, recorded honestly

For the four new posts the app was run **before** System 1 had ground truth,
which reverses the rule the harness is built on. Before writing anything below I
had seen only the `verdict` and `techName` columns of those four rows - listed
while confirming the CSV held all nine runs - and nothing else. I did not open
`reportJson`, `claimsJson` or `evidenceJson` for any new case until these
verdicts were written.

So: **the four new cases are weaker evidence than sets 1-3**, because knowing the
app's answer can pull a judgement toward it. The five re-tested cases are
unaffected - their ground truth was written before any of these runs existed.

Where the app's verdict and mine agree below, treat the agreement as softer than
it looks. Where they disagree, the disagreement is worth more.

## 4F - DcvZqlBMnoj (reel, 6.4s, @Artificial intelligence (AI) Country) - GlucoFM

The shortest post in any set: one static research figure captioned **"Google
Introduced GlucoFM, a lightweight, self-supervised continuous glucose monitoring
foundation model"**, intercut with a celebration meme. The audio is song lyrics -
`transcript.txt` is 46 characters and carries no claim at all.

| Claim | Finding |
|---|---|
| GlucoFM exists | **TRUE.** arXiv **2605.30865**, *"GlucoFM: A Dual-Stream Foundation Model for Continuous Glucose Monitoring"* |
| It is Google's | **TRUE.** Announced by **Google Research** on X and on `research.google/blog/glucofm-foundation-model-for-continuous-glucose-monitoring/` |
| "lightweight, self-supervised continuous glucose monitoring foundation model" | **TRUE, and verbatim.** The overlay is a word-for-word quote of Google Research's own announcement |
| The architecture figure (JEPA-style pre-training, state/event streams) | **Matches the paper**: JEPA-style latent objectives, dual-stream decomposition into slow glycemic trend and short-term deviation, 24-hour chronological grid, observation masks |
| Pretraining scale | Paper: 109,066 hours of unlabelled CGM from 477 subjects; 20% of the corpus already matches CGM-specific baselines |

**System 1 verdict: TRUE.** The post adds nothing to the announcement - no
"revolutionary", no "replaces your doctor", no install command, no affiliate
funnel. It reposts a real research release with the vendor's own wording and a
figure from the paper. This is the first post across nineteen recorded cases with
**no** overstatement in it.

**What this case tests:**
1. **Is TRUE reachable at all?** Nineteen cases, and the app has never returned
   it. If a verbatim quote of a Google Research announcement does not earn TRUE,
   the top of the rubric is decorative in the way the bottom was thought to be.
2. **A medical/research subject with no repo, no package and no install** - the
   subject is a paper.
3. **A six-second reel with a junk transcript.** 46 characters of song lyrics is
   the entire audio signal; everything real is in one static frame repeated.
4. **Silence-adjacent STT**: the track is music, not speech, so this also probes
   whether the new silence gate mistakes quiet music for nothing.

## 4G - DdBGaAgnQyL (reel, 47.1s, @Trending OpenSource Projects) - Locally Uncensored

A screen recording that scrolls the repo README end to end, narrated.

**Subject:** `PurpleDoubleD/locally-uncensored`, **1,493 stars**, 228 forks,
**AGPL-3.0**, created 2026-03-24, pushed 2026-09-08, homepage
`locallyuncensored.com`.

| Claim | Finding |
|---|---|
| Runs chat, image and video generation locally | **TRUE.** README: chat, image and video generation and a coding agent in one app; image generation via a bundled, auto-managed ComfyUI |
| Free and open source | **TRUE.** AGPL-3.0 - copyleft, which the reel does not mention, but "free" and "open source" are both correct |
| "No Docker, no terminal, no config files" | **TRUE**, stated verbatim in the README |
| Works with engines you already have (Ollama, LM Studio) | **TRUE**, and the list is longer: Ollama, LM Studio, vLLM, KoboldCpp, llama.cpp, LocalAI, Jan, TabbyAPI, GPT4All, Aphrodite, SGLang, TGI, LiteLLM, text-generation-webui, plus its own LU Engine |
| Coding agent that shows the diff first | **TRUE**, README |
| Agent mode with a permission gate | **TRUE**: web search, file read/write, shell, code execution, "every tool call passes a permission gate you control" |
| "Pick a model that fits your hardware" | **TRUE**, and notably honest - the reel states the hardware constraint rather than hiding it |
| Uncensored | **TRUE.** Abliterated/uncensored model variants are what the model manager ships |
| Current release | v2.6.8/2.6.9 (September 2026), CHANGELOG covers every version since 1.0.0 |

Two things the reel does not say, neither of them fatal:

- **macOS is not supported** ("none yet" in the README's platform table). The reel
  says "install it just like any other program" without naming a platform.
- **Antivirus engines flag the Windows installer.** The README says so plainly
  and explains why (the installer downloads and executes binaries on first run),
  which is more disclosure than the reel gives.
- **No independent review exists.** Every source found is the project's own repo,
  release notes or DEV post. Same shape as 3A: real, active, self-reported.

**System 1 verdict: TRUE.** Every checkable statement in the narration matches
the project's own documentation, and the one thing that usually gets hidden -
that a local AI studio needs capable hardware - is said out loud. The omissions
(macOS, AGPL, AV false positives) are caveats a report should carry, not
misrepresentations.

**What this case tests:**
1. **A second chance at TRUE**, on a post that is essentially a README readout.
2. **Canonicality with a plain slug on screen** - `github.com/PurpleDoubleD/locally-uncensored` is legible in almost every frame.
3. **Twelve frames of dense README text**: `ocrChars` should be large, and this is
   the best case yet for OCR carrying the whole subject.

## 4H - DW7TbBXmey3 (carousel, **8 slides**, @tenfoldmarc) - graphify + Obsidian

Numbered `01/08` to `08/08`. **The second >4-slide carousel in two sets**, and the
first run against the thumbnail filter and the coverage warning.

**Subject:** `graphify`, shown on slide 04 as **`github.com/safishamsi/graphify`**.

| Claim | Finding |
|---|---|
| The repo exists | **TRUE, but the slug is stale.** `safishamsi/graphify` **redirects to `Graphify-Labs/graphify`** - 116,130 stars, 11,265 forks, Apache-2.0, pushed 2026-09-07 |
| **"CLAUDE + OBSIDIAN = 71.5X LESS TOKENS"** | **Sourced, and this is the important difference from 3C.** The README states it twice: *"71.5x fewer tokens per query vs reading the raw files"*, and a benchmark table row: *"Karpathy repos + 5 papers + 4 images, 52 files, **71.5x**"*, with the raw inputs and outputs published under `worked/` so it can be re-run |
| Slide 01's terminal: `claude --usage` -> `before: 20,000 tokens/session, after: 280 tokens/session, 71.5x reduction` | **A mock-up.** `claude --usage` does not print that, and 20,000/280 is 71.4 - the real figure reverse-engineered into a fake terminal. The *number* is honest; the *evidence for it shown on screen* is staged |
| "Based on Andrej Karpathy's new structure (PhD who invented vibe coding)" | **Loose but not baseless.** The README opens with *"Andrej Karpathy keeps a `/raw` folder where he drops papers, tweets, screenshots, and notes. graphify is the answer to that problem"*, and the benchmark corpus is Karpathy's repos. Karpathy did coin "vibe coding" and does hold a PhD. He did not design graphify, and the post implies a system of his |
| "A free tool called graphify scans your files one time and builds a map" | **TRUE.** Apache-2.0, local deterministic AST parsing, no vector store |
| `/graphify ~/.claude`, `graphify scan`, `graphify-out/wiki/index.md`, the three CLAUDE.md rules | **Consistent with the README**, which documents `graphify-out/`, an `obsidian/` output folder and a `~/.claude/CLAUDE.md` block |
| Obsidian + BRAT + "3D Graph (v2.4.1)" | Obsidian, BRAT and a 3D graph plugin all exist; the exact version was not separately confirmed |
| **Scope of the 71.5x** | **The real caveat.** The README says reduction *scales with corpus size*: *"6 files fits in a context window anyway, so graph value there is structural clarity, not compression. At 52 files you get 71x+."* The post presents 71.5x as what happens to you, not as one corpus's measurement |

**System 1 verdict: PARTIALLY_TRUE.** The tool is real, enormous and permissively
licensed; the headline number is genuinely published by the project with a
reproducible benchmark - the opposite of 3C, where 70x appeared nowhere. What is
overstated is universality (a corpus-size-dependent result sold as a flat 71.5x),
the provenance ("Karpathy's system" for a project that merely cites his habit),
and a fabricated terminal readout used as proof.

**What this case tests:**
1. **The thumbnail filter and coverage warning, first live run**, on 8 slides.
   3C got 2 of 7 real slides. Anything below 8 here should now be *declared*.
2. **A rename on screen**, third instance: `safishamsi/graphify` ->
   `Graphify-Labs/graphify`. Case 1 failed this (clawdbot), case 4 passed it by
   luck (searched rather than resolved). `checkGitHubRename` exists for exactly
   this.
3. **A sourced multiplier**, directly against 3C's unsourced one. A report that
   treats 71.5x the same way in both posts is not reading evidence, it is
   pattern-matching on big numbers.
4. **Graphify again**, one set later, but this time as the *subject* rather than
   the dismissed rival - the mirror image of the stance trap.

## 4I - DU3W5LwEyxe (reel, 46.3s, @Anay Joshi) - YC AI Student Starter Pack

**Subject:** Y Combinator's AI Student Starter Pack, shown as a screen recording
of YC's own page.

| Claim | Finding |
|---|---|
| "$25,000 worth of AI starter pack" | **TRUE.** YC: *"Over $25,000 in free credits for AI tools and cloud services"* |
| "$10,000 for Azure and AWS" | **TRUE**, and understated: **$10,000 AWS and $10,000 Azure**, i.e. $20,000 |
| "$5,000 from GPT, Claude and Grok" | **TRUE**, slightly understated: OpenAI **$2,500** + xAI/Grok **$2,500** + Anthropic **$500** = **$5,500** |
| "Credits for AI devtools - web crawling, browser automation, video generation" | **TRUE.** Free tiers from 14+ YC startups covering voice, search and browser automation |
| **"Y Combinator just launched"** | **Stale.** The programme was announced for students attending YC events **starting Fall 2025**, with campus touring through 2025-2026 |
| **Eligibility** | **The omission that decides everything.** You must be a **student who attends a YC university event**, then sign in at `deals.ycombinator.com/students` **with a Hacker News account**, re-verify your email **every 30 days**, and access lasts **one year** from the qualifying event |
| "Stop paying for your API keys in 2026 ... here's exactly how you can get your hands on it ... you're getting it for free" | The narration **never says "student"** and never mentions attending an event. The requirement *is* on screen - YC's page reads *"free AI credits for students who attend YC events"* - in small text, for about two seconds |
| "Comment AI and I'll give it to you in the first 3 DM, but follow the account first" | Engagement funnel |

**System 1 verdict: PARTIALLY_TRUE.** Every number is right, the programme is
real, and the disclosure is technically present in the post's own screenshot.
That is the same shape as 3B, where the caption disclosed what the slide denied,
and it was scored PARTIALLY_TRUE - so consistency requires the same call here.

**MISLEADING is a defensible second choice**, and the argument for it is
stronger than in 3B: the audience for a Hindi-English reel is mostly nowhere near
a YC campus event, "just launched" is eight months stale, and the one condition
that decides whether a viewer can get any of this is the one thing the narration
leaves out. Recorded here so the alternative is not invented after seeing the
app's answer.

**What this case tests:**
1. **An eligibility catch rather than a pricing catch** - the money is real and
   free; the gate is who you have to be. `checkPricing` looks for billing traps,
   not qualification traps.
2. **A company/programme subject with no repo, no package, no model** - the third
   such case, after 3D and 3E.
3. **Numbers that are right in the post and easy to get wrong in a report.** 3D's
   report swapped pay rates between platforms; here there are five figures across
   five providers to keep straight.
4. **Does it read the small print in a frame?** The eligibility line is on screen
   for about two seconds in a 46-second reel.

## Expected spread

**TRUE (4F), TRUE (4G), PARTIALLY_TRUE (4H), PARTIALLY_TRUE (4I)** for the new
four, plus the unchanged set-3 truths: PARTIALLY_TRUE (3A), PARTIALLY_TRUE (3B),
HYPE (3C), MISLEADING (3D), PARTIALLY_TRUE (3E).

Across nine runs that is 5 PARTIALLY_TRUE, 2 TRUE, 1 HYPE, 1 MISLEADING. No
single reflex answer scores above 5/9, and both ends of the rubric - TRUE and
HYPE - are represented, neither of which the app has ever produced correctly.

---

# SET 4 RESULTS

Nine runs on the fixed build: the five set-3 posts re-tested, plus four new.
Scored on four stages rather than one word.

## Stage scoreboard

| | set 3 (5 cases) | set 4 (9 cases) |
|---|---|---|
| seeing | 3/5 | **6/9** |
| naming | 2/5 | **6/9** |
| no-invention | 4/5 | **7/9** |
| verdict | 2/5 | **4/9** |

Per-case:

| Case | seeing | naming | invention | verdict (app vs truth) |
|---|---|---|---|---|
| 3A Prime Agent | ok | **prime-agent** (was `rlm`) | none | MISLEADING vs PARTIALLY_TRUE |
| 3B GitNexus | 0/3 slides | GitNexus | **`cursor/cursor`** | PARTIALLY_TRUE vs PARTIALLY_TRUE |
| 3C BASE | 2/7 slides | **base** (was `graphify`) | none | PARTIALLY_TRUE vs HYPE |
| 3D side hustles | ok | **"Side Hustles"** (was a correct abstain) | none | PARTIALLY_TRUE vs MISLEADING |
| 3E Mindrift | ok | abstained | none | **FAKE** vs PARTIALLY_TRUE |
| 4F GlucoFM | ok | GlucoFM | none | **TRUE vs TRUE** |
| 4G Locally Uncensored | ok | locally-uncensored | `lmstudio-ai/lm-studio` | **TRUE vs TRUE** |
| 4H graphify | 2/8 slides | claude-code | none | MISLEADING vs PARTIALLY_TRUE |
| 4I YC starter pack | ok | abstained | none | **PARTIALLY_TRUE vs PARTIALLY_TRUE** |

## The fixes, measured

### Cross-post contamination: fixed, and it is the cleanest result in four sets

`DcbFunokXyI`, the same post, before and after:

| | set 3 | set 4 |
|---|---|---|
| images OCR'd | 5 | **2** |
| ocrChars | 1408 | 880 |
| stage-1 tools | BASE, Graphify, **Claude**, **FABLE 5.1** | **BASE, Graphify** |
| OCR content | slides 01-02 **plus** an unrelated Claude-pricing post ("FABLE 5.1 IS NOT CHEAPER", "$10/MTok", "STOP THE WATERMARKS") | slides 01-02 only |

Three phantom images - one avatar, two suggested posts - are gone, and with them
the two invented "tools" and the three wasted search queries they consumed. The
`_s100x100` / `_p240x240` rendition filter did exactly what the candidate log
predicted it would.

**And the flat denial is gone with it.** Set 3's report said *"BASE cannot be
installed because no public repository is available"*. Set 4 names
`ChristopherKahler/base`, status verified, and reports *"Token savings depend on
prompt engineering, not guaranteed"* - which is close to System 1's actual
finding that the 70x figure is unsourced.

### Silence gate: fired, exactly where predicted

```
Dcz98y7mbA1  peak=0.000 rms=0.0000 silent=true   speechChars=0
DcbFunokXyI  peak=0.000 rms=0.0000 silent=true   speechChars=0
```

The Welsh hallucination (`"Iw'n gweld."` x5, every chunk kept) is gone. All five
real reels transcribed normally, peaks 0.470-0.967, and one repetition loop was
still dropped on 3D. No collateral damage: 4F is a six-second music clip at
peak=0.470 and it was **not** silenced.

### Subject picker: 2/5 -> 6/9, and both new abstentions are correct

- **3A**: `rlm` -> **`prime-agent`**. The hyphen-normalised occurrence count did it.
- **3C**: `graphify` -> **`base`**. The dismissal check caught "Smart Devs Don't
  Use Graphify", so the post's rival stopped being its subject.
- **4I**: abstained on "Y Combinator AI Starter Pack" - correct, the post is
  about a credits programme, not a named product.
- **3E**: abstained instead of publishing `Sachifinance`.

### `checkTechnique` ran on a device for the first time in four sets

```
DcwJq4tp6Fz  tech:Earn $100 per day using a lapt...
DcqopiqvtRw  tech:...
```

And it moved the report: 3D's gotchas now include *"Rev's actual captioning rates
are lower than the claimed $1-$2 per minute"*, which is a rate check, not an
existence check.

## What got worse, and why

### 3D: MISLEADING -> PARTIALLY_TRUE, the wrong direction

Set 3 called the "$100 a day with a laptop" reel MISLEADING, matching System 1.
Set 4 softened it to PARTIALLY_TRUE while the *reasoning improved* - the report
now correctly says Rev pays under $1 per audio minute and that the advertised
rates are not guaranteed. It has the facts and will not commit to the judgement.

The naming stage also regressed: the model's `tech_name` changed from
"4 Side Hustles" (rejected as a headline, correct abstain) to **"Side Hustles"**,
which passes the headline filter and appears once in the OCR - so rule 2 accepted
it. A one-mention threshold is too generous for a phrase that is a topic, not a
product.

### 3E: MISLEADING -> FAKE, still about the wrong subject

The picker abstained, and the report still fact-checked **Sachifinance**, the
creator's handle: *"No verifiable website or service named Sachifinance exists."*
It also invented *"Each quick selfie task pays $14.70"* - the $14.70 was the
creator's total balance, not a per-task rate.

**Abstention is ignored for the fifth set running.** The picker now produces a
correct blank and nothing downstream consumes it. This is no longer a subtle
bug: it is the single highest-value unfixed item, because the picker is finally
right often enough for its silence to mean something.

### 4H: the rename test never happened, because of blindness

The 8-slide carousel yielded **2 slides**. Slide 04 carries
`github.com/safishamsi/graphify` - which 301-redirects to
`Graphify-Labs/graphify` (116,130 stars) - and the app never loaded it. It
picked **Claude Code** as the subject from slide 01, and reported *"No official
documentation confirms the 71.5x claim"*.

That statement is **false**: graphify's README states 71.5x twice, with a
benchmark table and published `worked/` inputs and outputs. But the app had no
way to know, because the evidence was on a slide it could not fetch. Denial on
partial evidence, seventh instance, and this time the cause is unambiguous.

**The coverage warning could not be verified from this CSV**: `coverage` was
passed to `logRun` but never added to `COLUMNS`, so it was silently dropped.
Fixed, along with `evidenceRules`, which turns out to have been **blank in every
set since it was added** - `normalized.__rules` was read by the run log and never
assigned anywhere. Both are measurement bugs in the harness, not the pipeline.

### A verdict-nudging rule fired, and got the right answer for a poor reason

4I: `verdictRaw=TRUE` -> `verdict=PARTIALLY_TRUE`, via

```js
if (report.verdict === 'TRUE' && (missing > 0 || verified === 0)) -> PARTIALLY_TRUE
```

It matched System 1, but the mechanism is "no verified tools", and the reason
there are no verified tools is that the subject is a **credits programme with no
software in it**. The rule punishes any post whose subject is not a repo. On this
run that coincided with the right answer; on 4F and 4G it would have been wrong
had those posts listed no tools. Worth watching, not yet worth changing - and it
is the only verdict rule left standing.

## Both TRUE cases were right, and TRUE is now reachable

Nineteen recorded cases produced no TRUE at all. Set 4 produced two, and System 1
agrees with both:

- **4F GlucoFM** - a verbatim repost of a Google Research announcement. arXiv
  2605.30865 confirms it. The app named GlucoFM from a **six-second** reel whose
  entire audio is seven characters of song lyric, off a single repeated frame.
- **4G Locally Uncensored** - `PurpleDoubleD/locally-uncensored`, 1,493 stars,
  AGPL-3.0. 9,522 OCR characters, the largest of any run, and the subject was
  named off the repo slug visible in nearly every frame.

Both are posts where the truth is simply *"this is real and accurately
described"*, and the app said so. The top of the rubric is not decorative.

**Caveat on both**, recorded in the ground-truth section and repeated here: the
four new posts were run in the app before System 1 wrote its verdicts, so
agreement on them is softer evidence than in sets 1-3.

## Inventions: 2 of 9

- **3B**: `cursor/cursor` listed as a tool repo with no evidence row for it.
- **4G**: `lmstudio-ai/lm-studio`. LM Studio is real and the README does name it,
  but it is **closed-source with no such public repo**, and no evidence row
  carried it.

Both are the same sub-species: an *integration the post mentions* promoted to a
tool row with a plausible-looking slug. Down from 5 of 5 in set 3, but the
mechanism is unchanged - nothing forces a repo to trace to a fetched page.

## Speed regressed, and the cause is measurable

Mean **54.3s** (set 3: 45.9s). Stage means across the nine:

| Stage | set 3 | set 4 |
|---|---|---|
| native | 22.5s | **25.9s** |
| search | 9.4s | 10.4s |
| pagefill | 6.1s | 7.6s |
| verifiers | 1.1s | **2.1s** |
| claims | 3.4s | 4.1s |
| synthesis | 3.4s | 4.3s |

The widened `checkTechnique` costs about a second on average and up to 3.8s on
3D, which is a fair price for the first pay-rate check the app has ever done. The
larger cost is still native: 45.9s on 3D and 45.4s on 4I, both of which fell back
to the cloud extractor.

## Ranked fixes after set 4

1. **Consume the abstention.** The picker is now right or honestly silent in 6 of
   9 runs, and the report ignores it every time. When the picker abstains the card
   should say so and the synthesis prompt should be told there is no confirmed
   subject - instead of the model inventing one from a creator's handle.
2. **Carousel pagination.** Still 2 slides out of 7 and out of 8. The filter
   removed the junk; it did not add the missing. This now blocks two separate
   findings (the rename test on 4H, the HYPE judgement on 3C).
3. **Verify the coverage warning actually reaches the model** - the column is
   fixed, so the next run will show whether the prompt line fires and whether it
   stops the denials.
4. **Tighten picker rule 2** to require two mentions, not one. "Side Hustles"
   with a single OCR hit should not become a subject.
5. **The evidence gate for repos.** Both inventions this set are integrations
   promoted to tool rows; a repo that appears in no fetched row should be dropped
   the way a 404'd pip package already is.
6. **Judge framing separately.** 3C (HYPE) and 3D (MISLEADING) both failed while
   the report contained the right facts underneath. The verdict is the only stage
   that has not improved, and it is the only one nothing structural has been done
   to.

## Set 5: Provider Experiment Ground Truth

### Case 5J: MiniMind (DdEzfn-jV09)
- **Type**: Carousel
- **Language**: English
- **Transcript**: N/A (Carousel)
- **OCR/Frames**: "Train a 64M-parameter LLM from scratch in just 2h", "jingyaogong/minimind", "git clone --depth 1 https://github.com/jingyaogong/minimind"
- **Web Check**: The repository jingyaogong/minimind exists on GitHub. It explicitly states it is an educational project that trains a 64M parameter LLM from scratch.
- **Verdict**: TRUE. The claim matches the repository's stated capabilities and purpose exactly.

### Case 5K: 5 Side Hustles (Dc_dKPBABsx)
- **Type**: Carousel
- **Language**: English
- **Transcript**: N/A (Carousel)
- **OCR/Frames**: "TOP 5 SIDE HUSTLES THAT CAN BE DONE FROM YOUR PHONE", lists platforms like mypoints.com, inboxdollars.com, upwork.com, fiverr.com, etsy.com. "START AN AI FACELESS CHANNEL", "AI does 80% of work".
- **Caption**: "I recorded a training that breaks down the entire strategy step by step. Comment GUIDE..."
- **Web Check**: The listed platforms are real, but the claims of making substantial passive income easily from a phone ("AI does 80% of work") and the aggressive framing leading to a course/guide is a classic hype/misleading trap.
- **Verdict**: MISLEADING or HYPE. The tools exist but the context and ease-of-use claims are highly exaggerated to sell a guide.

### Case 5L: MiniCPM-1B (DdF85HXm4ya)
- **Type**: Carousel
- **Language**: English
- **Transcript**: N/A (Carousel)
- **OCR/Frames**: "MiniCPM5-1B, from Tsinghua's THUNLP", "THIS OPEN-SOURCE MODEL CAN REPLACE QWEN 3.8 AT 1B PARAMETER", "beats every model its size on reasoning, code & agentic tasks".
- **Caption**: "this open-source model is insanely good for how small it is... ships its own agent skills too..."
- **Web Check**: Tsinghua's THUNLP created the MiniCPM series. The claims of it outperforming larger models and running locally at half a gigabyte are consistent with their marketing for their small language models.
- **Verdict**: TRUE / PARTIALLY_TRUE. The model exists and is open-source. Claiming it definitively "replaces" Qwen might be subjective hype, but the core technical claims about the model exist.

