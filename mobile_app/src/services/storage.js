import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEYS = {
  REELS: '@tech_fact_checker_reels',
  CHAT_PREFIX: '@tech_fact_checker_chat_',
  SETTINGS: '@tech_fact_checker_settings',
};

export const saveReelResult = async (result) => {
  try {
    const existing = await getAllReels();
    const filtered = existing.filter((r) => r.reelId !== result.reelId);
    const updated = [result, ...filtered];
    await AsyncStorage.setItem(STORAGE_KEYS.REELS, JSON.stringify(updated));
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
  } catch (e) {
    console.error('Failed to delete reel:', e);
  }
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
