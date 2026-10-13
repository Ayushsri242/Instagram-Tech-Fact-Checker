import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, Animated, Easing, StyleSheet, ScrollView } from 'react-native';
import { colors } from '../theme/colors';

// "How to use" as seven steps on REAL app screenshots (Oct 13: the drawn copies
// did not look like the app). Each step shows a screenshot in a phone frame
// with a tapping finger and a ring on what to tap. Screens live in
// assets/tour/ at 360 px wide; every x/y below is in that 360-wide space.
// Built-in Animated only - no video files, no native rebuild.

const IMG = {
  home: require('../../assets/tour/home.jpg'),
  reel: require('../../assets/tour/reel.jpg'),
  share: require('../../assets/tour/share.jpg'),
  notif: require('../../assets/tour/notif.jpg'),
  report: require('../../assets/tour/report.jpg'),
  chat: require('../../assets/tour/chat.jpg'),
  bubble: require('../../assets/tour/bubble.png'),
};

const STEPS = [
  { title: 'Start the bubble', line: 'Tap Start Doomscroll Mode on Home. A small AI bubble floats over Instagram.' },
  { title: 'Copy a reel link', line: 'On any reel, tap Share, then Copy link.' },
  { title: 'Tap the bubble', line: 'It turns orange when it gets the link, then blue again while checking. A notification shows the verdict - tap it to open the report.' },
  { title: 'Keep scrolling', line: 'Check as many reels as you like. When you are done, open Assay: your results are under Recent checks, and all of them are in History.' },
  { title: 'Or paste a link', line: 'Paste a link in the box on Home and tap Check.' },
  { title: 'Read the verdict', line: 'See if it is true, partly true, hype or misleading - with each claim and tool checked.' },
  { title: 'Ask AI', line: 'Ask follow-up questions, like "Is this free?"' },
];
const STEP_MS = 4200;
// Pages that are not on screen sit at their first frame.
const ZERO = new Animated.Value(0);

// Screenshots are 360 x 744; the phone screen shows them at half size.
const SCALE = 0.5;
const SCREEN_W = 360 * SCALE;
const SCREEN_H = 744 * SCALE;
const s = (v) => v * SCALE;

// Fraction of the step's timeline -> 0..1 window helpers.
const at = (t, a, b) => t.interpolate({ inputRange: [0, a, b, 1], outputRange: [0, 0, 1, 1], extrapolate: 'clamp' });
const blink = (t, a, b) => t.interpolate({ inputRange: [0, a, (a + b) / 2, b, 1], outputRange: [0, 0, 1, 0, 0], extrapolate: 'clamp' });

const Phone = ({ children }) => (
  <View style={styles.phone}>
    <View style={styles.screen}>{children}</View>
  </View>
);

const Shot = ({ src, style }) => (
  <Animated.Image source={src} style={[styles.shot, style]} resizeMode="stretch" />
);

// A finger that moves in and taps (x, y) at fraction `when` of the timeline.
const Finger = ({ t, x, y, when }) => (
  <Animated.Text style={[styles.finger, {
    left: s(x) - 9, top: s(y) - 3,
    opacity: t.interpolate({ inputRange: [0, when - 0.15, when, when + 0.15, 1], outputRange: [0, 1, 1, 0, 0], extrapolate: 'clamp' }),
    transform: [
      { translateY: t.interpolate({ inputRange: [0, when - 0.15, when, 1], outputRange: [24, 24, 0, 0], extrapolate: 'clamp' }) },
      { scale: t.interpolate({ inputRange: [0, when - 0.03, when, when + 0.03, 1], outputRange: [1, 1, 0.8, 1, 1], extrapolate: 'clamp' }) },
    ],
  }]}>👆</Animated.Text>
);

// A glowing ring around (x, y), shown between fractions a and b.
const Ring = ({ t, x, y, a, b, w = 60, h = 60, radius }) => (
  <Animated.View
    pointerEvents="none"
    style={[styles.ring, {
      left: s(x) - s(w) / 2, top: s(y) - s(h) / 2, width: s(w), height: s(h),
      borderRadius: radius ?? s(Math.min(w, h)) / 2,
      opacity: t.interpolate({ inputRange: [0, a, a + 0.05, b - 0.05, b, 1], outputRange: [0, 0, 1, 1, 0, 0], extrapolate: 'clamp' }),
      transform: [{ scale: t.interpolate({ inputRange: [0, a, a + 0.1, a + 0.2, a + 0.3, 1], outputRange: [1, 1, 1.12, 1, 1.12, 1], extrapolate: 'clamp' }) }],
    }]}
  />
);

