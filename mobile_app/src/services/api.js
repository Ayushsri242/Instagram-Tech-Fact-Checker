import axios from 'axios';
import { NativeModules } from 'react-native';
import { getGroqApiKey, getApiProvider, getApiModel } from './secrets';
import { getOfflineMode, saveApiLimits } from './storage';
import { runVerifiers, fillMissingPageText } from './verifiers';
import { logRun } from './runlog';

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
        { model, messages, temperature: 0 },
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

  const slugPattern = /\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\b/g;
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
  // Fuzzy variants, because a project's own page often uses the name it was
  // RENAMED to. On the nanobot run, "clawdbot" scored zero against
  // openclaw/openclaw - the very row that settles what Clawdbot actually is -
  // so the rename evidence was trimmed away before the model ever saw it.
  for (const n of [...needles]) {
    const bare = n.split('/').pop();
    if (bare && bare.length >= 4) {
      needles.push(bare);
      needles.push(bare.replace(/[-_.]/g, ''));
      if (bare.length >= 6) needles.push(bare.slice(0, Math.max(4, bare.length - 3)));
    }
  }
  const uniq = [...new Set(needles.filter((n) => n.length >= 4))];

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

// Carousels print their own slide counter - "01/07" on slide one. When the
// number of images actually fetched is short of the declared total, the
// extraction is incomplete, and that is a fact the pipeline can state instead
// of discovering by accident. Set 3 fetched 2 of a 7-slide post and then
// reported "no public repository exists" for a tool that lives on slide 3.
export const slideCoverage = (ocrText, imagesUsed) => {
  const seen = Number(imagesUsed || 0);
  if (!seen) return null;
  let declared = 0;
  for (const m of String(ocrText || '').matchAll(/\b0?(\d{1,2})\s*\/\s*0?(\d{1,2})\b/g)) {
    const index = Number(m[1]);
    const total = Number(m[2]);
    // A plausible slide counter, not a date or a fraction in a price.
    if (total >= 2 && total <= 20 && index >= 1 && index <= total) {
      declared = Math.max(declared, total);
    }
  }
  return declared > seen ? { declared, seen } : null;
};

