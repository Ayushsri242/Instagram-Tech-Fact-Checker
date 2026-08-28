# Instagram Reel Analyzer Project Notes

## Project Goal

Build an Android app inspired by the quick-capture feel of Shazam.

The app helps users save educational or informative Instagram reels, analyze them later, and show:

- what the reel is about
- the main claims made in the reel
- tools, repos, companies, or technologies mentioned
- a short summary
- a simple trust-style label such as:
  - maybe true
  - maybe hype
  - needs verification

The app should also save the original Instagram reel link so the user can revisit the reel later.

## Problem Statement

Many influencers post reels about tech updates, AI tools, GitHub repos, and tutorials.

Problems:

- information is often incomplete
- some content is exaggerated for views
- some claims may be misleading or false
- users want a quick way to save and later inspect useful reels

## Main Use Case

While scrolling Instagram:

1. User finds a reel that looks educational or informative.
2. User quickly captures it using the app.
3. App saves:
   - Instagram reel link
   - short audio sample if captured
   - a few screenshots / frames if captured
   - processing state
4. User continues scrolling.
5. Later, user opens the app.
6. App shows processed information about saved reels.

## Key Product Decision

This should be a `save now, analyze later` app.

Not:

- instant perfect truth checker inside Instagram
- full automatic Instagram scraping tool

Better framing:

`offline-first reel analysis app`

## Why Not Full Offline Fact Checking

We discussed that a fully offline app can do a good job at understanding content, but not always at verifying fresh tech claims.

Reason:

- new tech news changes quickly
- repo status changes
- release notes change
- product announcements are time-sensitive

So offline mode is good for:

- speech-to-text
- OCR
- summary
- claim extraction
- marking suspicious / incomplete claims

Offline mode is weak for:

- confirming latest truth
- checking recent announcements
- validating changing GitHub/project status

## Recommended Product Direction

Build an `offline-first` Android app with optional verification later.

Meaning:

- most understanding happens locally
- internet verification can be added later if needed
- avoid heavy dependence on paid APIs

## Important Constraint About Instagram Links

We discussed that an Instagram reel link alone is usually not enough to deeply analyze the reel.

Why:

- a link is mostly a pointer
- it does not automatically give full video/audio/text access
- app cannot reliably get full content just from the shared link

So the app should treat the link as:

- a reference to the original reel
- something to save for revisiting later

Not as:

- guaranteed full analysis input

## Shazam-Like Idea

We discussed a Shazam-like quick capture flow.

Possible idea:

- user taps a small widget / quick action
- app starts capturing a short reel audio sample
- app captures a few screen frames if permission is granted
- app processes everything later in background

Short version:

`App hear little, see little, think later.`

## Important Android Reality

This is possible, but not as seamless as Shazam.

Reason:

- Shazam only does music recognition using audio fingerprints
- this app needs more:
  - audio capture
  - speech transcription
  - OCR from frames
  - claim extraction
  - reasoning

Also Android may require:

- explicit screen/audio capture permission
- guided capture flow
- foreground capture flow in some cases

## Best MVP

The MVP should focus on:

- capture
- transcribe
- read screen text
- summarize
- mark suspicious
- save reel link

Not MVP:

- perfect fact checker
- full automatic Instagram scraping
- guaranteed deep analysis from only a reel URL

## Suggested MVP Flow

1. User sees an interesting Instagram reel.
2. User taps app quick action / widget or shares into app.
3. App saves the Instagram reel link.
4. App captures short audio and a few visual frames if user allows.
5. App stores everything locally.
6. Background processing runs later.
7. User opens app and sees:
   - summary
   - claims
   - entities mentioned
   - possible trust label
   - original reel link

## AI / Processing Pipeline

### Step 1: Input Capture

Possible inputs:

- Instagram reel link
- short captured audio
- screenshots or selected frames
- optional user notes

### Step 2: Speech to Text

Convert reel speech into transcript.

### Step 3: OCR

Extract visible text from screenshots / frames.

Examples:

- repo names
- URLs
- product names
- version numbers
- on-screen claims

### Step 4: Merge Content

Combine:

- transcript
- OCR text
- metadata

### Step 5: Understanding

Generate:

- short summary
- main claims
- mentioned tools/repos/companies
- what user should verify later

### Step 6: Store Results

Save all processed data locally so the user can revisit it anytime.

## Suggested Output Per Reel

Each reel card can show:

- title or short topic
- one-line summary
- extracted claims
- mentioned repos/tools
- trust-style badge:
  - maybe true
  - maybe hype
  - needs verification
- original Instagram reel link

## API Key / Scalability Discussion

We discussed minimizing paid API usage.

Reason:

- better scalability
- lower cost
- more practical for side project MVP
- stronger engineering story on resume

So the app should prefer:

- on-device processing
- local models where possible
- Android-native ML features where possible

## Resume Value

We agreed this is a strong resume project.

Why:

- solves a real user problem
- combines Android + AI + multimodal thinking
- bridges computer vision and LLM systems
- shows product thinking
- relevant for:
  - AI engineer roles
  - applied ML roles
  - multimodal AI roles
  - FDE-style roles

Important positioning for resume:

Call it something like:

`Offline-first Android app for capturing and analyzing educational Instagram reels using speech, OCR, and multimodal claim extraction`

Better than calling it:

`perfect fact-checker`

because that sounds unrealistic.

## Honest Summary

This project is valid, useful, and strong for learning plus resume impact.

The smartest way to build it is:

- start with Instagram reels only
- save original link
- capture a little audio and a few frames
- process later
- summarize and extract claims
- mark suspicious content
- add deeper verification later

## One-Line Vision

`Save reel now. Understand it later. Verify carefully.`
