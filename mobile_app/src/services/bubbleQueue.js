import { DeviceEventEmitter, NativeModules } from 'react-native';
import { analyzeReelApi, sleep, nextRunWaitMs, searchCooldownMs } from './api';
import { saveReelResult } from './storage';
import { beginAnalysis, finishAnalysis, failAnalysis, noteQueueGrew, noteQueueWaiting } from './jobNotify';
import { trace, shortRef } from './trace';
import { setJobsWaiting, setNextStart } from './jobState';

const { TechFactChecker } = NativeModules;

// The doomscroll bubble's queue.
//
// It used to live in App's useEffect, so it existed only while the app's
// screen did. Leaving the app (Back, or swiping it from recents) unmounted the
// screen and removed the listener, while the JS engine kept running - so on
// Oct 8 bubble taps reached native ("module: reel link received") and then
// went nowhere: the bubble stayed orange until the app was reopened. Here it
// is started once per JS engine, independent of any screen.

const queue = [];
let isProcessing = false;
let pausedUntil = 0; // set while waiting between reels
let started = false;

const processQueue = async () => {
  if (isProcessing || queue.length === 0) {
    if (queue.length) trace('doomscroll: ' + queue.length + ' waiting - ' + (pausedUntil ? 'paused between reels' : 'a reel is running'));
    return;
  }
  isProcessing = true;

  const url = queue.shift();
  setJobsWaiting(queue.length, queue.map(shortRef));
  setNextStart(null);
  const startedAt = Date.now();
  trace('doomscroll: start ' + shortRef(url) + ', ' + queue.length + ' still waiting' +
    (queue.length ? ' (' + queue.map(shortRef).join(', ') + ')' : ''));

  let hadError = false;
  try {
    // Bubble turns cyan/blue while processing.
    TechFactChecker.setBubbleColor('#00E5FF');
    // Same keep-alive and notifications as the paste flow, so the two entry
    // points cannot drift apart again.
    beginAnalysis(shortRef(url), queue.length);
    const result = await analyzeReelApi(url);
    await saveReelResult(result);
    // Doomscroll runs while the user is inside another app by definition, so
    // always notify - even if this app happens to be in front.
    await finishAnalysis(result, { alwaysNotify: true });
    trace('doomscroll: done ' + shortRef(url) + ' verdict=' + result.verdict + ' in ' + Math.round((Date.now() - startedAt) / 1000) + 's');
  } catch (e) {
    hadError = true;
    trace('doomscroll: FAILED ' + shortRef(url) + ' after ' + Math.round((Date.now() - startedAt) / 1000) + 's - ' + String(e && e.message).slice(0, 120));
    await failAnalysis(e && e.message);
  } finally {
    TechFactChecker.setBubbleColor('#00E5FF');
  }

  // Pause before the next reel only as long as Groq's budgets need (not after a
  // failure). Home counts the pause down and the notification says what waits.
  if (!hadError && queue.length) {
    // Also back off when the last run's web searches hit a bot check.
    const waitMs = Math.max(nextRunWaitMs(), searchCooldownMs());
    const startsAt = Date.now() + waitMs;
    trace('doomscroll: pause ' + Math.round(waitMs / 1000) + 's, next ' + shortRef(queue[0]) +
      ' starts at ' + new Date(startsAt).toTimeString().slice(0, 8) + ', ' + queue.length + ' waiting');
    if (waitMs > 0) {
      pausedUntil = startsAt;
      setNextStart(startsAt);
      noteQueueWaiting(queue.length, startsAt);
      await sleep(waitMs);
      pausedUntil = 0;
    }
  }
  isProcessing = false;
  processQueue();
};

const onReel = (url) => {
  TechFactChecker.setBubbleColor('#00E5FF'); // blue at once, so the user can queue the next reel
  // If the bubble logged a copy and this line is missing, JS was not listening.
  trace('doomscroll: JS received reel ' + shortRef(url) + ', queue now ' + (queue.length + 1));
  // Tell native it arrived; unconfirmed links are re-delivered at start-up.
  if (TechFactChecker.ackReel) TechFactChecker.ackReel(url);
  // A saved link and a live tap of the same reel can both arrive at start-up.
  if (queue.includes(url)) return;
  queue.push(url);
  setJobsWaiting(queue.length, queue.map(shortRef));
  // A reel already running: the notification gains "N more waiting".
  if (isProcessing) {
    if (pausedUntil) noteQueueWaiting(queue.length, pausedUntil);
    else noteQueueGrew(queue.length);
  }
  processQueue();
};

// Links the bubble saved while no JS was listening (app not running yet).
export const takePendingReels = () => {
  if (!TechFactChecker || !TechFactChecker.takePendingReels) return;
  TechFactChecker.takePendingReels().then((urls) => {
    (urls || []).forEach((url) => {
      trace('doomscroll: picked up saved link ' + shortRef(url) + ' on start');
      onReel(url);
    });
  }).catch(() => {});
};

// Once per JS engine; calling it again (App remounting) does nothing.
export const startBubbleQueue = () => {
  if (started || !TechFactChecker) return;
  started = true;
  DeviceEventEmitter.addListener('ON_REEL_COPIED', onReel);
  takePendingReels();
};
