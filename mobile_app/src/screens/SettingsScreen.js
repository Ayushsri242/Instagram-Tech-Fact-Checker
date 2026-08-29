import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { colors } from '../theme/colors';

export default function SettingsScreen() {
  const [modelExists, setModelExists] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Define exactly where the native Kotlin engine expects it.
  // Note: FileSystem.documentDirectory ends with a slash.
  const modelDir = `${FileSystem.documentDirectory}models/`;
  const modelPath = `${modelDir}llama-3.2-1b.bin`;
  
  // Use a reliable model download URL (HuggingFace direct link)
  // For safety and speed in this demo, we'll point to a quantized 1.3B or 1B model bin file if available.
  const DOWNLOAD_URL = "https://huggingface.co/karpathy/tinyllamas/resolve/main/stories15M.bin"; // Example 60MB model for testing, change to real 2GB model in prod.

  useEffect(() => {
    checkModel();
  }, []);

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
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Local AI Model Setup</Text>
        <Text style={styles.desc}>
          To run chats completely offline, you need to download the Local LLaMA model file (2GB).
          If you don't download it, the app will fall back to cloud APIs.
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
  card: { backgroundColor: colors.surface, padding: 20, borderRadius: 12 },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  desc: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 20 },
  statusBox: { backgroundColor: colors.background, padding: 12, borderRadius: 8, marginBottom: 20 },
  statusText: { color: colors.textPrimary, fontSize: 16, fontWeight: '500' },
  progressContainer: { marginTop: 10 },
  progressText: { color: colors.textPrimary, marginBottom: 8, fontSize: 14 },
  progressBarBg: { height: 10, backgroundColor: colors.background, borderRadius: 5, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: colors.primary },
  buttonRow: { flexDirection: 'row', justifyContent: 'center' },
  downloadBtn: { backgroundColor: colors.primary, padding: 14, borderRadius: 8, flex: 1, alignItems: 'center' },
  deleteBtn: { backgroundColor: colors.error, padding: 14, borderRadius: 8, flex: 1, alignItems: 'center' },
  btnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
});
