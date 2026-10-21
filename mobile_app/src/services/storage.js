import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

const STORAGE_KEYS = {
  REELS: '@tech_fact_checker_reels',
  CHAT_PREFIX: '@tech_fact_checker_chat_',
  SETTINGS: '@tech_fact_checker_settings',
};

// Every check stayed forever and the app's storage only grew (Oct 21). Keep
// the newest 100; older ones go with their AI chats.
const MAX_REELS = 100;

export const saveReelResult = async (result) => {
  try {
    const existing = await getAllReels();
    const filtered = existing.filter((r) => r.reelId !== result.reelId);
    const all = [{ ...result, savedAt: result.savedAt || Date.now() }, ...filtered];
    const updated = all.slice(0, MAX_REELS);
    await AsyncStorage.setItem(STORAGE_KEYS.REELS, JSON.stringify(updated));
    const dropped = all.slice(MAX_REELS).map((r) => `${STORAGE_KEYS.CHAT_PREFIX}${r.reelId}`);
    if (dropped.length) await AsyncStorage.multiRemove(dropped);
  } catch (e) {
    console.error('Failed to save reel:', e);
  }
};

export const getAllReels = async () => {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEYS.REELS);
    return json ? JSON.parse(json) : [];
  } catch (e) {
    console.error('Failed to fetch reels:', e);
    return [];
  }
};

export const getReelById = async (reelId) => {
  try {
    const all = await getAllReels();
    return all.find((r) => r.reelId === reelId) || null;
  } catch (e) {
    return null;
  }
};

export const deleteReelById = async (reelId) => {
  try {
    const existing = await getAllReels();
    const updated = existing.filter((r) => r.reelId !== reelId);
    await AsyncStorage.setItem(STORAGE_KEYS.REELS, JSON.stringify(updated));
    await AsyncStorage.removeItem(`${STORAGE_KEYS.CHAT_PREFIX}${reelId}`);
  } catch (e) {
    console.error('Failed to delete reel:', e);
  }
};

// Settings > Clear history: every check, every AI chat, the NEW badges.
export const clearAllHistory = async () => {
  const keys = await AsyncStorage.getAllKeys();
  const chats = keys.filter((k) => k.startsWith(STORAGE_KEYS.CHAT_PREFIX));
  await AsyncStorage.multiRemove([STORAGE_KEYS.REELS, UNSEEN_RESULTS_KEY, ...chats]);
};

