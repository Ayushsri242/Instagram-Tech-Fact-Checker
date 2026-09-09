import axios from 'axios';

// Claim router.
//
// Search is for FINDING things. Structured APIs are for VERIFYING them, and a
// price list cannot hallucinate. Every failure logged in TEST_LOG.md where the
// app invented a spec ("4x H100", "still incurs usage fees", "requires API key
// handling") was a question with an authoritative, keyless answer that nobody
// asked for.
//
// Rules, not a model: routing costs under a millisecond and adds no API call.
// Using an LLM to route would give back the latency this is meant to save.
//
// Every source here is free and needs no API key, which is the whole point of
// the project. Anything unrecognised still goes to DuckDuckGo.

const TIMEOUT = 6000;

const row = (title, url, snippet, pagePreview) => ({
  title,
  url,
  snippet: String(snippet || '').slice(0, 300),
  pagePreview: String(pagePreview || '').slice(0, 600),
});

// ---------------------------------------------------------------- PyPI

// The app once reported "pip install nanobot" as correct by luck. PyPI's
// `nanobot` is an unrelated robot-navigation library; the real package is
// `nanobot-ai`. One lookup makes that certain instead of lucky.
const checkPypi = async (pkg) => {
  const name = String(pkg).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,60}$/.test(name)) return [];
  try {
    const { data } = await axios.get(`https://pypi.org/pypi/${name}/json`, { timeout: TIMEOUT });
    const i = data.info || {};
    return [row(
      `PyPI - ${i.name || name}`,
      `https://pypi.org/project/${name}/`,
      `Version ${i.version} | ${i.summary || 'no summary'}`,
      `PyPI package "${i.name || name}" exists. Version ${i.version}. Summary: ${i.summary || 'none'}. ` +
        `Home page: ${i.home_page || i.project_url || 'none'}. License: ${i.license || 'unstated'}.`
    )];
  } catch (e) {
    if (e.response && e.response.status === 404) {
      // A confirmed absence is evidence too - and it is the evidence that
      // catches a fabricated install command.
      return [row(
        `PyPI - ${name} NOT FOUND`,
        `https://pypi.org/project/${name}/`,
        'No package with this name exists on PyPI.',
        `VERIFIED ABSENT: PyPI has no package named "${name}". An install command using this name is wrong.`
      )];
    }
    return [];
  }
};

// ---------------------------------------------------------------- npm

const checkNpm = async (pkg) => {
  const name = String(pkg).trim().toLowerCase();
  if (!/^(@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]{1,60}$/.test(name)) return [];
  try {
    const { data } = await axios.get(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { timeout: TIMEOUT });
    const latest = (data['dist-tags'] || {}).latest;
    const v = (data.versions || {})[latest] || {};
    return [row(
      `npm - ${data.name || name}`,
      `https://www.npmjs.com/package/${name}`,
      `Version ${latest} | ${v.description || 'no description'}`,
      `npm package "${data.name || name}" exists. Latest ${latest}. ${v.description || ''} License: ${v.license || 'unstated'}.`
    )];
  } catch (e) {
    if (e.response && e.response.status === 404) {
      return [row(
        `npm - ${name} NOT FOUND`,
        `https://www.npmjs.com/package/${name}`,
        'No package with this name exists on npm.',
        `VERIFIED ABSENT: npm has no package named "${name}".`
      )];
    }
    return [];
  }
};

// ---------------------------------------------------------------- OpenRouter

// The authoritative price list for hosted models. This is exactly what settled
// case 3: the reel claimed "1 million tokens, free", the app said you need 4x
// H100, and the truth was that the :free variant is 1M and the paid one is
// 262144 - a contradiction visible in the reel's own screenshot.
let modelCatalogue = null;
const loadModels = async () => {
  if (modelCatalogue) return modelCatalogue;
  try {
    const { data } = await axios.get('https://openrouter.ai/api/v1/models', { timeout: TIMEOUT });
    modelCatalogue = data.data || [];
  } catch (e) {
    modelCatalogue = [];
  }
  return modelCatalogue;
};

