import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated, Easing, StyleSheet, ScrollView } from 'react-native';
import { colors } from '../theme/colors';

// "How to use" as six scenes that copy the REAL app screens, in the order a
// user does things (Oct 12, tester feedback: nobody reads the text, and the
// first version's generic scenes did not show the actual app). Way 1 is the
// bubble while scrolling, way 2 is pasting a link, then the report and Ask AI.
// Built-in Animated only - no video files, no native rebuild.

const STEPS = [
  { title: 'Start the bubble', line: 'On Home, tap "Start Doomscroll Mode". The AI bubble appears on your screen.' },
  { title: 'Copy a reel link', line: 'In Instagram, tap Share → Copy link on the reel.' },
  { title: 'Tap the bubble', line: 'It turns orange, then blue - the check has started. You get a notification with the verdict.' },
  { title: 'Or paste a link', line: 'Copy a link, open Assay, paste it in the box and tap Check.' },
  { title: 'Read the verdict', line: 'See if the claim is true, hype or misleading - and which tools are real.' },
  { title: 'Ask AI', line: 'Tap Ask AI on any tool to chat about it.' },
];
const STEP_MS = 4200;
// Pages that are not on screen sit at their first frame.
const ZERO = new Animated.Value(0);

// Fraction of the step's timeline -> 0..1 window helpers.
const at = (t, a, b) => t.interpolate({ inputRange: [0, a, b, 1], outputRange: [0, 0, 1, 1], extrapolate: 'clamp' });
const blink = (t, a, b) => t.interpolate({ inputRange: [0, a, (a + b) / 2, b, 1], outputRange: [0, 0, 1, 0, 0], extrapolate: 'clamp' });

const Phone = ({ children }) => (
  <View style={styles.phone}>
    <View style={styles.notch} />
    <View style={styles.screen}>{children}</View>
  </View>
);

// A finger that moves in and taps (x, y) at fraction `when` of the timeline.
const Finger = ({ t, x, y, when }) => (
  <Animated.Text style={[styles.finger, {
    left: x, top: y,
    opacity: t.interpolate({ inputRange: [0, when - 0.15, when, when + 0.15, 1], outputRange: [0, 1, 1, 0, 0], extrapolate: 'clamp' }),
    transform: [{ scale: t.interpolate({ inputRange: [0, when - 0.03, when, when + 0.03, 1], outputRange: [1, 1, 0.8, 1, 1], extrapolate: 'clamp' }) }],
  }]}>👆</Animated.Text>
);

// Assay's Home: header, title, Start Doomscroll button, paste bar with Check.
const MiniHome = ({ t, pasted, pressCheck, pressStart }) => (
  <View style={{ flex: 1, backgroundColor: colors.background }}>
    <View style={styles.hHeader}>
      <Text style={styles.hHeaderBtn}>History</Text>
      <Text style={styles.hHeaderBtn}>⚙</Text>
    </View>
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={styles.hTitle}>Tech Fact Checker</Text>
      <Animated.View style={[styles.hStart, pressStart && { opacity: t.interpolate({ inputRange: [0, 0.28, 0.32, 0.4, 1], outputRange: [1, 1, 0.5, 1, 1] }) }]}>
        <Text style={styles.hStartText}>Start Doomscroll Mode</Text>
      </Animated.View>
    </View>
    <View style={styles.hBar}>
      <View style={styles.hInput}>
        <Text style={styles.hPlaceholder} numberOfLines={1}>Paste Instagram link here...</Text>
        {pasted && (
          <Animated.View style={[StyleSheet.absoluteFill, styles.hPasted, { opacity: at(t, 0.2, 0.28) }]}>
            <Text style={styles.hPastedText} numberOfLines={1}>instagram.com/reel/DeMN1…</Text>
          </Animated.View>
        )}
      </View>
      <Animated.View style={[styles.hCheck, pressCheck && { opacity: t.interpolate({ inputRange: [0, 0.5, 0.54, 0.6, 1], outputRange: [0.5, 0.5, 1, 0.6, 1] }) }]}>
        <Text style={styles.hCheckText}>Check</Text>
      </Animated.View>
    </View>
  </View>
);

