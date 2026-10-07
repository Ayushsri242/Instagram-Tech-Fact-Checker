// What is being analysed right now, for the progress strip on Home.
//
// In memory on purpose: a job only exists while this JS process is alive, so if
// Android kills the app the strip correctly shows nothing running.

// The pipeline's stages in order. The strip's bar fills by stage, not by time -
// a stage count is a fact, a time estimate would be a guess.
export const JOB_STAGES = [
  'Reading the reel',
  'Understanding the claims',
  'Searching the web',
  'Checking the sources',
  'Writing the verdict',
];

let state = { running: null, waiting: 0 };
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(state));

export const getJobState = () => state;

export const subscribeJob = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const jobStarted = (ref) => {
  state = { ...state, running: { ref, step: 0, startedAt: Date.now() } };
  emit();
};

export const jobStage = (step) => {
  if (!state.running) return;
  state = { ...state, running: { ...state.running, step } };
  emit();
};

export const jobEnded = () => {
  state = { ...state, running: null };
  emit();
};

// A short line under the stage while a long post is read in parts or the run
// waits for Groq's free per-minute budget - otherwise the bar just stops moving
// for a minute and the run looks stuck. `until` (ms timestamp) gives a countdown.
export const setJobNote = (text, until = null) => {
  if (!state.running) return;
  state = { ...state, running: { ...state.running, note: text || null, noteUntil: until } };
  emit();
};

// Reels the bubble queued behind the one running (doomscroll cooldown), and
// their shortcodes so Home can name them.
export const setJobsWaiting = (n, refs = []) => {
  state = { ...state, waiting: n, queued: refs };
  emit();
};

// When the next queued reel will start (ms timestamp), or null. Set during the
// pause between reels, so Home can count down instead of showing nothing - the
// queue looked lost for that minute (Oct 7).
export const setNextStart = (at) => {
  state = { ...state, nextStartAt: at };
  emit();
};