const checkModel = async (term) => {
  const needle = String(term).trim().toLowerCase().replace(/\s+/g, '-');
  if (needle.length < 4) return [];
  const models = await loadModels();
  const hits = models.filter((m) => String(m.id).toLowerCase().includes(needle)).slice(0, 6);
  if (!hits.length) return [];

  const lines = hits.map((m) => {
    const p = m.pricing || {};
    const free = String(p.prompt) === '0' && String(p.completion) === '0';
    return `${m.id}: context ${m.context_length} tokens, ${free ? 'FREE ($0 in / $0 out)' : `prompt $${p.prompt}/tok, completion $${p.completion}/tok`}`;
  });
  return [row(
    `OpenRouter catalogue - ${term}`,
    'https://openrouter.ai/models',
    lines[0],
    `Authoritative pricing and context limits from OpenRouter:\n${lines.join('\n')}`
  )];
};

// ---------------------------------------------------------------- HuggingFace

const checkHuggingFace = async (term) => {
  const q = String(term).trim();
  if (q.length < 4) return [];
  try {
    const { data } = await axios.get('https://huggingface.co/api/models', {
      params: { search: q, limit: 4, sort: 'downloads', direction: -1 },
      timeout: TIMEOUT,
    });
    if (!Array.isArray(data) || !data.length) return [];
    const lines = data.map((m) => `${m.id} (${m.downloads || 0} downloads, ${m.likes || 0} likes)`);
    return [row(
      `HuggingFace - ${q}`,
      `https://huggingface.co/models?search=${encodeURIComponent(q)}`,
      lines[0],
      `Models on HuggingFace matching "${q}":\n${lines.join('\n')}`
    )];
  } catch (e) {
    return [];
  }
};

// ---------------------------------------------------------------- Hacker News

// The fake-detector for news-shaped claims ("X launched", "Y is giving away
// free tokens"). A real launch has dated discussion; an invented one has none.
// No API key, and results carry timestamps and point counts.
const checkNews = async (term) => {
  const q = String(term).trim();
  if (q.length < 4) return [];
  try {
    const { data } = await axios.get('https://hn.algolia.com/api/v1/search', {
      params: { query: q, tags: 'story', hitsPerPage: 5 },
      timeout: TIMEOUT,
    });
    const hits = (data.hits || []).filter((h) => h.title);
    if (!hits.length) {
      return [row(
        `Hacker News - no discussion of "${q}"`,
        `https://hn.algolia.com/?q=${encodeURIComponent(q)}`,
        'No Hacker News stories mention this.',
        `NO COVERAGE: Hacker News has no stories about "${q}". A genuine launch of this kind is normally discussed there; treat the claim as unconfirmed.`
      )];
    }
    const lines = hits.map((h) => `${h.title} (${h.points || 0} points, ${String(h.created_at).slice(0, 10)})`);
    return [row(
      `Hacker News - ${q}`,
      `https://hn.algolia.com/?q=${encodeURIComponent(q)}`,
      lines[0],
      `Hacker News coverage of "${q}":\n${lines.join('\n')}`
    )];
  } catch (e) {
    return [];
  }
};

// ---------------------------------------------------------------- GitHub name

// A tool named in a post without a slug ("Clawdbot") is invisible to every
// check that starts from owner/repo. GitHub's search API resolves the bare name,
// and its redirect handling resolves renames - which is the whole Clawdbot ->
// OpenClaw miss that survived five test cases.
// Follows GitHub's own redirect on the vanity slug "name/name".
//
// This is the only thing that resolves a RENAME. Search matches repository
// names, and a rename changes the name - searching "clawdbot" returns forks and
// language ports, never openclaw. But api.github.com/repos/clawdbot/clawdbot
// 301s to openclaw/openclaw (389k stars), which is the single fact the app
// missed in every one of the five recorded test cases.
const checkGitHubRename = async (name) => {
  const bare = String(name).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (bare.length < 4) return [];
  const slug = `${bare}/${bare}`;
  try {
    const { data } = await axios.get(`https://api.github.com/repos/${slug}`, {
      headers: { Accept: 'application/vnd.github+json' },
      timeout: TIMEOUT,
    });
    const actual = data.full_name || slug;
    if (actual.toLowerCase() === slug.toLowerCase()) return [];
    return [row(
      `GitHub - ${name} is now ${actual}`,
      `https://github.com/${actual}`,
      `RENAMED: ${slug} redirects to ${actual} (${data.stargazers_count} stars).`,
      `RENAME CONFIRMED: the project "${name}" now lives at ${actual}, with ` +
        `${data.stargazers_count} stars. ${data.description || ''} ` +
        `Treat "${name}" and "${actual}" as the same project.`
    )];
  } catch (e) {
    return [];
  }
};