// An Instagram reel: video area, caption, right-side action icons.
const MiniReel = ({ children }) => (
  <View style={styles.reel}>
    <View style={styles.reelIcons}>
      <Text style={styles.reelIcon}>♡</Text>
      <Text style={styles.reelIcon}>💬</Text>
      <Text style={styles.reelIcon}>➤</Text>
      <Text style={styles.reelIcon}>⋯</Text>
    </View>
    <View style={styles.reelCaption}>
      <Text style={styles.reelUser}>@techguru</Text>
      <Text style={styles.reelText}>"Claude Code Pro is FREE for 1 year!"</Text>
    </View>
    {children}
  </View>
);

const Bubble = ({ style, color }) => (
  <Animated.View style={[styles.bubble, style, color && { backgroundColor: color }]}>
    <Text style={styles.bubbleText}>AI</Text>
  </Animated.View>
);

const SceneStart = ({ t }) => (
  <Phone>
    <MiniHome t={t} pressStart />
    <Finger t={t} x={60} y={118} when={0.32} />
    <Bubble style={{ top: 60, right: 6, transform: [{ scale: t.interpolate({ inputRange: [0, 0.42, 0.52, 0.58, 1], outputRange: [0, 0, 1.2, 1, 1], extrapolate: 'clamp' }) }] }} />
  </Phone>
);

const SceneCopy = ({ t }) => (
  <Phone>
    <MiniReel>
      <Bubble style={{ top: 50, left: 6 }} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY: t.interpolate({ inputRange: [0, 0.3, 0.42, 1], outputRange: [140, 140, 0, 0], extrapolate: 'clamp' }) }] }]}>
        <View style={styles.sheetGrab} />
        <Text style={styles.sheetItem}>Send to…</Text>
        <Animated.View style={[styles.sheetRow, { backgroundColor: t.interpolate({ inputRange: [0, 0.58, 0.62, 1], outputRange: ['rgba(0,229,255,0)', 'rgba(0,229,255,0)', 'rgba(0,229,255,0.35)', 'rgba(0,229,255,0.35)'] }) }]}>
          <Text style={styles.sheetItemBold}>🔗  Copy link</Text>
        </Animated.View>
        <Text style={styles.sheetItem}>Share to…</Text>
      </Animated.View>
      <Animated.View style={[styles.toast, { opacity: at(t, 0.7, 0.76) }]}>
        <Text style={styles.toastText}>Link copied</Text>
      </Animated.View>
    </MiniReel>
    <Finger t={t} x={128} y={118} when={0.25} />
    <Finger t={t} x={40} y={210} when={0.6} />
  </Phone>
);

const SceneTap = ({ t }) => (
  <Phone>
    <MiniReel>
      <Bubble
        style={{ top: 50, left: 6, transform: [{ scale: t.interpolate({ inputRange: [0, 0.22, 0.26, 0.3, 1], outputRange: [1, 1, 0.8, 1.1, 1], extrapolate: 'clamp' }) }] }}
        color={t.interpolate({ inputRange: [0, 0.25, 0.27, 0.5, 0.52, 1], outputRange: ['#00E5FF', '#00E5FF', '#FF9800', '#FF9800', '#00E5FF', '#00E5FF'], extrapolate: 'clamp' })}
      />
      <Animated.View style={[styles.notif, { transform: [{ translateY: t.interpolate({ inputRange: [0, 0.62, 0.72, 1], outputRange: [-90, -90, 0, 0], extrapolate: 'clamp' }) }] }]}>
        <Text style={styles.notifApp}>🔍 Assay · now</Text>
        <Text style={styles.notifTitle}>Verdict ready: MISLEADING</Text>
        <Text style={styles.notifBody}>Tap to read the fact check - Claude Startups Program</Text>
      </Animated.View>
    </MiniReel>
    <Finger t={t} x={10} y={70} when={0.25} />
  </Phone>
);

