import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, SafeAreaView, ActivityIndicator, NativeModules, Platform, Switch } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { colors } from '../theme/colors';
import { deleteGroqApiKey, getGroqApiKey, saveGroqApiKey } from '../services/secrets';
import { getOfflineMode, setOfflineMode } from '../services/storage';

export default function SettingsScreen() {
  const [modelExists, setModelExists] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [groqApiKey, setGroqApiKey] = useState('');
  const [hasGroqApiKey, setHasGroqApiKey] = useState(false);
  const [offlineMode, setOfflineModeState] = useState(false);

  // Define exactly where the native Kotlin engine expects it.
  // Note: FileSystem.documentDirectory ends with a slash.
  const modelDir = `${FileSystem.documentDirectory}models/`;
  const MODEL_FILE = 'Gemma3-1B-IT_multi-prefill-seq_q4_ekv2048.task';
  const modelPath = `${modelDir}${MODEL_FILE}`;
  
  // Direct download link from Hugging Face Dataset (CPU version)
  const DOWNLOAD_URL = `https://huggingface.co/datasets/Ayush-242/fact-checker-model/resolve/main/${MODEL_FILE}`;
  const STT_FILES = [
    ['tiny-encoder.int8.onnx', 'https://huggingface.co/datasets/Ayush-242/fact-checker-model/resolve/main/fact-checker-stt/whisper-tiny/tiny-encoder.int8.onnx'],
    ['tiny-decoder.int8.onnx', 'https://huggingface.co/datasets/Ayush-242/fact-checker-model/resolve/main/fact-checker-stt/whisper-tiny/tiny-decoder.int8.onnx'],
    ['tiny-tokens.txt', 'https://huggingface.co/datasets/Ayush-242/fact-checker-model/resolve/main/fact-checker-stt/whisper-tiny/tiny-tokens.txt'],
  ];

  useEffect(() => {
    checkModel();
    checkGroqApiKey();
    getOfflineMode().then(setOfflineModeState);
  }, []);

  const checkGroqApiKey = async () => {
    const savedKey = await getGroqApiKey();
    setHasGroqApiKey(Boolean(savedKey));
  };

  const saveGroqKey = async () => {
    if (!groqApiKey.trim()) {
      alert('Paste a Groq API key first.');
      return;
    }
    try {
      await saveGroqApiKey(groqApiKey);
      setGroqApiKey('');
      setHasGroqApiKey(true);
      alert('Groq API key saved on this device.');
    } catch (e) {
      console.error('Failed to save Groq API key', e);
      alert('Could not save Groq API key.');
    }
  };

  const removeGroqKey = async () => {
    try {
      await deleteGroqApiKey();
      setGroqApiKey('');
      setHasGroqApiKey(false);
    } catch (e) {
      console.error('Failed to delete Groq API key', e);
      alert('Could not delete Groq API key.');
    }
  };

  const toggleOffline = async (value) => {
    if (value && !modelExists) {
      alert('Download the local model below before switching to offline mode.');
      return;
    }
    setOfflineModeState(value);
    await setOfflineMode(value);
  };

  const checkModel = async () => {
    try {
      const dirInfo = await FileSystem.getInfoAsync(modelDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(modelDir, { intermediates: true });
      }
      
      const fileInfo = await FileSystem.getInfoAsync(modelPath);
      setModelExists(fileInfo.exists && fileInfo.size > 100000);
    } catch (e) {
      console.log("Error checking model", e);
    }
  };

  const downloadModel = async () => {
    setIsDownloading(true);
    setProgress(0);
    
    try {
      const downloadResumable = FileSystem.createDownloadResumable(
        DOWNLOAD_URL,
        modelPath,
        {},
        (downloadProgress) => {
          const p = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
          setProgress(p);
        }
      );

      const { uri } = await downloadResumable.downloadAsync();
      console.log('Finished downloading to ', uri);
      setModelExists(true);
      await FileSystem.makeDirectoryAsync(`${modelDir}whisper-tiny/`, { intermediates: true });
      
      // Tell native Kotlin engine to reload the model now that we have it
      if (Platform.OS === 'android' && NativeModules.TechFactChecker) {
        await NativeModules.TechFactChecker.reloadModel();
      }
      for (const [name, url] of STT_FILES) {
        await FileSystem.downloadAsync(url, `${modelDir}whisper-tiny/${name}`);
      }
    } catch (e) {
      console.error(e);
      alert('Download failed');
    } finally {
      setIsDownloading(false);
    }
  };

  const deleteModel = async () => {
    await FileSystem.deleteAsync(modelPath, { idempotent: true });
    setModelExists(false);
    setOfflineModeState(false);
    await setOfflineMode(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Groq API Setup</Text>
        <Text style={styles.desc}>
          Paste your Groq API key. It is encrypted and saved only in this app on this phone.
        </Text>
        <TextInput
          style={styles.input}
          value={groqApiKey}
          onChangeText={setGroqApiKey}
          placeholder="gsk_..."
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <Text style={styles.keyStatus}>
          Status: {hasGroqApiKey ? 'Saved on device' : 'Not saved'}
        </Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.downloadBtn} onPress={saveGroqKey}>
            <Text style={styles.btnText}>Save Groq Key</Text>
          </TouchableOpacity>
          {hasGroqApiKey && (
            <TouchableOpacity style={styles.deleteBtn} onPress={removeGroqKey}>
              <Text style={styles.btnText}>Delete</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Analysis Mode</Text>
        <Text style={styles.desc}>
          Online uses Groq and is faster and more accurate. Offline runs the
          3-stage pipeline entirely on this phone with Gemma 3 - no API key,
          no data leaves the device, but slower and less precise.
        </Text>
        <View style={styles.toggleRow}>
          <Text style={styles.statusText}>
            Mode: <Text style={{ color: offlineMode ? colors.warning : colors.success }}>
              {offlineMode ? 'Offline (on-device Gemma)' : 'Online (Groq)'}
            </Text>
          </Text>
          <Switch value={offlineMode} onValueChange={toggleOffline} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Local AI Model Setup</Text>
        <Text style={styles.desc}>
          Optional. Only needed for Offline mode: Gemma 3 1B (529 MB) plus the
          Whisper speech model. Skip this if you stay on Online mode.
        </Text>

        <View style={styles.statusBox}>
          <Text style={styles.statusText}>
            Status: <Text style={{ color: modelExists ? colors.success : colors.warning }}>
              {modelExists ? 'Downloaded & Ready' : 'Not Found'}
            </Text>
          </Text>
        </View>

        {isDownloading ? (
          <View style={styles.progressContainer}>
            <Text style={styles.progressText}>Downloading... {(progress * 100).toFixed(1)}%</Text>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
            </View>
          </View>
        ) : (
          <View style={styles.buttonRow}>
            {!modelExists ? (
              <TouchableOpacity style={styles.downloadBtn} onPress={downloadModel}>
                <Text style={styles.btnText}>Download Local Model</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.deleteBtn} onPress={deleteModel}>
                <Text style={styles.btnText}>Delete Model</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 16 },
  card: { backgroundColor: colors.surface, padding: 20, borderRadius: 12, marginBottom: 16 },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  desc: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 20 },
  statusBox: { backgroundColor: colors.background, padding: 12, borderRadius: 8, marginBottom: 20 },
  statusText: { color: colors.textPrimary, fontSize: 16, fontWeight: '500' },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 8,
    color: colors.textPrimary,
    marginBottom: 12,
    padding: 12,
  },
  keyStatus: { color: colors.textSecondary, fontSize: 13, marginBottom: 12 },
  progressContainer: { marginTop: 10 },
  progressText: { color: colors.textPrimary, marginBottom: 8, fontSize: 14 },
  progressBarBg: { height: 10, backgroundColor: colors.background, borderRadius: 5, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: colors.primary },
  buttonRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  downloadBtn: { backgroundColor: colors.primary, padding: 14, borderRadius: 8, flex: 1, alignItems: 'center' },
  deleteBtn: { backgroundColor: colors.error, padding: 14, borderRadius: 8, flex: 1, alignItems: 'center' },
  btnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
});