const checkGitHubName = async (name) => {
  const q = String(name).trim();
  if (q.length < 3 || /\s/.test(q) === false && q.length > 40) return [];
  try {
    const { data } = await axios.get('https://api.github.com/search/repositories', {
      params: { q: `${q} in:name`, sort: 'stars', order: 'desc', per_page: 3 },
      headers: { Accept: 'application/vnd.github+json' },
      timeout: TIMEOUT,
    });
    const items = data.items || [];
    if (!items.length) {
      return [row(
        `GitHub - no repo named "${q}"`,
        `https://github.com/search?q=${encodeURIComponent(q)}`,
        'GitHub search returns no repository with this name.',
        `NO REPO: GitHub has no repository named "${q}". If the post presents it as an open-source tool, that is unsupported.`
      )];
    }
    const lines = items.map((r) => {
      const renamed = r.full_name.toLowerCase().includes(q.toLowerCase()) ? '' : ' (name differs - possible rename)';
      return `${r.full_name} - ${r.stargazers_count} stars${renamed} - ${r.description || 'no description'}`;
    });
    return [row(
      `GitHub search - ${q}`,
      items[0].html_url,
      lines[0],
      `Repositories matching "${q}", most-starred first:\n${lines.join('\n')}`
    )];
  } catch (e) {
    // 403 here means the 60/hour budget is spent. Silence is correct - never let
    // "could not check" become "does not exist".
    return [];
  }
};

// ---------------------------------------------------------------- Jina Reader

// Free, keyless page-to-text proxy.
//
// Half the evidence in every recorded run came back with pageChars=0: GitHub,
// DeepWiki, nanobot.wiki and most doc sites render client-side, so Jsoup saw an
// empty shell. The model was then reasoning from two-line search snippets while
// the answer sat unread on the page. r.jina.ai returns clean text for those.
export const readPage = async (url, maxChars = 8000) => {
  try {
    const { data } = await axios.get(`https://r.jina.ai/${url}`, {
      timeout: 8000,
      headers: { Accept: 'text/plain' },
      responseType: 'text',
    });
    const text = String(data || '')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > 80 ? text.slice(0, maxChars) : '';
  } catch (e) {
    return '';
  }
};

/**
 * Fills page text for rows that came back empty, best few only.
 *
 * Bounded deliberately: this is a network call per row, and the token budget
 * only shows the model 12 rows anyway.
 */
export const fillMissingPageText = async (rows, limit = 4) => {
  const targets = [];
  for (const r of rows) {
    if (targets.length >= limit) break;
    if (!(r.pagePreview || '').length && r.url) targets.push(r);
  }
  if (!targets.length) return rows;
  const texts = await Promise.all(targets.map((r) => readPage(r.url)));
  let filled = 0;
  targets.forEach((r, i) => {
    if (texts[i]) { r.pagePreview = texts[i]; filled += 1; }
  });
  console.log(`Jina Reader filled ${filled}/${targets.length} empty pages.`);
  return rows;
};

// ------------------------------------------------- technique and pricing

