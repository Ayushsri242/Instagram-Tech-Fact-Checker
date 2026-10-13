import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';
import { colors } from '../theme/colors';

// First-run tour of Home (Oct 12: the old one was a static box and read as dull).
//   A. Spotlight: the screen dims, a pulsing ring circles one control at a time,
//      a card slides up with one line and a step counter.
//   B. "Watch a sample check": a scripted demo - a link types itself in, the
//      progress strip fills, a verdict card pops in. Saved example, no tokens.
//   D. Confetti and "You're ready!" at the end; Settings can replay it.
// Built-in Animated only, so it needs no native rebuild.

const DEMO_LINK = 'instagram.com/reel/DeMN1JhBEIU';
const DEMO_STAGES = ['Reading the reel', 'Understanding the claims', 'Searching the web', 'Writing the verdict'];
const CONFETTI_COLORS = ['#00E5FF', '#22c55e', '#eab308', '#f97316', '#ec4899', '#a855f7'];

const Spotlight = ({ layout, step, total, title, text, onNext, onSkip }) => {
  const { height: screenH } = useWindowDimensions();
  const pulse = useRef(new Animated.Value(0)).current;
  const card = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    card.setValue(0);
    Animated.spring(card, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [layout]);

  const pad = 8;
  const ring = { top: layout.y - pad, left: layout.x - pad, width: layout.width + pad * 2, height: layout.height + pad * 2 };
  const below = layout.y + layout.height + 24 < screenH * 0.6;
  const dim = 'rgba(0,0,0,0.78)';

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ring.top, backgroundColor: dim }} />
      <View style={{ position: 'absolute', top: ring.top + ring.height, left: 0, right: 0, bottom: 0, backgroundColor: dim }} />
      <View style={{ position: 'absolute', top: ring.top, left: 0, width: ring.left, height: ring.height, backgroundColor: dim }} />
      <View style={{ position: 'absolute', top: ring.top, left: ring.left + ring.width, right: 0, height: ring.height, backgroundColor: dim }} />
      {/* Solid ring plus an expanding, fading echo of it. */}
      <View style={[styles.ring, ring]} />
      <Animated.View
        pointerEvents="none"
        style={[styles.ring, ring, {
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }) }],
        }]}
      />
      <Animated.View style={[styles.card, below ? { top: ring.top + ring.height + 18 } : { bottom: screenH - ring.top + 18 }, {
        opacity: card,
        transform: [{ translateY: card.interpolate({ inputRange: [0, 1], outputRange: [below ? 30 : -30, 0] }) }],
      }]}>
        <Text style={styles.stepText}>{step} / {total}</Text>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardBody}>{text}</Text>
        <View style={styles.row}>
          <TouchableOpacity onPress={onSkip}><Text style={styles.skip}>Skip</Text></TouchableOpacity>
          <View style={styles.dots}>
            {Array.from({ length: total }).map((_, i) => (
              <View key={i} style={[styles.dot, i === step - 1 && styles.dotOn]} />
            ))}
          </View>
          <TouchableOpacity style={styles.nextBtn} onPress={onNext}>
            <Text style={styles.nextText}>{step === total ? 'Show me' : 'Next'}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
};

const Confetti = () => {
  const { width, height } = useWindowDimensions();
  const pieces = useRef(Array.from({ length: 28 }).map((_, i) => ({
    x: Math.random() * width,
    drift: (Math.random() - 0.5) * 120,
    delay: Math.random() * 300,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    size: 6 + Math.random() * 6,
    fall: new Animated.Value(0),
  }))).current;
  useEffect(() => {
    Animated.parallel(pieces.map((p) => Animated.timing(p.fall, {
      toValue: 1, duration: 1800, delay: p.delay, easing: Easing.out(Easing.quad), useNativeDriver: true,
    }))).start();
  }, []);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((p, i) => (
        <Animated.View key={i} style={{
          position: 'absolute', left: p.x, top: -20, width: p.size, height: p.size * 1.6, backgroundColor: p.color, borderRadius: 2,
          opacity: p.fall.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
          transform: [
            { translateY: p.fall.interpolate({ inputRange: [0, 1], outputRange: [0, height * 0.7] }) },
            { translateX: p.fall.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] }) },
            { rotate: p.fall.interpolate({ inputRange: [0, 1], outputRange: ['0deg', (360 + i * 40) + 'deg'] }) },
          ],
        }} />
      ))}
    </View>
  );
};

