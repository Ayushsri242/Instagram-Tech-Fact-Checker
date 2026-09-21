import re

with open('mobile_app/App.js', 'r') as f:
    content = f.read()

# Add NativeModules import
content = content.replace(
    "import { DeviceEventEmitter } from 'react-native';",
    "import { DeviceEventEmitter, NativeModules } from 'react-native';\nconst { TechFactChecker } = NativeModules;"
)

queue_logic = """
    // 1-minute Cooldown Queue implementation
    const queue = [];
    let isProcessing = false;

    const processQueue = async () => {
      if (isProcessing || queue.length === 0) return;
      isProcessing = true;

      const url = queue.shift();
      console.log('Doomscroll Mode: Processing URL ->', url);

      try {
        // 1. Reset bubble to Blue
        TechFactChecker.setBubbleColor("#00E5FF");
        // 2. Show processing notification
        TechFactChecker.showNotification("Doomscroll Mode", "Processing Reel...");

        const result = await analyzeReelApi(url);
        await saveReelResult(result);
        
        console.log('Doomscroll Mode: Finished ->', result.verdict);
        
        // 3. Step 4 - Push Notification with verdict
        TechFactChecker.showNotification("Fact Check Complete", `VERDICT: ${result.verdict}`);
      } catch (e) {
        console.log('Doomscroll Mode: Failed ->', e.message);
        TechFactChecker.showNotification("Fact Check Failed", "Could not process reel.");
      }

      // Enforce 1-minute (60000ms) cooldown before next item
      setTimeout(() => {
        isProcessing = false;
        processQueue();
      }, 60000);
    };

    const sub = DeviceEventEmitter.addListener('ON_REEL_COPIED', (url) => {
      console.log('Doomscroll Mode: Caught URL ->', url);
      queue.push(url);
      processQueue();
    });
"""

# Replace old listener with the new queue logic
old_listener = """    const sub = DeviceEventEmitter.addListener('ON_REEL_COPIED', async (url) => {
      console.log('Doomscroll Mode: Caught URL ->', url);
      // Step 3 will flesh out the queue. For now, just run it!
      try {
        const result = await analyzeReelApi(url);
        await saveReelResult(result);
        console.log('Doomscroll Mode: Finished ->', result.verdict);
        // TODO: Step 4 - Push Notification
      } catch (e) {
        console.log('Doomscroll Mode: Failed ->', e.message);
      }
    });"""

content = content.replace(old_listener, queue_logic.strip())

with open('mobile_app/App.js', 'w') as f:
    f.write(content)
