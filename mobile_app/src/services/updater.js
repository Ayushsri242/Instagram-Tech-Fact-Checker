import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { Alert } from 'react-native';
import Constants from 'expo-constants';

const GITHUB_API_URL = 'https://api.github.com/repos/Ayushsri242/Instagram-Tech-Fact-Checker/releases/tags/verified-production';

export const currentVersion = () => Constants.expoConfig?.version || '1.0.0';

// Download progress (0-100, or null when idle), shared with whichever screen
// shows it. The check now starts from App.js on launch, before Home exists,
// so the screen subscribes instead of owning the state.
let progress = null;
const listeners = new Set();
const setProgress = (value) => {
  progress = value;
  listeners.forEach((fn) => fn(progress));
};
export const subscribeUpdateProgress = (fn) => {
  listeners.add(fn);
  fn(progress);
  return () => listeners.delete(fn);
};

// Compares two version strings (e.g., '1.0.0' vs '1.0.1')
// Returns true if newVersion > currentVersion
const isNewerVersion = (current, incoming) => {
  if (!current || !incoming) return false;

  // Clean up versions (e.g., v1.0.1 -> 1.0.1)
  const currentParts = current.replace(/[^0-9.]/g, '').split('.').map(Number);
  const newParts = incoming.replace(/[^0-9.]/g, '').split('.').map(Number);

  for (let i = 0; i < Math.max(currentParts.length, newParts.length); i++) {
    const curr = currentParts[i] || 0;
    const next = newParts[i] || 0;
    if (next > curr) return true;
    if (next < curr) return false;
  }
  return false;
};

// One check at a time: launch and the Settings button can overlap, and two
// "Update Available" dialogs for the same release is a bug the user sees.
let inFlight = null;

// Returns { status: 'available' | 'latest' | 'none' | 'error' | 'downloading', version }.
// The Settings button shows it; the launch check ignores it.
export const checkForUpdates = () => {
  if (progress !== null) return Promise.resolve({ status: 'downloading', version: null });
  if (!inFlight) inFlight = runCheck().finally(() => { inFlight = null; });
  return inFlight;
};

const runCheck = async () => {
  try {
    // 1. Fetch release details from GitHub
    const response = await fetch(GITHUB_API_URL);
    if (!response.ok) {
      console.log('No verified-production release found or API error.');
      return { status: 'none', version: null };
    }

    const data = await response.json();
    const releaseVersion = data.name || data.tag_name;

    console.log(`Current version: ${currentVersion()}, GitHub version: ${releaseVersion}`);

    // 2. Compare versions
    if (!isNewerVersion(currentVersion(), releaseVersion)) {
      return { status: 'latest', version: releaseVersion };
    }
    // Find the APK asset
    const apkAsset = data.assets?.find((asset) => asset.name.endsWith('.apk'));
    if (!apkAsset) {
      console.log('No APK found in the release assets.');
      return { status: 'none', version: releaseVersion };
    }

    // 3. Prompt user
    Alert.alert(
      'Update Available',
      `Version ${releaseVersion} is available. Would you like to download and install it now?`,
      [
        { text: 'Later', style: 'cancel' },
        {
          text: 'Update',
          onPress: () => downloadAndInstallUpdate(apkAsset.browser_download_url, releaseVersion),
        },
      ],
      { cancelable: true }
    );
    return { status: 'available', version: releaseVersion };
  } catch (error) {
    console.log('Error checking for updates:', error);
    return { status: 'error', version: null };
  }
};

const downloadAndInstallUpdate = async (downloadUrl, version) => {
  try {
    const fileUri = FileSystem.documentDirectory + `update-${version}.apk`;
    setProgress(0);

    // Setup download resumable with progress callback
    const downloadResumable = FileSystem.createDownloadResumable(
      downloadUrl,
      fileUri,
      {},
      (downloadProgress) => {
        setProgress((downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite) * 100);
      }
    );

    // 4. Download APK
    const { uri } = await downloadResumable.downloadAsync();
    setProgress(null);

    // 5. Trigger Android Package Installer
    const contentUri = await FileSystem.getContentUriAsync(uri);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      type: 'application/vnd.android.package-archive',
    });
  } catch (error) {
    console.error('Error downloading or installing update:', error);
    Alert.alert('Update Failed', 'There was an error downloading the update.');
    setProgress(null);
  }
};
