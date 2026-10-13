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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../theme/colors';
import HomeTour from '../components/HomeTour';
import { getApiLimits, getOfflineMode, getUnseenResults, clearUnseenResults } from '../services/storage';
import { describeLimits } from '../services/api';
import { getJobState, subscribeJob, JOB_STAGES, setLastFailure } from '../services/jobState';
import { subscribeUpdateProgress } from '../services/updater';

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
  const [updateProgress, setUpdateProgress] = useState(null);

  // Coach Mark state
  const [showTour, setShowTour] = useState(false);

  const containerRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const historyRef = React.useRef(null);
  const settingsRef = React.useRef(null);
  const bubbleRef = React.useRef(null);

  // The update check itself runs from App.js at launch; Home only shows the
  // download progress once the user accepts an update.
  React.useEffect(() => subscribeUpdateProgress(setUpdateProgress), []);

  // The progress strip: live while Home is showing, gone on every other screen.
  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem('@tfc_tutorial_done').then((done) => {
        if (done !== 'yes') {
          // Add a small delay to let UI render before starting
          setTimeout(() => setShowTour(true), 500);
        }
      });

      setJob(getJobState());
      const unsubscribe = subscribeJob(setJob);
      const timer = setInterval(() => setTick(Date.now()), 1000);
      return () => {
        unsubscribe();
        clearInterval(timer);
      };
    }, [])
  );

  const finishTour = () => {
    AsyncStorage.setItem('@tfc_tutorial_done', 'yes').catch(() => {});
    setShowTour(false);
  };

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
  // The X on the banner: dismiss without opening any verdict (they stay in
  // History). Before, the banner only went away by opening one of them.
  const dismissUnseen = async () => {
    await clearUnseenResults();
    setUnseen([]);
  };

  const openUnseen = async (reelId) => {
    await clearUnseenResults();
    setUnseen([]);
    navigation.navigate('Result', { reelId });
  };

  const limitLine = isOffline ? 'OFFLINE MODE' : describeLimits(limits, now);

  // Only Instagram post links start an analysis. The box used to take anything
  // - a YouTube link went into the pipeline and failed a minute later - while
  // the bubble already ignored non-Instagram clipboards. The link is also pulled
  // out of surrounding text ("Check this https://www.instagram.com/reel/X/...").
  const handleSend = () => {
    if (!url.trim()) return;
    const m = url.match(/https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(reels?|p)\/([A-Za-z0-9_-]+)/i);
    if (!m) {
      alert('Only Instagram reel or post links are supported.\n\nExample: https://www.instagram.com/reel/...');
      return;
    }
    const kind = m[1].toLowerCase() === 'p' ? 'p' : 'reel';
    navigation.navigate('Chat', { initialUrl: 'https://www.instagram.com/' + kind + '/' + m[2] + '/' });
    setUrl('');
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1 }} ref={containerRef}>
          {/* Header */}
          <View style={styles.header}>
            <View ref={historyRef}>
              <TouchableOpacity onPress={() => navigation.navigate('History')} style={styles.iconButton}>
                <Text style={styles.iconText}>History</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1 }} />
            <View ref={settingsRef}>
              <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.iconButton}>
                <Text style={styles.iconText}>Settings</Text>
              </TouchableOpacity>
            </View>
          </View>

        {/* Groq usage on its own row: squeezed between History and Settings it
            wrapped into tiny unreadable text (Oct 13 recording). */}
        {!!limitLine && <Text style={styles.limitText}>{limitLine.split(String.fromCharCode(10)).join('   ·   ')}</Text>}

        {updateProgress !== null && (
          <View style={styles.updateBanner}>
            <Text style={styles.updateTitle}>Downloading Update... {Math.round(updateProgress)}%</Text>
            <View style={styles.jobTrack}>
              <View style={[styles.jobFill, { width: `${updateProgress}%` }]} />
            </View>
          </View>
        )}

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
            {/* Long posts are read in parts and may wait for Groq's free
                per-minute budget; say so, or the bar looks frozen. */}
            {!!job.running.note && (
              <Text style={styles.jobNote}>
                {job.running.note}
                {job.running.noteUntil && job.running.noteUntil > tick
                  ? ' ' + elapsed(job.running.noteUntil - tick) : ''}
              </Text>
            )}
            <View style={styles.jobTrack}>
              <View style={[styles.jobFill, { width: ((job.running.step + 1) / JOB_STAGES.length) * 100 + '%' }]} />
            </View>
          </View>
        )}
        {/* A reel that could not be checked: say which and why, here and not
            only in the notification. Cleared when the next reel starts. */}
        {!job.running && !!job.lastFailure && (
          <View style={[styles.jobStrip, { borderColor: colors.error || '#ef4444' }]}>
            <View style={styles.jobRow}>
              <Text style={[styles.jobTitle, { color: colors.error || '#ef4444' }]} numberOfLines={1}>
                Couldn't check {job.lastFailure.ref ? 'reel ' + job.lastFailure.ref : 'the reel'}
              </Text>
              <TouchableOpacity onPress={() => setLastFailure(null)} hitSlop={12}>
                <Text style={styles.jobTime}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.jobStage}>{job.lastFailure.reason} It is saved in History.</Text>
          </View>
        )}
        {/* Between reels: a countdown, not a silent minute. The queue looked
            lost during the old fixed 60 s pause (Oct 7). */}
        {!job.running && job.waiting > 0 && (
          <View style={styles.jobStrip}>
            <View style={styles.jobRow}>
              <ActivityIndicator size="small" color={colors.accentCyan} />
              <Text style={styles.jobTitle} numberOfLines={1}>
                {job.waiting} reel{job.waiting > 1 ? 's' : ''} waiting
              </Text>
              {!!job.nextStartAt && (
                <Text style={styles.jobTime}>{elapsed(Math.max(0, job.nextStartAt - tick))}</Text>
              )}
            </View>
            <Text style={styles.jobStage} numberOfLines={1}>
              {job.nextStartAt ? 'Next starts in ' + elapsed(Math.max(0, job.nextStartAt - tick)) : 'Starting next reel…'}
              {(job.queued || []).length ? ' · ' + job.queued.join(', ') : ''}
            </Text>
            {!!job.nextStartAt && (
              <View style={styles.jobTrack}>
                <View style={[styles.jobFill, {
                  width: Math.min(100, Math.max(0, 100 - ((job.nextStartAt - tick) / 600))) + '%',
                }]} />
              </View>
            )}
          </View>
        )}

        {/* A result that finished while the user was elsewhere. Without this, a
            user who left mid-analysis and came back after Android had killed
            the app landed here with no sign anything had happened. */}
        {unseen.length === 1 && (
          <TouchableOpacity style={styles.readyBanner} onPress={() => openUnseen(unseen[0].reelId)}>
            <TouchableOpacity style={styles.readyClose} onPress={dismissUnseen} hitSlop={12}>
              <Text style={styles.readyCloseText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.readyTitle}>Verdict ready: {unseen[0].verdict.replace('_', ' ')}</Text>
            <Text style={styles.readySub} numberOfLines={1}>{unseen[0].techName} - tap to open</Text>
          </TouchableOpacity>
        )}
        {unseen.length > 1 && (
          <View style={styles.readyBanner}>
            <TouchableOpacity style={styles.readyClose} onPress={dismissUnseen} hitSlop={12}>
              <Text style={styles.readyCloseText}>✕</Text>
            </TouchableOpacity>
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
          <Text style={styles.title}>Assay</Text>
          <Text style={styles.subtitle}>Fact-check tech reels in seconds</Text>
          <TouchableOpacity 
            ref={bubbleRef}
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
        <View style={styles.inputContainer} ref={inputRef}>
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

        {/* First-run tour: spotlight each control, then a sample check (HomeTour). */}
        {showTour && (
          <HomeTour
            containerRef={containerRef}
            onDone={finishTour}
            steps={[
              { ref: inputRef, title: 'Paste a link here', text: 'Copy any Instagram reel or post link and paste it here to fact-check it.' },
              { ref: bubbleRef, title: 'Or check while you scroll', text: 'Start the bubble, copy a reel link in Instagram and tap the bubble. No need to leave Instagram.' },
              { ref: historyRef, title: 'Your past checks', text: 'Every verdict is saved here, so you can reopen it any time.' },
              { ref: settingsRef, title: 'Settings', text: 'Your Groq key, permissions and app updates live here.' },
            ]}
          />
        )}
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
    fontSize: 11.5,
    lineHeight: 16,
    textAlign: 'center',
    marginHorizontal: 16,
    marginBottom: 6,
    color: colors.textSecondary,
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  updateBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  updateTitle: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: 'bold',
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
  jobNote: { color: colors.warning || '#eab308', fontSize: 12.5, marginTop: 4 },
  jobTrack: { height: 4, borderRadius: 2, backgroundColor: colors.cardBorder, marginTop: 10, overflow: 'hidden' },
  jobFill: { height: 4, backgroundColor: colors.accentCyan },
  readyTitle: { color: colors.accentCyan, fontSize: 15, fontWeight: 'bold', paddingRight: 28 },
  readyClose: { position: 'absolute', top: 8, right: 10, zIndex: 2, padding: 4 },
  readyCloseText: { color: colors.textMuted, fontSize: 16, fontWeight: 'bold' },
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
