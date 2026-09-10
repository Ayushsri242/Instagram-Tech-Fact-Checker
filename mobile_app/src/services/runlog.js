import * as FileSystem from 'expo-file-system';

// One CSV row per analysis run.
//
// Reading five runs out of Metro scrollback is how a batch turns back into
// single-reel tinkering: the numbers are there, but not side by side, so the
// pattern never surfaces. A CSV makes five runs comparable in one glance.

const FILE = FileSystem.documentDirectory + 'factcheck_runs.csv';

const COLUMNS = [
  'timestamp',
  'shortcode',
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
];

const cell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""').replace(/\n/g, ' ') + '"' : s;
};

export const logRun = async (fields) => {
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    const line = COLUMNS.map((c) => cell(fields[c])).join(',');
    if (!info.exists) {
      await FileSystem.writeAsStringAsync(FILE, COLUMNS.join(',') + '\n' + line + '\n');
    } else {
      const existing = await FileSystem.readAsStringAsync(FILE);
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
