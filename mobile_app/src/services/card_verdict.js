// Tool verdict (step 3: CARD_DESIGN.md section 6 + RUBRIC.md). Pure code, no model call.
// The reel's promises (claim reader v2 card) are compared with the filled Tool card.
const NF = 'not_found';
const RANK = { TRUE: 0, PARTIALLY_TRUE: 1, HYPE: 2, MISLEADING: 3, FAKE: 4 };
const worst = (vs) => vs.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'TRUE');

const SAYS_FREE = /\bfree\b|₹\s?0\b|\$\s?0\b|zero (?:rupees|cost|dollars)|no (?:api )?key|without (?:an? )?(?:api )?key|no subscription|no credit card|no (?:monthly )?(?:fee|cost)/i;
const SAYS_UNLIMITED = /unlimited|forever|no limits?|100% free|completely free|totally free|absolutely free/i;
const SAYS_OPEN = /open[- ]?source|\bMIT\b|apache|\bA?GPL\b|\bfoss\b/i;
const SAYS_LIGHT = /any (?:laptop|pc|computer|phone|device|machine)|no gpu|without (?:an? )?(?:\d+ ?gb )?gpu|low[- ]end|cpu[- ]only|old (?:laptop|pc|phone)/i;
const SAYS_SAFE = /\bsafe\b|official|no ban|secure|legit/i;
const FAMOUS = /^(chatgpt|claude|claude code|gemini|copilot|github copilot|cursor|n8n|ollama|ffmpeg|whisper|notion|canva|zapier|google sheets|whatsapp|perplexity|midjourney|stable diffusion|hugging ?face|langchain|weights & biases|wandb|vs ?code|docker|figma)$/i;
const PAID_TIER = /\b(?:claude|chatgpt|gpt|gemini|grok|kimi(?: k\d)?|perplexity|cursor|copilot|midjourney|notion|canva|youtube|spotify|linkedin)\s+(?:pro|premium|plus|max|ultra|advanced|business|team)\b/i;
const OSI_ID = /^(MIT|Apache-2\.0|BSD|BSD-[23]-Clause|ISC|MPL-2\.0|GPL|GPL-[23]\.0|LGPL|LGPL-[23]\.[01]|AGPL-3\.0|Unlicense|0BSD)$/i;

export const toolItemVerdict = (reader, f) => {
  const p = (reader && reader.promises) || {};
  const out = [];
  const add = (field, verdict, why) => out.push({ field, verdict, why });
  let checks = 0;

  // A live official link is the check that the tool is real. A failed lookup is never
  // "dead" (OCR misreads slugs), so FAKE is not concluded here.
  if (f.alive === 'live') { checks++; add('alive', 'TRUE', 'official link is live'); }
  if (f.alive === 'archived') { checks++; add('alive', 'PARTIALLY_TRUE', 'repo is archived (no longer maintained)'); }

  // A paid tier of a known product ("Claude Pro", "ChatGPT Plus") is paid by definition,
  // whatever free tier the base product has.
  const paidTier = PAID_TIER.test(String((reader && reader.name) || f.name || ''));
  const cost = paidTier ? 'paid' : (f.cost && f.cost.value) || NF;
  if (p.cost && SAYS_FREE.test(p.cost) && cost !== NF) {
    checks++;
    if (cost === 'paid') add('cost', 'MISLEADING', `post says "${p.cost}", but it has no free use`);
    else if (cost === 'needs_paid_key') add('cost', 'PARTIALLY_TRUE', `post says "${p.cost}", but it needs a paid key or account`);
    else if (cost === 'free_tier' && SAYS_UNLIMITED.test(p.cost)) add('cost', 'HYPE', `post says "${p.cost}", but the free use has limits`);
    else add('cost', 'TRUE', 'free to use' + (cost === 'free_tier' ? ' (normal free tier)' : ''));
  } else if (cost === 'needs_paid_key' || cost === 'paid') {
    // A blocking catch the post does not mention.
    checks++;
    add('cost', 'PARTIALLY_TRUE', cost === 'paid' ? 'paid product (post does not say)' : 'needs a paid key or account (post does not say)');
  }

  const lic = String(f.license || NF);
  if (p.license && SAYS_OPEN.test(p.license) && lic !== NF && lic !== 'other') {
    checks++;
    if (OSI_ID.test(lic)) add('license', 'TRUE', `open source (${lic})`);
    else if (lic === 'source_available') add('license', 'PARTIALLY_TRUE', 'source-available, not OSI open source (use limits)');
    else if (lic === 'none') add('license', 'MISLEADING', 'post says open source, but the repo has no license file');
  }

  const heavy = f.needs && f.needs.heavy;
  if (heavy === true) {
    checks++;
    if (p.needs && SAYS_LIGHT.test(p.needs)) add('needs', 'HYPE', `post says "${p.needs}", but it needs: ${f.needs.value}`);
    else add('needs', 'PARTIALLY_TRUE', `needs ${f.needs.value} (post does not say)`);
  } else if (heavy === false && p.needs) { checks++; add('needs', 'TRUE', 'requirements fit'); }

  // Safety changes the verdict only when the post promised safe / official (decision 10.4).
  const flags = (f.safety || []).map((s) => s.flag);
  if (p.safety && SAYS_SAFE.test(p.safety) && flags.length) {
    checks++;
    if (/official/i.test(p.safety) && flags.some((x) => /unofficial/.test(x))) add('safety', 'MISLEADING', 'post says official, the README says unofficial');
    else add('safety', 'PARTIALLY_TRUE', `post says "${p.safety}", but: ${flags.join('; ')}`);
  }

  if (reader && reader.claims_secret) {
    const stars = (f.activity && f.activity.stars) || 0;
    if (stars >= 10000 || FAMOUS.test(String(f.name || '').trim())) {
      checks++;
      add('secret', 'HYPE', `called secret/hidden, but it is well known (${stars ? stars + ' stars' : 'famous product'})`);
    }
  }
  return { verdict: checks ? worst(out.map((x) => x.verdict)) : 'UNVERIFIED', reasons: out };
};

// Post verdict = the worst item; items with nothing checked do not count.
export const toolVerdict = (readerCard, filled) => {
  const items = ((readerCard && readerCard.items) || []).map((r, i) => {
    const f = ((filled && filled.items) || [])[i] || {};
    return { name: f.name || r.name, ...toolItemVerdict(r, f) };
  });
  const checked = items.filter((x) => x.verdict !== 'UNVERIFIED');
  return { verdict: checked.length ? worst(checked.map((x) => x.verdict)) : 'UNVERIFIED', items };
};
