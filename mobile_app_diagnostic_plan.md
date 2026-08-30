# Mobile App Diagnostic & Implementation Plan

## Phase 1: Model Download Verification (The LLM Foundation)
- [ ] 1. Verify model file exists on phone and is the correct size (~1.3GB).
- [ ] 2. Verify MediaPipe successfully initializes the model (catch and log native Kotlin exceptions).

## Phase 2: The Ingestion Flow (Why Fact Check is a black box)
- [ ] 3. Log when user presses "Run Fact Check" (JS).
- [ ] 4. Log when Render server responds.
- [ ] 5. Log when Kotlin OCR/Fact-Check engine returns final JSON to JS.

## Phase 3: The LLM Chat Flow
- [ ] 6. Log the exact prompt being passed from React Native to the native LLM engine.
- [ ] 7. **CRITICAL:** Pass any MediaPipe native crash/exception straight up to the JS Expo console so we can read it in the terminal instead of failing silently.

## Status Updates
- **2026-08-30:** Created checklist. Adding verbose logs across JS and Kotlin layers to trace failures.
