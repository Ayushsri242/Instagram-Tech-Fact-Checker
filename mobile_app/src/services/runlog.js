import * as FileSystem from 'expo-file-system';

// One CSV row per analysis run.
//
// Reading five runs out of Metro scrollback is how a batch turns back into
// single-reel tinkering: the numbers are there, but not side by side, so the
// pattern never surfaces. A CSV makes five runs comparable in one glance.

const FILE = FileSystem.documentDirectory + 'factcheck_runs.csv';
const OLD_FILE = FileSystem.documentDirectory + 'factcheck_runs_old.csv';

const COLUMNS = [
  'timestamp',
  'shortcode',
  'url',              // the link as pasted, so a batch can be re-run from the CSV alone
  'verdict',
  'verdictRaw',       // before the deterministic rules ran
  'techName',
  'ocrChars',
  'speechChars',
  'captionChars',
  'toolsOut',
  'toolsVerified',
  'toolsNotFound',
  'install',
  'structuredRows',
  'searchRows',
  'keptRows',
  'keptWithPageText',
  'evidenceRules',    // what code overrode, ; separated
  'claims',
  'gotchas',
  'durationMs',
  'error',
  // Everything below is here so a batch can be analysed from this file alone.
  // Logcat rolls within minutes, screenshots crop the report, and pasting Metro
  // scrollback per run turns a five-post batch back into single-reel tinkering.
  'coverage',         // "2/8 slides" when the post declares more than were read
  'confidence',       // derived score plus the reasons it was reduced
  'subjectName',      // what the picker chose, not what the model said
  'subjectWhy',       // which path chose it: verified repo, model name, or abstain
  'verifiersFired',   // pypi/npm/hf/hn/pricing/technique/rename keys that ran
  'stageMs',          // native, claims, search, verifiers, pagefill, synthesis
  'mediaSource',      // WEBVIEW or RENDER
  'mediaType',
  'extractVia',       // TIER_A_SNIFF or TIER_B_HTML
  'slidesJson',       // carousel coverage: what the embed's JSON offered
  'slidesDom',        // what the DOM offered
  'imagesUsed',       // what OCR actually saw
  'ocrLens',          // per image or frame, comma separated
  'sttStats',         // rate/ch/enc/peak/rms and the chunk tally
  'candidates',       // image URLs kept, for cross-post contamination
  'claimsJson',       // stage 1 output and the queries it produced
  'evidenceJson',     // the 12 rows the model actually read
  'reportJson',       // the rendered card: the only record of what it claimed
  'transcript',
  'ocrText',
  'caption',          // the picker weights caption mentions above slide mentions
  'author',           // so a replay can reject the creator's own handle
  'fetchedRepos',     // every GitHub repo actually fetched, not just the 12 kept rows
  'postMode',         // 'money' (side hustle / earnings, checked against user reviews) or 'tech'
  'models',           // which model answered each job, e.g. "extract=qwen3.8-27b verdict=gpt-oss-120b"
  'title',            // the title the app shows (techName above is the model's raw name)
  'tokens',           // per job: model, input/output/cached tokens as Groq reported; total counts toward the daily limit
];

const cell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""').replace(/\n/g, ' ') + '"' : s;
};

export const logRun = async (fields) => {
  try {
    const header = COLUMNS.join(',');
    const line = COLUMNS.map((c) => cell(fields[c])).join(',');
    const info = await FileSystem.getInfoAsync(FILE);
    const existing = info.exists ? await FileSystem.readAsStringAsync(FILE) : '';
    // A file written by an older build has an older header. Appending to it
    // shifted every column after the new one (set 9: `url` was added, the
    // header was not, and triage silently dropped the 8 newest rows). Start a
    // fresh file instead; the old one is kept once, as _old.
    if (existing && existing.slice(0, existing.indexOf('\n')) !== header) {
      await FileSystem.deleteAsync(OLD_FILE, { idempotent: true });
      await FileSystem.moveAsync({ from: FILE, to: OLD_FILE });
      await FileSystem.writeAsStringAsync(FILE, header + '\n' + line + '\n');
    } else if (!existing) {
      await FileSystem.writeAsStringAsync(FILE, header + '\n' + line + '\n');
    } else {
      await FileSystem.writeAsStringAsync(FILE, existing + line + '\n');
    }
    // Also print it, so a run is recoverable from the terminal alone if the
    // file cannot be pulled off the device.
    console.log('\n===== TFC CSV ROW =====\n' + line);
    console.log('CSV file: ' + FILE);
  } catch (e) {
    console.warn('Could not write run log: ' + e.message);
  }
};

// The log as it was before the last column change. When COLUMNS grows the
// current file is moved here, and Save CSV used to ignore it - the runs from
// before an update vanished from what got pulled (Oct 7).
export const readOldRunLog = async () => {
  try {
    const info = await FileSystem.getInfoAsync(OLD_FILE);
    if (!info.exists) return '';
    return await FileSystem.readAsStringAsync(OLD_FILE);
  } catch (e) {
    return '';
  }
};

export const readRunLog = async () => {
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    if (!info.exists) return '';
    return await FileSystem.readAsStringAsync(FILE);
  } catch (e) {
    return '';
  }
};

export const clearRunLog = async () => {
  try {
    await FileSystem.deleteAsync(FILE, { idempotent: true });
  } catch (e) {
    // nothing to clear
  }
};

export const RUN_LOG_PATH = FILE;