// Matches the real bubble (FloatingBubbleService): app icon in a dark circle,
// the ring colour is the state.
const Bubble = ({ x, y, style, color }) => (
  <Animated.View style={[styles.bubble, { left: s(x) - 17, top: s(y) - 17 }, style, color && { borderColor: color }]}>
    <Image source={IMG.bubble} style={styles.bubbleIcon} />
  </Animated.View>
);

// 1. Home -> Start Doomscroll Mode -> the bubble appears.
const SceneStart = ({ t }) => (
  <Phone>
    <Shot src={IMG.home} />
    <Ring t={t} x={180} y={305} w={290} h={50} radius={8} a={0.1} b={0.4} />
    <Finger t={t} x={180} y={305} when={0.32} />
    <Bubble x={325} y={140} style={{ transform: [{ scale: t.interpolate({ inputRange: [0, 0.42, 0.52, 0.58, 1], outputRange: [0, 0, 1.2, 1, 1], extrapolate: 'clamp' }) }] }} />
  </Phone>
);

// 2. Instagram reel -> Share -> Copy link.
const SceneCopy = ({ t }) => (
  <Phone>
    <Shot src={IMG.reel} />
    <Shot src={IMG.share} style={{ opacity: at(t, 0.32, 0.4) }} />
    <Ring t={t} x={162} y={623} a={0.05} b={0.3} w={50} h={50} />
    <Finger t={t} x={162} y={623} when={0.25} />
    <Ring t={t} x={58} y={650} w={100} h={100} radius={10} a={0.5} b={0.95} />
    <Animated.View style={[styles.toast, { opacity: at(t, 0.62, 0.68) }]}>
      <Text style={styles.toastText}>Link copied ✓</Text>
    </Animated.View>
  </Phone>
);

// 3. Tap the bubble -> orange while checking -> verdict notification.
const SceneTap = ({ t }) => (
  <Phone>
    <Shot src={IMG.reel} />
    <Bubble
      x={20} y={78}
      style={{ transform: [{ scale: t.interpolate({ inputRange: [0, 0.22, 0.26, 0.3, 1], outputRange: [1, 1, 0.8, 1.1, 1], extrapolate: 'clamp' }) }] }}
      color={t.interpolate({ inputRange: [0, 0.25, 0.27, 0.55, 0.57, 1], outputRange: ['#00E5FF', '#00E5FF', '#FF9800', '#FF9800', '#00E5FF', '#00E5FF'], extrapolate: 'clamp' })}
    />
    <Ring t={t} x={20} y={78} w={80} h={80} a={0.02} b={0.3} />
    <Finger t={t} x={30} y={88} when={0.25} />
    <Animated.Image
      source={IMG.notif}
      resizeMode="stretch"
      style={[styles.notif, { transform: [{ translateY: t.interpolate({ inputRange: [0, 0.62, 0.72, 1], outputRange: [-60, -60, 0, 0], extrapolate: 'clamp' }) }] }]}
    />
  </Phone>
);

// 4. Back in Assay after scrolling: Recent checks, then History.
const SceneResults = ({ t }) => (
  <Phone>
    <Shot src={IMG.home} />
    <Ring t={t} x={180} y={435} w={330} h={70} radius={10} a={0.08} b={0.48} />
    <Ring t={t} x={52} y={33} w={86} h={44} radius={8} a={0.52} b={0.95} />
    <Finger t={t} x={52} y={38} when={0.75} />
  </Phone>
);

// 5. Home -> paste in the box -> Check.
const ScenePaste = ({ t }) => (
  <Phone>
    <Shot src={IMG.home} />
    <Animated.View style={[styles.pasted, { opacity: at(t, 0.24, 0.3) }]}>
      <Text style={styles.pastedText} numberOfLines={1}>instagram.com/p/Db9eN0dg7ER/</Text>
    </Animated.View>
    <Animated.View style={[styles.checkOn, { opacity: at(t, 0.3, 0.36) }]}>
      <Text style={styles.checkOnText}>Check</Text>
    </Animated.View>
    <Finger t={t} x={140} y={703} when={0.2} />
    <Ring t={t} x={311} y={703} w={80} h={56} a={0.4} b={0.75} />
    <Finger t={t} x={311} y={703} when={0.6} />
  </Phone>
);

// 6. The report: the verdict, then the claims.
const SceneReport = ({ t }) => (
  <Phone>
    <Shot src={IMG.report} />
    <Ring t={t} x={97} y={316} w={170} h={40} radius={8} a={0.1} b={0.5} />
    <Ring t={t} x={180} y={560} w={340} h={140} radius={10} a={0.5} b={0.95} />
  </Phone>
);

