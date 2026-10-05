import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { Alert } from 'react-native';
import Constants from 'expo-constants';

const GITHUB_API_URL = 'https://api.github.com/repos/Ayushsri242/Instagram-Tech-Fact-Checker/releases/tags/verified-production';

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

export const checkForUpdates = async (onProgress) => {
  try {
    // 1. Fetch release details from GitHub
    const response = await fetch(GITHUB_API_URL);
    if (!response.ok) {
      console.log('No verified-production release found or API error.');
      return;
    }

    const data = await response.json();
    const releaseVersion = data.name || data.tag_name;
    const currentVersion = Constants.expoConfig?.version || '1.0.0';

    console.log(`Current version: ${currentVersion}, GitHub version: ${releaseVersion}`);

    // 2. Compare versions
    if (isNewerVersion(currentVersion, releaseVersion)) {
      // Find the APK asset
      const apkAsset = data.assets?.find(asset => asset.name.endsWith('.apk'));
      
      if (!apkAsset) {
        console.log('No APK found in the release assets.');
        return;
      }

      // 3. Prompt user
      Alert.alert(
        'Update Available',
        `Version ${releaseVersion} is available. Would you like to download and install it now?`,
        [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Update',
            onPress: () => downloadAndInstallUpdate(apkAsset.browser_download_url, releaseVersion, onProgress),
          },
        ],
        { cancelable: true }
      );
    }
  } catch (error) {
    console.log('Error checking for updates:', error);
  }
};

const downloadAndInstallUpdate = async (downloadUrl, version, onProgress) => {
  try {
    const fileUri = FileSystem.documentDirectory + `update-${version}.apk`;

    // Setup download resumable with progress callback
    const downloadResumable = FileSystem.createDownloadResumable(
      downloadUrl,
      fileUri,
      {},
      (downloadProgress) => {
        const progress = (downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite) * 100;
        if (onProgress) onProgress(progress);
      }
    );

    // 4. Download APK
    const { uri } = await downloadResumable.downloadAsync();
    if (onProgress) onProgress(null); // Clear progress

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
    if (onProgress) onProgress(null);
  }
};
