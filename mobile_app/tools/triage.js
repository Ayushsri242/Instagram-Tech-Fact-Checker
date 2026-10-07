// Find the runs worth looking at, without knowing the right answer.
//
// Scoring a batch used to mean System 1 capturing every post by hand - download,
// read the frames, verify every claim against live APIs - before a single row
// could be judged. That does not scale past a handful of links, and it is why
// four sessions produced twenty-three cases instead of two hundred.
//
// But most bad runs announce themselves. The pipeline already records that it
// abstained on the subject, that it read two slides out of eight, that the audio
// was silent, that it printed a repo no fetched page mentions. None of that
// needs ground truth: it is the run admitting it was working blind.
//
// So: run the app normally, share one CSV, and let this pick the suspects. Only
// those get the expensive treatment.
//
//   node tools/triage.js ../runs_set8.csv
//   node tools/triage.js ../runs_set8.csv --all     (print clean rows too)
const fs = require('fs');

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
  const filled = rows.filter((r) => r[0]);
  const kept = filled.filter((r) => r.length === header.length);
  // Never drop rows silently: set 9 lost 8 of 20 here to a header from an
  // older build, and the batch looked smaller instead of broken.
  if (kept.length < filled.length) {
    console.error('WARNING: dropped ' + (filled.length - kept.length) + ' of ' + filled.length +
      ' rows whose column count does not match the header (' + header.length + ' columns).' +
      ' The file mixes builds; split it before scoring.');
  }
  return kept.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
};

const json = (s, fallback) => { try { return JSON.parse(s); } catch (e) { return fallback; } };
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Each check returns a reason string when it fires. Severity decides the order
// you read them in: "blind" means the run could not have been right, "suspect"
// means it might not be.
const CHECKS = [
  {
    id: 'error',
    severity: 'blind',
    test: (r) => (r.error ? 'run failed: ' + r.error.slice(0, 80) : null),
  },
  {
    id: 'coverage',
    severity: 'blind',
    // The post numbers its own slides, so the gap is the post's word against
    // the pipeline's. Every confident denial of a real tool has come from here.
    test: (r) => (r.coverage ? 'incomplete extraction: ' + r.coverage : null),
  },
  {
    id: 'no-text',
    severity: 'blind',
    test: (r) => (num(r.ocrChars) + num(r.speechChars) < 200
      ? 'almost nothing readable: ocr ' + num(r.ocrChars) + ', speech ' + num(r.speechChars)
      : null),
  },
  {
    id: 'silent-audio',
    severity: 'suspect',
    test: (r) => (/silent=true/.test(r.sttStats || '') && num(r.speechChars) > 0
      ? 'silent track still produced a transcript'
      : null),
  },
  {
    id: 'stt-garbage',
    severity: 'suspect',
    // keptLens=[4,1,4,3] is the shape of Whisper answering noise. Case 5 kept
    // eight such chunks and nothing noticed.
    test: (r) => {
      const m = (r.sttStats || '').match(/keptLens=\[([\d,]*)\]/);
      if (!m || !m[1]) return null;
      const lens = m[1].split(',').map(Number).filter((n) => n > 0);
      if (lens.length < 2) return null;
      const tiny = lens.filter((n) => n < 12).length;
      return tiny > lens.length / 2 ? 'most speech chunks are a few characters: ' + m[1] : null;
    },
  },
  {
    id: 'no-subject',
    severity: 'suspect',
    test: (r) => (!r.subjectName ? 'subject not confirmed: ' + (r.subjectWhy || '') : null),
  },
  {
    id: 'subject-vs-report',
    severity: 'suspect',
    // The picker abstained and the report named something anyway - the failure
    // that published a creator's Instagram handle as the product under test.
    test: (r) => (!r.subjectName && r.techName && r.techName !== 'Unidentified'
      ? 'picker abstained but report titled it "' + r.techName + '"'
      : null),
  },
  {
    id: 'invented-repo',
    severity: 'blind',
    // A repo in the report that appears in no fetched page and nowhere in the
    // post itself. Four sets running, every set had at least one.
    test: (r) => {
      const report = json(r.reportJson, {});
      const evidence = json(r.evidenceJson, []);
      // fetchedRepos lists every repo the run fetched; evidenceJson holds only
      // the 12 rows kept, so without it real fetched repos read as invented.
      const hay = (
        (r.fetchedRepos || '') + ' ' +
        evidence.map((e) => (e.u || '') + ' ' + (e.t || '')).join(' ') +
        ' ' + (r.ocrText || '') + ' ' + (r.caption || '')
      ).toLowerCase();
      const bad = (report.tools || [])
        .map((t) => t.repo)
        .filter((repo) => repo && !hay.includes(String(repo).toLowerCase()));
      return bad.length ? 'repo not in evidence or post: ' + bad.join(', ') : null;
    },
  },
  {
    id: 'invented-install',
    severity: 'blind',
    test: (r) => {
      const report = json(r.reportJson, {});
      const evidence = json(r.evidenceJson, []);
      const hay = (
        evidence.map((e) => (e.u || '') + ' ' + (e.t || '')).join(' ') +
        ' ' + (r.ocrText || '') + ' ' + (r.caption || '')
      ).toLowerCase();
      const bad = [];
      for (const t of report.tools || []) {
        // Skip flags such as -U / --upgrade to reach the package name.
        const m = String(t.install || '').match(/(?:pip3? install|npm i(?:nstall)?|npx)\s+(?:-{1,2}[\w-]+\s+)*(@?[\w./-]+)/i);
        if (m && !hay.includes(m[1].toLowerCase())) bad.push(m[1]);
      }
      return bad.length ? 'install command for an unseen package: ' + bad.join(', ') : null;
    },
  },
  {
    id: 'fake-without-search',
    severity: 'blind',
    // "This does not exist" is only credible if the looking was any good.
    test: (r) => (r.verdict === 'FAKE' && num(r.keptWithPageText) < 4
      ? 'called FAKE with only ' + num(r.keptWithPageText) + ' sources carrying page text'
      : null),
  },
  {
    id: 'rule-changed-verdict',
    severity: 'suspect',
    test: (r) => (r.verdictRaw && r.verdict !== r.verdictRaw
      ? 'code changed the verdict: ' + r.verdictRaw + ' -> ' + r.verdict +
        (r.evidenceRules ? ' (' + r.evidenceRules.slice(0, 60) + ')' : '')
      : null),
  },
  {
    id: 'low-confidence',
    severity: 'suspect',
    test: (r) => {
      const m = (r.confidence || '').match(/^(\d+)/);
      return m && Number(m[1]) < 60 ? 'self-reported confidence ' + r.confidence.slice(0, 70) : null;
    },
  },
  {
    id: 'thin-evidence',
    severity: 'suspect',
    test: (r) => (num(r.keptWithPageText) < 5
      ? 'only ' + num(r.keptWithPageText) + ' of ' + (num(r.keptRows) || 12) + ' sources had page text'
      : null),
  },
  {
    id: 'no-verifiers',
    severity: 'suspect',
    test: (r) => (!r.verifiersFired ? 'no structured verifier ran at all' : null),
  },
  {
    id: 'slow',
    severity: 'suspect',
    test: (r) => (num(r.durationMs) > 90000 ? 'took ' + Math.round(num(r.durationMs) / 1000) + 's' : null),
  },
];

