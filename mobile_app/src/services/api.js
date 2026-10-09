import axios from 'axios';
import { NativeModules } from 'react-native';
import { getGroqApiKey } from './secrets';
import { getOfflineMode, saveApiLimits, getApiLimits } from './storage';
import { runVerifiers, fillMissingPageText, readPage } from './verifiers';
import { logRun } from './runlog';
import { trace, shortRef } from './trace';
import { jobStage, setJobNote, getJobState } from './jobState';

const { TechFactChecker } = NativeModules;

// Groq only. Every test set was run on Groq, and its key also covers the
// Whisper transcription the native side does, so a second provider would mean
// a second key for half the pipeline. Six other providers lived here, untested.
//
// One key, one model per job. Groq's free tier allows 8,000 tokens PER MINUTE
// PER MODEL (measured Oct 7: each model reports its own x-ratelimit-limit-tokens
// and its own remaining count). A big carousel's claim extraction alone used
// 7,213 tokens on gpt-oss-120b, most of it hidden reasoning, so the verdict
// call that followed in the same minute was rate limited and the run died.
// Splitting the two calls across two models gives each its own minute. The
// user still pastes a single key.
//
// Measured on 8 recorded posts with the same prompt:
// - qwen3.8-27b extracts claims better (5 wins, 3 ties, 0 losses: no dock or
//   folder junk, no dependency noise), with no hidden reasoning, half the
//   tokens, 2-4x faster.
// - gpt-oss-120b stays the judge for the verdict.
// - gpt-oss-20b is out: on a 5,000-token prompt it spent its whole output on
//   hidden reasoning (finish_reason=length) and returned an EMPTY answer - the
//   "No JSON object in model reply" failures.
// Do not add a model from memory: 'llama-3.3-70b-versatile' was added that way
// and returned model_not_found. Check GET /openai/v1/models first.
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_CHAINS = {
  extract: ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b'],
  verdict: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'],
  chat: ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b'],
};
const shortModel = (m) => String(m).split('/').pop();

// Which model answered each job in the current analysis, for the run log.
let modelsUsed = {};
// Set when the last run's web searches hit a bot check; the bubble queue then
// waits longer before the next reel (rapid runs are what trip the checks).
let lastSearchBlocked = false;
export const searchCooldownMs = () => (lastSearchBlocked ? 30000 : 0);
export const resetModelsUsed = () => { modelsUsed = {}; };
const describeModelsUsed = () =>
  Object.keys(modelsUsed).map((k) => k + '=' + modelsUsed[k]).join(' ');

// Groq keys start with gsk_. Anything else is a key for some other service.
export const isGroqKey = (apiKey) => String(apiKey || '').trim().startsWith('gsk_');

