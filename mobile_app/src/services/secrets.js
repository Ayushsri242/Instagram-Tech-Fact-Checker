import * as SecureStore from 'expo-secure-store';
import { NativeModules } from 'react-native';

const { TechFactChecker } = NativeModules;

const GROQ_API_KEY = 'groq_api_key';
const BACKED_UP = 'groq_api_key_backed_up';

// Everything in the app's own storage is wiped on uninstall, so a user who
// reinstalled had to make a new Groq key. Each saved key is also copied to
// Downloads/Assay/assay_groq_key.txt, which survives; "Restore key from
// backup" reads it back.
const backUp = async (apiKey) => {
  try {
    if (!TechFactChecker?.saveKeyBackup) return;
    await TechFactChecker.saveKeyBackup(apiKey);
    await SecureStore.setItemAsync(BACKED_UP, apiKey.slice(-6));
  } catch (e) {
    console.warn('Could not back up the API key: ' + e.message);
  }
};

export const getGroqApiKey = () => SecureStore.getItemAsync(GROQ_API_KEY);
export const saveGroqApiKey = async (apiKey) => {
  await SecureStore.setItemAsync(GROQ_API_KEY, apiKey.trim());
  await backUp(apiKey.trim());
};
export const deleteGroqApiKey = () => SecureStore.deleteItemAsync(GROQ_API_KEY);

// A key saved by a build from before the backup existed: back it up once.
export const ensureKeyBackup = async () => {
  try {
    const key = await getGroqApiKey();
    if (!key) return;
    if ((await SecureStore.getItemAsync(BACKED_UP)) === key.slice(-6)) return;
    await backUp(key);
  } catch (e) {
    // nothing to back up
  }
};

// Lets the user pick the backup file. Returns the key, or null if they
// cancelled or the file holds no key. The restored key is NOT backed up again:
// that would add a second file next to the one just picked.
export const restoreGroqKeyFromBackup = async () => {
  if (!TechFactChecker?.pickKeyBackup) return null;
  const key = await TechFactChecker.pickKeyBackup();
  if (!key) return null;
  await SecureStore.setItemAsync(GROQ_API_KEY, key.trim());
  await SecureStore.setItemAsync(BACKED_UP, key.trim().slice(-6));
  return key.trim();
};
