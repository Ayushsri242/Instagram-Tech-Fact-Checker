import axios from 'axios';
import { NativeModules } from 'react-native';
import { getGroqApiKey, getApiProvider, getApiModel } from './secrets';
import { getOfflineMode, saveApiLimits } from './storage';

const { TechFactChecker } = NativeModules;

// One row per provider. `models` is a fallback chain: callGroqJson/Text walk it
// in order and keep the first that answers, so a retired model name costs a
// round trip instead of the whole run.
export const PROVIDERS = {
  Groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    // Both confirmed live against this account. Do not add a third from memory:
    // 'llama-3.3-70b-versatile' was added that way and returned model_not_found.
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
  },
  OpenRouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    models: ['openai/gpt-4o-mini', 'meta-llama/llama-3.3-70b-instruct'],
  },
  NVIDIA: {
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    models: ['meta/llama-3.3-70b-instruct', 'meta/llama3-70b-instruct'],
  },
  OpenAI: {
    url: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-4o-mini', 'gpt-3.5-turbo'],
  },
  Mistral: {
    url: 'https://api.mistral.ai/v1/chat/completions',
    models: ['mistral-large-latest', 'mistral-small-latest'],
  },
  Cohere: {
    // Cohere's OpenAI-compatible door. Its native API lives at /v1/chat, so
    // /v1/chat/completions on api.cohere.com is a 404.
    url: 'https://api.cohere.ai/compatibility/v1/chat/completions',
    models: ['command-r-plus', 'command-r'],
  },
  Google: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    models: ['gemini-2.0-flash', 'gemini-1.5-flash'],
  },
};

// Paste-only support. Groq/OpenRouter/NVIDIA/OpenAI/Google announce themselves
// with a prefix; Mistral and Cohere keys are bare alphanumerics, so the only
// tell left is length. Both shapes are stable but this is a heuristic, which is
// why the Provider Override box still exists.
export const detectProvider = (apiKey) => {
  const key = (apiKey || '').trim();
  if (!key) return null;
  if (key.startsWith('gsk_')) return 'Groq';
  if (key.startsWith('sk-or-v1-')) return 'OpenRouter';
  if (key.startsWith('nvapi-')) return 'NVIDIA';
  if (key.startsWith('AIza') || key.startsWith('AQ.')) return 'Google';
  if (key.startsWith('sk-')) return 'OpenAI';
  if (/^[A-Za-z0-9]{32}$/.test(key)) return 'Mistral';
  if (/^[A-Za-z0-9]{40}$/.test(key)) return 'Cohere';
  return null;
};

export const getApiConfig = (apiKey, manualProvider = null, manualModel = null) => {
  if (!apiKey) return null;

  // The override is a free-text box, so match it case-insensitively rather than
  // silently ignoring "cohere" because the key in PROVIDERS is "Cohere".
  const typed = (manualProvider || '').trim().toLowerCase();
  const name =
    Object.keys(PROVIDERS).find((p) => p.toLowerCase() === typed) || detectProvider(apiKey);

  // An unrecognised key is an error worth naming, not a silent fall back to
  // some other provider's endpoint with a model that may no longer exist.
  if (!name) {
    throw new Error(
      'Could not tell which provider this API key belongs to. ' +
        'Open Setup and type the provider name in "Provider Override" ' +
        '(one of: ' + Object.keys(PROVIDERS).join(', ') + ').'
    );
  }

  const models = manualModel && manualModel.trim() ? [manualModel.trim()] : PROVIDERS[name].models;
  return { url: PROVIDERS[name].url, models, provider: name };
};

