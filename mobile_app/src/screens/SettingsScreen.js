import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, SafeAreaView, NativeModules, ScrollView, Share, Alert } from 'react-native';
import { colors } from '../theme/colors';
import { deleteGroqApiKey, getGroqApiKey, saveGroqApiKey, restoreGroqKeyFromBackup } from '../services/secrets';
import { isGroqKey } from '../services/api';
import { readRunLog, readOldRunLog, clearRunLog, RUN_LOG_PATH } from '../services/runlog';
import { checkForUpdates, currentVersion } from '../services/updater';

export default function SettingsScreen({ navigation }) {
  const [groqApiKey, setGroqApiKey] = useState('');
  const [hasGroqApiKey, setHasGroqApiKey] = useState(false);
  const [runLogRows, setRunLogRows] = useState(0);
  const [updateStatus, setUpdateStatus] = useState('');

  useEffect(() => {
    checkGroqApiKey();
    countRunLog();
  }, []);

  // Rows, not bytes: the header line is always there, so an empty log reads 0.
  const countRunLog = async () => {
    const csv = await readRunLog();
    const lines = String(csv || '').trim().split('\n').filter(Boolean);
    setRunLogRows(Math.max(0, lines.length - 1));
  };

  const shareRunLog = async () => {
    const csv = await readRunLog();
    if (!csv) {
      Alert.alert('Run log', 'No runs recorded yet.');
      return;
    }
    try {
      // The file lives in app-private storage, so a viewer cannot open the
      // path. Share the text itself, which any chat or mail app will take.
      await Share.share({ message: csv, title: 'factcheck_runs.csv' });
    } catch (e) {
      Alert.alert('Could not share', e.message + '\n\nFile: ' + RUN_LOG_PATH);
    }
  };

  // One fixed file, overwritten each time, so old copies never pile up and the
  // batch can be pulled over adb without the Share sheet.
  const saveRunLogCopy = async () => {
    const csv = await readRunLog();
    if (!csv) {
      Alert.alert('Run log', 'No runs recorded yet.');
      return;
    }
    try {
      const path = await NativeModules.TechFactChecker.saveRunLogCopy(csv);
      // The log from before the last app update, if there is one.
      const old = await readOldRunLog();
      if (old) await NativeModules.TechFactChecker.saveRunLogCopyAs(old, 'runlog_old.csv');
      Alert.alert('Saved', runLogRows + ' run(s) saved to\n' + path +
        (old ? '\n\nThe log from before the last update was saved as runlog_old.csv.' : '') +
        '\n\nThe previous copy was replaced.');
    } catch (e) {
      Alert.alert('Could not save', e.message);
    }
  };

  const clearRunLogFile = () => {
    Alert.alert(
      'Clear run log?',
      runLogRows + ' recorded run(s) will be deleted. Share the CSV first if the batch has not been scored.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearRunLog();
            countRunLog();
          },
        },
      ]
    );
  };

  const checkGroqApiKey = async () => {
    setHasGroqApiKey(Boolean(await getGroqApiKey()));
  };

  const saveGroqKey = async () => {
    const key = groqApiKey.trim();
    if (!key) {
      alert('Paste your Groq API key first.');
      return;
    }
    // One key runs both the analysis and the speech-to-text, and both are Groq.
    if (!isGroqKey(key)) {
      alert('That is not a Groq key. Groq keys start with "gsk_" - get one free at console.groq.com/keys.');
      return;
    }
    try {
      await saveGroqApiKey(key);
      setGroqApiKey('');
      setHasGroqApiKey(true);
      alert('Groq API key saved on this device.');
    } catch (e) {
      console.error('Failed to save API key', e);
      alert('Could not save the API key.');
    }
  };

  // After a reinstall: read the key back from Downloads/Assay/assay_groq_key.txt.
  const restoreKey = async () => {
    try {
      const key = await restoreGroqKeyFromBackup();
      if (!key) {
        alert('No key found. Pick the file "assay_groq_key.txt" in Downloads > Assay.');
        return;
      }
      setHasGroqApiKey(true);
      alert('Groq API key restored from the backup.');
    } catch (e) {
      alert('Could not read the backup: ' + e.message);
    }
  };

  const removeGroqKey = async () => {
    try {
      await deleteGroqApiKey();
      setGroqApiKey('');
      setHasGroqApiKey(false);
      alert('API key deleted.');
    } catch (e) {
      console.error('Failed to delete API key', e);
      alert('Could not delete the API key.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Text style={styles.title}>Groq API Key</Text>
          <Text style={styles.desc}>
            Runs the fact check and the speech-to-text. Free at
            console.groq.com/keys - it starts with "gsk_".
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
            Status: {hasGroqApiKey ? 'Saved on device · backup in Downloads/Assay' : 'Not saved'}
            {groqApiKey && !isGroqKey(groqApiKey) ? ' | Not a Groq key' : ''}
          </Text>

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.downloadBtn} onPress={saveGroqKey}>
              <Text style={styles.btnText}>Save Key</Text>
            </TouchableOpacity>
            {hasGroqApiKey && (
              <TouchableOpacity style={styles.deleteBtn} onPress={removeGroqKey}>
                <Text style={styles.btnText}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
          {!hasGroqApiKey && (
            <TouchableOpacity style={styles.restoreBtn} onPress={restoreKey}>
              <Text style={styles.restoreText}>Reinstalled? Restore key from backup</Text>
            </TouchableOpacity>
          )}
        </View>

      <View style={styles.card}>
        <Text style={styles.title}>Background Permissions</Text>
        <Text style={styles.desc}>
          Notifications, running in the background, the doomscroll bubble and
          your phone's auto-start setting. Without them, results only arrive
          while the app is open.
        </Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.downloadBtn}
            onPress={() => navigation.navigate('Permissions', { fromSettings: true, initialSlide: 2 })}
          >
            <Text style={styles.btnText}>Review Permissions</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>How to Use Assay</Text>
        <Text style={styles.desc}>
          Read the instructions on how to use the Doomscroll Bubble, perform manual checks, and talk to the AI.
        </Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.downloadBtn}
            onPress={() => navigation.navigate('Permissions', { fromSettings: true, initialSlide: 1 })}
          >
            <Text style={styles.btnText}>Read Instructions</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>App Version</Text>
        <Text style={styles.desc}>
          Installed: v{currentVersion()}. Updates are checked every time the app opens; check now if you were told a new version is out.
        </Text>
        {!!updateStatus && <Text style={styles.statusText}>{updateStatus}</Text>}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.downloadBtn}
            onPress={async () => {
              setUpdateStatus('Checking...');
              const r = await checkForUpdates();
              setUpdateStatus(
                r.status === 'latest' ? 'Up to date (v' + currentVersion() + ')'
                  : r.status === 'available' ? 'Version ' + r.version + ' is available'
                  : r.status === 'downloading' ? 'An update is already downloading'
                  : r.status === 'none' ? 'No release published yet'
                  : 'Could not check - are you online?'
              );
            }}
          >
            <Text style={styles.btnText}>Check for Updates</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* The run log is one CSV row per analysis and it is how a batch of reels
          is scored. It was only reachable over adb, which meant a phone and a
          cable to read numbers the phone had already written. runlog.js has
          exported readRunLog/clearRunLog since it was created and nothing ever
          called them. */}
      <View style={styles.card}>
        <Text style={styles.title}>Run Log</Text>
        <Text style={styles.desc}>
          One CSV row per analysis: verdict, subject, evidence, timings and the
          full report. Share it to score a batch, clear it before starting a new
          one.
        </Text>
        <View style={styles.statusBox}>
          <Text style={styles.statusText}>
            Rows recorded: <Text style={{ color: colors.success }}>{runLogRows}</Text>
          </Text>
        </View>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.downloadBtn} onPress={shareRunLog}>
            <Text style={styles.btnText}>Share CSV</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.downloadBtn} onPress={saveRunLogCopy}>
            <Text style={styles.btnText}>Save CSV</Text>
          </TouchableOpacity>
          {runLogRows > 0 && (
            <TouchableOpacity style={styles.deleteBtn} onPress={clearRunLogFile}>
              <Text style={styles.btnText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
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
  buttonRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  downloadBtn: { backgroundColor: colors.primary, padding: 14, borderRadius: 8, flex: 1, alignItems: 'center' },
  restoreBtn: { marginTop: 10, padding: 10, alignItems: 'center' },
  restoreText: { color: colors.accentCyan, fontSize: 14, textDecorationLine: 'underline' },
  deleteBtn: { backgroundColor: colors.error, padding: 14, borderRadius: 8, flex: 1, alignItems: 'center' },
  btnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
});