// Providers that reject response_format still answer with prose or a fenced
// code block around the JSON. Cut to the outermost braces before parsing.
export const parseJsonLoose = (raw) => {
  const text = (raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in model reply: ' + text.slice(0, 200));
  return JSON.parse(text.slice(start, end + 1));
};

// Groq states the wait in the error ("Please try again in 10.5075s"). Limits
// are per model (measured Oct 7), so callGroq waits and retries the same model
// once, then moves to the next model, which has its own budget.
const rateLimitWaitMs = (error) => {
  const data = error?.response?.data;
  const code = data?.error?.code;
  const msg = data?.error?.message || '';
  // Output tokens per minute (OTPM). The free tier also caps how many tokens a
  // model may WRITE per minute; when several long answers land in one minute
  // Groq refuses the next with a 413 "expected output tokens exceed the
  // enforced limit" - yet the same request succeeds in a fresh minute (measured
  // Oct 7: 3,000 output tokens fine on its own). So wait it out like a 429.
  // Only when the minute is USED UP ("Used 1000, Requested 331") - a reply that
  // alone is expected to exceed the cap ("Limit 1000, Requested 1501", no
  // "Used") is refused again after waiting; go straight to the next model.
  const outputLimit = /output tokens per minute|OTPM/i.test(msg) && /\bUsed\s+\d+/i.test(msg);
  // A DAILY limit ("tokens per day (TPD) ... try again in 7m21.072s"): never
  // wait in the run. The old pattern read "21.072s" out of "7m21.072s", waited
  // 21 s and was refused again. Go straight to the next model.
  if (/per day|\bTPD\b|\bRPD\b/i.test(msg)) return 0;
  if (error?.response?.status !== 429 && code !== 'rate_limit_exceeded' && !outputLimit) return 0;
  // An INPUT too large for the per-minute limit fails again however long we
  // wait; the caller must split instead.
  if (!outputLimit && /reduce your message size/i.test(msg)) return 0;
  const m = msg.match(/try again in ([\d.]+)\s*s/i);
  const seconds = m ? parseFloat(m[1]) : (outputLimit ? 60 : 5);
  return Math.min(Math.ceil(seconds * 1000) + 500, 61000);
};

// Rescue a JSON reply that was cut off or broken near the end: keep everything
// up to the last complete object and close the brackets. On Oct 7 a long-list
// extraction came back with a broken last array item and the whole run failed
// over one item.
export const salvageJson = (raw) => {
  const text = String(raw || '');
  const start = text.indexOf('{');
  if (start === -1) return null;
  for (let cut = text.lastIndexOf('}'); cut > start; cut = text.lastIndexOf('}', cut - 1)) {
    const body = text.slice(start, cut + 1);
    const stack = [];
    let inString = false, escaped = false;
    for (const ch of body) {
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') stack.pop();
    }
    if (inString) continue;
    const closers = stack.reverse().map((c) => (c === '{' ? '}' : ']')).join('');
    try {
      return JSON.parse(body.replace(/,\s*$/, '') + closers);
    } catch (e) {
      // try an earlier cut
    }
  }
  return null;
};

// Native wait: React Native pauses JS timers while the app is in the
// background, so a setTimeout here would hang a rate-limited background run.
export const sleep = (ms) =>
  TechFactChecker?.sleep ? TechFactChecker.sleep(ms) : new Promise((r) => setTimeout(r, ms));

// Groq states durations as "2m59.56s", "7.66s" or "1h2m3s".
export const parseResetMs = (value) => {
  const s = String(value || '').trim();
  if (!s) return null;
  let ms = 0, matched = false;
  for (const m of s.matchAll(/([\d.]+)\s*(h|ms|m|s)/g)) {
    matched = true;
    const n = parseFloat(m[1]);
    ms += m[2] === 'h' ? n * 3600000 : m[2] === 'm' ? n * 60000 : m[2] === 's' ? n * 1000 : n;
  }
  return matched ? Math.round(ms) : null;
};

// What the Home header shows. Groq's headers mean two different things, and the
// old display only ever showed the one that does not matter:
//
//   *-requests  -> requests per DAY    (the old "N reqs left")
//   *-tokens    -> tokens per MINUTE   (8,000 on the free tier - the wall this
//                                       app actually hits)
//
// It was also only saved after a SUCCESSFUL call, so a 429 - the one moment the
// number matters - never updated it, and it never expired, so yesterday's count
// sat on the screen indefinitely. Every response is recorded now, failures
// included, with the moment each window resets.
// One line for the Home header. A window whose reset time has passed is shown
// as full rather than at its last recorded value: nothing was spent since, and
// the old display left a stale count on screen for as long as the app was idle.
//
// Two models now, each with its OWN per-minute and per-day budget (qwen reads
// the post, gpt-oss-120b judges it). Showing whichever answered last could
// read "8k/8k" while the other was nearly spent, so each is shown by its job:
//   Reader 6.2k · Judge 3.1k of 8k/min
//   982 runs left today
// "Runs left" is the lower of the two daily counts - a run needs both.
const LIMIT_LABELS = { 'qwen3.8-27b': 'Reader', 'gpt-oss-120b': 'Judge' };
const limitState = (rec, now) => {
  if (!rec || !rec.timestamp || now - rec.timestamp > 36 * 3600000) return null; // stale: meaningless
  const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const tokLimit = n(rec.limitTokens);
  let tokLeft = n(rec.remainingTokens);
  if (tokLimit !== null && rec.tokensResetAt && now >= rec.tokensResetAt) tokLeft = tokLimit;
  const reqLimit = n(rec.limitRequests);
  let reqLeft = n(rec.remainingRequests);
  if (reqLimit !== null && rec.requestsResetAt && now >= rec.requestsResetAt) reqLeft = reqLimit;
  return { tokLimit, tokLeft, reqLimit, reqLeft };
};
const shortCount = (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(v));

export const describeLimits = (limits, now = Date.now()) => {
  if (!limits) return null;
  // Records saved before the split: one model, the old one-line format.
  // (Those came from gpt-oss-120b, the only model then - the judge.)
  const byModel = limits.byModel || (limits.timestamp ? { 'gpt-oss-120b': limits } : {});
  const tokParts = [];
  let tokLimitShown = null;
  let runsLeft = null;
  for (const [model, rec] of Object.entries(byModel)) {
    const st = limitState(rec, now);
    if (!st) continue;
    if (st.tokLeft !== null && st.tokLimit !== null) {
      tokParts.push((LIMIT_LABELS[model] || model) + ' ' + shortCount(st.tokLeft));
      tokLimitShown = st.tokLimit;
    }
    if (st.reqLeft !== null) runsLeft = runsLeft === null ? st.reqLeft : Math.min(runsLeft, st.reqLeft);
  }
  // Two short lines: the header slot between History and Settings is narrow.
  // The second line used to be "982 runs left today" - Groq's REQUEST count,
  // which never runs out first. The daily TOKEN count does (Oct 7), and Groq
  // never reports it, so it is our own tally of the last 24 hours.
  const lines = [];
  if (tokParts.length) lines.push(tokParts.join(' · ') + ' of ' + shortCount(tokLimitShown) + '/min');
  const usage = limits.usage || {};
  const dayParts = [];
  let dayLimit = DAILY_TOKEN_LIMIT;
  for (const model of Object.keys(LIMIT_LABELS)) {
    if (!usage[model]) continue;
    dayParts.push(LIMIT_LABELS[model] + ' ' + shortCount(usedToday(usage[model], now)));
    dayLimit = usage[model].limit || dayLimit;
  }
  if (dayParts.length) lines.push('Today: ' + dayParts.join(' · ') + ' of ' + shortCount(dayLimit));
  else if (runsLeft !== null) lines.push(runsLeft + ' runs left today');
  return lines.length ? lines.join('\n') : null;
};

// How long the bubble queue should pause before the next reel, from the
// budgets Groq reported, instead of a fixed 60 s. A run needs roughly this many
// tokens from each model within a minute (measured Oct 7: extraction 1-7k on
// qwen, verdict ~5-6k on gpt-oss-120b). If a model has that much left, or its
// minute has already reset, no wait for it. Capped at 60 s; with no numbers yet
// it does not wait - callGroq still waits out any rate limit it meets.
const RUN_NEEDS = { 'qwen3.8-27b': 4000, 'gpt-oss-120b': 6000 };
// The same reading for one model: how long until it has `need` tokens left in
// its current minute (0 if it already has, or nothing is known yet).
const modelWaitMs = (model, need, now = Date.now()) => {
  const key = shortModel(model);
  const rec = limitsByModel && limitsByModel[key];
  const st = limitState(rec, now);
  if (!st || st.tokLeft === null || st.tokLeft >= need) return 0;
  return rec.tokensResetAt && rec.tokensResetAt > now ? Math.min(rec.tokensResetAt - now + 1000, 61000) : 0;
};

export const nextRunWaitMs = (now = Date.now()) => {
  let wait = 0;
  for (const [model, need] of Object.entries(RUN_NEEDS)) {
    const rec = limitsByModel && limitsByModel[model];
    const st = limitState(rec, now);
    if (!st || st.tokLeft === null || st.tokLeft >= need) continue;
    if (rec.tokensResetAt && rec.tokensResetAt > now) wait = Math.max(wait, rec.tokensResetAt - now + 1000);
  }
  return Math.min(wait, 60000);
};

// The latest numbers per model, loaded once from storage and kept in memory.
let limitsByModel = null;
const recordLimits = async (headers, model) => {
  const h = headers || {};
  const get = (k) => h[k] !== undefined ? h[k] : (typeof h.get === 'function' ? h.get(k) : undefined);
  const limitRequests = get('x-ratelimit-limit-requests');
  const remainingRequests = get('x-ratelimit-remaining-requests') || get('x-ratelimit-remaining');
  if (remainingRequests === undefined || remainingRequests === null) return;
  const now = Date.now();
  const requestsResetMs = parseResetMs(get('x-ratelimit-reset-requests') || get('x-ratelimit-reset'));
  const tokensResetMs = parseResetMs(get('x-ratelimit-reset-tokens'));
  const rec = {
    remainingRequests,
    limitRequests: limitRequests || null,
    remainingTokens: get('x-ratelimit-remaining-tokens') || null,
    limitTokens: get('x-ratelimit-limit-tokens') || null,
    requestsResetAt: requestsResetMs !== null ? now + requestsResetMs : null,
    tokensResetAt: tokensResetMs !== null ? now + tokensResetMs : null,
    timestamp: now,
  };
  try {
    // Loads both halves of the saved record; saving only byModel here would
    // wipe the daily usage log kept alongside it.
    await loadUsage();
    limitsByModel[shortModel(model)] = rec;
    await saveUsage();
  } catch (e) {
    // The header line is a convenience; never let it break a call.
  }
};

// Extra instructions for one model on one job. When gpt-oss-120b stands in as
// the READER it ignored rules qwen follows (Oct 9, 10 saved reels): it listed
// background apps (TikTok, Render), the creator's handle, a watermark site
// (gittrend.io) and every model a tool merely supports, and it copied OCR typos
// ("ninimind", "enClaude") that qwen repaired. Same prompt, so the backup gets
// these spelled out instead of falling back less often (waiting adds a minute).
const MODEL_HINTS = {
  'extract:gpt-oss-120b': [
    'STRICT RULES FOR THIS ANSWER:',
    '- tools = ONLY what the post is about or tells the viewer to use. Not apps visible in the background, not the creator\'s own @handle or name, not a watermark or site name printed on every slide, not every model or service a tool merely supports.',
    '- OCR text has typos. Write each name the way the product spells it: if the slides say "ninimind" or "enClaude", the product is "MiniMind" or "OpenClaude". Use the clearest spelling the post itself shows.',
    '- When unsure whether something is a tool, leave it out.',
  ].join('\n'),
};
const withModelHints = (messages, job, model) => {
  const hint = MODEL_HINTS[job + ':' + shortModel(model)];
  if (!hint) return messages;
  return messages.map((m, i) => (i === messages.length - 1 && m.role === 'user' ? { ...m, content: m.content + '\n\n' + hint } : m));
};

// ---- Daily token tracker ----
//
// The free tier allows 200,000 tokens a day per model (measured Oct 7 from a
// refusal: "tokens per day (TPD): Limit 200000, Used 198300"), and Groq does
// NOT report the daily count in its headers - the limit was invisible until it
// failed three reels. So count it ourselves: every reply carries `usage`, and
// tokens served from Groq's prompt cache do not count. Kept per model over a
// rolling 24 hours (a refusal at 19:11 said "try again in 7m21s", so the
// window rolls rather than resetting at midnight), and re-anchored to Groq's
// own "Used" figure whenever a daily refusal states it.
const DAY_MS = 24 * 3600000;
export const DAILY_TOKEN_LIMIT = 200000;
let usageByModel = null;
let runTokens = {};

const loadUsage = async () => {
  if (usageByModel) return;
  try {
    const saved = await getApiLimits();
    usageByModel = (saved && saved.usage) || {};
    if (!limitsByModel) limitsByModel = (saved && saved.byModel) || {};
  } catch (e) {
    usageByModel = {};
    if (!limitsByModel) limitsByModel = {};
  }
};

const saveUsage = async () => {
  try {
    await saveApiLimits({ byModel: limitsByModel || {}, usage: usageByModel });
  } catch (e) {
    // a display aid; never break a call over it
  }
};

const recordUsage = async (model, usage, job) => {
  if (!usage) return;
  const cached = Number((usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0);
  const input = Number(usage.prompt_tokens || 0);
  const output = Number(usage.completion_tokens || 0);
  const counted = Math.max(0, input + output - cached);
  const key = shortModel(model);
  // This run's own tally, for the CSV.
  const r = runTokens[job] || (runTokens[job] = { model: key, input: 0, output: 0, cached: 0 });
  r.model = key;
  r.input += input;
  r.output += output;
  r.cached += cached;
  await loadUsage();
  const now = Date.now();
  const rec = usageByModel[key] || (usageByModel[key] = { log: [], limit: DAILY_TOKEN_LIMIT });
  rec.log = rec.log.filter(([t]) => now - t < DAY_MS);
  rec.log.push([now, counted]);
  await saveUsage();
};

// "tokens per day (TPD): Limit 200000, Used 198300" - Groq's own count.
const calibrateDaily = async (model, data) => {
  const msg = (data && data.error && data.error.message) || '';
  const m = msg.match(/tokens per day[^:]*:\s*Limit\s+(\d+),\s*Used\s+(\d+)/i);
  if (!m) return;
  await loadUsage();
  const key = shortModel(model);
  usageByModel[key] = { log: [[Date.now(), Number(m[2])]], limit: Number(m[1]) };
  await saveUsage();
};

// Tokens counted for one model in the last 24 hours (from a saved record).
const usedToday = (rec, now = Date.now()) =>
  rec && rec.log ? rec.log.filter(([t]) => now - t < DAY_MS).reduce((sum, [, n]) => sum + n, 0) : 0;

export const resetRunTokens = () => { runTokens = {}; };
// "extract=qwen3.8-27b in=5210 out=840 cached=0; verdict=gpt-oss-120b ...; total=13350"
const describeRunTokens = () => {
  const parts = Object.entries(runTokens).map(([job, r]) =>
    job + '=' + r.model + ' in=' + r.input + ' out=' + r.output + ' cached=' + r.cached);
  if (!parts.length) return '';
  const total = Object.values(runTokens).reduce((s, r) => s + r.input + r.output - r.cached, 0);
  return parts.join('; ') + '; total=' + total;
};

// One guarded call for every job. A reply only counts if it is usable: for
// JSON jobs it must parse (and pass `accept`, when given); for text it must be
// non-empty. Anything else - empty answer, cut-off answer, unparseable - moves
// on to the next model instead of failing the run.
//
// Rate limits: wait the time Groq states and retry the SAME model once (its
// minute has reset by then); if it is still limited, the next model has its own
// separate budget. "Request too large" is not waited on - it cannot succeed.
const callGroq = async (apiKey, messages, { job, json, accept, temperature }) => {
  let lastError;
  for (const model of MODEL_CHAINS[job]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await axios.post(
          GROQ_URL,
          {
            model,
            messages: withModelHints(messages, job, model),
            temperature,
            // gpt-oss reasons before it answers, and the reasoning shares the
            // output allowance. With the default allowance gpt-oss-20b spent
            // all of it reasoning and answered nothing; give room to finish.
            max_completion_tokens: 4096,
            // Same evidence, same verdict as far as the model allows: a fixed
            // seed makes sampling repeatable (Groq: best effort). Oct 8: the
            // unchanged judge gave FAKE then MISLEADING on identical evidence.
            seed: 7,
          },
          { timeout: 90000, headers: { Authorization: 'Bearer ' + apiKey } }
        );
        recordLimits(response.headers, model);
        // Before any check below: a reply we then reject still cost tokens.
        recordUsage(model, response.data.usage, job);
        const choice = (response.data.choices || [])[0] || {};
        const content = (choice.message && choice.message.content) || '';
        if (!content.trim()) {
          throw new Error(`Empty reply from ${model} (finish_reason=${choice.finish_reason || 'unknown'})`);
        }
        let value = content;
        if (json) {
          try {
            value = parseJsonLoose(content);
          } catch (parseError) {
            value = salvageJson(content);
            if (!value) throw parseError;
            console.warn(`${job}: repaired a broken JSON reply from ${model}`);
          }
        }
        if (json && accept && !accept(value)) {
          throw new Error(`Reply from ${model} is missing required fields`);
        }
        modelsUsed[job] = shortModel(model);
        if (model !== MODEL_CHAINS[job][0]) console.warn(`${job}: answered by fallback ${model}`);
        return value;
      } catch (error) {
        // A 429 carries the same headers, and it is the one response where the
        // numbers matter most.
        if (error.response) recordLimits(error.response.headers, model);
        if (error.response && error.response.data) calibrateDaily(model, error.response.data);
        if (error.response && error.response.data) {
          console.error(`API ${job} error from ${model}:`, JSON.stringify(error.response.data));
          lastError = new Error(`${error.message} - ${JSON.stringify(error.response.data)}`);
        } else {
          console.warn(`${job}: ${model} unusable - ${error.message}`);
          lastError = error;
        }
        const waitMs = attempt === 0 ? rateLimitWaitMs(error) : 0;
        if (waitMs > 0) {
          console.warn(`Rate limited on ${model}; waiting ${waitMs}ms then retrying.`);
          // Show the wait on Home's progress strip, then put back what it said.
          const before = (getJobState().running || {}).note || null;
          setJobNote("Waiting for Groq's free per-minute limit", Date.now() + waitMs);
          await sleep(waitMs);
          setJobNote(before);
          continue;
        }
        break; // not a rate limit, or still limited after waiting: next model
      }
    }
  }
  throw lastError || new Error('All models failed.');
};

// Mirrors verify.extract_claims_and_queries in the Python pipeline. The short
// version of this prompt missed listicle carousels and never asked for repo
// slugs, which is where most of the checkable evidence actually lives.
// ---- Long posts: stay under Groq's per-request limit without cutting text ----

// Rough token count. Measured on recorded prompts: ~3.6 characters per token.
const approxTokens = (s) => Math.ceil(String(s || '').length / 3.6);
// A whole step-1 request (instructions + post text). Under the free tier's
// 8,000 tokens per minute with room for the answer (~1-2.5k tokens).
const EXTRACT_PROMPT_BUDGET = 5500;

// The same piece of text on every slide - creator handle, series header, page
// footer - is kept once. Short fragments (numbers, "1/20") are always kept:
// they carry list positions.
export const dropRepeatedText = (ocr) => {
  const seen = new Set();
  return String(ocr || '').split('\n').map((line) =>
    line.split(/\s*\|\s*/).filter((seg) => {
      const k = seg.trim().toLowerCase();
      if (!k) return false;
      if (k.length < 4) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).join(' | ')
  ).filter((l) => l.trim()).join('\n');
};

// Split on-screen text into parts whose full prompt fits the budget. Slides
// (lines) are packed in order until the next would not fit; a single slide too
// big on its own is split at its " | " fragments, then by length.
export const splitForBudget = (ocr, promptTokensFor) => {
  if (promptTokensFor(ocr) <= EXTRACT_PROMPT_BUDGET) return [ocr];
  const roomChars = Math.max(2000, (EXTRACT_PROMPT_BUDGET - promptTokensFor('')) * 3.6);
  const units = [];
  for (const line of String(ocr || '').split('\n')) {
    if (line.length <= roomChars) { units.push(line); continue; }
    let buf = '';
    for (const seg of line.split(/\s*\|\s*/)) {
      for (let i = 0; i < seg.length; i += roomChars) {
        const piece = seg.slice(i, i + roomChars);
        if (buf && buf.length + piece.length + 3 > roomChars) { units.push(buf); buf = ''; }
        buf = buf ? buf + ' | ' + piece : piece;
      }
    }
    if (buf) units.push(buf);
  }
  const parts = [];
  let cur = '';
  for (const u of units) {
    if (cur && cur.length + u.length + 1 > roomChars) { parts.push(cur); cur = ''; }
    cur = cur ? cur + '\n' + u : u;
  }
  if (cur) parts.push(cur);
  return parts;
};

// One extraction from several parts: items in post order without repeats,
// every claim, and searches taken in turn from each part so no part is starved.
export const mergeExtractions = (results) => {
  const strip = (n) => String(n || '').replace(/^\s*\d{1,3}\s*[.):-]\s*/, '').trim();
  const tools = [];
  const toolKeys = new Set();
  const claims = [];
  const claimKeys = new Set();
  for (const r of results) {
    for (const t of (r && r.tools) || []) {
      const k = String(strip(t && t.name)).toLowerCase().replace(/[\s_.-]+/g, '');
      if (!k || toolKeys.has(k)) continue;
      toolKeys.add(k);
      tools.push(t);
    }
    for (const c of (r && r.claimed_features) || []) {
      const k = String(c).toLowerCase().trim();
      if (!k || claimKeys.has(k)) continue;
      claimKeys.add(k);
      claims.push(c);
    }
  }
  const queries = [];
  const lists = results.map((r) => ((r && r.search_queries) || []).slice());
  for (let round = 0; queries.length < 10 && lists.some((l) => l.length > round); round++) {
    for (const l of lists) {
      if (queries.length >= 10) break;
      if (l[round] && !queries.includes(l[round])) queries.push(l[round]);
    }
  }
  const first = results.find((r) => r && r.tech_name) || {};
  return {
    tech_name: first.tech_name || null,
    is_multi_tool: true,
    tools,
    claimed_features: claims,
    search_queries: queries,
  };
};

