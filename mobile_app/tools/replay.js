// Replay a recorded run log through the pipeline's pure stages, on a laptop,
// with no device, no Instagram fetch and no API call.
//
// Why this exists: three test sets were scored by running five posts on a phone
// and reading one verdict word out of each. That costs a build, a download and
// a paid model call per case, so the cheap move was always to fix against a
// single reel and re-test on that same reel - the most expensive mistake of the
// last two sessions. The 39-column run log now stores the whole input
// (transcript, OCR, the twelve evidence rows), so the stages that are pure
// functions can be re-run in a second against every case ever recorded.
//
// It scores the stages separately, because a single verdict word hides which
// half is broken: a post whose slides were never loaded and a post whose
// subject was misidentified both come out as one wrong word.
//
//   node tools/replay.js ../runs_set3b.csv [more.csv ...]
//
// Stages scored:
//   SEEING  - did extraction actually cover the post
//   NAMING  - did the subject picker choose the thing the post is about
//   INVENT  - does the report assert repos or installs no evidence row supports
//   VERDICT - against the System 1 verdict recorded in TEST_LOG.md
const fs = require('fs');
const path = require('path');
const Module = require('module');

// api.js imports react-native and the app's own storage layer. None of that is
// reachable in node, and none of it is needed for the pure stages.
const STUBS = {
  'react-native': { NativeModules: { TechFactChecker: null } },
  'expo-file-system': { documentDirectory: '', getInfoAsync: async () => ({ exists: false }) },
  axios: { post: async () => { throw new Error('replay does not call the network'); } },
  'expo-secure-store': { getItemAsync: async () => null, setItemAsync: async () => {} },
  '@react-native-async-storage/async-storage': { getItem: async () => null, setItem: async () => {} },
};
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return realLoad(request, parent, isMain);
};

require('@babel/register')({
  presets: [require.resolve('@babel/preset-env')],
  plugins: [require.resolve('@babel/plugin-syntax-jsx')],
  only: [path.join(__dirname, '..', 'src')],
  babelrc: false,
  configFile: false,
});

const { __test } = require('../src/services/api');
const { pickSubject, normalizeReport } = __test;

const EXPECTED = require('./expected.json');

// Minimal RFC4180 reader. The run log embeds JSON in quoted cells, so a split
// on commas silently shreds every interesting column.
const parseCsv = (text) => {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift();
  return rows
    .filter((r) => r.length === header.length && r[0])
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
};

const json = (s, fallback) => { try { return JSON.parse(s); } catch (e) { return fallback; } };
const occurrences = (needle, hay) => {
  const n = String(needle || '').toLowerCase();
  if (n.length < 3) return 0;
  const h = String(hay || '').toLowerCase();
  let count = 0, i = 0;
  while ((i = h.indexOf(n, i)) !== -1) { count++; i += n.length; }
  return count;
};

const results = [];
for (const file of process.argv.slice(2)) {
  for (const run of parseCsv(fs.readFileSync(file, 'utf8'))) {
    const want = EXPECTED[run.shortcode];
    if (!want) { console.log('no expectation recorded for ' + run.shortcode + ', skipping'); continue; }
    const evidence = json(run.evidenceJson, []).map((e) => ({ title: e.t, url: e.u, pagePreview: 'x'.repeat(e.p || 0) }));
    const report = json(run.reportJson, {});

    // SEEING. A carousel is covered when as many images were OCR'd as the post
    // has slides. A reel is covered when the frames carried text at all.
    const used = Number(run.imagesUsed || 0);
    const seeing = want.slides
      ? { ok: used >= want.slides, detail: used + '/' + want.slides + ' slides' }
      : { ok: Number(run.ocrChars || 0) > 0, detail: run.ocrChars + ' ocr chars' };

    // NAMING. Re-run the picker on the recorded inputs, so a change to
    // pickSubject is measurable here without touching a phone.
    const picked = pickSubject(json(run.claimsJson, {}).tech_name, evidence, run.ocrText);
    // "prime-agent" the repo and "Prime Agent" the product are the same answer.
    const flat = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const naming = {
      ok: flat(picked.name) === flat(want.subject),
      detail: (picked.name || '(abstained)') + '  [' + picked.why + ']',
      hits: occurrences(picked.name, run.ocrText),
    };

    // INVENT. Every repo and install the report prints must be traceable to a
    // row the model was actually given. Four sets have produced a fabricated
    // repo, package or spec in every single case.
    const evidenceText = evidence.map((e) => e.url + ' ' + e.title).join(' ').toLowerCase();
    const invented = [];
    for (const tool of report.tools || []) {
      if (tool.repo && !evidenceText.includes(String(tool.repo).toLowerCase())) invented.push('repo ' + tool.repo);
      const pkg = String(tool.install || '').match(/(?:pip install|npm i(?:nstall)?|npx)\s+(@?[\w./-]+)/i);
      if (pkg && !evidenceText.includes(pkg[1].toLowerCase())) invented.push('install ' + pkg[1]);
    }
    const verdict = { ok: run.verdict === want.verdict, detail: run.verdict + ' vs ' + want.verdict };

    results.push({ shortcode: run.shortcode, seeing, naming, invent: { ok: !invented.length, detail: invented.join(', ') || 'none' }, verdict });
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('case', 14) + pad('SEEING', 22) + pad('NAMING', 40) + pad('INVENTED', 26) + 'VERDICT');
for (const r of results) {
  const mark = (s) => (s.ok ? '. ' : 'X ');
  console.log(
    pad(r.shortcode, 14) +
    pad(mark(r.seeing) + r.seeing.detail, 22) +
    pad(mark(r.naming) + r.naming.detail, 40).slice(0, 40) +
    pad(mark(r.invent) + r.invent.detail, 26).slice(0, 26) +
    mark(r.verdict) + r.verdict.detail
  );
}
const score = (k) => results.filter((r) => r[k].ok).length + '/' + results.length;
console.log('\nseeing ' + score('seeing') + '   naming ' + score('naming') +
  '   no-invention ' + score('invent') + '   verdict ' + score('verdict'));