const Demo = ({ onDone }) => {
  const [typed, setTyped] = useState('');
  const [stage, setStage] = useState(-1);
  const [showVerdict, setShowVerdict] = useState(false);
  const fill = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    let i = 0;
    const typer = setInterval(() => {
      i += 1;
      setTyped(DEMO_LINK.slice(0, i));
      if (i >= DEMO_LINK.length) {
        clearInterval(typer);
        setStage(0);
        Animated.timing(fill, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.quad), useNativeDriver: false }).start(() => {
          setShowVerdict(true);
          Animated.spring(pop, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }).start();
        });
      }
    }, 35);
    return () => clearInterval(typer);
  }, []);

  useEffect(() => {
    const id = fill.addListener(({ value }) => setStage(Math.min(DEMO_STAGES.length - 1, Math.floor(value * DEMO_STAGES.length))));
    return () => fill.removeListener(id);
  }, []);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.demoWrap, { opacity: fadeIn }]}>
      {showVerdict && <Confetti />}
      <Text style={styles.demoHeading}>Watch a sample check</Text>
      <View style={styles.demoInput}>
        <Text style={styles.demoLink} numberOfLines={1}>{typed}<Text style={{ color: colors.accentCyan }}>|</Text></Text>
      </View>
      {stage >= 0 && (
        <View style={styles.demoStrip}>
          <Text style={styles.demoStage}>{DEMO_STAGES[stage]}...</Text>
          <View style={styles.demoTrack}>
            <Animated.View style={[styles.demoFill, { width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
          </View>
        </View>
      )}
      {showVerdict && (
        <Animated.View style={[styles.verdict, { opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
          <Text style={styles.verdictBadge}>MISLEADING</Text>
          <Text style={styles.verdictTitle}>"Free Claude Code Pro for a year"</Text>
          <Text style={styles.verdictBody}>Real programme, but only for eligible startups - not for anyone who comments.</Text>
        </Animated.View>
      )}
      {showVerdict && (
        <View style={{ alignItems: 'center', marginTop: 26 }}>
          <Text style={styles.ready}>You're ready!</Text>
          <Text style={styles.readySub}>Paste a link below, or start the bubble and check reels while you scroll.</Text>
          <TouchableOpacity style={[styles.nextBtn, { marginTop: 16, paddingHorizontal: 32 }]} onPress={onDone}>
            <Text style={styles.nextText}>Let's go</Text>
          </TouchableOpacity>
        </View>
      )}
    </Animated.View>
  );
};

// steps: [{ ref, title, text }]; containerRef: the view the refs are measured in.
export default function HomeTour({ steps, containerRef, onDone }) {
  const [index, setIndex] = useState(0);
  const [layout, setLayout] = useState(null);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    if (demo) return;
    const target = steps[index] && steps[index].ref && steps[index].ref.current;
    if (!target || !containerRef.current) { setIndex((i) => (i < steps.length - 1 ? i + 1 : i)); return; }
    setLayout(null);
    const t = setTimeout(() => {
      target.measureLayout(containerRef.current, (x, y, width, height) => setLayout({ x, y, width, height }), () => {});
    }, 120);
    return () => clearTimeout(t);
  }, [index, demo]);

  if (demo) return <Demo onDone={onDone} />;
  if (!layout) return null;
  const s = steps[index];
  return (
    <Spotlight
      layout={layout}
      step={index + 1}
      total={steps.length}
      title={s.title}
      text={s.text}
      onSkip={onDone}
      onNext={() => (index < steps.length - 1 ? setIndex(index + 1) : setDemo(true))}
    />
  );
}

const styles = StyleSheet.create({
  ring: { position: 'absolute', borderWidth: 2.5, borderColor: colors.accentCyan, borderRadius: 14 },
  card: {
    position: 'absolute', left: 20, right: 20, backgroundColor: colors.surface, borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: colors.accentCyan,
  },
  stepText: { color: colors.accentCyan, fontSize: 12, fontWeight: 'bold', marginBottom: 6 },
  cardTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: 'bold' },
  cardBody: { color: colors.textMuted, fontSize: 14, marginTop: 6, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  skip: { color: colors.textMuted, fontSize: 14, padding: 6 },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.cardBorder || '#333' },
  dotOn: { backgroundColor: colors.accentCyan, width: 18 },
  nextBtn: { backgroundColor: colors.accentCyan, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  nextText: { color: '#000', fontWeight: 'bold', fontSize: 15 },
  demoWrap: { zIndex: 1000, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', padding: 24 },
  demoHeading: { color: colors.accentCyan, fontSize: 13, fontWeight: 'bold', textAlign: 'center', marginBottom: 14, letterSpacing: 1 },
  demoInput: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.cardBorder || '#333' },
  demoLink: { color: colors.textPrimary, fontSize: 15 },
  demoStrip: { marginTop: 18 },
  demoStage: { color: colors.textMuted, fontSize: 13, marginBottom: 6 },
  demoTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surface, overflow: 'hidden' },
  demoFill: { height: 6, backgroundColor: colors.accentCyan },
  verdict: { marginTop: 22, backgroundColor: colors.surface, borderRadius: 16, padding: 18, borderWidth: 1.5, borderColor: '#f97316' },
  verdictBadge: { alignSelf: 'flex-start', color: '#000', backgroundColor: '#f97316', fontWeight: 'bold', fontSize: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, overflow: 'hidden' },
  verdictTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: 'bold', marginTop: 10 },
  verdictBody: { color: colors.textMuted, fontSize: 14, marginTop: 6, lineHeight: 20 },
  ready: { color: colors.textPrimary, fontSize: 24, fontWeight: 'bold' },
  readySub: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginTop: 6, lineHeight: 20 },
});