const extractClaims = async (apiKey, transcript, ocrText) => {
  // Text repeated on every slide (handle, header, footer) is kept once - free
  // shrinking before any splitting is considered.
  const cleanOcr = dropRepeatedText(ocrText);
  const buildPrompt = (ocrPart, part) => [
    'Analyze this content from a tech video/Instagram reel/carousel post.',
    'You are given both the Audio Transcript (or post caption) and all On-Screen Text detected from the video frames/slides.',
    ...(part.count > 1 ? ['',
      'NOTE: the post is long, so its on-screen text is sent in ' + part.count + ' parts. This is part ' + (part.index + 1) +
      ' of ' + part.count + '. Extract what appears in THIS part; the parts are merged afterwards.'] : []),
    '',
    'Audio Transcript / Caption:',
    part.index === 0 ? transcript : '(given with part 1)',
    '',
    'On-Screen Text / Visuals Detected from Frames/Slides:',
    ocrPart,
    '',
    'Task:',
    '1. Determine if this post is about a SINGLE tool/technique or MULTIPLE items (e.g. "5 LLM Libraries", "4 Side Hustle Websites").',
    '2. Extract all distinct tools/libraries/websites/platforms mentioned or shown on screen. Look specifically for GitHub repo names, domain URLs, and platform names.',
    '3. Generate precise DuckDuckGo search queries. For developer tools, query "owner/repo github". For money-making, freelancing, or software sites, you MUST include terms like "reviews", "scam", or "reddit" (e.g. "Alignerr.com reviews scam reddit") to find truth.',
    '4. Audio transcription often misspells names (e.g. hearing "Zev" when the screen says "Zed"). ALWAYS trust the exact spelling shown in the On-Screen Text over the audio.',
    '5. Every number the post states is its OWN claim in claimed_features, kept with its exact figure and what it applies to - pay rates ("$5 to $20 per music review on Music Xray"), prices, speeds, sizes, counts, percentages. Never merge several figures into one line: each one is checked separately.',
    '6. Only list tools the post is ABOUT or tells the viewer to use. Ignore apps that merely appear in the background (dock, menu bar, editor sidebars, recent-folder lists) and garbled OCR fragments that are not real names.',
    '7. If the post is a numbered list ("22 NLP techniques", "Top 10 repos"), return EVERY numbered item in tools - techniques and concepts included, not only installable tools - in the post\'s order, with its number in the name ("1. Text Normalisation"). Do not stop early.',
    '8. Keep the answer compact: leave out any field you would set to null, and keep each tool\'s "claim" to one short sentence (under 15 words). Long lists must still be complete.',
    '',
    'Respond ONLY with valid JSON in this exact structure:',
    '{"tech_name":"Primary title or main tool/website name","is_multi_tool":true,"tools":[{"name":"Tool or Website Name","github_repo":"owner/repo or null","domain_url":"domain.com or null","pip_command":"pip install ... or null","claim":"Core feature or claim stated"}],"claimed_features":["claim 1","claim 2"],"search_queries":["query 1","query 2"]}',
  ].join('\n');

  // Groq's free tier refuses any SINGLE request over 8,000 tokens per minute
  // (Oct 7: a 20-slide carousel asked for 10,773 and both models refused it).
  // Split by MEASURED size - a text-heavy post may split after slide 4, a light
  // one not at all - and merge the parts. Nothing is cut.
  const parts = splitForBudget(cleanOcr, (ocr) => approxTokens(buildPrompt(ocr, { index: 0, count: 2 })));
  if (parts.length > 1) console.warn('Step 1: post sent in ' + parts.length + ' parts to stay under the per-request limit.');
  const results = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts.length > 1) {
      setJobNote('Long post: reading part ' + (i + 1) + ' of ' + parts.length);
      // Pace the parts: if the reader model's minute is spent, wait for it
      // rather than fire the next part into a refusal (Oct 7: four parts back
      // to back hit the per-minute output limit and the run failed).
      const waitMs = i > 0 ? modelWaitMs(MODEL_CHAINS.extract[0], approxTokens(buildPrompt(parts[i], { index: i, count: parts.length })) + 1500) : 0;
      if (waitMs > 0) {
        setJobNote('Long post: waiting for Groq\'s free limit before part ' + (i + 1) + ' of ' + parts.length, Date.now() + waitMs);
        await sleep(waitMs);
        setJobNote('Long post: reading part ' + (i + 1) + ' of ' + parts.length);
      }
    }
    results.push(await callGroq(apiKey, [
      { role: 'system', content: 'You are an expert technical entity and claim extraction system. Output strictly valid JSON.' },
      { role: 'user', content: buildPrompt(parts[i], { index: i, count: parts.length }) },
    ], { job: 'extract', json: true, temperature: 0, accept: (d) => d && (Array.isArray(d.tools) || typeof d.tech_name === 'string') }));
  }
  if (parts.length > 1) setJobNote(null);
  const data = results.length === 1 ? results[0] : mergeExtractions(results);

  // Rule 7 asks for list items as "12. Word2Vec" so none is skipped; drop the
  // number again (order is kept) or the name never matches an evidence page.
  data.tools = (Array.isArray(data.tools) ? data.tools : []).map((t) =>
    t && typeof t.name === 'string' ? { ...t, name: t.name.replace(/^\s*\d{1,3}\s*[.):-]\s*/, '').trim() } : t
  );

  // Folder names on the creator's own computer are not tools. The PixelFriend
  // demo (Oct 6) had VS Code's Welcome page behind it, whose "Recent" list
  // reads "ScreenAlly ~/Projects | sipsip ~/Projects | finance-agent ...".
  // Stage 1 listed all five as tools and spent 7 of 10 searches on them, so
  // little evidence about the actual subject came back. A name the caption or
  // speech uses is kept even if it is also a folder.
  const folders = localFolderNames(ocrText);
  if (folders.size) {
    const said = flatKey(transcript);
    const isFolder = (name) => {
      const k = flatKey(name);
      return k.length >= 3 && folders.has(k) && !said.includes(k);
    };
    const dropped = (data.tools || []).filter((t) => isFolder(t.name)).map((t) => t.name);
    if (dropped.length) {
      data.tools = data.tools.filter((t) => !isFolder(t.name));
      data.search_queries = (data.search_queries || []).filter(
        (q) => !dropped.some((n) => flatKey(q).includes(flatKey(n)))
      );
      console.warn('Dropped local folder names listed as tools: ' + dropped.join(', '));
    }
  }

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

  // Other slug-shaped text on screen is weaker: file paths and "A/B" pairs read
  // exactly like owner/repo. On the AutoShorts reel, "M1/M2", "Users/nacbook",
  // "Applications/AutoShorts.app" and "Debian/Ubuntu" were put FIRST, pushed the
  // model's own searches past the 10-query cut, and the report then said no
  // repo existed. Drop the path-shaped ones, and queue the rest AFTER the
  // model's queries instead of before them.
  const looksLikePath = (slug) => {
    const [owner, repo] = slug.split('/');
    if (OS_PATH_PARTS.has(owner.toLowerCase())) return true;                   // Users/..., Applications/...
    if (/\.(app|dmg|exe|msi|zip|mp4|mov|png|jpe?g|gif|txt|md|json|ya?ml|pdf|csv|sh)$/i.test(repo)) return true;
    if (owner.length <= 3 && repo.length <= 3) return true;                    // M1/M2, A/B
    return false;
  };
  const slugPattern = /\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\b/g;
  let match = slugPattern.exec(ocrText || '');
  while (match !== null) {
    const slug = match[1];
    if (!slug.startsWith('http') && isUsableSlug(slug) && !looksLikePath(slug)) {
      if (!queries.includes(slug + ' github')) queries.push(slug + ' github');
    }
    match = slugPattern.exec(ocrText || '');
  }
  // A repo the post PRINTS as a github.com URL goes first. The pattern above
  // stops at "github.com/jaywebtech" and never produced "jaywebtech/autoshorts",
  // so the one repo the creator pointed at was never searched for directly.
  for (const slug of printedGithubSlugs(ocrText).reverse()) {
    const q = slug + ' github';
    const at = queries.indexOf(q);
    if (at !== -1) queries.splice(at, 1);
    queries.unshift(q);
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
    // A product name OCR mangled is still worth searching, because a search
    // engine corrects spelling and hands back the canonical name in its result
    // titles. The KAT-Coder reel read as "AT-Coder-V2.5" - the K clipped off a
    // press-release screenshot - so the real model was never searched, never
    // entered the evidence, and the report ended up fact-checking the three
    // libraries visible in a code screenshot instead.
    //
    // Narrow on purpose: only names the post actually shows, long enough not to
    // be a word, and version-shaped. Querying bare invented names is what once
    // pulled real pages about an unrelated "Hidden Markov Model framework".
    const name = String(tool.name || '');
    const productShaped = name.length >= 6 && /[-_.]|\d/.test(name) && !/\s/.test(name);
    if (productShaped && String(ocrText || '').toLowerCase().includes(name.toLowerCase())) {
      if (!queries.includes(name)) queries.push(name);
    }
  });
  data.search_queries = queries.slice(0, 10);
  return data;
};

// Path segments that make "x/y" a file path, not a GitHub owner/repo.
const OS_PATH_PARTS = new Set([
  'users', 'user', 'home', 'applications', 'documents', 'downloads', 'desktop',
  'library', 'usr', 'opt', 'var', 'tmp', 'etc', 'bin', 'volumes', 'system',
  'program files', 'appdata', 'clips', 'shorts', 'videos', 'pictures', 'music',
]);

// ---- Money / side-hustle posts --------------------------------------------
//
// The pipeline was built for developer tools: does the repo / package exist?
// An earnings post ("These websites print money: Music Xray $5-20 per review,
// GoTranscript paid per minute ...") is a different question. The sites almost
// always exist; what needs checking is whether they pay what the post says.
// On the first such runs the GitHub/Hacker News checks filled 4 of the 12
// evidence seats, a stranger's GitHub repo titled the report, and the reviews
// that answer the question reached the model as titles with no text.

// Earning language only. Currency alone is not enough: "$20/month" is a price,
// and an AI-tool pricing post must stay a tech post.
const MONEY_HINT = /\b(?:earn|earns|earning|(?:passive|extra|side|monthly|daily|online|second|additional) income|get paid|getting paid|paid per|pays? (?:you|up to|around)|(?:will|that|which) pay(?: you)?|side ?hustles?|make money|making money|prints? money|passive income|payouts?|work from home|cash ?out|withdraw(?:al)?)\b/i;
// A pay RATE: a currency amount per unit of work ("$5 to $20 per review").
// "Cost per task" on an AI pricing slide has no amount next to it and stays a
// tech post; so does an app that "earned $1M" (past tense, a startup story).
// No "per month": that is how prices are written ("Rs 59 per month", "$0 /
// month"), and both made tech posts look like side hustles (Oct 7).
const PAY_RATE = /(?:\$|₹|rs\.?\s?|inr\s?)\d[\d,.]*k?\s*(?:(?:to|-)\s*(?:\$|₹|rs\.?\s?)?\d[\d,.]*k?\s*)?(?:per|\/|an?|each)\s*(?:review|survey|task|hour|hr|day|minute|min|video|episode|article|song|word)\b/i;

