// Tool card fields (Nov 28, CARD_DESIGN.md 4.1 and 11 B). Not wired into the app yet.
//
// Code fills every field it can (link, alive, maker, license, activity, what it
// does, safety flags) from fixed sources: the GitHub API and the tool's own site.
// One model call reads cost and needs for ALL items from passages code picked
// from those same sources; every answer carries a quote that code checks.
// Bad news (paid, needs a paid key, heavy needs) is asked a second time in a
// different way; if the two answers disagree the field is not_found.
import { githubLookup, githubSearch, readPage } from './verifiers';

const NF = 'not_found';
const key = (s) => String(s || '').toLowerCase().replace(/^\s*\d{1,3}\s*[.):-]\s*/, '').replace(/[^a-z0-9]/g, '');
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9$₹]+/g, ' ').trim();
const SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const host = (u) => (String(u || '').match(/^(?:https?:\/\/)?([^/?#\s]+)/i) || [])[1] || '';

const COST_WORDS = /no api key|without an api key|ollama|lm studio|local model|runs locally|free|\$|₹|€|price|pricing|plan|subscription|credit|api key|api_key|token|paid|pay|cost|licen[cs]e|open[- ]?source|trial|billing|account/i;
const NEEDS_WORDS = /gpu|vram|\bram\b|\d\s?gb|cpu|cuda|nvidia|apple silicon|windows|mac|linux|android|ios|docker|python|node|requir|install|key|account|browser|chrome/i;

// Safety flags a source shows (decision 10.4: never guessed).
const SAFETY_TERMS = [
  [/\bunofficial\b|not affiliated|not endorsed/i, 'the README says it is unofficial / not affiliated'],
  [/(?:get|be|result in|risk(?:s)?(?: of)?)[^.]{0,30}\bban(?:ned)?\b|account[^.]{0,30}(?:suspend|restrict|ban)/i, 'the README warns of account bans or restrictions'],
  [/against[^.]{0,25}terms of service|violat[^.]{0,25}terms|\bToS\b/i, 'the README mentions terms-of-service risk'],
];
// License file text -> an id (GitHub says NOASSERTION for these).
const OSI = /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|MPL-2\.0|GPL-[23]\.0|LGPL-[23]\.[01]|AGPL-3\.0|Unlicense|0BSD|other_osi)/;
export const licenseFromText = (t) => {
  const s = String(t || '');
  // The file's own heading wins: an MIT file that mentions data terms further down is still MIT.
  const head = s.slice(0, 300);
  if (/^\s*MIT License/i.test(head) || /permission is hereby granted, free of charge/i.test(head)) return 'MIT';
  if (/^\s*Apache License/i.test(head)) return 'Apache-2.0';
  if (/functional source license|business source license|sustainable use license|elastic license|commons clause|server side public license|non-?commercial|fair source|polyform/i.test(s)) return 'source_available';
  if (/gnu affero general public license/i.test(s)) return 'AGPL-3.0';
  if (/gnu lesser general public license/i.test(s)) return 'LGPL';
  if (/gnu general public license/i.test(s)) return 'GPL';
  if (/apache license[\s,]+version 2\.0/i.test(s)) return 'Apache-2.0';
  if (/permission is hereby granted, free of charge/i.test(s)) return 'MIT';
  if (/redistribution and use in source and binary forms/i.test(s)) return 'BSD';
  return 'other';
};
const sentenceAround = (text, idx) => {
  const start = Math.max(0, text.lastIndexOf('.', idx) + 1);
  const end = text.indexOf('.', idx);
  return text.slice(start, end === -1 ? idx + 160 : end + 1).trim().slice(0, 240);
};
const safetyFlags = (gh, readme) => {
  const out = [];
  const d = gh && gh.data;
  if (d && d.fork) out.push({ flag: `fork of ${(d.parent && d.parent.full_name) || 'another repo'}`, source: d.html_url });
  if (d && d.archived) out.push({ flag: 'archived (read-only)', source: d.html_url });
  if (d && !d.license) out.push({ flag: 'no license file', source: d.html_url });
  const text = String(readme || '').replace(/\s+/g, ' ');
  if (/\.apk\b/i.test(text)) out.push({ flag: 'installs an APK outside the Play Store', source: d && d.html_url, quote: sentenceAround(text, text.search(/\.apk\b/i)) });
  for (const [re, flag] of SAFETY_TERMS) {
    const i = text.search(re);
    if (i !== -1) out.push({ flag, source: d && d.html_url, quote: sentenceAround(text, i) });
  }
  return out;
};

// Passages for one field: the source split into ~450-char chunks, best few by keyword hits.
const passages = (text, re, k = 3) => {
  const t = String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const chunks = [];
  for (let i = 0; i < t.length && chunks.length < 60; i += 400) chunks.push(t.slice(i, i + 450));
  const g = new RegExp(re.source, 'gi');
  return chunks.map((c, i) => ({ c, i, n: (c.match(g) || []).length }))
    .filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.i - b.i).slice(0, k)
    .sort((a, b) => a.i - b.i).map((x) => x.c);
};

// ---- link + code fields --------------------------------------------------------
const resolveItem = async (item, ctx) => {
  const out = { name: item.name, official_link: NF, alive: NF, maker: NF, license: NF, activity: null, what_it_does: NF, safety: [] };
  let gh = null;
  const tries = [];
  if (item.github_repo && SLUG.test(item.github_repo)) tries.push(item.github_repo);
  for (const s of ctx.printedRepos || []) {
    const repo = s.split('/')[1];
    if (key(repo) && (key(repo).includes(key(item.name)) || key(item.name).includes(key(repo))) && !tries.includes(s)) tries.push(s);
  }
  for (const slug of tries) { gh = await githubLookup(slug); if (gh) break; }
  // GitHub search only for posts that talk about GitHub / open source, and only on an exact name match.
  if (!gh && ctx.githubPost && key(item.name).length >= 4) {
    const hit = (await githubSearch(item.name)).find((r) => key(r.name) === key(item.name));
    if (hit) gh = await githubLookup(hit.full_name);
  }
  // Fixed search when the reader gave no link: "<name> github" on GitHub posts, else "<name> official site".
  // A result counts only if every word of the name is in its title or address.
  let searchedSite = '';
  if (!gh && !host(item.domain) && ctx.search && ctx.searches < 3) {
    ctx.searches++;
    const words = norm(item.name).split(' ').filter((w) => w.length >= 3);
    const rows = await ctx.search([item.name + (ctx.githubPost ? ' github' : ' official site')]).catch(() => []);
    const hitRow = (rows || []).find((r) => {
      const hay = norm((r.title || '') + ' ' + (r.url || ''));
      return words.length && words.every((w) => hay.includes(w)) && !/reddit|youtube|medium\.com|linkedin|instagram|twitter|x\.com/i.test(r.url || '');
    });
    if (hitRow) {
      const m = String(hitRow.url).match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
      if (m) gh = await githubLookup(m[1]);
      else searchedSite = host(hitRow.url);
    }
  }
  let siteText = '';
  if (gh) {
    const d = gh.data;
    out.official_link = d.html_url;
    out.alive = d.archived ? 'archived' : 'live';
    out.maker = (d.owner && d.owner.login) || NF;
    const lic = d.license && d.license.spdx_id;
    out.license = !d.license ? 'none' : lic === 'NOASSERTION' ? licenseFromText(gh.licenseText) : lic;
    out.activity = { stars: d.stargazers_count, last_push: String(d.pushed_at || '').slice(0, 10),
      last_release: gh.release ? `${gh.release.tag_name} (${String(gh.release.published_at || '').slice(0, 10)})` : null };
    if (d.description) out.what_it_does = { value: d.description, source: d.html_url };
    out.safety = safetyFlags(gh, gh.readme);
  } else {
    const dom = host(item.domain) || searchedSite;
    if (dom && dom.includes('.')) {
      siteText = await readPage('https://' + dom, 6000);
      if (siteText && !/Target URL returned error \d+/i.test(siteText)) {
        out.official_link = 'https://' + dom + '/';
        out.alive = 'live';
        const title = (siteText.match(/^Title:\s*(.{3,120}?)\s+URL Source:/) || [])[1];
        if (title) out.what_it_does = { value: title, source: out.official_link };
      } else siteText = '';
    }
  }
  // Sources the model may read, all the item's own.
  const sources = [];
  if (gh) {
    const d = gh.data;
    sources.push({ url: d.html_url, text: `GitHub facts: license ${out.license}; ${d.description || ''}` });
    if (gh.readme) sources.push({ url: d.html_url + '#readme', text: gh.readme.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') });
    if (d.homepage && /^https?:/.test(d.homepage) && !/github\.com/.test(d.homepage)) {
      const t = await readPage(d.homepage, 5000);
      if (t) sources.push({ url: d.homepage, text: t });
    }
  }
  if (siteText) {
    sources.push({ url: out.official_link, text: siteText });
    const p = await readPage(out.official_link + 'pricing', 5000);
    if (p && !/Target URL returned error \d+/i.test(p) && /pric|plan|free|\$/i.test(p)) sources.push({ url: out.official_link + 'pricing', text: p });
  }
  return { out, sources };
};

// ---- model fields ----------------------------------------------------------------
const buildPack = (items) => items.map((it, n) => {
  const take = (re) => it.sources.flatMap((s) => passages(s.text, re, 2).map((c) => ({ url: s.url, c }))).slice(0, 4);
  const lines = [...take(COST_WORDS), ...take(NEEDS_WORDS)];
  const seen = new Set();
  const uniq = lines.filter((l) => (seen.has(l.c) ? false : seen.add(l.c)));
  return `### Item ${n + 1}: ${it.out.name}\n` + (uniq.length ? uniq.map((l) => `[${l.url}] ${l.c}`).join('\n') : '(no source text found)');
}).join('\n\n');

const checkQuote = (item, quote, re) => {
  const q = norm(quote);
  if (q.length < 4 || !re.test(String(quote))) return null;
  const src = item.sources.find((s) => norm(s.text).includes(q));
  return src ? src.url : null;
};

export const fillToolCard = async (card, { ask, search, printedRepos = [], postText = '' } = {}) => {
  const items = ((card && card.items) || []).slice(0, 7);
  const githubPost = /github|open[- ]?source|repo\b/i.test(postText) || printedRepos.length > 0;
  const resolved = [];
  const ctx = { printedRepos, githubPost, search, searches: 0 };
  for (const it of items) resolved.push(await resolveItem(it, ctx));
  const stats = { calls: 0 };
  const withText = resolved.filter((r) => r.sources.length);
  for (const r of resolved) { r.out.cost = { value: NF }; r.out.needs = { value: NF, heavy: null }; }
  if (withText.length && ask) {
    const prompt = [
      'For each software tool below, read ONLY the passages given for it (from its own repo, README or site) and answer two questions.',
      'cost.value: "free" (fully free to use, no paid key needed) | "free_tier" (free with limits; paid plans exist) | "paid" (no free use) | "needs_paid_key" (the tool is free but needs a paid API key or paid account to work; a free or local option documented = "free") | "not_found".',
      'needs.value: what a normal person must have to run it (GPU/VRAM, OS, phone version, Docker, an account, an API key), under 15 words, or "not_found". needs.heavy: true only if it would stop a normal laptop user (big GPU, one OS only, paid account); ordinary installs are not heavy.',
      'Every answer needs "quote": exact words copied from that item\'s passages that show it. No quote, no answer: use "not_found".',
      '',
      buildPack(withText.map((r) => r)),
      '',
      'Respond ONLY with JSON: {"items":[{"n":1,"cost":{"value":"free","detail":"the catch in under 12 words, or empty","quote":"exact words"},"needs":{"value":"short","heavy":false,"quote":"exact words"}}]}',
    ].join('\n');
    try {
      const ans = await ask([{ role: 'system', content: 'You read software documentation precisely. Output strictly valid JSON.' }, { role: 'user', content: prompt }],
        (d) => d && Array.isArray(d.items));
      stats.calls++;
      for (const a of ans.items || []) {
        const r = withText[Number(a.n) - 1];
        if (!r) continue;
        const c = a.cost || {};
        const cs = c.value && c.value !== NF ? checkQuote(r, c.quote, COST_WORDS) : null;
        if (cs) r.out.cost = { value: c.value, detail: c.detail || '', source: cs, quote: c.quote };
        const nd = a.needs || {};
        const ns = nd.value && nd.value !== NF ? checkQuote(r, nd.quote, NEEDS_WORDS) : null;
        if (ns) r.out.needs = { value: nd.value, heavy: Boolean(nd.heavy), source: ns, quote: nd.quote };
      }
    } catch (e) { stats.error = e.message; }

    // Bad news asked again, as a yes/no question (rule 11 B4).
    const doubt = withText.filter((r) => ['paid', 'needs_paid_key'].includes(r.out.cost.value) || r.out.needs.heavy);
    if (doubt.length) {
      const qs = doubt.map((r, i) => {
        const qList = [];
        if (['paid', 'needs_paid_key'].includes(r.out.cost.value)) qList.push(`q${i + 1}a: Can a normal person use ${r.out.name} without paying anything (no paid plan, no paid API key, no paid account)?`);
        if (r.out.needs.heavy) qList.push(`q${i + 1}b: Can ${r.out.name} run on an ordinary laptop (no large GPU, any common OS)?`);
        return qList.join('\n');
      }).join('\n');
      const prompt2 = ['Answer each question ONLY from the passages. Answer "yes", "no" or "unclear", with an exact quote.', '',
        buildPack(doubt), '', qs, '', 'Respond ONLY with JSON: {"answers":[{"id":"q1a","answer":"no","quote":"exact words"}]}'].join('\n');
      try {
        const ans2 = await ask([{ role: 'system', content: 'You read software documentation precisely. Output strictly valid JSON.' }, { role: 'user', content: prompt2 }],
          (d) => d && Array.isArray(d.answers));
        stats.calls++;
        const by = Object.fromEntries((ans2.answers || []).map((a) => [String(a.id), String(a.answer || '').toLowerCase()]));
        doubt.forEach((r, i) => {
          if (['paid', 'needs_paid_key'].includes(r.out.cost.value) && by[`q${i + 1}a`] !== 'no') r.out.cost = { value: NF, disagreed: r.out.cost.value };
          if (r.out.needs.heavy && by[`q${i + 1}b`] !== 'no') r.out.needs = { ...r.out.needs, heavy: null, disagreed: true };
        });
      } catch (e) {
        // Could not confirm: never keep unconfirmed bad news.
        doubt.forEach((r) => {
          if (['paid', 'needs_paid_key'].includes(r.out.cost.value)) r.out.cost = { value: NF, disagreed: 'unconfirmed' };
          if (r.out.needs.heavy) r.out.needs = { ...r.out.needs, heavy: null };
        });
      }
    }
  }
  // An OSI open-source license is itself a source for "free to use" when the docs name no
  // paid plan or paid key (the model found nothing either way).
  for (const r of resolved) {
    if (r.out.cost.value === NF && !r.out.cost.disagreed && OSI.test(String(r.out.license))) {
      r.out.cost = { value: 'free', detail: 'open-source license; no paid plan or paid key found in its docs', source: r.out.official_link, quote: 'license ' + r.out.license, basis: 'license' };
    }
  }
  stats.searches = ctx.searches;
  return { items: resolved.map((r) => r.out), stats };
};