// Search what people say ABOUT a technique, not whether the technique exists.
//
// The agent's own ground truth was wrong on one reel because it reasoned from
// silence: no Hacker News thread, therefore fabricated. Querying the claim
// instead returned the real picture - Claude Code has TWO limits, a local
// conversation-length one that deleting log files genuinely helps, and a
// server-side usage quota that it does not touch. The reel conflated them. That
// is misapplication, not invention, and only a search of the claim reveals it.
export const checkTechnique = async (claim, subject) => {
  const text = String(claim || '').trim();
  if (text.length < 12) return [];
  const q = `${subject ? subject + ' ' : ''}${text} does it work`.slice(0, 160);
  try {
    const { data } = await axios.get(
      'https://r.jina.ai/https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q),
      { timeout: 15000, headers: { Accept: 'text/plain' }, responseType: 'text' }
    );
    // Jina returns markdown links; the headings are the result titles.
    const titles = [...String(data || '').matchAll(/^##\s+\[([^\]]+)\]/gm)]
      .map((m) => m[1].trim())
      .filter((t) => t.length > 12)
      .slice(0, 6);
    if (!titles.length) return [];
    return [row(
      `What people say about: ${text.slice(0, 50)}`,
      'https://duckduckgo.com/?q=' + encodeURIComponent(q),
      titles[0],
      `Search results discussing this claim:${String.fromCharCode(10)}${titles.join(String.fromCharCode(10))}`
    )];
  } catch (e) {
    return [];
  }
};

// Pricing pages are where "free" goes to die.
//
// A reel titled "FREE HOSTING - 100% REAL" was scored PARTIALLY_TRUE because the
// host was never examined: its plan is Rs 95/month *billed triennially*, about
// Rs 3,420 up front. Billing cadence is the catch, and it is only ever on the
// pricing page.
const BILLING_TRAP = /(billed|billing)\s*(triennially|annually|yearly|every\s+\d+\s+years?|up ?front|in advance)|paid\s+(annually|yearly|up ?front|in advance)|\d+\s*-?\s*(year|yr)\s+(term|contract|commitment)|first (year|month) only|introductory price/i;

export const checkPricing = async (evidence, subject, ocrText = '') => {
  const out = [];

  // Look in the post's own screenshots first. On the "FREE HOSTING - 100% REAL"
  // reel the words "Billed triennially, renews at same price" sat in the OCR the
  // whole time and the model read past them. Fetching the pricing page does not
  // help either: Hostomy injects the billing cadence with JS, so the fetched
  // text carries the price with no term attached.
  const inOcr = String(ocrText || '').match(BILLING_TRAP);
  if (inOcr) {
    out.push(row(
      'Billing terms shown in the post itself',
      '',
      `The post's own screenshot says "${inOcr[0]}".`,
      `PRICING CATCH, VISIBLE IN THE POST: the screenshot reads "${inOcr[0]}". ` +
        'A monthly figure quoted under this cadence is not a monthly commitment, ' +
        'and any claim that the service is free must be weighed against it.'
    ));
  }

  const candidates = (evidence || [])
    .filter((r) => /pricing|plans?|billing|buy|checkout|hosting/i.test(`${r.url || ''} ${r.title || ''}`))
    .slice(0, 2);
  for (const c of candidates) {
    const text = await readPage(c.url, 2500);
    if (!text) continue;
    const hit = text.match(BILLING_TRAP);
    if (hit) {
      out.push(row(
        `Pricing terms - ${subject || c.title}`,
        c.url,
        `Billing catch found: "${hit[0]}"`,
        `PRICING CATCH on ${c.url}: the page says "${hit[0]}".`
      ));
    }
  }
  return out;
};

// ---------------------------------------------------------------- the router

// Platforms a tool integrates with, not products under test.
const PLATFORMS = new Set([
  'telegram', 'whatsapp', 'slack', 'discord', 'signal', 'messenger', 'instagram',
  'twitter', 'x', 'facebook', 'youtube', 'github', 'gitlab', 'google', 'apple',
  'microsoft', 'openai', 'anthropic', 'nvidia', 'meta', 'amazon', 'aws', 'azure',
  'python', 'javascript', 'typescript', 'docker', 'linux', 'windows', 'macos',
]);

const MODEL_HINT = /\b(model|llm|flash|pro|lite|mini|turbo|instruct|nemotron|gemini|gpt|claude|llama|qwen|mistral|deepseek)\b/i;
const PRICING_HINT = /\b(free|pricing|price|cost|token|context|window|unlimited|credits?|subscription)\b/i;
const NEWS_HINT = /\b(launch|launched|release[ds]?|announce[ds]?|unveil|acquire[ds]?|shut ?down|deprecat|partners?hip|giving away|gives away)\b/i;

/**
 * Runs every verifier whose pattern matches, in parallel.
 *
 * Returns evidence rows in the same shape gatherEvidence produces, so nothing
 * downstream needs to know these came from an API rather than a search.
 */
export const runVerifiers = async (claimsData, transcript = '', ocrText = '', evidence = []) => {
  const tech = String((claimsData && claimsData.tech_name) || '').trim();
  const tools = (claimsData && claimsData.tools) || [];
  const claims = (claimsData && claimsData.claimed_features) || [];
  const haystack = [transcript, ocrText, claims.join(' '), tools.map((t) => t.claim || '').join(' ')].join(' ');

  const jobs = [];
  const seen = new Set();
  const once = (key, fn) => {
    if (seen.has(key)) return;
    seen.add(key);
    jobs.push(fn().catch(() => []));
  };

  // Packages named by the model, plus any install command spelled out anywhere.
  for (const tool of tools) {
    const cmd = String(tool.pip_command || '');
    const pip = cmd.match(/pip\s+install\s+([a-z0-9][a-z0-9._-]*)/i);
    if (pip) once(`pypi:${pip[1]}`, () => checkPypi(pip[1]));
  }
  for (const m of haystack.matchAll(/pip\s+install\s+([a-z0-9][a-z0-9._-]*)/gi)) {
    once(`pypi:${m[1]}`, () => checkPypi(m[1]));
  }
  for (const m of haystack.matchAll(/npm\s+i(?:nstall)?\s+(@?[a-z0-9][a-z0-9@/._-]*)/gi)) {
    once(`npm:${m[1]}`, () => checkNpm(m[1]));
  }
  // A bare tech name is worth a PyPI probe too - that is how "nanobot" vs
  // "nanobot-ai" gets settled rather than guessed.
  if (tech && /^[a-z0-9][a-z0-9._-]{2,40}$/i.test(tech)) {
    once(`pypi:${tech}`, () => checkPypi(tech.toLowerCase()));
  }

  const modelish = MODEL_HINT.test(haystack) || MODEL_HINT.test(tech);
  const pricingish = PRICING_HINT.test(haystack);
  if (tech && modelish) {
    once(`or:${tech}`, () => checkModel(tech));
    once(`hf:${tech}`, () => checkHuggingFace(tech));
  }
  // A pricing claim about a named model is the case the catalogue answers best.
  if (tech && pricingish && !modelish) {
    once(`or:${tech}`, () => checkModel(tech));
  }
  if (tech && NEWS_HINT.test(haystack)) {
    once(`hn:${tech}`, () => checkNews(tech));
  }

  // Tools named without a repo. These are the ones that later get invented,
  // denied, or matched to a fork - but chase only a couple.
  //
  // Firing on every extracted name flooded the evidence: "Telegram", "WhatsApp",
  // "ZArchitecture" and "Data Science Pipeline" each pulled a Hacker News row,
  // taking 5 of the 12 slots the model actually reads, and returning 2020-era
  // Belarus and Facebook stories with nothing to do with the post.
  let chased = 0;
  for (const tool of tools) {
    if (chased >= 2) break;
    const hasRepo = tool.github_repo && tool.github_repo !== 'null';
    const name = String(tool.name || '').trim();
    // A platform the tool integrates WITH is not what is being checked, and a
    // generic phrase ("Data Science Pipeline") is not a product name.
    if (hasRepo || name.length < 3 || PLATFORMS.has(name.toLowerCase())) continue;
    if (name.split(/\s+/).length > 2) continue;
    chased += 1;
    once(`ghname:${name}`, () => checkGitHubName(name));
    once(`ghrename:${name}`, () => checkGitHubRename(name));
    once(`hn:${name}`, () => checkNews(name));
  }

  // Claims that describe an action or a price are not answered by any registry.
  // The first half of this was written against one case - a "delete the log
  // file to reset your limit" reel - and it only ever recognised that shape.
  // Two later sets were built to exercise this check with earnings posts ("make
  // $100 a day with a laptop", "get paid to train AI") and it fired on neither,
  // because a money claim contains none of those verbs. Searching what people
  // say about a method is exactly what those posts need: the pay rate is the
  // claim, and no registry answers it.
  const TECHNIQUE_HINT = /\b(delete|remove|reset|bypass|unlock|trick|hack|disable|edit|patch|unlimited|forever|no limit|earn|earning|income|get paid|pays? (?:you|around|up to)?|per hour|per day|an hour|a day|side hustle|work from home|withdraw|payout|legit)\b/i;
  const PRICE_HINT = /\b(free|price|pricing|cost|month|monthly|plan|subscription|rupees|\$|Rs)\b/i;
  for (const c of claims.slice(0, 4)) {
    if (TECHNIQUE_HINT.test(c)) once(`tech:${c.slice(0, 30)}`, () => checkTechnique(c, tech));
  }
  if (claims.some((c) => PRICE_HINT.test(c)) || PRICE_HINT.test(haystack)) {
    once('pricing', () => checkPricing(evidence, tech, ocrText));
  }

  // Which routers fired is a fact about the run, not about the evidence, and it
  // is the only way to tell "the pricing check ran and found nothing" from "the
  // pricing check never ran". checkTechnique and checkPricing were both shipped
  // untested on a device; without this, a clean CSV row cannot distinguish them
  // working from them never being reached.
  const fired = [...seen];
  if (!jobs.length) return { rows: [], fired };
  const results = await Promise.all(jobs);
  return { rows: results.flat().filter(Boolean), fired };
};

export const __test = { checkPypi, checkModel, checkNews, checkGitHubName, checkGitHubRename, MODEL_HINT, PRICING_HINT, NEWS_HINT };
