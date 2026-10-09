// What the user sees when a check fails.
//
// Raw errors used to reach the notification and the chat as they were thrown:
// "Request failed with status code 429 - {"error":{"message":"Request too
// large for model `qw..." and "Cloud extraction failed: Instagram refused the
// backup server (no login): ERROR: [Instagram] ...". The full text still goes
// to the flow log and the CSV; the app shows one plain sentence.
export const friendlyError = (message) => {
  const m = String(message || '');
  if (/isn't available to everyone|not available to everyone|login required|log in|private/i.test(m)) {
    return 'Instagram only shows this reel to logged-in users (age-restricted or private), so it can\'t be checked.';
  }
  if (/tokens per day|\bTPD\b|requests per day|\bRPD\b/i.test(m)) {
    return 'Your free Groq daily limit is used up. It frees up gradually over the next 24 hours.';
  }
  if (/\b429\b|rate limit|Rate limit/i.test(m)) {
    return 'Groq\'s free per-minute limit was busy. Please try again in a minute.';
  }
  if (/\b413\b|too large/i.test(m)) {
    return 'This post is too long to check on the free plan.';
  }
  if (/\b401\b|invalid api key|Invalid API Key|unauthori[sz]ed/i.test(m)) {
    return 'Your Groq API key was not accepted. Check it in Settings.';
  }
  if (/JSON|Unexpected token|Empty reply|missing required fields|All models failed/i.test(m)) {
    return 'The AI gave an unreadable answer. Please try this reel again.';
  }
  if (/Network Error|timeout|timed out|ENOTFOUND|Unable to resolve host|failed to connect/i.test(m)) {
    return 'Network problem. Check your internet connection and try again.';
  }
  if (/extraction|No video URL|WebView|video service|Cloud/i.test(m)) {
    return 'Couldn\'t read this reel from Instagram. Please try again in a minute.';
  }
  return 'Something went wrong while checking this reel. Please try again.';
};