const ScenePaste = ({ t }) => (
  <Phone>
    <MiniHome t={t} pasted pressCheck />
    <Animated.View style={[styles.strip, { opacity: at(t, 0.6, 0.64) }]}>
      <Text style={styles.stripTitle}>Checking reel DeMN1…</Text>
      <View style={styles.stripTrack}>
        <Animated.View style={[styles.stripFill, { width: t.interpolate({ inputRange: [0, 0.62, 1], outputRange: ['0%', '0%', '100%'], extrapolate: 'clamp' }) }]} />
      </View>
    </Animated.View>
    <Finger t={t} x={60} y={250} when={0.18} />
    <Finger t={t} x={140} y={250} when={0.54} />
  </Phone>
);

const SceneReport = ({ t }) => (
  <Phone>
    <View style={{ flex: 1, backgroundColor: colors.background, padding: 8 }}>
      <Text style={styles.rHeader}>Fact-Check Report</Text>
      <View style={styles.rBadge}><Text style={styles.rBadgeText}>VERDICT: MISLEADING</Text></View>
      <Text style={styles.rSummary}>A real programme - but only eligible startups get a free year, not everyone who comments.</Text>
      <View style={styles.rTool}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rToolName}>Claude Team ✓</Text>
          <Text style={styles.rToolDesc}>Anthropic's team plan</Text>
        </View>
        <Animated.View style={[styles.askChip, { transform: [{ scale: t.interpolate({ inputRange: [0, 0.4, 0.5, 0.6, 0.7, 1], outputRange: [1, 1, 1.15, 1, 1.15, 1], extrapolate: 'clamp' }) }] }]}>
          <Text style={styles.askChipText}>ASK AI</Text>
        </Animated.View>
      </View>
    </View>
    <Finger t={t} x={128} y={170} when={0.75} />
  </Phone>
);

const SceneChat = ({ t }) => (
  <Phone>
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Text style={[styles.rHeader, { padding: 8 }]}>Ask AI</Text>
      <View style={{ flex: 1, justifyContent: 'flex-end', padding: 8 }}>
        <Animated.View style={[styles.msgUser, { opacity: at(t, 0.15, 0.22) }]}>
          <Text style={styles.msgUserText}>Can a student get it free?</Text>
        </Animated.View>
        <Animated.View style={[styles.msgTyping, { opacity: blink(t, 0.3, 0.5) }]}>
          <Text style={styles.msgAiText}>• • •</Text>
        </Animated.View>
        <Animated.View style={[styles.msgAi, { opacity: at(t, 0.5, 0.58) }]}>
          <Text style={styles.msgAiText}>No - the free year is only for approved startups. Students can use the free plan.</Text>
        </Animated.View>
      </View>
      <View style={styles.chatBar}><Text style={styles.hPlaceholder}>Ask a question...</Text></View>
    </View>
  </Phone>
);

const SCENES = [SceneStart, SceneCopy, SceneTap, ScenePaste, SceneReport, SceneChat];

