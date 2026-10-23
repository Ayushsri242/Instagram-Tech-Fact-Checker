import AsyncStorage from '@react-native-async-storage/async-storage';
import { PERMISSIONS_DONE_KEY } from '../screens/WelcomeScreen';

// "What's new" after an update, in plain words (Oct 22).
//
// Before each release build, add a new entry at the TOP with a new id and 2-4
// short lines a non-technical user understands. The newest entry is shown once,
// the first time the app opens after updating. No new entry = no popup.
export const WHATS_NEW = [
  {
    // New id on Oct 23 (news line added), so phones that saw the Oct 22 notes see it again.
    id: '2026-10-23',
    title: "What's new in Assay",
    items: [
      'Reels about hacks, security bugs and tech news are now checked against the latest news articles.',
      'Start the bubble from anywhere: swipe down from the top of your screen and tap the Assay tile. Add it from Settings.',
      'Checks now run even when Assay is closed. Copy a reel, tap the bubble, and the result arrives as a notification.',
      'The tile buzzes and changes colour when you tap it, so you know the bubble is on.',
    ],
  },
];

const SEEN_KEY = '@tfc_whats_new_seen';

// The newest notes if this user has not seen them yet. A fresh install gets
// nothing (the tutorial covers it) and is marked as seen.
export const getUnseenWhatsNew = async () => {
  try {
    const latest = WHATS_NEW[0];
    if (!latest) return null;
    const seen = await AsyncStorage.getItem(SEEN_KEY);
    if (seen === latest.id) return null;
    // No record yet: an existing user (finished setup) updating to the first
    // build with this popup sees it; a brand-new user does not.
    if (!seen && (await AsyncStorage.getItem(PERMISSIONS_DONE_KEY)) !== 'yes') {
      await markWhatsNewSeen();
      return null;
    }
    return latest;
  } catch (e) {
    return null;
  }
};

export const markWhatsNewSeen = async () => {
  try {
    if (WHATS_NEW[0]) await AsyncStorage.setItem(SEEN_KEY, WHATS_NEW[0].id);
  } catch (e) {
    // shown again next time; harmless
  }
};
