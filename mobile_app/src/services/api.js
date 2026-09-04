import axios from 'axios';
import { NativeModules } from 'react-native';
import { getGroqApiKey } from './secrets';
import { getOfflineMode } from './storage';

const { TechFactChecker } = NativeModules;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b'];

const callGroqJson = async (apiKey, messages) => {
  let lastError;
  for (const model of GROQ_MODELS) {
    try {
      const response = await axios.post(
        GROQ_URL,
        { model, messages, temperature: 0.1, response_format: { type: 'json_object' } },
        { timeout: 90000, headers: { Authorization: 'Bearer ' + apiKey } }
      );
      return JSON.parse(response.data.choices[0].message.content.trim());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('All Groq models failed.');
};

const callGroqText = async (apiKey, messages) => {
  let lastError;
  for (const model of GROQ_MODELS) {
    try {
      const response = await axios.post(
        GROQ_URL,
        { model, messages, temperature: 0.3 },
        { timeout: 60000, headers: { Authorization: 'Bearer ' + apiKey } }
      );
      return response.data.choices[0].message.content;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('All Groq models failed.');
};

const extractClaims = (apiKey, transcript, ocrText) => {
  const prompt = [
    'Analyze this tech video/reel/carousel using transcript and OCR.',
    'Transcript:', transcript,
    'OCR:', ocrText,
    'Return ONLY JSON:',
    '{"tech_name":"main tool/title","tools":[{"name":"Tool Name","github_repo":"owner/repo or null","pip_command":"pip install ... or null","claim":"core claim"}],"claimed_features":["claim"],"search_queries":["precise query"]}',
  ].join('\n');
  return callGroqJson(apiKey, [
    { role: 'system', content: 'You are an expert technical entity and claim extraction system. Output strictly valid JSON.' },
    { role: 'user', content: prompt },
  ]);
};

const synthesizeFactCheck = (apiKey, transcript, ocrText, claimsData, evidence) => {
  const evidenceText = evidence.map((item) => [
    'Title: ' + (item.title || ''),
    'URL: ' + (item.url || ''),
    'Snippet: ' + (item.snippet || ''),
  ].join('\n')).join('\n\n');
  const prompt = [
    'You are a senior Applied AI and Software Engineer fact-checking a social-media tech post.',
    'Compare transcript, OCR, claims, and web evidence. Practical utility matters.',
    'Verdict must be TRUE, PARTIALLY_TRUE, HYPE, MISLEADING, or FAKE.',
    'Transcript:', transcript,
    'OCR:', ocrText,
    'Extracted claims:', JSON.stringify(claimsData),
    'Web evidence:', evidenceText,
    'Return ONLY JSON:',
    '{"tech_name":"string","verdict":"TRUE","pricing_model":"Open Source","github_url":"https://github.com/... or null","factual_reality":"2-4 sentence explanation","summary_markdown":"markdown report with Verdict, What Was Claimed, Practical Reality, Gotchas, References","sources":["url"]}',
  ].join('\n');
  return callGroqJson(apiKey, [
    { role: 'system', content: 'You are a precise, objective AI technical fact checker. Output strictly valid JSON.' },
    { role: 'user', content: prompt },
  ]);
};

const normalizeTools = (tools) => (tools || []).map((tool) => ({
  name: tool.name || 'Tool',
  githubRepo: tool.github_repo || null,
  pipCommand: tool.pip_command || null,
  isVerified: Boolean(tool.github_repo),
}));

export const analyzeReelApi = async (url) => {
  if (!TechFactChecker) throw new Error('Native mobile module is unavailable. Rebuild the Android dev app.');
  const offline = await getOfflineMode();

  // Offline: the native 3-stage Gemma pipeline already produced the verdict,
  // the evidence and the markdown report. Nothing leaves the device.
  if (offline) {
    const localResult = await TechFactChecker.analyzeAndVerify(url, true);
    return { ...localResult, offline: true };
  }

  const apiKey = await getGroqApiKey();
  if (!apiKey) throw new Error('Add your Groq API key in Setup first.');

  const media = await TechFactChecker.analyzeAndVerify(url, false);
  const transcript = media.rawTranscript || '';
  const ocrText = media.ocrText || '';
  const claimsData = await extractClaims(apiKey, transcript, ocrText);
  const queries = (claimsData.search_queries || []).slice(0, 10);
  const evidence = queries.length ? await TechFactChecker.gatherEvidence(queries) : (media.sources || []);
  const report = await synthesizeFactCheck(apiKey, transcript, ocrText, claimsData, evidence);

  return {
    ...media,
    techName: report.tech_name || claimsData.tech_name || media.techName,
    verdict: report.verdict || 'UNKNOWN',
    pricingModel: report.pricing_model || 'Unknown',
    githubUrl: report.github_url || null,
    factualReality: report.factual_reality || '',
    summaryMarkdown: report.summary_markdown || '',
    tools: normalizeTools(claimsData.tools),
    claims: claimsData.claimed_features || [],
    sources: evidence,
  };
};

export const chatWithAiApi = async (reel, userMessage, conversation = []) => {
  const offline = await getOfflineMode();
  const apiKey = offline ? null : await getGroqApiKey();
  if (!offline && !apiKey) throw new Error('Add your Groq API key in Setup first.');
  const recentChat = conversation.slice(-8).map((message) =>
    (message.sender === 'user' ? 'User: ' : 'Assistant: ') + message.text
  ).join('\n');
  const context = [
    'You are an expert AI and mobile engineer answering questions about one verified Instagram post.',
    'Tech: ' + (reel.techName || 'Unknown Technology'),
    'Transcript: ' + (reel.rawTranscript || ''),
    'Verified fact-check: ' + (reel.summaryMarkdown || reel.factualReality || ''),
    'Evidence: ' + JSON.stringify(reel.sources || []),
    'Answer concisely and technically. State uncertainty when evidence does not support an answer.',
  ].join('\n\n');
  if (offline) {
    if (!TechFactChecker) throw new Error('Native mobile module is unavailable.');
    const prompt =
      '<start_of_turn>user\n' + context + '\n\n' + recentChat +
      '\n\nCurrent question: ' + userMessage +
      '<end_of_turn>\n<start_of_turn>model\n';
    return TechFactChecker.generateResponse(prompt);
  }

  return callGroqText(apiKey, [
    { role: 'system', content: context },
    { role: 'user', content: recentChat + '\n\nCurrent question: ' + userMessage },
  ]);
};