// Providers that reject response_format still answer with prose or a fenced
// code block around the JSON. Cut to the outermost braces before parsing.
export const parseJsonLoose = (raw) => {
  const text = (raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in model reply: ' + text.slice(0, 200));
  return JSON.parse(text.slice(start, end + 1));
};

// Rate limits are per-organisation, not per-model, so falling straight through
// to the next model in the chain hits the same wall. Groq states the wait in the
// error ("Please try again in 10.5075s"); honour it and retry the same model.
const rateLimitWaitMs = (error) => {
  const data = error?.response?.data;
  const code = data?.error?.code;
  if (error?.response?.status !== 429 && code !== 'rate_limit_exceeded') return 0;
  // Only worth waiting for a per-minute token limit; "request too large" will
  // fail again no matter how long we wait.
  const msg = data?.error?.message || '';
  if (/reduce your message size/i.test(msg)) return 0;
  const m = msg.match(/try again in ([\d.]+)\s*s/i);
  const seconds = m ? parseFloat(m[1]) : 5;
  return Math.min(Math.ceil(seconds * 1000) + 500, 30000);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const callGroqJson = async (apiKey, messages) => {
  let lastError;
  const provider = await getApiProvider();
  const modelOverride = await getApiModel();
  const config = getApiConfig(apiKey, provider, modelOverride);
  for (const model of config.models) {
    for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await axios.post(
        config.url,
        { model, messages, temperature: 0.1 },
        { timeout: 90000, headers: { Authorization: 'Bearer ' + apiKey } }
      );
      
      const headers = response.headers || {};
      const remainingRequests = headers['x-ratelimit-remaining-requests'] || headers['x-ratelimit-remaining'];
      const remainingTokens = headers['x-ratelimit-remaining-tokens'];
      const resetTime = headers['x-ratelimit-reset-requests'] || headers['x-ratelimit-reset'];
      if (remainingRequests) {
        saveApiLimits({ remainingRequests, remainingTokens, resetTime, timestamp: Date.now() });
      }
      
      return parseJsonLoose(response.data.choices[0].message.content);
    } catch (error) {
      if (error.response && error.response.data) {
        console.error("API JSON Error Data:", JSON.stringify(error.response.data));
        lastError = new Error(`${error.message} - ${JSON.stringify(error.response.data)}`);
      } else {
        lastError = error;
      }
      const waitMs = attempt === 0 ? rateLimitWaitMs(error) : 0;
      if (waitMs > 0) {
        console.warn(`Rate limited on ${model}; waiting ${waitMs}ms then retrying.`);
        await sleep(waitMs);
        continue;
      }
      break;
    }
    }
  }
  throw lastError || new Error('All models failed.');
};