// A money post: earning language, and nothing anchored to code (no repo, no
// install command) - "earn with this Python bot" is still a tech post.
//
// The earning language must come from the POST ITSELF - its caption, its
// title, what the creator says - or appear more than once on the slides. On
// Oct 7 three tech posts were checked as side hustles over one line of slide
// text: an Airtel price hike ("Rs 59 per month"), an AI tool's pricing card
// ("$0 / month") and one tool's own "Start Earning" button in a list of seven.
export const moneyPost = (claimsData, text, headline = text) => {
  const tools = (claimsData && claimsData.tools) || [];
  const codeAnchored = tools.some((t) => (t.github_repo && t.github_repo !== 'null') || t.pip_command) ||
    printedGithubSlugs(text).length > 0 ||
    /\b(?:pip3?|npm|brew|cargo)\s+install\b|\bnpm i\b/i.test(text);
  if (codeAnchored) return false;
  const said = [headline, (claimsData && claimsData.tech_name) || ''].join(' ');
  if (MONEY_HINT.test(said) || PAY_RATE.test(said)) return true;
  // The post's own text only: the model's claims restate the same slide, so
  // one "Start Earning" button counted twice (Oct 7, Glambase).
  const body = String(text || '');
  const flags = MONEY_HINT.flags.includes('g') ? MONEY_HINT.flags : MONEY_HINT.flags + 'g';
  const hits = (body.match(new RegExp(MONEY_HINT.source, flags)) || []).length +
    (body.match(new RegExp(PAY_RATE.source, flags)) || []).length;
  return hits >= 2;
};

