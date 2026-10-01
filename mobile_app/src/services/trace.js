import { NativeModules } from 'react-native';

// One line in the TFC_FLOW log, from JavaScript.
//
// A release APK cannot be inspected with `run-as`, and the background bugs this
// app has - a bubble stuck orange, a notification that opened the wrong report -
// only reproduce in release, because debug builds pause JS whenever the app
// leaves the screen. So the user-visible flow is logged on one tag that native
// code shares, and a release build is debugged with:
//
//   adb logcat -v time -s TFC_FLOW
//
// Keep messages short and factual: what happened, to which reel, how long it
// took. They are read by grep, not by a user.
const { TechFactChecker } = NativeModules;

export const trace = (message) => {
  const text = String(message);
  try {
    if (TechFactChecker && TechFactChecker.trace) {
      TechFactChecker.trace(text);
      return;
    }
  } catch (e) {
    // fall through to console
  }
  console.log('TFC_FLOW js: ' + text);
};

// Shortcode only - full URLs carry share tokens and make the log unreadable.
export const shortRef = (url) => {
  const m = String(url || '').match(/(?:reel|p)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : String(url || '').slice(0, 40);
};