const callGroqText = async (apiKey, messages) => {
  let lastError;
  const provider = await getApiProvider();
  const modelOverride = await getApiModel();
  const config = getApiConfig(apiKey, provider, modelOverride);
  for (const model of config.models) {
    for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await axios.post(
        config.url,
        { model, messages, temperature: 0.3 },
        { timeout: 60000, headers: { Authorization: 'Bearer ' + apiKey } }
      );
      
      const headers = response.headers || {};
      const remainingRequests = headers['x-ratelimit-remaining-requests'] || headers['x-ratelimit-remaining'];
      const remainingTokens = headers['x-ratelimit-remaining-tokens'];
      const resetTime = headers['x-ratelimit-reset-requests'] || headers['x-ratelimit-reset'];
      if (remainingRequests) {
        saveApiLimits({ remainingRequests, remainingTokens, resetTime, timestamp: Date.now() });
      }
      
      return response.data.choices[0].message.content;
    } catch (error) {
      if (error.response && error.response.data) {
        console.error("API Text Error Data:", JSON.stringify(error.response.data));
        lastError = new Error(`${error.message} - ${JSON.stringify(error.response.data)}`);
      } else {
        lastError = error;
      }
      const waitMs = attempt === 0 ? rateLimitWaitMs(error) : 0;
      if (waitMs > 0) {
        console.warn(`Rate limited on ${model}; waiting ${waitMs}ms then retrying.`);
        await sleep(waitMs);
        continue;
      }
      break;
    }
    }
  }
  throw lastError || new Error('All models failed.');
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

  // OCR produces slug-shaped junk from URLs and UI chrome: "l/github.com",
  // "v1/chat", "8081/v1", "github/workflows". Searching those burned 4 of 25
  // evidence rows on GitHub's own homepage. The native SourceEvidence layer
  // already rejects these; the JS path did not.
  const JUNK_SLUG_PARTS = new Set([
    'github.com', 'www.github.com', 'github', 'gitlab', 'workflows', 'blob', 'tree',
    'main', 'master', 'docs', 'doc', 'api', 'pip', 'http', 'https', 'v1', 'v1beta',
    'chat', 'models', 'responses', 'releases', 'raw', 'assets', 'static',
  ]);
  const isUsableSlug = (slug) => {
    const [owner, repo] = slug.split('/');
    if (!owner || !repo) return false;
    if (/^\d+$/.test(owner) || /^\d/.test(owner)) return false;       // "8081/v1"
    if (owner.length < 2 || repo.length < 2) return false;             // "l/github.com"
    if (JUNK_SLUG_PARTS.has(owner.toLowerCase())) return false;
    if (JUNK_SLUG_PARTS.has(repo.toLowerCase())) return false;
    if (slug.includes('.') && !repo.includes('.')) return false;       // "l/github.com" style
    return true;
  };

  const slugPattern = /([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/g;
  let match = slugPattern.exec(ocrText || '');
  while (match !== null) {
    const slug = match[1];
    if (!slug.startsWith('http') && isUsableSlug(slug)) {
      if (!queries.includes(slug + ' github')) queries.unshift(slug + ' github');
    }
    match = slugPattern.exec(ocrText || '');
  }

  // Only search for tools the model actually anchored to a repo or package.
  // Querying a bare invented name ("Hidden Markov Model framework") returns
  // real pages about an unrelated subject, which then read as corroboration.
  (data.tools || []).forEach((tool) => {
    const repo = tool.github_repo && tool.github_repo !== 'null' ? tool.github_repo : null;
    if (repo && isUsableSlug(repo) && !queries.includes(repo + ' github')) {
      queries.unshift(repo + ' github');
    }
    const isPrimary = tool.name && data.tech_name &&
      tool.name.toLowerCase() === String(data.tech_name).toLowerCase();
    if (tool.name && (repo || tool.pip_command || isPrimary)) {
      const q = tool.name + ' github';
      if (!queries.includes(q)) queries.push(q);
    }
  });
  data.search_queries = queries.slice(0, 10);
  return data;
};

// Groq's free tier caps a single request at 8000 tokens for this org, and a
// long reel (88s of transcript + 10 frames of OCR + 30 evidence rows) was
// asking for 9050 - a hard failure that no amount of waiting fixes.
// Budget the payload instead of truncating it blindly at the end.
const MAX_EVIDENCE_ROWS = 12;
const MAX_PAGE_PREVIEW = 300;
const MAX_TRANSCRIPT = 3000;
const MAX_OCR = 3000;

// Relevance first, page text second.
//
// The first version of this ranked purely on "has scraped page text", which
// backfired badly: on the nanobot run the only rows with page text were
// github.com, github.com/github, desktop.github.com and Wikipedia's GitHub
// article - chrome that happens not to block scrapers. The actual repo page
// scraped to zero characters. Having page text measures who allows scraping,
// not who is relevant.
const rankEvidence = (evidence, techName, tools) => {
  const needles = [];
  if (techName) needles.push(String(techName).toLowerCase());
  for (const t of tools || []) {
    if (t.github_repo && t.github_repo !== 'null') needles.push(String(t.github_repo).toLowerCase());
    if (t.name) needles.push(String(t.name).toLowerCase());
  }
  const uniq = [...new Set(needles.filter((n) => n.length >= 3))];

  const score = (item) => {
    const hay = `${item.url || ''} ${item.title || ''}`.toLowerCase();
    let s = 0;
    const onTopic = uniq.some((n) => hay.includes(n));
    if (onTopic) s += 10;
    // A bare domain root is usually a landing page rather than evidence - but
    // not when the domain IS the subject, e.g. nanobot.wiki.
    if (!onTopic && /^https?:\/\/[^/]+\/?$/.test(item.url || '')) s -= 8;
    if ((item.pagePreview || '').length > 0) s += 3;
    return s;
  };

  return [...(evidence || [])]
    .map((item, i) => ({ item, i, s: score(item) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .slice(0, MAX_EVIDENCE_ROWS)
    .map((x) => x.item);
};

const synthesizeFactCheck = (apiKey, transcript, ocrText, claimsData, evidence) => {
  const kept = rankEvidence(evidence, claimsData && claimsData.tech_name, claimsData && claimsData.tools);
  if ((evidence || []).length > kept.length) {
    console.warn(`Evidence trimmed for token budget: ${evidence.length} -> ${kept.length} rows.`);
  }
  const evidenceText = kept.map((item) => [
    'Title: ' + (item.title || ''),
    'URL: ' + (item.url || ''),
    'Snippet: ' + (item.snippet || '').slice(0, 300),
    // Scraped page text, matching research.fetch_url_text. Without it the model
    // is reasoning from two lines of search-result marketing.
    'Page Context: ' + (item.pagePreview || '').slice(0, MAX_PAGE_PREVIEW),
  ].join('\n')).join('\n\n');
  transcript = (transcript || '').slice(0, MAX_TRANSCRIPT);
  ocrText = (ocrText || '').slice(0, MAX_OCR);
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
    'Return FIELDS ONLY. Do not write markdown, headings, bullet characters, tables or emoji inside any value.',
    'BE BRIEF. This is a card the reader scans in five seconds, not an article; they ask follow-up questions in chat afterwards.',
    '- factual_reality: AT MOST 2 sentences, under 220 characters total. Say what the tool is and whether the claim holds. No preamble.',
    '- claims: at most 4 items, each one short sentence under 100 characters.',
    '- gotchas: at most 4 items, each one short sentence under 100 characters. Only real blockers, not generic advice.',
    '- tools[].what_it_does: ONE short sentence, under 90 characters.',
    '- tools: ONLY software the post tells the viewer to install or use. Do NOT list messaging platforms, websites, companies, concepts, architectures or section headings as tools. A product being compared against counts only if the post presents it as an alternative to use.',
    'Ground every tool entry in the evidence above. Set "status" to "verified" only when the evidence shows the repo exists, "not_found" when it does not. Never invent a repo, install command, URL, price or hardware requirement.',
    'Prefer the canonical repository over a fork or mirror. If a repo looks like a fork of a more popular project, name the original.',
    '',
    'Return ONLY JSON:',
    '{"tech_name":"string","verdict":"TRUE","pricing_model":"Open Source","github_url":"https://github.com/... or null","factual_reality":"2-4 sentence explanation","claims":["one plain sentence per claim"],"tools":[{"name":"Tool Name","repo":"owner/repo or null","install":"pip install x or null","what_it_does":"one plain sentence","caveat":"one plain sentence or null","status":"verified"}],"gotchas":["one plain sentence per caveat"]}',
  ].join('\n');
  return callGroqJson(apiKey, [
    { role: 'system', content: 'You are a precise, objective AI technical fact checker. Output strictly valid JSON.' },
    { role: 'user', content: prompt },
  ]);
};

// The model is allowed to be sloppy; the object we hand to the UI is not.
// Asking for plain sentences is not enforcing them, so strip any markdown that
// leaks through - the report is rendered by components, not by a markdown parser.
const cleanLine = (v) => String(v == null ? '' : v)
  .replace(/[*`_]+/g, '')
  .replace(/^\s*[-•]\s*/, '')
  .replace(/^#{1,6}\s*/, '')
  .replace(/\s+/g, ' ')
  .trim();

// Trim on a sentence boundary rather than mid-word, so a cap never produces
// "the repo describes an ultra-lig".
const clampSentences = (text, maxSentences, maxChars) => {
  const src = String(text || '').trim();
  if (!src) return '';
  // A sentence ends at .!? followed by whitespace and a capital (or end of
  // string). Splitting on every "." turned "Python 3.10+" into "Python 3." -
  // version numbers and decimals are the common case here, not the exception.
  const parts = [];
  let start = 0;
  const re = /[.!?]+(?=\s+[A-Z(\[]|\s*$)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    parts.push(src.slice(start, m.index + m[0].length).trim());
    start = m.index + m[0].length;
  }
  if (start < src.length) parts.push(src.slice(start).trim());

  let out = parts.slice(0, maxSentences).join(' ').trim();
  if (!out) out = src;
  if (out.length > maxChars) {
    const cut = out.slice(0, maxChars);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
    out = (stop > maxChars * 0.5 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '') + '...').trim();
  }
  // A clause cut at a semicolon reads as a mistake; end it cleanly.
  return out.replace(/[;,]$/, '.');
};

const cleanList = (v, limit = 10) => {
  if (typeof v === 'string') v = [v];
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const raw of v) {
    const item = raw && typeof raw === 'object' ? (raw.text || raw.claim || '') : raw;
    const text = cleanLine(item);
    if (text && !/^(none|null|n\/a)$/i.test(text) && !out.includes(text)) out.push(text);
  }
  return out.slice(0, limit);
};

const normalizeReport = (report, evidence) => {
  const VERDICTS = ['TRUE', 'PARTIALLY_TRUE', 'HYPE', 'MISLEADING', 'FAKE'];
  const verdict = VERDICTS.includes(report.verdict) ? report.verdict : 'UNKNOWN';
  const tools = (Array.isArray(report.tools) ? report.tools : [])
    .filter((t) => t && typeof t === 'object' && cleanLine(t.name))
    .map((t) => ({
      name: cleanLine(t.name),
      repo: cleanLine(t.repo) || null,
      install: cleanLine(t.install) || null,
      whatItDoes: clampSentences(cleanLine(t.what_it_does), 1, 100),
      caveat: cleanLine(t.caveat) || null,
      status: ['verified', 'not_found'].includes(t.status) ? t.status : 'unverified',
    }))
    // The model keeps listing non-tools: "Telegram", "WhatsApp", "ZArchitecture"
    // (OCR noise from a heading) and outright inventions. An entry with no repo,
    // no install command and nothing verified is not a tool - it is a sentence
    // wearing a badge, and it makes the card longer while saying less.
    .filter((t) => t.repo || t.install || t.status === 'verified')
    .slice(0, 6);
  // References come from pages we actually fetched, so they cannot be invented.
  const references = [];
  for (const item of evidence || []) {
    const url = (item.url || '').trim();
    if (url && !references.some((r) => r.url === url)) {
      references.push({ url, title: (item.title || url).trim() });
    }
    if (references.length >= 8) break;
  }
  return {
    verdict,
    factualReality: clampSentences(cleanLine(report.factual_reality), 2, 220),
    claims: cleanList(report.claims, 4).map((c) => clampSentences(c, 1, 110)),
    tools,
    gotchas: cleanList(report.gotchas, 4).map((g) => clampSentences(g, 1, 110)),
    references,
  };
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
  const log = (label, value) => {
    console.log(`
===== TFC ${label} =====`);
    console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  };

  log('INPUT', {
    url,
    transcriptChars: transcript.length,
    ocrChars: ocrText.length,
    techNameFromNative: media.techName || null,
    nativeVerdict: media.verdict || null,
  });
  log('TRANSCRIPT', transcript || '(empty)');
  log('OCR', ocrText || '(empty)');

  const claimsData = await extractClaims(apiKey, transcript, ocrText);
  log('STAGE 1 CLAIMS', claimsData);
  const queries = (claimsData.search_queries || []).slice(0, 10);
  log('STAGE 2 QUERIES', queries);
  const evidence = queries.length ? await TechFactChecker.gatherEvidence(queries) : (media.sources || []);
  log('STAGE 2 EVIDENCE', {
    count: evidence.length,
    withPageContext: evidence.filter((e) => (e.pagePreview || '').length > 0).length,
    rows: evidence.map((e) => ({ title: e.title, url: e.url, pageChars: (e.pagePreview || '').length })),
  });

  const report = await synthesizeFactCheck(apiKey, transcript, ocrText, claimsData, evidence);
  log('STAGE 3 RAW REPORT', report);
  const normalized = normalizeReport(report, evidence);
  log('STAGE 3 NORMALIZED (what the card renders)', normalized);

  return {
    ...media,
    techName: report.tech_name || claimsData.tech_name || media.techName,
    verdict: report.verdict || 'UNKNOWN',
    pricingModel: report.pricing_model || 'Unknown',
    githubUrl: report.github_url || null,
    factualReality: report.factual_reality || '',
    // Structured report for the UI. summaryMarkdown is kept only so older saved
    // reels and the chat context still render.
    report: normalized,
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