export const saveChatMessage = async (reelId, message) => {
  try {
    const history = await getChatHistory(reelId);
    const updated = [...history, message];
    await AsyncStorage.setItem(`${STORAGE_KEYS.CHAT_PREFIX}${reelId}`, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save chat message:', e);
  }
};

export const getChatHistory = async (reelId) => {
  try {
    const json = await AsyncStorage.getItem(`${STORAGE_KEYS.CHAT_PREFIX}${reelId}`);
    return json ? JSON.parse(json) : [];
  } catch (e) {
    return [];
  }
};

const OFFLINE_MODE_KEY = '@tech_fact_checker_offline_mode';

// Offline = run the on-device Gemma pipeline instead of Groq. Default is
// online, so users who never download the 529 MB model are unaffected.
export const getOfflineMode = async () => {
  try {
    return (await AsyncStorage.getItem(OFFLINE_MODE_KEY)) === 'true';
  } catch (e) {
    return false;
  }
};

export const setOfflineMode = async (enabled) => {
  try {
    await AsyncStorage.setItem(OFFLINE_MODE_KEY, enabled ? 'true' : 'false');
  } catch (e) {
    console.error('Failed to save offline mode:', e);
  }
};

// The last analysis that finished while the user may not have been looking.
// A user who pastes a link rarely waits sixty seconds on a spinner - they leave,
// and if Android kills the app in the meantime, reopening it lands on Home with
// no sign that anything finished. Home reads this to show a "verdict ready"
// banner until it is opened.
//
// A list, not one slot: a user who taps the bubble on four reels and comes back
// later must see all four verdicts, not only the last one.
const UNSEEN_RESULTS_KEY = '@tech_fact_checker_unseen_results';
const UNSEEN_MAX_AGE_MS = 24 * 3600000;
const UNSEEN_MAX = 10;

export const getUnseenResults = async () => {
  try {
    const json = await AsyncStorage.getItem(UNSEEN_RESULTS_KEY);
    const list = json ? JSON.parse(json) : [];
    return list.filter((r) => Date.now() - r.finishedAt < UNSEEN_MAX_AGE_MS);
  } catch (e) {
    return [];
  }
};

export const addUnseenResult = async (result) => {
  try {
    const list = (await getUnseenResults()).filter((r) => r.reelId !== result.reelId);
    list.unshift({
      reelId: result.reelId,
      techName: result.techName || 'Fact check',
      verdict: result.verdict || 'UNKNOWN',
      finishedAt: Date.now(),
    });
    await AsyncStorage.setItem(UNSEEN_RESULTS_KEY, JSON.stringify(list.slice(0, UNSEEN_MAX)));
  } catch (e) {
    console.error('Failed to save unseen result:', e);
  }
};

// Opened from somewhere else (History, a notification): only that one is read.
export const markResultSeen = async (reelId) => {
  try {
    const list = await getUnseenResults();
    const rest = list.filter((r) => r.reelId !== reelId);
    if (rest.length !== list.length) await AsyncStorage.setItem(UNSEEN_RESULTS_KEY, JSON.stringify(rest));
  } catch (e) {
    // nothing to mark
  }
};

// Opened from the Home banner: the banner closes as a whole; the rest are in History.
export const clearUnseenResults = async () => {
  try {
    await AsyncStorage.removeItem(UNSEEN_RESULTS_KEY);
  } catch (e) {
    // nothing to clear
  }
};

const API_LIMITS_KEY = '@tech_fact_checker_api_limits';

export const saveApiLimits = async (limits) => {
  try {
    await AsyncStorage.setItem(API_LIMITS_KEY, JSON.stringify(limits));
  } catch (e) {
    console.error('Failed to save API limits:', e);
  }
};

export const getApiLimits = async () => {
  try {
    const json = await AsyncStorage.getItem(API_LIMITS_KEY);
    return json ? JSON.parse(json) : null;
  } catch (e) {
    return null;
  }
};

// Debug builds: what the app's storage holds, printed to Metro at launch, so
// the cleanup (old update APKs, the 100-check cap) can be checked (Oct 21).
export const logStorageUsage = async () => {
  if (!__DEV__) return;
  try {
    const mb = (b) => (b / 1048576).toFixed(2) + ' MB';
    const lines = [];
    for (const [label, dir] of [['files', FileSystem.documentDirectory], ['cache', FileSystem.cacheDirectory]]) {
      let total = 0;
      const items = [];
      for (const n of await FileSystem.readDirectoryAsync(dir)) {
        const info = await FileSystem.getInfoAsync(dir + n, { size: true });
        total += info.size || 0;
        items.push([n, info.size || 0]);
      }
      items.sort((a, b) => b[1] - a[1]);
      lines.push(label + ': ' + mb(total) + ' | ' + items.slice(0, 6).map(([n, b]) => n + ' ' + mb(b)).join(', '));
    }
    const keys = await AsyncStorage.getAllKeys();
    const pairs = await AsyncStorage.multiGet(keys);
    const kb = pairs.reduce((t, [, v]) => t + (v ? v.length : 0), 0) / 1024;
    const reels = await getAllReels();
    const chats = keys.filter((k) => k.startsWith(STORAGE_KEYS.CHAT_PREFIX)).length;
    lines.push('saved data: ' + kb.toFixed(0) + ' KB | checks ' + reels.length + ', AI chats ' + chats);
    console.log('\n===== ASSAY STORAGE =====\n' + lines.join('\n'));
  } catch (e) {
    console.log('Storage report failed: ' + e.message);
  }
};
