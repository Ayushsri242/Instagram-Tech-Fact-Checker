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
