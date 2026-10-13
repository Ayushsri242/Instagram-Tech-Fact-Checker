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
  ScrollView,
  NativeModules,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../theme/colors';
import HomeTour from '../components/HomeTour';
import { getApiLimits, getOfflineMode, getUnseenResults, getAllReels } from '../services/storage';
import { verdictLabel, verdictColor, savedTime, timeAgo } from '../services/verdicts';
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
  const [recent, setRecent] = useState([]);
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
  const recentRef = React.useRef(null);

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
        // Unopened results get a NEW dot in Recent checks. The list grows to
        // hold all of them (up to 8), so nothing checked while away is hidden.
        const fresh = await getUnseenResults();
        setUnseen(fresh);
        setRecent((await getAllReels()).slice(0, Math.min(8, Math.max(4, fresh.length))));
        setNow(Date.now());
      };
      refresh();
      // The per-minute token window resets within a minute; re-read while this
      // screen is showing so the header is not frozen at its last value.
      const timer = setInterval(refresh, 5000);
      return () => clearInterval(timer);
    }, [])
  );

  const limitLine = isOffline ? 'OFFLINE MODE' : describeLimits(limits, now);

  // Only Instagram post links start an analysis. The box used to take anything
  // - a YouTube link went into the pipeline and failed a minute later - while
  // the bubble already ignored non-Instagram clipboards. The link is also pulled
  // out of surrounding text ("Check this https://www.instagram.com/reel/X/...").
  const startBubble = async () => {
    try {
      await NativeModules.TechFactChecker.startDoomscrollMode();
      alert('Bubble started. Open Instagram, copy a reel link and tap the bubble.');
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

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
            {job.lastFailure.retry && !!job.lastFailure.url && (
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => {
                  const url = job.lastFailure.url;
                  setLastFailure(null);
                  navigation.navigate('Chat', { initialUrl: url });
                }}
              >
                <Text style={styles.retryText}>↻  Retry</Text>
              </TouchableOpacity>
            )}
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

        {/* Results that finished while the user was in Instagram used to get a
            banner here, repeating Recent checks just below (Oct 13). They are
            now marked NEW in that list instead. */}
        {/* Home body (Oct 13 redesign): brand, the bubble card, recent checks.
            The old screen was a title and one button in empty space. */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.brand}>Assay</Text>
          <Text style={styles.tagline}>Fact-check tech reels in seconds</Text>

          <View style={styles.heroCard}>
            <Text style={styles.heroTitle}>Check while you scroll</Text>
            <Text style={styles.heroText}>Start the bubble, copy a reel link in Instagram, then tap the bubble. You never leave Instagram.</Text>
            <TouchableOpacity ref={bubbleRef} style={styles.heroBtn} onPress={startBubble}>
              <Text style={styles.heroBtnText}>▶  Start Doomscroll Mode</Text>
            </TouchableOpacity>
          </View>

          {/* collapsable={false}: Android drops layout-only views, and the tour has to measure this one. */}
          <View ref={recentRef} collapsable={false}>
          <View style={styles.recentHead}>
            <Text style={styles.sectionTitle}>Recent checks</Text>
            {recent.length > 0 && (
              <TouchableOpacity onPress={() => navigation.navigate('History')} hitSlop={10}>
                <Text style={styles.seeAll}>See all</Text>
              </TouchableOpacity>
            )}
          </View>
          {recent.length === 0 ? (
            <Text style={styles.emptyText}>Your verdicts will appear here. Paste a link below to try your first check.</Text>
          ) : (
            recent.map((r) => (
              <TouchableOpacity key={r.reelId} style={styles.recentRow} onPress={() => navigation.navigate('Result', { reel: r })}>
                <View style={[styles.verdictDot, { backgroundColor: verdictColor(r.verdict) }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.recentTitle} numberOfLines={1}>{r.techName || r.title || 'Reel'}</Text>
                  <Text style={styles.recentMeta}>
                    {verdictLabel(r.verdict)}{savedTime(r) ? '  ·  ' + timeAgo(savedTime(r)) : ''}
                  </Text>
                </View>
                {unseen.some((u) => u.reelId === r.reelId) && (
                  <View style={styles.newBadge}><Text style={styles.newBadgeText}>NEW</Text></View>
                )}
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            ))
          )}
          </View>
        </ScrollView>

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
              // Oct 13: the bubble leads now that it heads the redesigned Home.
              { ref: bubbleRef, title: 'Start here', text: 'Start Doomscroll Mode to check reels while you scroll Instagram.' },
              { ref: recentRef, title: 'Recent checks', text: 'Your latest verdicts show up here. Tap one to open its report.' },
              { ref: inputRef, title: 'Or paste a link', text: 'Paste any Instagram reel or post link here to check it right away.' },
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
  body: { paddingHorizontal: 20, paddingBottom: 24 },
  brand: { color: colors.textPrimary, fontSize: 34, fontWeight: 'bold', marginTop: 12, letterSpacing: 0.5 },
  tagline: { color: colors.accentCyan, fontSize: 14, marginTop: 2 },
  heroCard: { marginTop: 22, backgroundColor: colors.surface, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: 'rgba(0,229,255,0.35)' },
  heroTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: 'bold' },
  heroText: { color: colors.textSecondary, fontSize: 14, marginTop: 6, lineHeight: 20 },
  heroBtn: { marginTop: 16, backgroundColor: colors.accentCyan, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  heroBtnText: { color: '#000', fontWeight: 'bold', fontSize: 15 },
  recentHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 26, marginBottom: 8 },
  sectionTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: 'bold' },
  seeAll: { color: colors.accentCyan, fontSize: 14 },
  emptyText: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginTop: 4 },
  recentRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8 },
  verdictDot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  recentTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  recentMeta: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
  newBadge: { backgroundColor: colors.accentCyan, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 8 },
  newBadgeText: { color: '#000', fontSize: 10.5, fontWeight: 'bold', letterSpacing: 0.5 },
  chevron: { color: colors.textMuted, fontSize: 22, marginLeft: 8 },
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
  retryBtn: { alignSelf: 'flex-start', marginTop: 10, backgroundColor: colors.accentCyan, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 16 },
  retryText: { color: '#000', fontWeight: 'bold', fontSize: 14 },
  jobNote: { color: colors.warning || '#eab308', fontSize: 12.5, marginTop: 4 },
  jobTrack: { height: 4, borderRadius: 2, backgroundColor: colors.cardBorder, marginTop: 10, overflow: 'hidden' },
  jobFill: { height: 4, backgroundColor: colors.accentCyan },
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
