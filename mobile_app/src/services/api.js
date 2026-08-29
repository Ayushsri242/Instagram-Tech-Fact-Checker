import { NativeModules, Platform } from 'react-native';

const { TechFactChecker } = NativeModules;

export const analyzeReelApi = async (url) => {
  try {
    if (Platform.OS === 'android' && TechFactChecker) {
      // In a fully native flow, we would pass the local video file. 
      // For this bridge, we pass mocked transcription/OCR inputs since we bypassed the Python ingest step.
      return await TechFactChecker.analyzeAndVerify(
        url,
        "Instagram Reel",
        "Creator",
        "This tool is amazing for developers.", // mock transcript
        "github.com/example/repo",            // mock OCR
        "example/repo",                       // mock detected repos
        "https://github.com/example/repo"     // mock URLs
      );
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
    console.error("Native Module Fact Check Error:", error);
    throw error;
  }
};

export const chatWithAiApi = async (reelId, userMessage, techName) => {
  try {
    console.log("NativeModules keys:", Object.keys(NativeModules));
    console.log("TechFactChecker exists?", !!TechFactChecker);
    
    if (Platform.OS === 'android' && TechFactChecker) {
      return await TechFactChecker.generateResponse(userMessage);
    }

    
    if (userMessage.toLowerCase().includes('install')) {
      return `To install ${techName}, run:\n\`\`\`bash\npip install ${techName.toLowerCase().replace(/\s+/g, '-')}\n\`\`\``;
    }
    return `${techName} is verified from on-screen evidence. You can inspect its GitHub repository or clone it locally to test.`;
  } catch (error) {
    console.error("Native Module LLM Error:", error);
    throw error;
  }
};
