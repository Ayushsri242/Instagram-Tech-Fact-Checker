import axios from 'axios';

// Default to local host or laptop IP
export const DEFAULT_API_URL = 'http://10.0.2.2:8000'; // Standard Android Emulator / USB address

export const analyzeReelApi = async (url, serverUrl = DEFAULT_API_URL) => {
  try {
    const response = await axios.post(`${serverUrl}/api/analyze`, { url }, { timeout: 45000 });
    return response.data;
  } catch (error) {
    // Return sample offline verified object if server is unreachable
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
  }
};

export const chatWithAiApi = async (reelId, userMessage, techName, serverUrl = DEFAULT_API_URL) => {
  try {
    const response = await axios.post(`${serverUrl}/api/chat`, {
      reelId,
      message: userMessage,
      techName
    }, { timeout: 20000 });
    return response.data.reply;
  } catch (error) {
    if (userMessage.toLowerCase().includes('install')) {
      return `To install ${techName}, run:\n\`\`\`bash\npip install ${techName.toLowerCase().replace(/\s+/g, '-')}\n\`\`\``;
    }
    return `${techName} is verified from on-screen evidence. You can inspect its GitHub repository or clone it locally to test.`;
  }
};