// The platforms the post names, in the order it names them.
const moneyPlatforms = (claimsData) => {
  const out = [];
  for (const t of (claimsData && claimsData.tools) || []) {
    const n = String(t.name || '').trim();
    if (n.length >= 2 && !out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  return out.slice(0, 5);
};

// Searches about the CLAIM, spread so every platform gets some: one query per
// platform first, then a second round, and so on. The first run searched only
// "<site> reviews scam reddit", and the last two platforms got no evidence at all.
const moneyQueries = (platforms, claimsData, text) => {
  const india = /\bindia\b|₹|\brupees?\b|\binr\b|\blakhs?\b/i.test(text);
  const perPlatform = platforms.map((p) => [
    p + ' reviews trustpilot',
    p + ' how much can you really earn reddit',
    p + ' payment proof withdrawal problems',
    p + ' scam or legit',
    ...(india ? [p + ' India payout'] : []),
  ]);
  const out = [];
  for (let round = 0; out.length < 10 && round < 5; round++) {
    for (const qs of perPlatform) {
      if (out.length >= 10) break;
      if (qs[round] && !out.includes(qs[round])) out.push(qs[round]);
    }
  }
  // No named platform ("make $100 a day with ChatGPT"): search the claims.
  for (const c of (claimsData && claimsData.claimed_features) || []) {
    if (out.length >= 10) break;
    const q = String(c).slice(0, 90) + ' reddit real experience';
    if (!out.includes(q)) out.push(q);
  }
  for (const q of (claimsData && claimsData.search_queries) || []) {
    if (out.length >= 10) break;
    if (!out.includes(q)) out.push(q);
  }
  return out;
};

// The 12 rows the model reads for a money post: no code registries, the
// Trustpilot readings and "what people say" rows first, and every platform
// gets up to 3 seats before any platform gets a fourth.
const CODE_REGISTRY = /github\.com|hn\.algolia\.com|news\.ycombinator\.com|pypi\.org|npmjs\.com|huggingface\.co/i;
const rankMoneyEvidence = (evidence, platforms) => {
  // A platform's Trustpilot page arrives twice: once as the row the Trustpilot
  // check READ, once as the bare search result with no text. Keep the read one
  // - the duplicates took 4 of the 12 seats on the first money-mode run.
  const pageKey = (u) => String(u || '').toLowerCase().split(/[?#]/)[0].replace(/\/+$/, '');
  const readPages = new Set((evidence || [])
    .filter((r) => /^Trustpilot - /.test(String(r.title || '')))
    .map((r) => pageKey(r.url)));
  const rows = (evidence || []).filter((r) =>
    !CODE_REGISTRY.test(String(r.url || '')) &&
    (/^Trustpilot - /.test(String(r.title || '')) || !readPages.has(pageKey(r.url))));
  const score = (r) =>
    (/^(Trustpilot - |What people say about)/.test(String(r.title || '')) ? 30 : 0) +
    ((r.pagePreview || '').length > 0 ? 10 : 0) +
    ((r.snippet || '').length > 0 ? 2 : 0);
  const sorted = rows.map((r, i) => ({ r, i, s: score(r) })).sort((a, b) => (b.s - a.s) || (a.i - b.i));
  const keyOf = (r) => {
    const raw = (String(r.title || '') + ' ' + String(r.url || '')).toLowerCase();
    const hay = flatKey(raw);
    // Short names ("Rev") must match as a word, or every "reviews" row is Rev's.
    const p = platforms.find((x) => {
      const k = flatKey(x);
      if (k.length < 3) return false;
      return k.length < 5 ? new RegExp('(^|[^a-z0-9])' + escapeForRegex(k) + '([^a-z0-9]|$)').test(raw) : hay.includes(k);
    });
    return p ? p.toLowerCase() : '_other';
  };
  const kept = [];
  const perPlatform = {};
  for (const cap of [1, 2, 3]) {
    for (const x of sorted) {
      if (kept.length >= MAX_EVIDENCE_ROWS) break;
      if (kept.includes(x.r)) continue;
      const k = keyOf(x.r);
      if (k !== '_other' && (perPlatform[k] || 0) >= cap) continue;
      if (k === '_other' && cap < 3) continue;
      perPlatform[k] = (perPlatform[k] || 0) + 1;
      kept.push(x.r);
    }
  }
  for (const x of sorted) {
    if (kept.length >= MAX_EVIDENCE_ROWS) break;
    if (!kept.includes(x.r)) kept.push(x.r);
  }
  return kept;
};

// "Side hustles: Music Xray, GoTranscript, Upwork +1" rather than "Unidentified"
// or a random repo name.
const moneyTitle = (platforms, modelName, author) => {
  if (platforms.length >= 2) {
    const shown = platforms.slice(0, 3).join(', ');
    return 'Side hustles: ' + shown + (platforms.length > 3 ? ' +' + (platforms.length - 3) : '');
  }
  if (platforms.length === 1) return platforms[0];
  const handle = flatKey(author);
  const name = String(modelName || '').trim();
  if (name && !(handle && flatKey(name).includes(handle))) return name;
  return 'Earning claim';
};

// ---- List posts ("22 NLP techniques", "top 5 recruiters") ------------------
//
// The subject picker abstains on these by design - a headline is not a product
// - and the report was then titled "Unidentified" with -25 confidence for
// "subject not confirmed", on posts that never had a single subject.

const LIST_NAME = /^\s*(?:top\s*)?\d+\s+\S|\btop\s+\d+\b|\b\d+\s+(?:tools|websites|sites|apps|techniques|ways|courses|repos|repositories|platforms|jobs|tips|libraries|projects|ideas|recruiters|companies|skills)\b/i;
const isListPost = (modelName, tools) =>
  ((tools || []).length >= 3) || LIST_NAME.test(String(modelName || ''));

// The model's own name for the post, unless it is the creator's handle (the
// picker rejects handles on purpose - the app once published one as the
// product); otherwise the first tools it found.
const listTitle = (modelName, tools, author) => {
  const name = String(modelName || '').trim();
  const handle = flatKey(author);
  if (name && !(handle && handle.length >= 3 && flatKey(name).includes(handle))) return name;
  const names = (tools || []).map((t) => String(t.name || '').trim()).filter(Boolean);
  if (names.length >= 2) return names.slice(0, 3).join(', ') + (names.length > 3 ? ' +' + (names.length - 3) : '');
  return names[0] || null;
};

// "busybee_website" and "busybee website" are the same name.
const flatKey = (s) => String(s || '').toLowerCase().replace(/[\s_.\-]+/g, '');

// Names OCR read as "<name> ~/Projects", "<name> /Projects", "<name> -/Projects"
// or "<name> ~/.gemini/antigravity/scratch" - an IDE's recent-folders list.
// OCR drops or mangles the "~", so the path word or a slash path is the tell.
// The whole line must be exactly "<name> <home folder>" - a looser version
// (any "name some/path") flagged real subjects like graphify and claude.
const LOCAL_FOLDER_LINE = /^([A-Za-z][\w.-]{2,}(?: [A-Za-z][\w.-]+)?)\s*(?:~|-)?\/?(?:Projects|Documents|Desktop|Downloads|Developer|repos|workspace)\/?$/i;
const localFolderNames = (ocrText) => {
  const out = new Set();
  for (const line of String(ocrText || '').split(/\s*\|\s*|\n/)) {
    const m = line.trim().match(LOCAL_FOLDER_LINE);
    if (m) out.add(flatKey(m[1]));
  }
  // One "Claude Projects" line is a product feature, not a folder list. A
  // recent-folders list always has several entries.
  return out.size >= 2 ? out : new Set();
};

// Repos the post prints as a github.com URL, as owner/repo. OCR splits URLs
// ("github. com/", "github.c om/"), so the separators are whitespace-tolerant.
const printedGithubSlugs = (ocrText) => {
  const out = [];
  const re = /github\s*\.\s*c\s*o\s*m\s*\/\s*([\w.-]+)\s*\/\s*([\w.-]+)/gi;
  for (const m of String(ocrText || '').matchAll(re)) {
    const slug = m[1] + '/' + m[2].replace(/\.git$/i, '').replace(/\.+$/, '');
    if (!GITHUB_RESERVED_PATHS.has(m[1].toLowerCase()) && !out.some((s) => s.toLowerCase() === slug.toLowerCase())) {
      out.push(slug);
    }
  }
  return out;
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
// `pinned` - repo slugs that must reach the model: the subject the picker chose
// and any repo the post prints. The AutoShorts reel fetched JayWebtech/autoshorts
// on all five runs, but on three of them rows about Homebrew, Winget, FFmpeg,
// Rust and React filled the 12 seats first; the model then wrote "no public
// repository was found" and the verdict went MISLEADING. Same post, same input,
// TRUE / PARTIALLY_TRUE / MISLEADING depending on the order of the searches.
const rankEvidence = (evidence, techName, tools, pinned = []) => {
  const pins = pinned.map((s) => 'github.com/' + String(s).toLowerCase());
  const isPinned = (item) => {
    const url = String(item.url || '').toLowerCase();
    return pins.some((p) => url.includes(p + '/') || url.endsWith(p) || url.includes(p + '?') || url.includes(p + '#'));
  };
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

  // Rows about the SUBJECT outrank rows about side tools. The pin above only
  // covers a subject that is a GitHub repo; Jev (Oct 2) was a name from the
  // caption, so all 12 seats went to Claude Code / Codex / TypeSafe pages, the
  // model read nothing about Jev, called it "fabricated" and the verdict went
  // MISLEADING -> FAKE between two runs. Matched at a word start, so a short
  // name like "jev" does not hit the middle of unrelated words.
  const subjectNeedles = [...new Set([
    String(techName || '').toLowerCase().trim(),
    String(techName || '').toLowerCase().replace(/[\s_.-]+/g, ''),
    String(techName || '').toLowerCase().replace(/\s+/g, '-'),
  ])].filter((n) => n.length >= 3);
  const aboutSubject = (hay) =>
    subjectNeedles.some((n) => new RegExp('(?:^|[^a-z0-9])' + escapeForRegex(n)).test(hay));

  const score = (item) => {
    const hay = `${item.url || ''} ${item.title || ''}`.toLowerCase();
    let s = isPinned(item) ? 100 : 0;
    if (aboutSubject(hay)) s += 40;
    const onTopic = uniq.some((n) => hay.includes(n));
    if (onTopic) s += 10;
    // A bare domain root is usually a landing page rather than evidence - but
    // not when the domain IS the subject, e.g. nanobot.wiki.
    if (!onTopic && /^https?:\/\/[^/]+\/?$/.test(item.url || '')) s -= 8;
    if ((item.pagePreview || '').length > 0) s += 3;
    return s;
  };

  // Subject rows lead, but leave at least 4 seats for everything else: the
  // report still has to check the side tools the post names.
  const MAX_SUBJECT_ROWS = MAX_EVIDENCE_ROWS - 4;
  const ranked = [...(evidence || [])]
    .map((item, i) => ({ item, i, s: score(item) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i));
  const kept = [];
  let subjectRows = 0;
  for (const x of ranked) {
    if (kept.length >= MAX_EVIDENCE_ROWS) break;
    const isSubject = x.s >= 40 && !isPinned(x.item);
    if (isSubject && subjectRows >= MAX_SUBJECT_ROWS) continue;
    if (isSubject) subjectRows += 1;
    kept.push(x.item);
  }
  // Seats the cap left empty go back to subject rows rather than staying unused.
  for (const x of ranked) {
    if (kept.length >= MAX_EVIDENCE_ROWS) break;
    if (!kept.includes(x.item)) kept.push(x.item);
  }
  return kept;
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

const synthesizeFactCheck = (apiKey, transcript, ocrText, claimsData, evidence, coverage, keptRows, post = {}) => {
  const kept = keptRows || rankEvidence(evidence, claimsData && claimsData.tech_name, claimsData && claimsData.tools);
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
    ...(post.money ? ['',
      'THIS IS A MONEY / SIDE-HUSTLE POST about: ' + ((post.platforms || []).join(', ') || 'an earning method') + '.',
      'The question is NOT whether the websites exist - it is whether the EARNING CLAIMS hold. For each platform, use the user reviews, Trustpilot scores and real-experience reports in the evidence: what people actually earn, whether it pays out, fees, payout minimums, tests to pass, country restrictions.',
      'For this post these verdict rules replace the tool rules below. Go down the list; the FIRST rule that matches is the verdict:',
      '1. FAKE: the evidence shows a named platform has shut down, or is widely reported as not paying / a scam.',
      '2. MISLEADING: the pay users typically report is BELOW the lowest figure the post claims (claim "$5-$20 per review", users report cents), OR the platform does not pay for that work at all, OR a major catch is hidden (fees to join, payout threshold most never reach, not open in the country the post targets).',
      '3. HYPE: the per-task pay users report is within the claimed range, but the post sells it as easy, passive or life-changing money ("prints money", "quit your job").',
      '4. PARTIALLY_TRUE: users report pay INSIDE the claimed range but at its low end, or work is scarce, tests are required, or only some of the listed platforms hold up.',
      '5. TRUE: the platforms are operating and users report pay matching the claim.',
      'Judge by the TYPICAL user report, not the best or worst single review. If the evidence has no pay figures at all for a platform, do not guess: say so, and decide from the platforms that do have them.',
      'List each platform in tools (status "verified" only if the evidence shows it operating today). Gotchas must be about money: real pay rates, fees, payout minimums, country limits, tests. Never cite a GitHub repository for a money post.'] : []),
    '',
    'Web Evidence Gathered:', evidenceText,
    '',
    'Evaluation Principles:',
    '- If MULTI-TOOL list (e.g. 5 tools): check each tool against evidence. If real GitHub repositories / pip packages exist, the verdict should reflect their collective authenticity. In the summary, give a concise bulleted breakdown for EVERY tool with its repo, practical utility, and caveats.',
    '- If SINGLE-TOOL: evaluate the single tool deeply.',
    '- Practical Utility First: if a shorthand trick or prompt (e.g. "/eli5") actually produces the claimed result in practice because the AI understands the intent, mark it TRUE or PARTIALLY_TRUE and explain prompt semantics vs native command.',
    '- Same-name projects: a repository or package with the same name but owned by an account other than the post author (' + (post.author ? '@' + post.author : 'unknown') + ') is SOMEONE ELSE\'S project unless the post prints its URL or names that account. Never present it as the post\'s repo or use it to call the post TRUE. A name collision makes the post MISLEADING or FAKE only when the post claims you can download, install or buy the tool and the only thing with that name is unrelated.',
    '- Personal project demo: if the post shows the creator\'s OWN project working on screen and makes no checkable claim (no link, install command, price, benchmark number or availability promise), the verdict is TRUE. Say it is a personal project with no public repo or download found, and add the gotcha "Personal project - no public download found". Do not mark it MISLEADING or PARTIALLY_TRUE only because no repo exists.',
    '- Background apps are not tools: apps that only appear in the dock, menu bar, browser tabs or the editor window behind the demo are not part of the claim. Do not list them as tools or write gotchas about them.',
    // Ordered, first match wins. The old five overlapping descriptions let the
    // same evidence land on neighbouring verdicts from run to run (Oct 8: Fake
    // vs Misleading, True vs Misleading, Misleading vs Partly true on three
    // reels). Each border below is the one that flipped.
    'Verdict: go down this list; the FIRST rule that matches is the verdict.',
    '1. FAKE: there is POSITIVE evidence against the post: the tool/offer is reported as a scam, has shut down, the link or repo the post itself prints is dead, or the only thing with that name is an unrelated project the post claims you can download. "Found nothing" is NOT fake - see rule 2.',
    '2. MISLEADING: any of: the main tool/offer could not be found anywhere in the evidence (say "could not be verified") - EXCEPT a personal project demo, which follows the Personal project rule above; the offer exists but only for a restricted group (eligible startups, students, one country, new accounts, a waitlist) while the post presents it as open to anyone; a severe catch the post hides (it is paid when the post says free, a hard usage cap, a required paid plan); the post misdescribes what the tool does.',
    '3. HYPE: the tools exist and do roughly what is shown, but the post wildly overstates the result ("replaces your whole team", "100x faster", "zero effort", "never pay again").',
    '4. PARTIALLY_TRUE: the tools exist and work as shown, with minor caveats the post leaves out (early alpha, needs an API key, setup required, some listed items not found, small usage limits).',
    '5. TRUE: the tools exist, are accessible as described, and do what the post shows.',
    'For a list post, judge the list as a whole: one unfindable item out of many is a PARTIALLY_TRUE caveat, not MISLEADING for the whole post.',
    '',
    'Return FIELDS ONLY. Do not write markdown, headings, bullet characters, tables or emoji inside any value.',
    'BE BRIEF. This is a card the reader scans in five seconds, not an article; they ask follow-up questions in chat afterwards.',
    '- factual_reality: AT MOST 2 sentences, under 220 characters total. Say what the tool/platform is and whether the claim holds. No preamble.',
    '- claims: at most 4 items, each one short sentence under 100 characters.',
    '- gotchas: at most 4 items, each one short sentence under 100 characters. Only real blockers, not generic advice.',
    '- tools[].what_it_does: ONE short sentence, under 90 characters.',
    '- tools: ONLY software, platforms, or websites the post tells the viewer to use. Do NOT list generic concepts or section headings as tools.',
    'Ground every tool/platform entry in the evidence above. Set "status" to "verified" if the evidence confirms the GitHub repo OR the official website/platform exists. Set to "not_found" if neither can be found. Never invent a repo, install command, URL, price or hardware requirement.',
    'Prefer the canonical repository over a fork or mirror. If a repo looks like a fork of a more popular project, name the original.',
    '',
    'Return ONLY JSON:',
    '{"tech_name":"string","verdict":"TRUE","pricing_model":"Open Source or Commercial","github_url":"https://github.com/... or null","factual_reality":"2-4 sentence explanation","claims":["one plain sentence per claim"],"tools":[{"name":"Tool or Website Name","repo":"owner/repo or null","website":"domain.com or null","install":"pip install x or null","what_it_does":"one plain sentence","caveat":"one plain sentence or null","status":"verified"}],"gotchas":["one plain sentence per caveat"]}',
  ].join('\n');
  return callGroq(apiKey, [
    { role: 'system', content: 'You are a precise, objective AI technical fact checker. Output strictly valid JSON.' },
    { role: 'user', content: prompt },
  ], { job: 'verdict', json: true, temperature: 0, accept: (d) => d && typeof d.verdict === 'string' && d.verdict.trim().length > 0 });
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
// Every GitHub repository whose page was actually fetched, as owner/name.
// Host exactly github.com, so docs.github.com/en/packages is not a repo.
const fetchedRepoSlugs = (rows) => {
  const out = [];
  for (const r of rows || []) {
    // Any page under the repo counts: /releases proves the repo as well as / does.
    const m = String(r.url || '').match(/(?:^|\/\/)(?:www\.)?github\.com\/([\w.-]+)\/([\w-]+(?:\.[\w-]+)*?)(?:\.git)?(?:[/#?]|$)/i);
    if (!m || GITHUB_RESERVED_PATHS.has(m[1].toLowerCase())) continue;
    const slug = m[1] + '/' + m[2];
    if (!out.some((s) => s.toLowerCase() === slug.toLowerCase())) out.push(slug);
  }
  return out;
};
const repoKey = (slug) => String(slug || '').toLowerCase().replace(/[-_.]/g, '');

const applyEvidenceRules = (report, evidence, techName, opts = {}) => {
  const notes = [];
  const rows = evidence || [];
  const hay = (r) => `${r.title || ''} ${r.snippet || ''} ${r.pagePreview || ''}`;
  const findRow = (re) => rows.find((r) => re.test(hay(r)));

  // Evidence gate for repos: a repo URL may appear in the report only if it was
  // in the gathered evidence.
  const fetched = fetchedRepoSlugs(rows);
  const validTools = [];
  for (const tool of report.tools || []) {
    if (tool.repo && tool.repo !== 'null') {
      const lowerRepo = tool.repo.toLowerCase();
      // Exact slug match against fetched repos. A substring test let
      // docs.github.com/en/packages vouch for a "repo" called en/packages.
      const inEvidence = fetched.some((s) => s.toLowerCase() === lowerRepo);
      // Repair a spelling slip before dropping. The model wrote nashsu/llmwiki,
      // the fetched repo is nashsu/llm_wiki, and the gate removed the post's
      // own subject while keeping two side tools. Same owner, same name once
      // - _ . are ignored, is the same repo; take the spelling that was fetched.
      const repaired = inEvidence ? null : fetched.find((s) => repoKey(s) === repoKey(tool.repo));
      if (repaired) {
        notes.push(`Repaired repo for "${tool.name}": ${tool.repo} -> ${repaired} (the fetched spelling).`);
        tool.repo = repaired;
      } else if (!inEvidence) {
        notes.push(`Dropped tool "${tool.name}": repo ${tool.repo} was never fetched in evidence.`);
        continue;
      }
    }
    validTools.push(tool);
  }
  report.tools = validTools;

  for (const tool of report.tools || []) {
    if (!tool.install) continue;
    // Flags first ("pip install -U transformers"): skip them to the package name.
    const m = String(tool.install).match(/(?:pip3?)\s+install\s+(?:-{1,2}[\w-]+\s+)*([a-z0-9][a-z0-9._-]*)/i);
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
  // Not for money posts: a site that exists can still be a scam that never
  // pays, and existence is all "verified" means here.
  if (report.verdict === 'FAKE' && verified > 0 && missing === 0 && !opts.money) {
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
// Words that put a name on the losing side of a comparison: "beat X", "faster
// than X", "X vs Y" (Y), "compared to X".
const BASELINE_WORDS = 'beat|beats|beating|outperforms?|outperformed|than|vs\\.?|versus|compared (?:to|with)';
const escapeForRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Cheap Levenshtein, bounded: only ever called on short product names.
const editDistance = (a, b) => {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
};

// Repair names the OCR mangled, using what the search engine gave back.
//
// A name read off a screenshot loses characters - "KAT-Coder-V2.5" arrived as
// "AT-Coder-V2.5", "GlucoFM" once as "GluFormer". Search engines correct
// spelling for free, so once the mangled token has been searched, the canonical
// spelling is sitting in a result title. Adopt it, and remember which mangled
// token it came from so the picker can still score it against the OCR.
export const repairNames = (names, evidence) => {
  const repaired = {};
  const titles = (evidence || []).map((e) => String(e.title || ''));
  for (const raw of names) {
    const name = String(raw || '').trim();
    if (name.length < 6) continue;
    for (const title of titles) {
      // Split on "/" too: a result title is usually "GitHub - owner/repo: ...",
      // so without it the repo name is welded to its owner and never matches.
      for (const token of title.split(/[\s,:()[\]"'|/]+/)) {
        if (token.length < 6 || token.toLowerCase() === name.toLowerCase()) continue;
        const d = editDistance(name.toLowerCase(), token.toLowerCase());
        // Characters must be MISSING or EXTRA, never swapped. OCR clips a
        // letter off the edge of a screenshot; it does not turn one word into
        // a different one. Without this, "GlucoFM" repaired to "glucose" - two
        // substitutions, distance 2, and a completely different subject.
        const lengthGap = Math.abs(name.length - token.length);
        if (d <= 2 && d === lengthGap && d < name.length / 3) {
          repaired[token] = name;
          break;
        }
      }
      if (Object.values(repaired).includes(name)) break;
    }
  }
  return repaired;
};

// Paths under github.com that are not repositories.
const GITHUB_RESERVED_PATHS = new Set([
  'topics', 'orgs', 'collections', 'marketplace', 'sponsors', 'features',
  'about', 'pricing', 'security', 'enterprise', 'apps', 'settings', 'search',
  'explore', 'trending', 'login', 'join', 'site', 'readme', 'users', 'new',
]);

const pickSubject = (rawModelName, evidence, ocrText, post = {}) => {
  let modelName = rawModelName;
  // OCR joins lines with " | ", so the slide reading "Smart Devs Don't / Use
  // Graphify" arrives as "Smart Devs Don't | Use Graphify" and no phrase match
  // survives. Flatten the separators before looking for phrases.
  const flatten = (t) => String(t || '').toLowerCase().replace(/[|\n]+/g, ' ').replace(/\s+/g, ' ');
  const ocr = flatten(ocrText);
  const caption = flatten(post.caption);
  // The creator's own handle is on every slide as a watermark. Once carousel
  // pagination started returning all seven slides instead of two, the handle
  // outscored the product: a post about BASE was titled "Charlie", because
  // @charlieautomates is stamped on each slide and BASE is only written on
  // three. More sight made the ranking worse, which means mention count alone
  // was never the right signal.
  const handle = String(post.author || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const isAuthorHandle = (name) => {
    const n = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!n || !handle || n.length < 3) return false;
    return handle.includes(n) || n.includes(handle);
  };
  const countIn = (hay, n) => {
    if (n.length < 3) return 0;
    if (n.length === 3) {
      // Enforce word boundaries for 3-letter acronyms to prevent substring overcounting (e.g. 'rlm' in 'world')
      const escaped = n.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      const match = hay.match(new RegExp(`\\b${escaped}\\b`, 'gi'));
      return match ? match.length : 0;
    }
    let count = 0, i = 0;
    while ((i = hay.indexOf(n, i)) !== -1) { count += 1; i += n.length; }
    return count;
  };
  // A repo is "prime-agent"; the post writes "Prime Agent". Counting the slug
  // literally scored it zero on a post that showed the name in every frame, and
  // the subject fell through to a three-letter acronym instead.
  const countOf = (hay, needle) => {
    const n = String(needle || '').toLowerCase();
    const spaced = n.replace(/[-_.]+/g, ' ');
    return Math.max(countIn(hay, n), spaced === n ? 0 : countIn(hay, spaced));
  };
  const occurrences = (needle) => countOf(ocr, needle);
  // The caption is the one place a creator writes the subject as a sentence
  // rather than as design. A chart legend listing baselines put "GluFormer"
  // on screen beside the model being announced, and mention count could not
  // separate them - while the caption said "Google Introduced GlucoFM" in its
  // first four words. Caption mentions are worth more than slide mentions.
  const CAPTION_WEIGHT = 3;
  // A repaired name scores on the mangled spelling the post actually shows:
  // "KAT-Coder-V2.5" appears nowhere in the OCR, but "AT-Coder-V2.5" does, and
  // they are the same product.
  const aliases = post.aliases || {};
  // Tried and reverted (Oct 2): giving the caption weight only to names the
  // video itself also shows or says, against algorithm-bait captions. It cost
  // two correct titles - MiMo-V2.6-Distill-Qwen-9B (the slides spell it
  // differently) and Claude (no speech recorded) - and no recorded run has yet
  // been mis-titled by a bait caption. Revisit only with such a case in hand.
  const baseScore = (needle) => occurrences(needle) + CAPTION_WEIGHT * countOf(caption, needle);
  // "Hybrid Latent Attention (HLA)": the post writes the long name once and the
  // short form after that, and neither spelling contains the other, so the
  // whole string scored 1 and the report said "Unidentified" (Oct 8). Count
  // the name without its bracket plus the bracketed short form (3+ chars).
  const nameScore = (needle) => {
    const n = String(needle || '');
    const m = n.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (!m) return baseScore(n);
    const short = m[2].trim();
    return Math.max(baseScore(n), baseScore(m[1].trim()) + (short.length >= 3 ? baseScore(short) : 0));
  };
  const score = (needle) => {
    const source = aliases[needle];
    return nameScore(needle) + (source ? nameScore(source) : 0);
  };
  // Repo slugs the post shows on screen, e.g. "github.com/safishamsi/graphify".
  // OCR of a screenshot puts spaces where a URL has none: the graphify slide
  // came back as "/github. com/safishamsi/graphify", so a strict host match
  // found nothing on the one post that printed its repo.
  const printedRepoNames = new Set();
  for (const m of ocr.matchAll(/github\s*\.\s*com\s*\/\s*[\w.-]+\s*\/\s*([\w.-]+)/g)) {
    printedRepoNames.add(m[1].toLowerCase());
  }
  // "It's called X", "introducing X", "meet X", "my product X".
  const NAMING_PHRASES = "(?:called|named|introducing|meet|my product)";
  const namedInCaption = (name) => {
    const n = String(name || '').toLowerCase();
    if (n.length < 3) return false;
    return [n, n.replace(/[-_.]+/g, ' ')].some((v) =>
      new RegExp(NAMING_PHRASES + '\\s+(?:the\\s+)?' + escapeForRegex(v) + '(?![\\w-])', 'i').test(caption)
    );
  };
  const isDismissed = (name) => {
    const n = escapeForRegex(name);
    // Either order: "don't use Graphify" and "Graphify killer" both bury it.
    return new RegExp('(?:' + DISMISSAL_VERBS + ')\\s+(?:the\\s+)?' + n, 'i').test(ocr) ||
      new RegExp(n + '\\s+(?:is\\s+)?(?:killer|is dead|obsolete)', 'i').test(ocr);
  };
  // A name the post compares AGAINST is a baseline, not the subject. Phonon-2's
  // caption says it "just beat Whisper large"; Whisper was named 13 times to
  // Phonon's 5, and openai/whisper became the title. Same shape as GluFormer in
  // a chart legend (set 5). The words are in the post, so this is a lookup.
  const isBaseline = (name) => {
    const n = escapeForRegex(String(name || '').toLowerCase());
    if (n.length < 3) return false;
    const re = new RegExp('(?:' + BASELINE_WORDS + ')\\s+(?:the\\s+|openai\\s+|google\\s+|meta\\s+)?' + n + '(?![\\w-])', 'i');
    return re.test(ocr) || re.test(caption);
  };

  // 1. A repository the evidence confirmed, whose name the post shows - ranked,
  //    not first-past-the-post. Evidence order is arbitrary, and taking the
  //    first match made a repo mentioned once beat "Prime Agent", which the
  //    same post showed 23 times.
  const candidates = [];
  for (const r of evidence || []) {
    // Host exactly github.com: docs.github.com/en/packages parsed as owner "en"
    // / repo "packages" and titled a post about Brud Code "packages".
    const m = String(r.url || '').match(/(?:^|\/\/)(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/?$/i);
    if (!m) continue;
    // github.com/topics/users is a tag page, not a repository, and it parsed as
    // owner "topics" / repo "users" - which then won on the word "users"
    // appearing in a caption.
    if (GITHUB_RESERVED_PATHS.has(m[1].toLowerCase())) continue;
    const repoName = m[2];
    if (!looksLikeSubject(repoName)) continue;
    // A three-letter repo name is an acronym for a concept, not the product a
    // post is about, and counting substrings flatters it: "rlm" scored 13 hits
    // against "prime-agent"'s 11 on a post whose every frame says Prime Agent,
    // because RLM is the technique the harness is built on. (Fixed: 3-letter words now require boundaries)
    if (repoName.length < 3) continue;
    // The creator's handle is not the product, however often it is stamped on
    // the slides.
    if (isAuthorHandle(repoName)) continue;
    // A repo the post PRINTS as a URL outranks one it merely names. The
    // graphify carousel shows github.com/safishamsi/graphify on slide 4 while
    // its caption talks about Claude Code, the tool being improved - so
    // weighting the caption alone picked the wrong subject. A slug on screen is
    // the creator pointing at the thing.
    const printed = printedRepoNames.has(repoName.toLowerCase());
    const hits = score(repoName) + (printed ? 100 : 0);
    if (hits < 1) continue;
    if (candidates.some((c) => c.name.toLowerCase() === repoName.toLowerCase())) continue;
    candidates.push({ name: repoName, slug: m[1] + '/' + m[2], hits, printed, dismissed: isDismissed(repoName) || isBaseline(repoName) });
  }
  // A tool the post promotes outranks one it dismisses, however often the
  // dismissed one is named; within a group, the more the post says it, the more
  // likely it is what the post is about.
  candidates.sort((a, b) => (a.dismissed - b.dismissed) || (b.hits - a.hits));
  const best = candidates.find((c) => !c.dismissed);
  if (best) {
    // A verified repo is not automatically the subject. The GlucoFM post plots
    // GluFormer once in a chart legend as a baseline; that repo exists, so it
    // became the headline of a post whose caption and every frame say GlucoFM.
    // When the model's name is said far more often than the repo is, the post
    // is about the model's name and the repo is a footnote.
    const modelScore = looksLikeSubject(modelName) && !isAuthorHandle(modelName) && !isDismissed(modelName)
      ? score(modelName)
      : 0;
    // The caption NAMES the subject in so many words - "It's called LLM Wiki",
    // "It's called MiMo-V2.6-Distill-Qwen-9B". That is the creator stating a
    // fact, not a mention to be counted: by count, Requarks/wiki won on every
    // "wiki" in "LLM Wiki", and sglang (the engine the model runs on) beat the
    // model the caption had just named.
    if (!best.printed && modelScore > 0 && namedInCaption(modelName) &&!namedInCaption(best.name)) {
      return { name: modelName, why: `named in the caption ("${modelName}"), over verified repo ${best.slug} at ${best.hits}` };
    }
    if (!best.printed && modelScore > best.hits) {
      return { name: modelName, why: `model name, scores ${modelScore} against verified repo ${best.slug} at ${best.hits}` };
    }
    return { name: best.name, slug: best.slug, why: `verified repo ${best.slug}, score ${best.hits}` + (best.printed ? ' (slug printed in the post)' : '') };
  }
  if (candidates.length) {
    // Everything the evidence verified is something this post is arguing
    // against. Naming any of them would fact-check the rival.
    const names = candidates.map((c) => c.name).join(', ');
    if (looksLikeSubject(modelName) && !isAuthorHandle(modelName) && score(modelName) >= 1 && !isDismissed(modelName)) {
      return { name: modelName, why: `model name, scores ${score(modelName)}; verified repos (${names}) are all dismissed by the post` };
    }
    return { name: null, why: `only dismissed tools were verified (${names})` };
  }

  // If the search engine handed back a corrected spelling of the model's name,
  // use that spelling from here on - the report should say KAT-Coder-V2.5, not
  // the clipped AT-Coder-V2.5 the OCR produced.
  const corrected = Object.keys(aliases).find(
    (k) => String(aliases[k]).toLowerCase() === String(modelName || '').toLowerCase()
  );
  if (corrected) modelName = corrected;

  // 2. The model's name, but only if the post actually says it. A name with
  //    zero occurrences is the definition of not being the subject: that branch
  //    used to return the name anyway, and it published a creator's Instagram
  //    handle as the product under test.
  if (looksLikeSubject(modelName) && !isAuthorHandle(modelName)) {
    const hits = score(modelName);
    if (hits >= 2) return { name: modelName, why: `model name, scores ${hits} in caption and OCR` };
    return { name: null, why: `rejected "${modelName}": model named it but it scores only ${hits} (needs 2)` };
  }
  if (isAuthorHandle(modelName)) {
    return { name: null, why: `rejected "${modelName}": that is the creator's handle, not the product` };
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
export const deriveConfidence = ({ subjectNamed, coverage, toolsReal, rowsWithText, hasText, searchFailed }) => {
  let score = 95;
  const why = [];
  // The web search itself failed (every engine blocked): the verdict rests on
  // the post and the structured checks alone.
  if (searchFailed) { score -= 30; why.push('web search unavailable'); }
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

const normalizeReport = (report, evidence, opts = {}) => {
  const VERDICTS = ['TRUE', 'PARTIALLY_TRUE', 'HYPE', 'MISLEADING', 'FAKE'];
  const verdict = VERDICTS.includes(report.verdict) ? report.verdict : 'UNKNOWN';
  const tools = (Array.isArray(report.tools) ? report.tools : [])
    .filter((t) => t && typeof t === 'object' && cleanLine(t.name))
    .map((t) => ({
      name: cleanLine(t.name),
      repo: cleanLine(t.repo) || null,
      website: cleanLine(t.website) || null,
      install: cleanLine(t.install) || null,
      whatItDoes: clampSentences(cleanLine(t.what_it_does), 1, 100),
      caveat: cleanLine(t.caveat) || null,
      status: ['verified', 'not_found'].includes(t.status) ? t.status : 'unverified',
    }))
    // The model keeps listing non-tools: "Telegram", "WhatsApp", "ZArchitecture"
    // (OCR noise from a heading) and outright inventions. An entry with no repo,
    // no website, no install command and nothing verified is not a tool - it is a sentence
    // wearing a badge, and it makes the card longer while saying less.
    .filter((t) => t.repo || t.website || t.install || t.status === 'verified')
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
  }, evidence, report.tech_name, opts);
};

// Exposed for tools/replay.js, which re-runs recorded runs through the picker
// and the normaliser without a device. Testing on hardware costs a build, an
// Instagram fetch and an API call per case, which is why earlier sessions kept
// tuning against a single reel and calling it a pass.
export const __test = { synthesizeFactCheck, extractClaims, pickSubject, normalizeReport, looksLikeSubject, applyEvidenceRules, rankEvidence, printedGithubSlugs, moneyPlatforms, moneyQueries, rankMoneyEvidence, moneyTitle, isListPost, listTitle };

const normalizeTools = (tools) => (tools || []).map((tool) => ({
  name: tool.name || 'Tool',
  githubRepo: tool.github_repo || null,
  pipCommand: tool.pip_command || null,
  isVerified: Boolean(tool.github_repo),
}));

export const analyzeReelApi = async (url) => {
  // Set before the try so the failure log below can use them: a failed run
  // used to log durationMs as Date.now() - Date.now(), always 0.
  const runStartedAt = Date.now();
  resetModelsUsed();
  resetRunTokens();
  try {
  if (!TechFactChecker) throw new Error('Native mobile module is unavailable. Rebuild the Android dev app.');
  const offline = await getOfflineMode();

  // Offline: the native 3-stage Gemma pipeline already produced the verdict,
  // the evidence and the markdown report. Nothing leaves the device.
  if (offline) {
    const localResult = await TechFactChecker.analyzeAndVerify(url, true, '');
    return { ...localResult, offline: true };
  }

  const apiKey = await getGroqApiKey();
  if (!apiKey) throw new Error('Add your Groq API key in Settings first.');

  const startedAt = Date.now();
  // Per-stage timing, so "50 seconds" can be attributed instead of guessed at.
  // Set 2 regressed 40.3s -> 50.4s and the cause had to be reasoned about from
  // what had changed, because nothing measured the stages.
  const stage = {};
  let mark = startedAt;
  const lap = (name) => { stage[name] = Date.now() - mark; mark = Date.now(); };
  trace('pipeline start ' + shortRef(url));
  const media = await TechFactChecker.analyzeAndVerify(url, false, apiKey);
  lap('native');
  jobStage(1);
  trace('pipeline native done ' + shortRef(url) + ' in ' + stage.native + 'ms, reelId=' + media.reelId);
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
  // The creator's own handle is never a tool under test (the backup reader
  // listed "AmanXaicom", Oct 9). Either reader, same rule.
  if (media.author && Array.isArray(claimsData.tools)) {
    const handle = flatKey(media.author);
    if (handle.length >= 3) claimsData.tools = claimsData.tools.filter((t) => flatKey(t && t.name) !== handle);
  }
  lap('claims');
  jobStage(2);
  // Kept because the picker overwrites tech_name below, and a replay of this
  // run has to see what the model originally said to measure a picker change.
  const modelTechName = claimsData.tech_name;
  log('STAGE 1 CLAIMS', claimsData);
  // Money / side-hustle posts are checked differently - see moneyPost().
  const money = moneyPost(claimsData, [media.caption, ocrText, transcript].join(' '), [media.caption, transcript].join(' '));
  const platforms = money ? moneyPlatforms(claimsData) : [];
  const queries = money
    ? moneyQueries(platforms, claimsData, [media.caption, ocrText, transcript].join(' '))
    : (claimsData.search_queries || []).slice(0, 10);
  if (money) log('MONEY MODE', { platforms });
  log('STAGE 2 QUERIES', queries);

  // Structured lookups and web search are independent, so run them together.
  // Sequentially they pushed one run to 55s; a paste-and-wait app cannot afford
  // that.
  const searched = queries.length
    ? await TechFactChecker.gatherEvidence(queries)
    : (media.sources || []);
  lap('search');
  // Which engines answered and how many searches were blocked (Oct 8: a run
  // whose every search hit a bot check was judged on one source).
  const searchHealth = queries.length && TechFactChecker.getLastSearchHealth
    ? await TechFactChecker.getLastSearchHealth().catch(() => '') : '';
  const webHits = Number((String(searchHealth).match(/hits=(\d+)/) || [])[1] || 0);
  const searchFailed = queries.length > 0 && Boolean(searchHealth) && webHits < 3;
  lastSearchBlocked = /blocked=[1-9]/.test(searchHealth);
  if (searchHealth) log('SEARCH HEALTH', searchHealth);
  jobStage(3);
  // The pricing check needs the search results, so the router runs after them.
  // Its own lookups are already parallel inside runVerifiers.
  const verified = await runVerifiers(claimsData, transcript, ocrText, searched, { money });
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
  // Money posts live or die on what users report, so read more of it.
  await fillMissingPageText(evidence, money ? 4 : 2);
  lap('pagefill');

  // Decide the subject in code before the model writes anything about it.
  const namesSeen = [claimsData.tech_name, ...(claimsData.tools || []).map((t) => t.name)].filter(Boolean);
  const aliases = repairNames(namesSeen, evidence);
  if (Object.keys(aliases).length) log('NAME REPAIRS', aliases);
  // A money post's subject is its platforms, never a GitHub repo: the
  // side-hustle run was titled "gotranscript" after a stranger's repo.
  const subject = money
    ? { name: moneyTitle(platforms, modelTechName, media.author), why: 'money post: titled from its platforms (' + platforms.join(', ') + ')' }
    : pickSubject(claimsData.tech_name, evidence, ocrText, {
      author: media.author,
      caption: media.caption,
      aliases,
    });
  log('SUBJECT', subject);
  if (subject.name !== undefined && subject.name !== claimsData.tech_name) {
    claimsData = { ...claimsData, tech_name: subject.name };
  }

  const coverage = slideCoverage(ocrText, media.imagesUsed);
  if (coverage) log('COVERAGE', coverage);
  jobStage(4);
  // The rows the model will read, decided once here so the run log records
  // exactly these. The CSV used to log evidence.slice(0, 12) - the first rows
  // FOUND, not the ones ranked and sent - so "what the model saw" was wrong.
  const pinned = [...new Set([subject.slug, ...printedGithubSlugs(ocrText)].filter(Boolean))];
  const kept = money
    ? rankMoneyEvidence(evidence, platforms)
    : rankEvidence(evidence, claimsData.tech_name, claimsData.tools, pinned);
  if (pinned.length) log('PINNED EVIDENCE', pinned);
  // Wait for the main judge's minute rather than hand the verdict to the
  // backup: on Oct 7, 5 of 13 back-to-back reels were judged by the backup
  // model only because the main one's per-minute budget was spent. A verdict
  // prompt is ~5-6.5k tokens.
  const judgeWait = modelWaitMs(MODEL_CHAINS.verdict[0], 6500);
  if (judgeWait > 0) {
    setJobNote("Waiting for Groq's free per-minute limit", Date.now() + judgeWait);
    await sleep(judgeWait);
    setJobNote(null);
  }
  const report = await synthesizeFactCheck(apiKey, transcript, ocrText, claimsData, evidence, coverage, kept, { author: media.author, money, platforms });
  lap('synthesis');
  log('STAGE 3 RAW REPORT', report);
  const verdictRaw = report.verdict;
  const normalized = normalizeReport(report, evidence, { money });
  normalized.confidence = deriveConfidence({
    // A list of platforms has no single subject to confirm - not a weakness.
    // A list post ("22 NLP techniques", "top 5 recruiters") has no single
    // subject to confirm; being one is not a weakness of the run.
    subjectNamed: Boolean(subject.name) || money || isListPost(modelTechName, claimsData.tools),
    coverage,
    toolsReal: normalized.toolsReal,
    rowsWithText: kept.filter((e) => (e.pagePreview || '').length > 0).length,
    hasText: (ocrText.length + transcript.length) > 200,
    searchFailed,
  });
  log('CONFIDENCE', normalized.confidence);

  // Tools mentioned in the video/slides but not promoted to the top verified list
  const allClaimedTools = claimsData?.tools || [];
  // Already covered = same name ignoring spacing/punctuation, or the name part
  // of a reported tool's repo. "Needle" was listed again under "Also mentioned"
  // below the verified "cactus-needle" (repo cactus-compute/needle). Plain
  // substring matching is NOT used: it would hide "Claude" behind "Claude Code".
  const covered = new Set();
  for (const t of normalized.tools || []) {
    if (t.name) covered.add(flatKey(t.name));
    if (t.repo) covered.add(flatKey(String(t.repo).split('/').pop()));
  }
  normalized.otherTools = allClaimedTools
    .filter((t) => {
      const k = flatKey(t.name);
      return k && !covered.has(k);
    })
    .map((t) => ({
      name: t.name,
      // Kept so "Ask AI" can check the exact repo the post named, not a
      // same-name project the search happens to find.
      repo: t.github_repo && t.github_repo !== 'null' ? t.github_repo : null,
      description: t.claim || '',
    }));

  // Last resort for the title, and it is still a lookup rather than a guess.
  //
  // The picker runs BEFORE synthesis, so it can only see repo names that the
  // OCR shows. On a reel whose on-screen text is a headline - "Claude +
  // NotebookLM Persistent Memory" - it correctly abstains, and the card was
  // then titled "Unidentified" even though the finished report names
  // alfredang/notebooklm-mcp and the evidence verified it. Take that name, but
  // only when exactly one tool's repo is traceable to a page that was actually
  // fetched, so an invented repo can never become the headline.
  const evidenceUrls = evidence.map((e) => String(e.url || '').toLowerCase()).join(' ');
  const traceable = (normalized.tools || []).filter(
    (t) => t.repo && evidenceUrls.includes(String(t.repo).toLowerCase())
  );
  const fallbackName = traceable.length === 1 ? traceable[0].name : null;
  if (!subject.name && fallbackName) {
    log('SUBJECT FALLBACK', { name: fallbackName, why: 'only tool whose repo was in the fetched evidence' });
  }
  log('STAGE 3 NORMALIZED (what the card renders)', normalized);

  const tools = normalized.tools || [];
  // The title the app shows. A list post keeps its list title even when the
  // picker found a repo for one item: "22 NLP Techniques" was titled "spaCy"
  // (item 18 of 22). A repo the post PRINTS as a link is the exception - then
  // it is the subject. A single-subject post the picker abstained on stays
  // "Unidentified": those rejections are window titles and creator handles.
  // "Prints a repo link" only marks THE subject when the post prints one link:
  // a "10 GitHub repos" post prints all ten and was titled "searxng" (Oct 7).
  const onePrintedRepo = /slug printed/.test(subject.why || '') && printedGithubSlugs(ocrText).length <= 1;
  const displayTitle = (!money && isListPost(modelTechName, claimsData.tools) && !onePrintedRepo
    ? listTitle(modelTechName, claimsData.tools, media.author) : null) ||
    subject.name || fallbackName ||
    (isListPost(modelTechName, claimsData.tools) ? listTitle(modelTechName, claimsData.tools, media.author) : null) ||
    'Unidentified';

  await logRun({
    timestamp: new Date().toISOString(),
    shortcode: (String(url).match(/(?:reel|p)\/([A-Za-z0-9_-]+)/) || [])[1] || url,
    url: String(url),
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
    keptRows: kept.length,
    keptWithPageText: kept.filter((e) => (e.pagePreview || '').length > 0).length,
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
      kept.map((e) => ({
        t: e.title,
        u: e.url,
        p: (e.pagePreview || '').length,
      }))
    ),
    reportJson: JSON.stringify(normalized),
    transcript,
    ocrText,
    caption: media.caption || '',
    author: media.author || '',
    postMode: money ? 'money' : 'tech',
    models: describeModelsUsed(),
    tokens: describeRunTokens(),
    search: searchHealth,
    title: displayTitle,
    fetchedRepos: fetchedRepoSlugs(evidence).join(' '),
  });
  trace('pipeline done ' + shortRef(url) + ' verdict=' + normalized.verdict +
    ' subject=' + (subject.name || 'none') + ' total=' + (Date.now() - startedAt) + 'ms');
  delete normalized.__rules;

  return {
    ...media,
    // The report shows this so the user can reopen the post.
    sourceUrl: media.sourceUrl || url,
    // An honest blank beats a confident wrong: two of five recorded runs named
    // a window title and a caption headline.
    // List posts get a title from the model's name or their items. A single-
    // subject post the picker abstained on stays "Unidentified": those
    // rejections are window titles and creator handles, which it must not print.
    // A list post keeps its list title even when the picker found a repo for
    // one item: "22 NLP Techniques" was titled "spaCy" (item 18 of 22). A repo
    // the post PRINTS as a link is the exception - then it is the subject.
    techName: displayTitle,
    subjectWhy: subject.why,
    // The verdict AFTER the evidence rules. This used to return the model's raw
    // verdict, so a run the rules downgraded TRUE -> PARTIALLY_TRUE still showed
    // TRUE on the badge and in the notification, while the CSV said PARTIALLY_TRUE.
    verdict: normalized.verdict,
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
  } catch (e) {
    await logRun({
      timestamp: new Date().toISOString(),
      shortcode: (String(url).match(/(?:reel|p)\/([A-Za-z0-9_-]+)/) || [])[1] || url,
      url: String(url),
      error: e.message || String(e),
      durationMs: Date.now() - runStartedAt,
      models: describeModelsUsed(),
      tokens: describeRunTokens(),
    }).catch(() => {});
    throw e;
  }
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

// The chat's view of the post. Short posts go in whole; long ones as the item
// and claim lists from the analysis plus the lines matching the question.
const STOPWORDS = new Set(('the and for are was were this that with what which who whom whose why how ' +
  'does did can could would should will about from into than then them they their there here have has ' +
  'had not but all any each list post tell show give mentioned mention said says say also other more ' +
  'tools tool items item used using use your you its it’s was it is').split(' '));
const CHAT_FULL_TEXT = 2500;
const CHAT_EXCERPT = 1800;
export const postExcerpt = (reel, question) => {
  const ocr = String(reel.ocrText || '');
  const names = [
    ...(reel.tools || []).map((t) => t && t.name),
    ...(((reel.report && reel.report.tools) || []).map((t) => t && t.name)),
    ...(((reel.report && reel.report.otherTools) || []).map((t) => t && t.name)),
  ].filter(Boolean);
  const items = [...new Set(names.map((n) => String(n).trim()))].join(', ');
  const claims = (reel.claims || []).map((c) => (typeof c === 'string' ? c : (c && c.claim) || '')).filter(Boolean).slice(0, 25).join(' | ');
  if (ocr.length <= CHAT_FULL_TEXT) return { full: true, text: ocr, items, claims, totalChars: ocr.length };
  const words = [...new Set((String(question || '').toLowerCase().match(/[a-z0-9][a-z0-9.+#-]{2,}/g) || [])
    .filter((w) => !STOPWORDS.has(w)))];
  const lines = ocr.split(/\s*\|\s*|\n/).map((l) => l.trim()).filter(Boolean);
  const picked = [];
  let size = 0;
  lines.forEach((line, i) => {
    if (size >= CHAT_EXCERPT || !words.some((w) => line.toLowerCase().includes(w))) return;
    // The matching line plus its neighbours: a heading's explanation is the next line.
    for (const j of [i - 1, i, i + 1]) {
      if (lines[j] && !picked.includes(j) && size < CHAT_EXCERPT) { picked.push(j); size += lines[j].length + 3; }
    }
  });
  const text = picked.sort((a, b) => a - b).map((j) => lines[j]).join(' | ');
  return { full: false, text, items, claims, totalChars: ocr.length };
};

// The question the report's "ASK AI" chip sends. Built by askToolQuestion so
// the chip and the chat cannot drift apart.
const VERIFY_TOOL_QUESTION = /^Verify the tool "(.+?)"(?: \(([\w.-]+\/[\w.-]+)\))?/i;
export const askToolQuestion = (tool) =>
  'Verify the tool "' + tool.name + '"' + (tool.repo ? ' (' + tool.repo + ')' : '') + ' mentioned in this post.' +
  (tool.description ? ' The post says: ' + tool.description : '');

export const chatWithAiApi = async (reel, userMessage, conversation = [], onSearchStart = null) => {
  const offline = await getOfflineMode();
  const apiKey = offline ? null : await getGroqApiKey();
  if (!offline && !apiKey) throw new Error('Add your Groq API key in Settings first.');
  // Every follow-up used to re-send the whole research file: the full evidence
  // array with each row's scraped page text, the entire transcript, and eight
  // untruncated chat turns. A five-word question therefore cost 6,648 tokens,
  // and with 4,694 already spent by the analysis that had just run it broke
  // Groq's 8,000-per-minute ceiling and stalled the chat for 25 seconds.
  //
  // The model does not need twenty-seven scraped pages to answer "what is
  // MCP?" - it needs the verdict, a short transcript, and a list of where the
  // evidence came from. If it genuinely needs more it can already ask for a
  // search through the SEARCH: contract below.
  const recentChat = conversation.slice(-6).map((message) =>
    (message.sender === 'user' ? 'User: ' : 'Assistant: ') + String(message.text || '').slice(0, 400)
  ).join('\n');
  const sourceList = (reel.sources || []).slice(0, 6).map(
    (e) => '- ' + String(e.title || '').slice(0, 80) + ' :: ' + (e.url || '')
  ).join('\n');
  const verdictLine = [
    reel.verdict ? 'Verdict: ' + reel.verdict : '',
    (reel.report && reel.report.factualReality) || reel.factualReality || '',
  ].filter(Boolean).join(' - ');
  // What the post contains, without sending all of it. A 13-slide carousel's
  // on-screen text was 19,700 characters; the chat used to get the first 1,200
  // and then, told to answer only from that, denied that NLTK was in the post -
  // it was on a later slide. Now it gets everything the analysis extracted from
  // the WHOLE post, plus the lines of the full text that match the question.
  const post = postExcerpt(reel, userMessage);
  const context = [
    'You are an expert AI and mobile engineer answering questions about one verified Instagram post.',
    'Tech: ' + (reel.techName || 'Unknown Technology'),
    'Transcript: ' + String(reel.rawTranscript || '').slice(0, 800),
    'Items the analysis found in the WHOLE post (every slide/frame): ' + (post.items || '(none)'),
    'Claims the post makes: ' + (post.claims || '(none)'),
    post.full
      ? 'Full on-screen text of the post: ' + (post.text || '(none)')
      : 'Parts of the on-screen text relevant to this question (the full text is ' + post.totalChars + ' characters, not all shown): ' + (post.text || '(no matching lines)'),
    'Verified fact-check: ' + verdictLine,
    'Sources consulted (titles and links only):' + (sourceList ? '\n' + sourceList : ' none'),
    'CRITICAL RULES:',
    // Oct 6: asked "what NLP techniques were present?" about a post whose 22
    // techniques sat on slides the app never read, the chat answered in 1.5 s
    // with an invented generic list of 24. It only had the cover text.
    '0. What the POST says or lists comes ONLY from the items, claims, transcript and on-screen text above - never from general knowledge. If something is not there and you were not given the full on-screen text, say you cannot find it in the parts of the post you have; never claim the post does not mention it.',
    '1. Answer in 1-2 short sentences maximum. Be concise. Only provide long detailed answers if the user explicitly uses words like "explain", "detail", or "elaborate".',
    '2. If the user asks a question about something you have 0 knowledge about and it is not covered above, you MUST output EXACTLY the phrase: SEARCH: [your search query here] and nothing else. The system will perform the search and give you the answer to summarize. You are given source titles and links, not their contents, so use this whenever the answer would need the text of one of those pages.',
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

  // "Ask AI" on a tool the report had no room to check (a "top 10 repos" post
  // gets 5-6 checked within the token budget). Fetch the evidence FIRST: left
  // to itself the model only searches when it decides it knows nothing, and a
  // repo name it half-remembers would be "verified" from memory.
  const verify = userMessage.match(VERIFY_TOOL_QUESTION);
  if (verify) {
    if (onSearchStart) onSearchStart();
    const name = verify[1];
    const repo = verify[2] || null;
    const parts = [];
    if (repo) {
      const page = await readPage('https://github.com/' + repo, 3000);
      parts.push('GitHub page github.com/' + repo + ':\n' +
        (page || '(could not be fetched - the repository may not exist or may be private)'));
    }
    parts.push('Web search for "' + (repo || name) + '":\n' +
      await performQuickSearch(repo ? repo + ' github' : name + ' github'));
    messages.push({
      role: 'user',
      content: 'Evidence fetched just now:\n' + parts.join('\n\n') +
        '\n\nUsing ONLY this evidence: does "' + name + '" exist, what does it actually do, and does that match what the post claims? ' +
        'If the evidence does not show it, say it could not be found - do not answer from memory. Keep it to 2-4 short sentences.',
    });
    return callGroq(apiKey, messages, { job: 'chat', temperature: 0.3 });
  }

  let res = await callGroq(apiKey, messages, { job: 'chat', temperature: 0.3 });
  if (res.includes('SEARCH:')) {
    const match = res.match(/SEARCH:\s*(.+)/);
    if (match) {
      if (onSearchStart) onSearchStart();
      const query = match[1].trim();
      const searchResult = await performQuickSearch(query);
      messages.push({ role: 'assistant', content: res });
      messages.push({ role: 'user', content: 'Search Results:\n' + searchResult + '\n\nNow answer the question concisely.' });
      return callGroq(apiKey, messages, { job: 'chat', temperature: 0.3 });
    }
  }
  return res;
};



