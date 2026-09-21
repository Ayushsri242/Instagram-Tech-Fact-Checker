# Tech Fact Checker - Handoff Notes

## 1. Goal
Implement **"Doomscroll Mode"**: A Shazam-like background analysis feature. The user enables the mode in the app, which spawns a floating System Alert Window ("Bubble"). While doomscrolling on Instagram, the user copies a Reel link and taps the Bubble. The Bubble grabs the clipboard link, passes it to the React Native background layer to analyze silently, and (eventually) sends a push notification with the Verdict so the user never has to leave Instagram.

## 2. Current Architecture
*   **Permissions:** `SYSTEM_ALERT_WINDOW`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE` are configured in `AndroidManifest.xml`.
*   **Native Foreground Service:** `FloatingBubbleService.kt` runs an ongoing foreground notification to keep the process alive. It uses `WindowManager` to draw a draggable 120x120 Cyan circle (using `GradientDrawable.OVAL`) on top of other apps.
*   **Clipboard Trick:** Android 13/14 strictly blocks clipboard reads from background apps. When the bubble is tapped, it temporarily steals Window focus (`FLAG_NOT_FOCUSABLE.inv()`) for 150ms to legally access the clipboard, then restores its state.
*   **Native-to-JS Bridge:** When an `instagram.com` link is found in the clipboard, the bubble turns Orange and fires a system broadcast `Intent("com.techfactchecker.REEL_COPIED")`. 
*   **React Native Listener:** `TechFactCheckerModule.kt` listens for this broadcast and routes it to JavaScript (`DeviceEventEmitter.emit("ON_REEL_COPIED")`). `App.js` listens to this event.

## 3. What is Working
*   The bubble successfully renders over Instagram.
*   The bubble successfully reads the clipboard **if the parent app is in the foreground**. (We are currently waiting on the user to test the newest build which contains the focus-stealing trick to allow clipboard reading while Instagram is in the foreground).
*   The UI changes (button in `HomeScreen.js`) are complete.

## 4. Current Problems & Immediate Next Steps
1.  **Broadcast Routing Fails:** Even when the bubble successfully read the clipboard and turned Orange, the JS listener in `App.js` didn't fire. 
    *   *Fix:* In `FloatingBubbleService.kt`, the broadcast needs explicit package routing: `intent.setPackage(packageName)`. Or, `TechFactCheckerModule` needs to be forcibly initialized so the `init` block registers the receiver. (Consider moving the receiver to `MainApplication` or using `LocalBroadcastManager`).
2.  **Step 3 - The Cooldown Queue:** Right now, `App.js` blindly calls `analyzeReelApi(url)` immediately. We must implement a queue system (using a local array or `AsyncStorage`) that processes reels one at a time with a 1-minute cooldown delay between runs to respect Groq/LLM API rate limits.
3.  **Step 4 - Push Notifications:** Once `analyzeReelApi` finishes, we need to send a local Android Push Notification with the final Verdict (e.g., "VERDICT: MISLEADING") so the user knows the result without opening the app.

## 5. Development Constraints
*   **No local Gradle:** The user relies strictly on GitHub Actions (`build-mobile-apk.yml`) to compile Kotlin changes. Native changes require a git commit, push, and a 2-minute wait for the cloud build.
*   JS changes can be tested instantly with a Metro reload (`R`).
*   The user's Windows machine is connected via ADB (`192.168.0.212:44811` or USB). You can monitor logs via `adb logcat -s TFC_DEBUG FloatingBubble ReactNativeJS`.