// Manual (Oct 12: auto-advance was too fast). Swipe or use the arrows; the
// step on screen replays its animation slowly until the user moves on. A
// nested horizontal ScrollView takes the swipe before the Welcome pager does.
export default function HowItWorks() {
  const [step, setStep] = useState(0);
  const [pageW, setPageW] = useState(0);
  const pager = useRef(null);
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    t.setValue(0);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: STEP_MS, easing: Easing.linear, useNativeDriver: false }),
      Animated.delay(900),
      Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [step]);

  const go = (i) => {
    const next = Math.max(0, Math.min(STEPS.length - 1, i));
    pager.current?.scrollTo({ x: next * pageW, animated: true });
    setStep(next);
  };

  return (
    <View style={styles.wrap} onLayout={(e) => setPageW(e.nativeEvent.layout.width)}>
      {pageW > 0 && (
        <ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setStep(Math.round(e.nativeEvent.contentOffset.x / pageW))}
          style={{ width: pageW }}
        >
          {STEPS.map((s, i) => {
            const Scene = SCENES[i];
            return (
              <View key={i} style={{ width: pageW, alignItems: 'center' }}>
                <Scene t={i === step ? t : ZERO} />
                <Text style={styles.stepNo}>STEP {i + 1} OF {STEPS.length}</Text>
                <Text style={styles.title}>{s.title}</Text>
                <Text style={styles.line}>{s.line}</Text>
              </View>
            );
          })}
        </ScrollView>
      )}
      <View style={styles.navRow}>
        <TouchableOpacity onPress={() => go(step - 1)} disabled={step === 0} hitSlop={12}>
          <Text style={[styles.arrow, step === 0 && { opacity: 0.25 }]}>‹</Text>
        </TouchableOpacity>
        <View style={styles.dots}>
          {STEPS.map((_, i) => (
            <TouchableOpacity key={i} onPress={() => go(i)} hitSlop={10}>
              <View style={[styles.dot, i === step && styles.dotOn]} />
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={() => go(step + 1)} disabled={step === STEPS.length - 1} hitSlop={12}>
          <Text style={[styles.arrow, step === STEPS.length - 1 && { opacity: 0.25 }]}>›</Text>
        </TouchableOpacity>
      </View>
      {step === 0 && <Text style={styles.hint}>Swipe to see how it works →</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 8 },
  phone: { width: 190, height: 320, borderRadius: 28, borderWidth: 3, borderColor: '#3a3f4b', backgroundColor: '#0b0d12', padding: 7, overflow: 'hidden' },
  notch: { alignSelf: 'center', width: 50, height: 6, borderRadius: 3, backgroundColor: '#3a3f4b', marginBottom: 5 },
  screen: { flex: 1, borderRadius: 18, backgroundColor: colors.background, overflow: 'hidden' },
  finger: { position: 'absolute', fontSize: 24 },
  // Assay Home
  hHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 8 },
  hHeaderBtn: { color: colors.textPrimary, fontSize: 10, fontWeight: 'bold' },
  hTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: 'bold' },
  hStart: { marginTop: 10, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.accentCyan, borderRadius: 6 },
  hStartText: { color: '#000', fontSize: 9, fontWeight: 'bold' },
  hBar: { flexDirection: 'row', padding: 6, gap: 5, alignItems: 'center' },
  hInput: { flex: 1, height: 26, borderRadius: 13, backgroundColor: colors.surface, justifyContent: 'center', paddingHorizontal: 8, overflow: 'hidden' },
  hPlaceholder: { color: colors.textMuted, fontSize: 8 },
  hPasted: { backgroundColor: colors.surface, justifyContent: 'center', paddingHorizontal: 8 },
  hPastedText: { color: colors.textPrimary, fontSize: 8 },
  hCheck: { backgroundColor: colors.accentCyan, borderRadius: 13, paddingHorizontal: 9, height: 26, justifyContent: 'center' },
  hCheckText: { color: '#000', fontSize: 9, fontWeight: 'bold' },
  strip: { position: 'absolute', left: 8, right: 8, top: 30, backgroundColor: colors.surface, borderRadius: 8, padding: 7, borderWidth: 1, borderColor: colors.accentCyan },
  stripTitle: { color: colors.textPrimary, fontSize: 9, fontWeight: 'bold', marginBottom: 5 },
  stripTrack: { height: 4, borderRadius: 2, backgroundColor: colors.background, overflow: 'hidden' },
  stripFill: { height: 4, backgroundColor: colors.accentCyan },
  // Instagram reel
  reel: { flex: 1, backgroundColor: '#2a1f3d' },
  reelIcons: { position: 'absolute', right: 8, bottom: 60, alignItems: 'center', gap: 10 },
  reelIcon: { color: '#fff', fontSize: 15 },
  reelCaption: { position: 'absolute', left: 8, right: 40, bottom: 12 },
  reelUser: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  reelText: { color: '#fff', fontSize: 9, marginTop: 2 },
  bubble: { position: 'absolute', width: 34, height: 34, borderRadius: 17, backgroundColor: '#00E5FF', alignItems: 'center', justifyContent: 'center', elevation: 4 },
  bubbleText: { color: '#000', fontWeight: 'bold', fontSize: 11 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#262626', padding: 10, borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  sheetGrab: { alignSelf: 'center', width: 30, height: 3, borderRadius: 2, backgroundColor: '#555', marginBottom: 8 },
  sheetItem: { color: '#bbb', fontSize: 10, marginVertical: 4 },
  sheetRow: { borderRadius: 6, padding: 5 },
  sheetItemBold: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  toast: { position: 'absolute', alignSelf: 'center', top: 30, backgroundColor: '#333', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  toastText: { color: '#fff', fontSize: 9 },
  notif: { position: 'absolute', left: 5, right: 5, top: 5, backgroundColor: '#e8eaf0', borderRadius: 10, padding: 7 },
  notifApp: { color: '#555', fontSize: 8 },
  notifTitle: { color: '#000', fontSize: 10, fontWeight: 'bold', marginTop: 1 },
  notifBody: { color: '#333', fontSize: 8, marginTop: 1 },
  // Report
  rHeader: { color: colors.textPrimary, fontSize: 12, fontWeight: 'bold', marginBottom: 8 },
  rBadge: { alignSelf: 'flex-start', backgroundColor: '#f97316', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  rBadgeText: { color: '#000', fontSize: 9, fontWeight: 'bold' },
  rSummary: { color: colors.textMuted, fontSize: 9, marginTop: 8, lineHeight: 13 },
  rTool: { flexDirection: 'row', alignItems: 'center', marginTop: 12, backgroundColor: colors.surface, borderRadius: 8, padding: 8 },
  rToolName: { color: colors.textPrimary, fontSize: 10, fontWeight: 'bold' },
  rToolDesc: { color: colors.textMuted, fontSize: 8, marginTop: 2 },
  askChip: { backgroundColor: colors.accentCyan, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  askChipText: { color: '#000', fontSize: 8, fontWeight: 'bold' },
  // Chat
  msgUser: { alignSelf: 'flex-end', backgroundColor: colors.accentCyan, borderRadius: 10, padding: 7, marginBottom: 6, maxWidth: '85%' },
  msgUserText: { color: '#000', fontSize: 9 },
  msgTyping: { position: 'absolute', left: 8, bottom: 8, backgroundColor: colors.surface, borderRadius: 10, padding: 7 },
  msgAi: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderRadius: 10, padding: 7, maxWidth: '90%' },
  msgAiText: { color: colors.textPrimary, fontSize: 9, lineHeight: 13 },
  chatBar: { margin: 6, height: 24, borderRadius: 12, backgroundColor: colors.surface, justifyContent: 'center', paddingHorizontal: 8 },
  // Captions and navigation
  stepNo: { color: colors.accentCyan, fontSize: 11, fontWeight: 'bold', marginTop: 16, letterSpacing: 1 },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: 'bold', marginTop: 4 },
  line: { color: colors.textMuted, fontSize: 15, textAlign: 'center', marginTop: 6, paddingHorizontal: 24, lineHeight: 21 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginTop: 16 },
  arrow: { color: colors.accentCyan, fontSize: 34, fontWeight: 'bold', paddingHorizontal: 8 },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
  dots: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.cardBorder || '#333' },
  dotOn: { width: 22, backgroundColor: colors.accentCyan },
});