const showAll = process.argv.includes('--all');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const rows = files.flatMap((f) => parseCsv(fs.readFileSync(f, 'utf8')));

let blind = 0, suspect = 0, clean = 0;
const tally = {};

for (const r of rows) {
  const hits = [];
  for (const check of CHECKS) {
    let reason = null;
    try { reason = check.test(r); } catch (e) { reason = 'check ' + check.id + ' threw: ' + e.message; }
    if (reason) {
      hits.push({ ...check, reason });
      tally[check.id] = (tally[check.id] || 0) + 1;
    }
  }
  const worst = hits.some((h) => h.severity === 'blind') ? 'blind' : hits.length ? 'suspect' : 'clean';
  if (worst === 'blind') blind++; else if (worst === 'suspect') suspect++; else clean++;
  if (worst === 'clean' && !showAll) continue;
  const label = worst === 'blind' ? 'BLIND  ' : worst === 'suspect' ? 'SUSPECT' : 'clean  ';
  console.log('\n' + label + '  ' + r.shortcode + '  [' + r.verdict + ']  ' + (r.techName || ''));
  for (const h of hits) console.log('   - (' + h.id + ') ' + h.reason);
  if (worst !== 'clean') {
    try {
      const claims = JSON.parse(r.claimsJson || '{}');
      if (claims.search_queries && claims.search_queries.length) {
        console.log('     * Queries: ' + claims.search_queries.join(', '));
      }
      if (claims.tools && claims.tools.length) {
        console.log('     * Tools Found: ' + claims.tools.map(t => t.name).join(', '));
      }
    } catch (e) {}
  }
}

console.log('\n' + '-'.repeat(60));
console.log('rows ' + rows.length + '   blind ' + blind + '   suspect ' + suspect + '   clean ' + clean);
const flagged = blind + suspect;
console.log('flagged ' + flagged + '/' + rows.length +
  ' (' + (rows.length ? Math.round((flagged / rows.length) * 100) : 0) + '%)' +
  ' - ground-truth only these');
const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
if (ranked.length) {
  console.log('\nmost common problems:');
  for (const [id, n] of ranked) console.log('  ' + String(n).padStart(3) + '  ' + id);
}
