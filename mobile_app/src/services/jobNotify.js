import { NativeModules, AppState } from 'react-native';
import { addUnseenResult, saveReelResult } from './storage';
import { friendlyError } from './errors';
import { trace } from './trace';
import { jobStarted, jobEnded, setLastFailure } from './jobState';

// Notifications for an analysis, shared by the paste flow and doomscroll mode.
//
// A user who pastes a link does not wait sixty seconds on a spinner: they switch
// apps or lock the phone. The analysis must keep running (AnalysisService holds
// the process alive while it does), and when it finishes the user has to be told
// - otherwise the result sits in a screen nobody is looking at.
//
// Both entry points go through here so they cannot drift apart. Doomscroll mode
// once had notifications and the paste flow had none; this is that gap closing.

const { TechFactChecker } = NativeModules;

const call = (name, ...args) => {
  try {
    const fn = TechFactChecker && TechFactChecker[name];
    return fn ? Promise.resolve(fn(...args)).catch(() => false) : Promise.resolve(false);
  } catch (e) {
    return Promise.resolve(false);
  }
};

// The user is looking at the screen the result lands on. A notification then is
// noise, and a Home banner would announce something they already read.
const userIsWatching = () => AppState.currentState === 'active';

const analysingText = (waiting) =>
  'Analysing reel' + (waiting > 0 ? ' · ' + waiting + ' more waiting' : '') + ' - you can leave the app';

export const beginAnalysis = (ref = '', waiting = 0) => {
  trace('analysis begin ' + ref + ' appState=' + AppState.currentState);
  jobStarted(ref);
  return call('startAnalysisService', analysingText(waiting));
};

// The ongoing notification follows the bubble queue. Restarting the service
// with a new message only updates its notification, so these are cheap. The
// notification used to say only "Analysing reel", and disappeared between
// reels while more were still queued.
export const noteQueueGrew = (waiting) => call('startAnalysisService', analysingText(waiting));
export const noteQueueWaiting = (waiting, startsAt) =>
  call('startAnalysisService',
    waiting + ' reel' + (waiting > 1 ? 's' : '') + ' waiting - next starts at ' +
    new Date(startsAt).toTimeString().slice(0, 5));

export const finishAnalysis = async (result, { alwaysNotify = false } = {}) => {
  jobEnded();
  await call('stopAnalysisService');
  if (!result || !result.reelId) {
    trace('analysis finished with no reelId - nothing to notify');
    return;
  }
  const watching = userIsWatching();
  trace('analysis done reelId=' + result.reelId + ' verdict=' + result.verdict +
    ' appState=' + AppState.currentState + ' notify=' + (alwaysNotify || !watching));
  if (alwaysNotify || !watching) {
    await addUnseenResult(result);
    const verdict = String(result.verdict || 'UNKNOWN').replace('_', ' ');
    const subject = result.techName && result.techName !== 'Unidentified' ? ' - ' + result.techName : '';
    await call(
      'showNotificationWithLink',
      'Verdict ready: ' + verdict,
      'Tap to read the fact check' + subject,
      'techfactchecker://result/' + result.reelId
    );
  }
};

// The raw message goes to the flow log; the user gets one plain sentence, on
// Home, in History (so the reel is not lost) and in the notification.
export const failAnalysis = async (message, url = null) => {
  trace('analysis failed: ' + String(message || '').slice(0, 120));
  const reason = friendlyError(message);
  const code = (String(url || '').match(/(?:reel|p)\/([A-Za-z0-9_-]+)/) || [])[1] || null;
  jobEnded();
  setLastFailure({ ref: code, reason, at: Date.now() });
  if (url) {
    await saveReelResult({
      reelId: 'failed-' + (code || 'link') + '-' + Date.now(),
      url,
      verdict: 'FAILED',
      techName: "Couldn't check this reel",
      title: code ? 'instagram.com/' + code : url,
      factualReality: reason,
      failed: true,
      createdAt: new Date().toISOString(),
    });
  }
  await call('stopAnalysisService');
  if (!userIsWatching()) {
    await call('showNotification', "Couldn't check this reel", reason);
  }
};
