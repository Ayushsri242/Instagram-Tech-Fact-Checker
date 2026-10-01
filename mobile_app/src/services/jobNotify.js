import { NativeModules, AppState } from 'react-native';
import { saveLatestResult } from './storage';
import { trace } from './trace';

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

export const beginAnalysis = (ref = '') => {
  trace('analysis begin ' + ref + ' appState=' + AppState.currentState);
  return call('startAnalysisService', 'Analysing reel - you can leave the app');
};

export const finishAnalysis = async (result, { alwaysNotify = false } = {}) => {
  await call('stopAnalysisService');
  if (!result || !result.reelId) {
    trace('analysis finished with no reelId - nothing to notify');
    return;
  }
  const watching = userIsWatching();
  trace('analysis done reelId=' + result.reelId + ' verdict=' + result.verdict +
    ' appState=' + AppState.currentState + ' notify=' + (alwaysNotify || !watching));
  if (alwaysNotify || !watching) {
    await saveLatestResult(result);
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

export const failAnalysis = async (message) => {
  trace('analysis failed: ' + String(message || '').slice(0, 120));
  await call('stopAnalysisService');
  if (!userIsWatching()) {
    await call('showNotification', 'Fact check failed', String(message || 'Could not process the reel.').slice(0, 120));
  }
};
