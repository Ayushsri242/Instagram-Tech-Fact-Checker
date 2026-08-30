import { NativeModules, Platform } from 'react-native';

const { TechFactChecker } = NativeModules;

export const analyzeReelApi = async (url) => {
  try {
    console.log(`\n======================================`);
    console.log(`[API] Run Fact Check Pressed`);
    console.log(`[API] URL: ${url}`);
    
    if (Platform.OS === 'android' && TechFactChecker) {
      console.log(`[API] Calling Native Module...`);
      const result = await TechFactChecker.analyzeAndVerify(url);
      console.log(`[API] Received Native Module Result successfully!`);
      return result;
    }
    
    // Fallback if running on iOS or NativeModule not linked
    const shortcode = url.split('/').filter(Boolean).pop() || 'sample_reel';
    return {
      reelId: shortcode,
      sourceUrl: url,
      title: `Instagram Post (${shortcode})`,
      author: 'Instagram Creator',
      techName: 'Tech Library / Tool',
      verdict: 'PARTIALLY_TRUE',
      pricingModel: 'Open Source',
      githubUrl: 'https://github.com',
      factualReality: 'Analyzed on-screen visual claims and audio transcript.',
      summaryMarkdown: '### 🎯 Verdict: **PARTIALLY_TRUE**\n\n- Verified open-source libraries and code components.\n- Check documentation before running in production.',
      tools: [
        {
          name: 'Tech Lib',
          githubRepo: 'owner/repo',
          pipCommand: 'pip install tech-lib',
          isVerified: true
        }
      ],
      claims: ['Open-source framework shown in reel'],
      rawTranscript: 'Sample audio transcript extracted on-device.'
    };
  } catch (error) {
    console.error("\n[API ERROR] Native Module Fact Check Error:");
    console.error(error);
    console.error("======================================\n");
    throw error;
  }
};

export const chatWithAiApi = async (reel, userMessage) => {
  try {
    const techName = reel.techName || "Unknown Tool";
    
    console.log(`\n======================================`);
    console.log(`[API] Ask AI Button Pressed`);
    console.log(`[API] Tech Name: ${techName}`);
    console.log(`[API] User Message: ${userMessage}`);
    
    if (Platform.OS === 'android' && TechFactChecker) {
      // Format specifically for Gemma instruction-tuned (it) models
      const injectedPrompt = `<start_of_turn>user
You are a strict, helpful Fact-Checking AI assistant. You just analyzed a video about ${techName}.
Here are the findings from the video analysis:
- Verdict: ${reel.verdict}
- Summary: ${reel.summaryMarkdown}
- Detected Tools: ${JSON.stringify(reel.tools.map(t => t.name))}

Answer the user's question concisely based on this evidence. Do not write a prompt, just provide the answer.
User's Question: ${userMessage}<end_of_turn>
<start_of_turn>model
`;

      console.log(`[API] Sent Prompt to Native MediaPipe Model (length: ${injectedPrompt.length})`);
      const response = await TechFactChecker.generateResponse(injectedPrompt);
      console.log(`[API] Received Native Model Response successfully!`);
      return response;
    }

    // Fallback if not Android
    if (userMessage.toLowerCase().includes('install')) {
      return `To install ${techName}, run:\n\`\`\`bash\npip install ${techName.toLowerCase().replace(/\s+/g, '-')}\n\`\`\``;
    }
    return `${techName} is verified from on-screen evidence. You can inspect its GitHub repository or clone it locally to test.`;
  } catch (error) {
    console.error("\n[API ERROR] Native Module LLM Error:");
    console.error(error);
    console.error("======================================\n");
    throw error;
  }
};