// 7. Ask AI: the question goes in, then the answer types in.
const SceneChat = ({ t }) => (
  <Phone>
    <Shot src={IMG.chat} />
    {/* Hide the real question and answer, then reveal them in order. */}
    <Animated.View style={[styles.cover, { top: s(478), height: s(58), opacity: t.interpolate({ inputRange: [0, 0.2, 0.26, 1], outputRange: [1, 1, 0, 0], extrapolate: 'clamp' }) }]} />
    <Animated.View style={[styles.cover, { top: s(536), height: s(110), opacity: t.interpolate({ inputRange: [0, 0.5, 0.58, 1], outputRange: [1, 1, 0, 0], extrapolate: 'clamp' }) }]} />
    <Animated.View style={[styles.typing, { opacity: blink(t, 0.28, 0.52) }]}>
      <Text style={styles.typingText}>• • •</Text>
    </Animated.View>
    <Finger t={t} x={316} y={704} when={0.18} />
  </Phone>
);

const SCENES = [SceneStart, SceneCopy, SceneTap, SceneResults, ScenePaste, SceneReport, SceneChat];

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
          {STEPS.map((st, i) => {
            const Scene = SCENES[i];
            return (
              <View key={i} style={{ width: pageW, alignItems: 'center' }}>
                <Scene t={i === step ? t : ZERO} />
                <Text style={styles.stepNo}>STEP {i + 1} OF {STEPS.length}</Text>
                <Text style={styles.title}>{st.title}</Text>
                <Text style={styles.line}>{st.line}</Text>
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
  phone: { borderRadius: 24, borderWidth: 3, borderColor: '#3a3f4b', backgroundColor: '#0b0d12', padding: 6 },
  screen: { width: SCREEN_W, height: SCREEN_H, borderRadius: 16, backgroundColor: colors.background, overflow: 'hidden' },
  shot: { position: 'absolute', left: 0, top: 0, width: SCREEN_W, height: SCREEN_H },
  finger: { position: 'absolute', fontSize: 22 },
  ring: { position: 'absolute', borderWidth: 2, borderColor: colors.accentCyan, backgroundColor: 'rgba(0,229,255,0.12)' },
  bubble: { position: 'absolute', width: 34, height: 34, borderRadius: 17, backgroundColor: '#0F141C', borderWidth: 2, borderColor: '#00E5FF', alignItems: 'center', justifyContent: 'center', elevation: 4, overflow: 'hidden' },
  bubbleIcon: { width: 28, height: 28, borderRadius: 14 },
  toast: { position: 'absolute', alignSelf: 'center', top: 30, backgroundColor: '#333', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  toastText: { color: '#fff', fontSize: 10 },
  notif: { position: 'absolute', left: 4, top: 4, width: SCREEN_W - 8, height: (SCREEN_W - 8) * 82 / 360, borderRadius: 8 },
  // Paste scene: the pasted link and the Check button lighting up.
  pasted: { position: 'absolute', left: s(14), top: s(678), width: s(248), height: s(50), justifyContent: 'center', paddingHorizontal: 8, backgroundColor: '#1b2230', borderRadius: s(25) },
  pastedText: { color: colors.textPrimary, fontSize: 8.5 },
  checkOn: { position: 'absolute', left: s(274), top: s(681), width: s(74), height: s(44), borderRadius: s(22), backgroundColor: colors.accentCyan, alignItems: 'center', justifyContent: 'center' },
  checkOnText: { color: '#000', fontSize: 9, fontWeight: 'bold' },
  // Chat scene: background-coloured covers over the real messages.
  cover: { position: 'absolute', left: 0, right: 0, backgroundColor: '#0f141c' },
  typing: { position: 'absolute', left: s(16), top: s(545), backgroundColor: '#1b2230', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  typingText: { color: colors.textPrimary, fontSize: 10 },
  // Captions and navigation
  stepNo: { color: colors.accentCyan, fontSize: 11, fontWeight: 'bold', marginTop: 14, letterSpacing: 1 },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: 'bold', marginTop: 4 },
  line: { color: colors.textMuted, fontSize: 15, textAlign: 'center', marginTop: 6, paddingHorizontal: 24, lineHeight: 21 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginTop: 14 },
  arrow: { color: colors.accentCyan, fontSize: 34, fontWeight: 'bold', paddingHorizontal: 8 },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
  dots: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.cardBorder || '#333' },
  dotOn: { width: 22, backgroundColor: colors.accentCyan },
});
