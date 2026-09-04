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

// Mirrors verify.extract_claims_and_queries in the Python pipeline. The short
// version of this prompt missed listicle carousels and never asked for repo
// slugs, which is where most of the checkable evidence actually lives.
const extractClaims = async (apiKey, transcript, ocrText) => {
  const prompt = [
    'Analyze this content from a tech video/Instagram reel/carousel post.',
    'You are given both the Audio Transcript (or post caption) and all On-Screen Text detected from the video frames/slides.',
    '',
    'Audio Transcript / Caption:',
    transcript,
    '',
    'On-Screen Text / Visuals Detected from Frames/Slides:',
    ocrText,
    '',
    'Task:',
    '1. Determine if this post is about a SINGLE tool/technique or MULTIPLE tools/libraries (e.g. "5 LLM Libraries", listicle carousel).',
    '2. Extract all distinct tools/libraries/frameworks mentioned or shown on screen. Look specifically for GitHub repo names (e.g. owner/repo), pip package names, and domain URLs.',
    '3. Generate precise DuckDuckGo search queries. If GitHub repo or pip package names are present, include queries like "owner/repo github" or "pip install packagename".',
    '',
    'Respond ONLY with valid JSON in this exact structure:',
    '{"tech_name":"Primary title or main tool name","is_multi_tool":true,"tools":[{"name":"Tool Name","github_repo":"owner/repo or null","pip_command":"pip install ... or null","claim":"Core feature or claim stated"}],"claimed_features":["claim 1","claim 2"],"search_queries":["query 1","query 2"]}',
  ].join('\n');

  const data = await callGroqJson(apiKey, [
    { role: 'system', content: 'You are an expert technical entity and claim extraction system. Output strictly valid JSON.' },
    { role: 'user', content: prompt },
  ]);

  // Deterministic query enrichment, same as the Python side. A repo slug read
  // off the screen is checkable evidence and must not depend on the model
  // remembering to ask about it.
  const queries = data.search_queries || [];
  const slugPattern = /\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\b/g;
  let match = slugPattern.exec(ocrText || '');
  while (match !== null) {
    const slug = match[1];
    if (!slug.startsWith('http') && !slug.startsWith('pip/') && !slug.startsWith('api/')) {
      if (!queries.includes(slug + ' github')) queries.unshift(slug + ' github');
    }
    match = slugPattern.exec(ocrText || '');
  }
  (data.tools || []).forEach((tool) => {
    if (tool.github_repo && tool.github_repo !== 'null' && !queries.includes(tool.github_repo + ' github')) {
      queries.unshift(tool.github_repo + ' github');
    }
    if (tool.name && !queries.includes(tool.name + ' python library github')) {
      queries.push(tool.name + ' python library github');
    }
  });
  data.search_queries = queries.slice(0, 10);
  return data;
};

const synthesizeFactCheck = (apiKey, transcript, ocrText, claimsData, evidence) => {
  const evidenceText = evidence.map((item) => [
    'Title: ' + (item.title || ''),
    'URL: ' + (item.url || ''),
    'Snippet: ' + (item.snippet || ''),
    // Scraped page text, matching research.fetch_url_text. Without it the model
    // is reasoning from two lines of search-result marketing.
    'Page Context: ' + (item.pagePreview || '').slice(0, 400),
  ].join('\n')).join('\n\n');
  const prompt = [
    'You are a senior Applied AI and Software Engineer acting as a practical, objective Fact-Checker for social media tech videos and posts.',
    'Analyze the claims made in the transcript/caption and on-screen visuals against the collected real-world web evidence.',
    '',
    'Audio/Caption:', transcript,
    '',
    'Visual/OCR Text:', ocrText,
    '',
    'Extracted Claims & Tools:', JSON.stringify(claimsData),
    '',
    'Web Evidence Gathered:', evidenceText,
    '',
    'Evaluation Principles:',
    '- If MULTI-TOOL list (e.g. 5 tools): check each tool against evidence. If real GitHub repositories / pip packages exist, the verdict should reflect their collective authenticity. In the summary, give a concise bulleted breakdown for EVERY tool with its repo, practical utility, and caveats.',
    '- If SINGLE-TOOL: evaluate the single tool deeply.',
    '- Practical Utility First: if a shorthand trick or prompt (e.g. "/eli5") actually produces the claimed result in practice because the AI understands the intent, mark it TRUE or PARTIALLY_TRUE and explain prompt semantics vs native command.',
    '- TRUE: tools/repos exist, are open-source / usable, and work as demonstrated.',
    '- PARTIALLY_TRUE: real tools/repos exist, but with minor technical caveats (early alpha, semantic shortcut, setup prerequisites).',
    '- HYPE: the underlying concept exists, but marketing claims ("100% replaces everything", "zero effort") are exaggerated.',
    '- MISLEADING: omits critical limitations, severe pricing catches, or misrepresents functionality.',
    '- FAKE: completely fabricated tools, non-existent repos, or scams.',
    '',
    'summary_markdown must contain: 🎯 Verdict, 🔍 What Was Claimed (bullets), 💡 Practical Reality & Tool Breakdown (name, repo link, pip command, what it does), ⚠️ Gotchas / Caveats, 🔗 References.',
    '',
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