const synthesizeFactCheck = (apiKey, transcript, ocrText, claimsData, evidence, coverage) => {
  const kept = rankEvidence(evidence, claimsData && claimsData.tech_name, claimsData && claimsData.tools);
  if ((evidence || []).length > kept.length) {
    console.warn(`Evidence trimmed for token budget: ${evidence.length} -> ${kept.length} rows.`);
  }
  // Log the survivors, not the input. The previous log showed the full list, so
  // a row being cut was invisible - which hid the openclaw evidence being
  // dropped by the ranker on the nanobot run.
  console.log('\n===== TFC STAGE 2 KEPT (what the model actually reads) =====');
  console.log(JSON.stringify(kept.map((k) => ({ title: k.title, url: k.url, pageChars: (k.pagePreview || '').length })), null, 2));
  const extractClaimAnchored = (text, budget) => {
    if (!text) return '';
    const terms = [];
    if (claimsData && claimsData.tech_name) terms.push(claimsData.tech_name);
    (claimsData && claimsData.tools || []).forEach(t => {
      if (t.name) terms.push(t.name);
      if (t.github_repo && t.github_repo !== 'null') terms.push(t.github_repo);
    });
    const claimsStr = (claimsData && claimsData.claimed_features || []).join(' ');
    const numbers = claimsStr.match(/\b\d+(?:\.\d+)?x?\b/g) || [];
    terms.push(...numbers);
    terms.push('price', 'pricing', 'license', 'free', 'cost', 'source');
    
    const sentences = text.replace(/([.!?])\s+/g, "$1|").split("|");
    const hits = [];
    const lowerTerms = [...new Set(terms)].filter(Boolean).map(t => String(t).toLowerCase());
    
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i].toLowerCase();
      if (lowerTerms.some(t => s.includes(t))) {
        if (i > 0) hits.push(sentences[i-1].trim());
        hits.push(sentences[i].trim());
        if (i < sentences.length - 1) hits.push(sentences[i+1].trim());
      }
    }
    
    const result = hits.length ? [...new Set(hits)].join(' ') : text;
    return result.slice(0, budget);
  };

  const evidenceText = kept.map((item) => [
    'Title: ' + (item.title || ''),
    'URL: ' + (item.url || ''),
    'Snippet: ' + (item.snippet || '').slice(0, 300),
    'Page Context: ' + extractClaimAnchored(item.pagePreview, MAX_PAGE_PREVIEW),
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
    ...(claimsData.tech_name === null ? ['',
      'SUBJECT UNIDENTIFIED: Do not guess the primary tool or subject name. State clearly in factual_reality that the primary subject could not be confidently identified, and only evaluate the tools that were found.'] : []),
    ...(coverage ? ['',
      'EXTRACTION WAS INCOMPLETE: this post declares ' + coverage.declared +
      ' slides and only ' + coverage.seen + ' were read. Anything the post promotes may be on a slide nobody saw,' +
      ' so do not state that a tool does not exist, has no repository or cannot be installed. Say the post was only partly readable instead.'] : []),
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

// The model reads the evidence and then contradicts it.
//
// On one nanobot run the kept evidence literally said
//   "PyPI - nanobot: Minimalist robot navigation framework"
// and the model still emitted "pip install nanobot". Asking more firmly does not
// work - three sessions of prompt changes proved that. So every check that can
// be decided by looking at the evidence is decided here instead.
const applyEvidenceRules = (report, evidence, techName) => {
  const notes = [];
  const rows = evidence || [];
  const hay = (r) => `${r.title || ''} ${r.snippet || ''} ${r.pagePreview || ''}`;
  const findRow = (re) => rows.find((r) => re.test(hay(r)));

  // Evidence gate for repos: a repo URL may appear in the report only if it was
  // in the gathered evidence.
  const validTools = [];
  for (const tool of report.tools || []) {
    if (tool.repo && tool.repo !== 'null') {
      const lowerRepo = tool.repo.toLowerCase();
      const inEvidence = rows.some((r) => (r.url || '').toLowerCase().includes('github.com/' + lowerRepo));
      if (!inEvidence) {
        notes.push(`Dropped tool "${tool.name}": repo ${tool.repo} was never fetched in evidence.`);
        continue;
      }
    }
    validTools.push(tool);
  }
  report.tools = validTools;

  for (const tool of report.tools || []) {
    if (!tool.install) continue;
    const m = String(tool.install).match(/(?:pip3?)\s+install\s+([a-z0-9][a-z0-9._-]*)/i);
    if (!m) continue;
    const pkg = m[1];
    const lower = pkg.toLowerCase();
    // Plain string match, not a built regex. `\b` and `\s` inside a template
    // literal are a backspace char and the letter s, so the previous pattern
    // silently never matched and fabricated packages sailed through.
    const absentTitle = `pypi - ${lower} not found`;
    if (rows.some((r) => String(r.title || '').toLowerCase().startsWith(absentTitle))) {
      notes.push(`Dropped install "${tool.install}": PyPI has no package named "${pkg}".`);
      tool.install = null;
      continue;
    }
    const row = rows.find((r) => String(r.url || '').toLowerCase() === `https://pypi.org/project/${lower}/`);
    if (row) {
      // The package exists. Do NOT delete the command just because the summary
      // reads unrelated: on the gemini-web2api run this rule removed
      // "pip install httpx", which is the project's own documented first step.
      // A dependency is not a wrong package. Flag the mismatch, keep the line.
      const summary = String(row.snippet || '').toLowerCase();
      const subject = String(techName || '').toLowerCase();
      const named = subject.length >= 3 && subject !== lower && summary.includes(subject);
      const aiish = /\b(ai|agent|agents|assistant|llm|llms|chatbot|chat)\b/.test(summary);
      if (!named && !aiish) {
        notes.push(`NOTE: "${pkg}" on PyPI is "${String(row.snippet || '').slice(0, 60)}" - may be a dependency rather than the tool itself.`);
      }
    }
  }

  // A rename the resolver confirmed must not be silently dropped.
  const rename = findRow(/RENAME CONFIRMED|RENAMED: /i);
  if (rename) {
    const line = String(rename.snippet || rename.pagePreview || '').replace(/\s+/g, ' ').trim();
    if (line && !(report.gotchas || []).some((g) => /renamed|now lives at|is now/i.test(g))) {
      report.gotchas = [line.slice(0, 140), ...(report.gotchas || [])].slice(0, 4);
      notes.push('Added the confirmed rename to gotchas; the model had that row and omitted it.');
    }
  }

  // Two questions, two answers.
  //
  // Asking one model for one word produced a reflex: four runs of
  // PARTIALLY_TRUE, then - after the rubric was tightened - three runs of
  // MISLEADING, including on a post whose five repos were all real and whose
  // star counts were UNDERSTATED. "Are the tools real" is decidable from
  // evidence; "is the framing honest" is a judgement. Keep them apart.
  const tools = report.tools || [];
  const verified = tools.filter((t) => t.status === 'verified').length;
  const missing = tools.filter((t) => t.status === 'not_found').length;
  report.toolsReal = { verified, missing, total: tools.length };

  // Code owns the existence half. The model may not call something fake when
  // the evidence verified it, nor real when the evidence says it is missing.
  if (report.verdict === 'FAKE' && verified > 0 && missing === 0) {
    notes.push(`Overrode FAKE: ${verified}/${tools.length} tools were verified to exist.`);
    report.verdict = 'MISLEADING';
  }
  if (report.verdict === 'TRUE' && (missing > 0 || verified === 0)) {
    notes.push(`Downgraded TRUE (verified=${verified}, missing=${missing}).`);
    report.verdict = 'PARTIALLY_TRUE';
  }
  // A MISLEADING -> HYPE softening rule used to sit here. It fired twice and
  // was wrong both times, most damagingly on a reel about resetting Claude
  // Code's usage limit: "Claude Code" is obviously a real tool, so the rule
  // softened a correct MISLEADING to HYPE. Whether a tool exists says nothing
  // about whether a claim ABOUT that tool is honest, which is the whole point
  // of keeping the two questions apart. Removed deliberately - do not re-add.

  // The run log reads `__rules` and it was never assigned, so the
  // `evidenceRules` column has been blank in every recorded set - including the
  // run where a TRUE was silently downgraded to PARTIALLY_TRUE and the analysis
  // had to reconstruct which rule did it by reading this function.
  if (notes.length) {
    console.warn('EVIDENCE RULES:' + String.fromCharCode(10) + '  ' + notes.join(String.fromCharCode(10) + '  '));
    report.__rules = notes;
  }
  return report;
};

// Deterministic subject picker.
//
// Two of five recorded runs named the wrong thing, and when the subject is
// wrong nothing downstream can be right:
//   - "sparkly-api"          - the creator's own IDE window title
//   - "5 free GitHub repos"  - the caption headline, not a product
//
// Order of trust: a repo the evidence verified, then a name the OCR repeats,
// then the model's guess. Chrome and headlines are rejected outright, and if
// nothing survives the answer is "unidentified" - an honest blank beats a
// confident wrong.
const CHROME_PATTERNS = [
  /ask anything/i, /for actions/i, /to mention/i, /^untitled/i, /settings$/i,
  /^new (chat|file|project)/i, /^search$/i, /^menu$/i, /sign ?in/i, /^home$/i,
];
const HEADLINE_PATTERNS = [
  /^\d+\s/i,                       // "5 free GitHub repos"
  /^(top|best|these|my|the)\s/i,  // "Top 5 tools"
  /(repos|tools|libraries|apps|tricks|hacks|ways|tips)$/i,
  /killer$/i, /f[*u]ck/i,
];

const looksLikeSubject = (name) => {
  const n = String(name || '').trim();
  if (n.length < 3 || n.length > 40) return false;
  if (n.split(/\s+/).length > 4) return false;
  if (CHROME_PATTERNS.some((re) => re.test(n))) return false;
  if (HEADLINE_PATTERNS.some((re) => re.test(n))) return false;
  return true;
};

// A post that names a rival names it in order to bury it. Set 3 picked
// "Graphify" as the subject of a post whose first slide reads "Smart Devs Don't
// Use Graphify. They Use BASE." - the mention was read, the stance was not.
// Case 2 did the same with DeepCode.
const DISMISSAL_VERBS = "don'?t use|do not use|stop using|no more|forget|replace[sd]?|instead of|rip|goodbye to|killer|kills|is dead|obsolete";
const escapeForRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const pickSubject = (modelName, evidence, ocrText) => {
  // OCR joins lines with " | ", so the slide reading "Smart Devs Don't / Use
  // Graphify" arrives as "Smart Devs Don't | Use Graphify" and no phrase match
  // survives. Flatten the separators before looking for phrases.
  const ocr = String(ocrText || '').toLowerCase().replace(/[|\n]+/g, ' ').replace(/\s+/g, ' ');
  const countOf = (n) => {
    if (n.length < 3) return 0;
    let count = 0, i = 0;
    while ((i = ocr.indexOf(n, i)) !== -1) { count += 1; i += n.length; }
    return count;
  };
  // A repo is "prime-agent"; the post writes "Prime Agent". Counting the slug
  // literally scored it zero on a post that showed the name in every frame, and
  // the subject fell through to a three-letter acronym instead.
  const occurrences = (needle) => {
    const n = String(needle || '').toLowerCase();
    const spaced = n.replace(/[-_.]+/g, ' ');
    return Math.max(countOf(n), spaced === n ? 0 : countOf(spaced));
  };
  const isDismissed = (name) => {
    const n = escapeForRegex(name);
    // Either order: "don't use Graphify" and "Graphify killer" both bury it.
    return new RegExp('(?:' + DISMISSAL_VERBS + ')\\s+(?:the\\s+)?' + n, 'i').test(ocr) ||
      new RegExp(n + '\\s+(?:is\\s+)?(?:killer|is dead|obsolete)', 'i').test(ocr);
  };

  // 1. A repository the evidence confirmed, whose name the post shows - ranked,
  //    not first-past-the-post. Evidence order is arbitrary, and taking the
  //    first match made a repo mentioned once beat "Prime Agent", which the
  //    same post showed 23 times.
  const candidates = [];
  for (const r of evidence || []) {
    const m = String(r.url || '').match(/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/i);
    if (!m) continue;
    const repoName = m[2];
    if (!looksLikeSubject(repoName)) continue;
    // A three-letter repo name is an acronym for a concept, not the product a
    // post is about, and counting substrings flatters it: "rlm" scored 13 hits
    // against "prime-agent"'s 11 on a post whose every frame says Prime Agent,
    // because RLM is the technique the harness is built on.
    if (repoName.length < 4) continue;
    const hits = occurrences(repoName);
    if (hits < 1) continue;
    if (candidates.some((c) => c.name.toLowerCase() === repoName.toLowerCase())) continue;
    candidates.push({ name: repoName, slug: m[1] + '/' + m[2], hits, dismissed: isDismissed(repoName) });
  }
  // A tool the post promotes outranks one it dismisses, however often the
  // dismissed one is named; within a group, the more the post says it, the more
  // likely it is what the post is about.
  candidates.sort((a, b) => (a.dismissed - b.dismissed) || (b.hits - a.hits));
  const best = candidates.find((c) => !c.dismissed);
  if (best) {
    return { name: best.name, why: `verified repo ${best.slug} named ${best.hits}x in the post` };
  }
  if (candidates.length) {
    // Everything the evidence verified is something this post is arguing
    // against. Naming any of them would fact-check the rival.
    const names = candidates.map((c) => c.name).join(', ');
    if (looksLikeSubject(modelName) && occurrences(modelName) >= 1 && !isDismissed(modelName)) {
      return { name: modelName, why: `model name, appears ${occurrences(modelName)}x; verified repos (${names}) are all dismissed by the post` };
    }
    return { name: null, why: `only dismissed tools were verified (${names})` };
  }

  // 2. The model's name, but only if the post actually says it. A name with
  //    zero occurrences is the definition of not being the subject: that branch
  //    used to return the name anyway, and it published a creator's Instagram
  //    handle as the product under test.
  if (looksLikeSubject(modelName)) {
    const hits = occurrences(modelName);
    if (hits >= 2) return { name: modelName, why: `model name, appears ${hits}x in OCR` };
    return { name: null, why: `rejected "${modelName}": model named it but appears only ${hits}x (needs 2)` };
  }
  return { name: null, why: `rejected "${modelName}" as chrome or headline` };
};

// How much the pipeline should be trusted on THIS run, computed from what
// actually happened rather than asked of the model.
//
// A model rating its own answer is a self-report, and every model-judgement
// rule added to this project has needed correcting. These four facts are
// already measured every run, and each one has a recorded case behind it: a
// post whose subject could not be confirmed published a creator's Instagram
// handle as the product; a 7-slide carousel read 2 slides and then denied a
// real repo existed; evidence rows that scraped to nothing produced a report
// reasoning from search-result marketing.
export const deriveConfidence = ({ subjectNamed, coverage, toolsReal, rowsWithText, hasText }) => {
  let score = 95;
  const why = [];
  if (!subjectNamed) { score -= 25; why.push('subject not confirmed'); }
  if (coverage) {
    score -= 25;
    why.push('read ' + coverage.seen + ' of ' + coverage.declared + ' slides');
  }
  if (toolsReal && toolsReal.total > 0 && toolsReal.verified < toolsReal.total) {
    const unverified = toolsReal.total - toolsReal.verified;
    score -= Math.min(20, unverified * 10);
    why.push(unverified + ' of ' + toolsReal.total + ' tools unverified');
  }
  if (rowsWithText < 6) { score -= 10; why.push('only ' + rowsWithText + ' sources carried page text'); }
  if (!hasText) { score -= 15; why.push('little readable text in the post'); }
  return { score: Math.max(10, Math.min(95, score)), why };
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
  return applyEvidenceRules({
    verdict,
    factualReality: clampSentences(cleanLine(report.factual_reality), 2, 220),
    claims: cleanList(report.claims, 4).map((c) => clampSentences(c, 1, 110)),
    tools,
    gotchas: cleanList(report.gotchas, 4).map((g) => clampSentences(g, 1, 110)),
    references,
    toolsReal: null,
  }, evidence, report.tech_name);
};

// Exposed for tools/replay.js, which re-runs recorded runs through the picker
// and the normaliser without a device. Testing on hardware costs a build, an
// Instagram fetch and an API call per case, which is why earlier sessions kept
// tuning against a single reel and calling it a pass.
export const __test = { pickSubject, normalizeReport, looksLikeSubject, applyEvidenceRules };

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

  const startedAt = Date.now();
  // Per-stage timing, so "50 seconds" can be attributed instead of guessed at.
  // Set 2 regressed 40.3s -> 50.4s and the cause had to be reasoned about from
  // what had changed, because nothing measured the stages.
  const stage = {};
  let mark = startedAt;
  const lap = (name) => { stage[name] = Date.now() - mark; mark = Date.now(); };
  const media = await TechFactChecker.analyzeAndVerify(url, false);
  lap('native');
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

  let claimsData = await extractClaims(apiKey, transcript, ocrText);
  lap('claims');
  // Kept because the picker overwrites tech_name below, and a replay of this
  // run has to see what the model originally said to measure a picker change.
  const modelTechName = claimsData.tech_name;
  log('STAGE 1 CLAIMS', claimsData);
  const queries = (claimsData.search_queries || []).slice(0, 10);
  log('STAGE 2 QUERIES', queries);

  // Structured lookups and web search are independent, so run them together.
  // Sequentially they pushed one run to 55s; a paste-and-wait app cannot afford
  // that.
  const searched = queries.length
    ? await TechFactChecker.gatherEvidence(queries)
    : (media.sources || []);
  lap('search');
  // The pricing check needs the search results, so the router runs after them.
  // Its own lookups are already parallel inside runVerifiers.
  const verified = await runVerifiers(claimsData, transcript, ocrText, searched);
  const structured = verified.rows;
  lap('verifiers');
  log('STAGE 2 STRUCTURED', structured.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })));
  // Structured rows lead: they are authoritative and short, so they survive the
  // token trim that drops the tail of the search results.
  const evidence = [...structured, ...searched];
  log('STAGE 2 EVIDENCE', {
    count: evidence.length,
    withPageContext: evidence.filter((e) => (e.pagePreview || '').length > 0).length,
    rows: evidence.map((e) => ({ title: e.title, url: e.url, pageChars: (e.pagePreview || '').length })),
  });

  // Rescue the rows that scraped to nothing, before ranking picks the 12.
  await fillMissingPageText(evidence, 2);
  lap('pagefill');

  // Decide the subject in code before the model writes anything about it.
  const subject = pickSubject(claimsData.tech_name, evidence, ocrText);
  log('SUBJECT', subject);
  if (subject.name !== undefined && subject.name !== claimsData.tech_name) {
    claimsData = { ...claimsData, tech_name: subject.name };
  }

  const coverage = slideCoverage(ocrText, media.imagesUsed);
  if (coverage) log('COVERAGE', coverage);
  const report = await synthesizeFactCheck(apiKey, transcript, ocrText, claimsData, evidence, coverage);
  lap('synthesis');
  log('STAGE 3 RAW REPORT', report);
  const verdictRaw = report.verdict;
  const normalized = normalizeReport(report, evidence);
  normalized.confidence = deriveConfidence({
    subjectNamed: Boolean(subject.name),
    coverage,
    toolsReal: normalized.toolsReal,
    rowsWithText: evidence.slice(0, MAX_EVIDENCE_ROWS).filter((e) => (e.pagePreview || '').length > 0).length,
    hasText: (ocrText.length + transcript.length) > 200,
  });
  log('CONFIDENCE', normalized.confidence);
  log('STAGE 3 NORMALIZED (what the card renders)', normalized);

  const tools = normalized.tools || [];
  await logRun({
    timestamp: new Date().toISOString(),
    shortcode: (String(url).match(/(?:reel|p)\/([A-Za-z0-9_-]+)/) || [])[1] || url,
    verdict: normalized.verdict,
    verdictRaw,
    techName: report.tech_name || claimsData.tech_name || '',
    ocrChars: ocrText.length,
    speechChars: media.speechChars != null ? media.speechChars : '',
    captionChars: media.caption ? media.caption.length : '',
    toolsOut: tools.length,
    toolsVerified: tools.filter((t) => t.status === 'verified').length,
    toolsNotFound: tools.filter((t) => t.status === 'not_found').length,
    install: tools.map((t) => t.install).filter(Boolean).join(' ; '),
    structuredRows: structured.length,
    searchRows: searched.length,
    keptRows: Math.min(evidence.length, 12),
    keptWithPageText: evidence.slice(0, 12).filter((e) => (e.pagePreview || '').length > 0).length,
    evidenceRules: (normalized.__rules || []).join(' ; '),
    claims: (normalized.claims || []).length,
    gotchas: (normalized.gotchas || []).length,
    durationMs: Date.now() - startedAt,
    error: '',
    // Everything below exists so a batch can be analysed from the CSV alone.
    // Three test sets were scored from counters, and every disease-level finding
    // - invented repos, a fork cited over a 389k-star original, a fact-check of
    // a window title - needed the report text, which no column carried.
    coverage: coverage ? coverage.seen + '/' + coverage.declared + ' slides' : '',
    confidence: normalized.confidence
      ? normalized.confidence.score + ' (' + (normalized.confidence.why.join('; ') || 'no penalties') + ')'
      : '',
    subjectName: subject.name || '',
    subjectWhy: subject.why || '',
    verifiersFired: (verified.fired || []).join(' ; '),
    stageMs: Object.keys(stage).map((k) => k + '=' + stage[k]).join(' '),
    mediaSource: media.mediaSource || '',
    mediaType: media.mediaType || '',
    extractVia: media.extractVia || '',
    slidesJson: media.slidesJson != null ? media.slidesJson : '',
    slidesDom: media.slidesDom != null ? media.slidesDom : '',
    imagesUsed: media.imagesUsed != null ? media.imagesUsed : '',
    ocrLens: media.ocrLens || '',
    sttStats: media.sttStats || '',
    candidates: media.candidates || '',
    claimsJson: JSON.stringify({
      tech_name: modelTechName,
      tech_name_after_picker: claimsData.tech_name,
      tools: claimsData.tools,
      claimed_features: claimsData.claimed_features,
      search_queries: queries,
    }),
    evidenceJson: JSON.stringify(
      evidence.slice(0, 12).map((e) => ({
        t: e.title,
        u: e.url,
        p: (e.pagePreview || '').length,
      }))
    ),
    reportJson: JSON.stringify(normalized),
    transcript,
    ocrText,
  });
  delete normalized.__rules;

  return {
    ...media,
    // An honest blank beats a confident wrong: two of five recorded runs named
    // a window title and a caption headline.
    techName: subject.name !== undefined && subject.name !== null ? subject.name : (subject.name === null ? 'Unidentified' : (report.tech_name || media.techName || 'Unidentified')),
    subjectWhy: subject.why,
    verdict: report.verdict || 'UNKNOWN',
    pricingModel: report.pricing_model || 'Unknown',
    githubUrl: report.github_url || null,
    factualReality: report.factual_reality || '',
    // Structured report for the UI. summaryMarkdown is kept only so older saved
    // reels and the chat context still render.
    report: normalized,
    // ResultScreen's badge reads this. Derived from the run, not self-rated.
    confidenceScore: normalized.confidence ? normalized.confidence.score : null,
    summaryMarkdown: report.summary_markdown || '',
    tools: normalizeTools(claimsData.tools),
    claims: claimsData.claimed_features || [],
    sources: evidence,
  };
};

