import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { getApiLimits, getOfflineMode, getUnseenResults, clearUnseenResults } from '../services/storage';
import { describeLimits } from '../services/api';
import { getJobState, subscribeJob, JOB_STAGES } from '../services/jobState';

const elapsed = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

export default function HomeScreen({ navigation }) {
  const [url, setUrl] = useState('');
  const [limits, setLimits] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const [unseen, setUnseen] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [job, setJob] = useState(getJobState());
  const [tick, setTick] = useState(Date.now());

  // The progress strip: live while Home is showing, gone on every other screen.
  useFocusEffect(
    useCallback(() => {
      setJob(getJobState());
      const unsubscribe = subscribeJob(setJob);
      const timer = setInterval(() => setTick(Date.now()), 1000);
      return () => {
        unsubscribe();
        clearInterval(timer);
      };
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      const refresh = async () => {
        const offline = await getOfflineMode();
        setIsOffline(offline);
        setLimits(offline ? null : await getApiLimits());
        // Only fresh, unopened results earn the banner.
        setUnseen(await getUnseenResults());
        setNow(Date.now());
      };
      refresh();
      // The per-minute token window resets within a minute; re-read while this
      // screen is showing so the header is not frozen at its last value.
      const timer = setInterval(refresh, 5000);
      return () => clearInterval(timer);
    }, [])
  );

  // Opening any one closes the whole banner; the others stay in History.
  const openUnseen = async (reelId) => {
    await clearUnseenResults();
    setUnseen([]);
    navigation.navigate('Result', { reelId });
  };

  const limitLine = isOffline ? 'OFFLINE MODE' : describeLimits(limits, now);

  const handleSend = () => {
    if (!url.trim()) return;
    navigation.navigate('Chat', { initialUrl: url.trim() });
    setUrl('');
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.navigate('History')} style={styles.iconButton}>
            <Text style={styles.iconText}>History</Text>
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            {!!limitLine && <Text style={styles.limitText}>{limitLine}</Text>}
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.iconButton}>
            <Text style={styles.iconText}>Settings</Text>
          </TouchableOpacity>
        </View>

        {/* A reel being analysed, or queued by the bubble. The notification says
            the same, but a user who opens the app should not have to pull down
            the shade to learn that work is still going on. */}
        {!!job.running && (
          <View style={styles.jobStrip}>
            <View style={styles.jobRow}>
              <ActivityIndicator size="small" color={colors.accentCyan} />
              <Text style={styles.jobTitle} numberOfLines={1}>Checking reel {job.running.ref}</Text>
              <Text style={styles.jobTime}>{elapsed(tick - job.running.startedAt)}</Text>
            </View>
            <Text style={styles.jobStage}>
              {JOB_STAGES[job.running.step]}
              {job.waiting > 0 ? ' · ' + job.waiting + ' more waiting' : ''}
            </Text>
            <View style={styles.jobTrack}>
              <View style={[styles.jobFill, { width: ((job.running.step + 1) / JOB_STAGES.length) * 100 + '%' }]} />
            </View>
          </View>
        )}
        {!job.running && job.waiting > 0 && (
          <View style={styles.jobStrip}>
            <Text style={styles.jobTitle}>
              {job.waiting} reel{job.waiting > 1 ? 's' : ''} waiting - next one starts within a minute
            </Text>
          </View>
        )}

        {/* A result that finished while the user was elsewhere. Without this, a
            user who left mid-analysis and came back after Android had killed
            the app landed here with no sign anything had happened. */}
        {unseen.length === 1 && (
          <TouchableOpacity style={styles.readyBanner} onPress={() => openUnseen(unseen[0].reelId)}>
            <Text style={styles.readyTitle}>Verdict ready: {unseen[0].verdict.replace('_', ' ')}</Text>
            <Text style={styles.readySub} numberOfLines={1}>{unseen[0].techName} - tap to open</Text>
          </TouchableOpacity>
        )}
        {unseen.length > 1 && (
          <View style={styles.readyBanner}>
            <Text style={styles.readyTitle}>{unseen.length} reels checked while you were away</Text>
            <Text style={styles.readySub}>Check them below, or later in History</Text>
            {unseen.map((r) => (
              <TouchableOpacity key={r.reelId} style={styles.readyRow} onPress={() => openUnseen(r.reelId)}>
                <Text style={styles.readyVerdict}>{r.verdict.replace('_', ' ')}</Text>
                <Text style={styles.readyName} numberOfLines={1}>{r.techName}</Text>
                <Text style={styles.readyOpen}>Open</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Center Title (Empty State) */}
        <View style={styles.centerContent}>
          <Text style={styles.title}>Tech Fact Checker</Text>
          <Text style={styles.subtitle}>100% Free - Local-First Micro-Agent</Text>
          <TouchableOpacity 
            style={{ marginTop: 24, padding: 12, backgroundColor: colors.accentCyan, borderRadius: 8 }}
            onPress={async () => {
              const { NativeModules } = require('react-native');
              try {
                await NativeModules.TechFactChecker.startDoomscrollMode();
                alert('Doomscroll Mode started! Floating bubble should appear.');
              } catch (e) {
                alert('Error: ' + e.message);
              }
            }}
          >
            <Text style={{ color: '#000', fontWeight: 'bold' }}>Start Doomscroll Mode</Text>
          </TouchableOpacity>
        </View>

        {/* Input Bar at Bottom */}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Paste Instagram link here..."
            placeholderTextColor={colors.textMuted}
            value={url}
            onChangeText={setUrl}
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity
            style={[styles.sendButton, !url.trim() && styles.disabledSend]}
            onPress={handleSend}
            disabled={!url.trim()}
          >
            <Text style={styles.sendText}>Check</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    alignItems: 'center',
  },
  iconButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  iconText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  limitText: {
    fontSize: 12,
    color: colors.textMuted,
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  readyBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accentCyan,
    backgroundColor: colors.surface,
  },
  jobStrip: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.surface,
  },
  jobRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  jobTitle: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: 'bold' },
  jobTime: { color: colors.textMuted, fontSize: 13 },
  jobStage: { color: colors.textMuted, fontSize: 13, marginTop: 6 },
  jobTrack: { height: 4, borderRadius: 2, backgroundColor: colors.cardBorder, marginTop: 10, overflow: 'hidden' },
  jobFill: { height: 4, backgroundColor: colors.accentCyan },
  readyTitle: { color: colors.accentCyan, fontSize: 15, fontWeight: 'bold' },
  readySub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  readyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  readyVerdict: { color: colors.accentCyan, fontSize: 13, fontWeight: 'bold', minWidth: 110 },
  readyName: { flex: 1, color: colors.textPrimary, fontSize: 14 },
  readyOpen: { color: colors.accentCyan, fontSize: 13, fontWeight: '600' },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: colors.accentCyan,
    marginTop: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 14,
  },
  sendButton: {
    backgroundColor: colors.accentCyan,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  disabledSend: {
    opacity: 0.5,
  },
  sendText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
