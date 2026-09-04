import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, SafeAreaView, ActivityIndicator, NativeModules, Platform, Switch, ScrollView } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { colors } from '../theme/colors';
import { deleteGroqApiKey, getGroqApiKey, saveGroqApiKey } from '../services/secrets';
import { getOfflineMode, setOfflineMode } from '../services/storage';

export default function SettingsScreen() {
  const [modelExists, setModelExists] = useState(false);
  const [sttExists, setSttExists] = useState(false);
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
  // sherpa-onnx publishes these itself, so there is nothing to re-host.
  // Whisper base, not tiny: tiny transcribes the sentence structure correctly
  // but gets every proper noun wrong ("forge code" -> "4D", "Claude" -> "Cloud"),
  // and the product name is the entire point of the analysis.
  const STT_BASE = 'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-base/resolve/main';
  // [filename, minimum plausible size]. A 404 from HF is a 15-byte body that
  // downloadAsync writes to disk without throwing; sherpa-onnx then calls
  // exit(-1) natively on the unparseable file and kills the whole app.
  const STT_FILES = [
    ['base-encoder.int8.onnx', 25000000],   // actual 29.1 MB
    ['base-decoder.int8.onnx', 110000000],  // actual 130.7 MB
    ['base-tokens.txt', 700000],            // actual 0.8 MB
  ];
  // Superseded by base. Deleted after a successful base download so the old
  // ~90 MB is not left sitting on the device forever.
  const LEGACY_STT_FILES = ['tiny-encoder.int8.onnx', 'tiny-decoder.int8.onnx', 'tiny-tokens.txt'];

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
      await purgeBadSttFiles();
      setSttExists(await checkStt());
    } catch (e) {
      console.log("Error checking model", e);
    }
  };

  // Self-heal: a previously failed download leaves a tiny junk file that
  // crashes the native STT engine. Remove anything implausibly small.
  const purgeBadSttFiles = async () => {
    for (const [name, minSize] of STT_FILES) {
      const path = `${modelDir}whisper-tiny/${name}`;
      try {
        const info = await FileSystem.getInfoAsync(path);
        if (info.exists && info.size < minSize) {
          console.warn(`Removing truncated STT file ${name} (${info.size} bytes)`);
          await FileSystem.deleteAsync(path, { idempotent: true });
        }
      } catch (e) {
        // Nothing to clean up.
      }
    }
  };

  const checkStt = async () => {
    for (const [name, minSize] of STT_FILES) {
      try {
        const info = await FileSystem.getInfoAsync(`${modelDir}whisper-tiny/${name}`);
        if (!info.exists || info.size < minSize) return false;
      } catch (e) {
        return false;
      }
    }
    return true;
  };

  const downloadStt = async () => {
    await FileSystem.makeDirectoryAsync(`${modelDir}whisper-tiny/`, { intermediates: true });
    for (const [name, minSize] of STT_FILES) {
      const path = `${modelDir}whisper-tiny/${name}`;
      const res = await FileSystem.downloadAsync(`${STT_BASE}/${name}`, path);
      const info = await FileSystem.getInfoAsync(path);
      if (res.status !== 200 || !info.exists || info.size < minSize) {
        await FileSystem.deleteAsync(path, { idempotent: true });
        throw new Error(`Speech model ${name} failed (HTTP ${res.status}, ${info.size || 0} bytes).`);
      }
    }
    // Only now, with base confirmed on disk, reclaim the old tiny files.
    for (const name of LEGACY_STT_FILES) {
      await FileSystem.deleteAsync(`${modelDir}whisper-tiny/${name}`, { idempotent: true });
    }
    setSttExists(true);
  };

  const downloadSttOnly = async () => {
    setIsDownloading(true);
    try {
      await downloadStt();
      alert('Speech model downloaded.');
    } catch (e) {
      console.error(e);
      alert(`Download failed: ${e.message || e}`);
    } finally {
      setIsDownloading(false);
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
      await downloadStt();
    } catch (e) {
      console.error(e);
      alert(`Download failed: ${e.message || e}`);
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
      <ScrollView contentContainerStyle={styles.scrollContent}>
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
            {'\n'}Speech: <Text style={{ color: sttExists ? colors.success : colors.warning }}>
              {sttExists ? 'Ready' : 'Not downloaded (speech step will be skipped)'}
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
              <>
                {!sttExists && (
                  <TouchableOpacity style={styles.downloadBtn} onPress={downloadSttOnly}>
                    <Text style={styles.btnText}>Download Speech Model</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.deleteBtn} onPress={deleteModel}>
                  <Text style={styles.btnText}>Delete Model</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: 16, paddingBottom: 48 },
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