const performQuickSearch = async (query) => {
  try {
    const { data } = await axios.get(
      'https://r.jina.ai/https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query),
      { timeout: 10000, headers: { Accept: 'text/plain' }, responseType: 'text' }
    );
    // Return the first 1500 chars of Jina markdown
    return String(data || '').slice(0, 1500);
  } catch (e) {
    return 'Search failed.';
  }
};

export const chatWithAiApi = async (reel, userMessage, conversation = [], onSearchStart = null) => {
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
    'CRITICAL RULES:',
    '1. Answer in 1-2 short sentences maximum. Be concise. Only provide long detailed answers if the user explicitly uses words like "explain", "detail", or "elaborate".',
    '2. If the user asks a question about something you have 0 knowledge about and it is not in the Evidence, you MUST output EXACTLY the phrase: SEARCH: [your search query here] and nothing else. The system will perform the search and give you the answer to summarize.',
  ].join('\n\n');
  
  if (offline) {
    if (!TechFactChecker) throw new Error('Native mobile module is unavailable.');
    const prompt =
      '<start_of_turn>user\n' + context + '\n\n' + recentChat +
      '\n\nCurrent question: ' + userMessage +
      '<end_of_turn>\n<start_of_turn>model\n';
    let res = await TechFactChecker.generateResponse(prompt);
    if (res.includes('SEARCH:')) {
      const match = res.match(/SEARCH:\s*(.+)/);
      if (match) {
        if (onSearchStart) onSearchStart();
        const query = match[1].trim();
        const searchResult = await performQuickSearch(query);
        const followUpPrompt = prompt + res + '<end_of_turn>\n<start_of_turn>user\nSearch Results:\n' + searchResult + '\nNow answer the user\'s question concisely.<end_of_turn>\n<start_of_turn>model\n';
        return TechFactChecker.generateResponse(followUpPrompt);
      }
    }
    return res;
  }

  const messages = [
    { role: 'system', content: context },
    { role: 'user', content: recentChat + '\n\nCurrent question: ' + userMessage },
  ];
  let res = await callGroqText(apiKey, messages);
  if (res.includes('SEARCH:')) {
    const match = res.match(/SEARCH:\s*(.+)/);
    if (match) {
      if (onSearchStart) onSearchStart();
      const query = match[1].trim();
      const searchResult = await performQuickSearch(query);
      messages.push({ role: 'assistant', content: res });
      messages.push({ role: 'user', content: 'Search Results:\n' + searchResult + '\n\nNow answer the question concisely.' });
      return callGroqText(apiKey, messages);
    }
  }
  return res;
};
