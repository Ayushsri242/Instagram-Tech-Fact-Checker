import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  NativeModules,
  AppState,
  useWindowDimensions,
  Linking,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { colors } from '../theme/colors';
import { saveGroqApiKey, getGroqApiKey } from '../services/secrets';
import { isGroqKey } from '../services/api';

const { TechFactChecker } = NativeModules;
export const PERMISSIONS_DONE_KEY = '@tfc_permissions_done';

export default function WelcomeScreen({ navigation, route }) {
  const fromSettings = route?.params?.fromSettings;
  const { width } = useWindowDimensions();
  const [currentSlide, setCurrentSlide] = useState(0);
  const scrollRef = useRef(null);

  const [hasOverlay, setHasOverlay] = useState(false);
  const [hasGroqKey, setHasGroqKey] = useState(false);
  
  const refreshPermissions = useCallback(async () => {
    try {
      const s = await TechFactChecker.getPermissionState();
      setHasOverlay(!!s.overlay);
    } catch (e) {
      console.log('Error reading permission state:', e);
    }
  }, []);

  const checkGroqKey = useCallback(async () => {
    try {
      const key = await getGroqApiKey();
      setHasGroqKey(!!key);
    } catch (e) {
      console.log('Error reading groq key:', e);
    }
  }, []);

  // When returning from background (like from browser or settings), check clipboard and permissions
  useEffect(() => {
    refreshPermissions();
    checkGroqKey();

    const sub = AppState.addEventListener('change', async (next) => {
      if (next === 'active') {
        refreshPermissions();
        
        // Clipboard sniffer
        try {
          const hasKey = await getGroqApiKey();
          if (!hasKey) {
            const clipboardContent = await Clipboard.getStringAsync();
            if (clipboardContent && isGroqKey(clipboardContent.trim())) {
              await saveGroqApiKey(clipboardContent.trim());
              await Clipboard.setStringAsync('');
              setHasGroqKey(true);
              // alert is simple, maybe use a nicer UI later, but fine for now
              alert('Groq API Key automatically securely saved from clipboard!');
            }
          } else {
            setHasGroqKey(true);
          }
        } catch (e) {
          console.log('Clipboard sniff error:', e);
        }
      }
    });
    return () => sub.remove();
  }, [refreshPermissions, checkGroqKey]);

  const goToNextSlide = () => {
    if (currentSlide < 2) {
      const nextSlide = currentSlide + 1;
      scrollRef.current?.scrollTo({ x: nextSlide * width, animated: true });
      setCurrentSlide(nextSlide);
    }
  };

  const handleScroll = (event) => {
    const x = event.nativeEvent.contentOffset.x;
    const slide = Math.round(x / width);
    if (slide !== currentSlide) {
      setCurrentSlide(slide);
    }
  };

  const openOverlaySettings = () => {
    TechFactChecker.openOverlaySettings().catch(() => {});
  };

  const openGroqSettings = async () => {
    Linking.openURL('https://console.groq.com/keys');
  };

  const finish = async () => {
    await AsyncStorage.setItem(PERMISSIONS_DONE_KEY, 'yes').catch(() => {});
    if (fromSettings) {
      navigation.goBack();
    } else {
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    }
  };

  const canStart = hasOverlay && hasGroqKey;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={16}
      >
        {/* Slide 1: Welcome */}
        <View style={[styles.slide, { width }]}>
          <Text style={styles.title}>Welcome to Assay</Text>
          <Text style={styles.subtitle}>Don't get scammed by fake tech reels.</Text>
          <Text style={styles.desc}>
            Assay runs directly over your favorite apps to fact-check tech content in real-time.
          </Text>
          <TouchableOpacity style={styles.btn} onPress={goToNextSlide}>
            <Text style={styles.btnText}>Next</Text>
          </TouchableOpacity>
        </View>

        {/* Slide 2: How to Use */}
        <View style={[styles.slide, { width }]}>
          <Text style={styles.title}>How to Use</Text>
          <View style={styles.instructionList}>
            <Text style={styles.desc}>1. Keep the Assay Bubble enabled.</Text>
            <Text style={styles.desc}>2. Watch an Instagram Reel.</Text>
            <Text style={styles.desc}>3. Tap 'Copy Link' on the reel.</Text>
            <Text style={styles.desc}>Alternatively, manually paste the link into the app.</Text>
          </View>
          <TouchableOpacity style={styles.btn} onPress={goToNextSlide}>
            <Text style={styles.btnText}>Next</Text>
          </TouchableOpacity>
        </View>

        {/* Slide 3: Hard Gate */}
        <View style={[styles.slide, { width }]}>
          <Text style={styles.title}>Setup Requirements</Text>
          <Text style={styles.subtitle}>We need two things to get started.</Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>1. Display over other apps</Text>
            <Text style={styles.cardDesc}>Needed for the doomscroll bubble.</Text>
            <TouchableOpacity 
              style={[styles.actionBtn, hasOverlay && styles.actionBtnDone]} 
              onPress={openOverlaySettings}
              disabled={hasOverlay}
            >
              <Text style={styles.btnText}>{hasOverlay ? 'Granted ✓' : 'Grant Permission'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>2. Groq API Key</Text>
            <Text style={styles.cardDesc}>Powers the AI analysis. Get one free, then return here.</Text>
            <TouchableOpacity 
              style={[styles.actionBtn, hasGroqKey && styles.actionBtnDone]} 
              onPress={openGroqSettings}
              disabled={hasGroqKey}
            >
              <Text style={styles.btnText}>{hasGroqKey ? 'Connected ✓' : 'Get Free AI Key'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.startBtn, !canStart && styles.startBtnDisabled]}
            onPress={finish}
            disabled={!canStart}
          >
            <Text style={styles.btnText}>Start App</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Pagination Dots */}
      <View style={styles.pagination}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.dot, currentSlide === i && styles.dotActive]} />
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  slide: { flex: 1, padding: 30, justifyContent: 'center' },
  title: { color: colors.textPrimary, fontSize: 32, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' },
  subtitle: { color: colors.textSecondary, fontSize: 18, marginBottom: 30, textAlign: 'center' },
  desc: { color: colors.textPrimary, fontSize: 16, lineHeight: 24, marginBottom: 16, textAlign: 'center' },
  instructionList: { marginBottom: 30 },
  btn: { backgroundColor: colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  btnText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  card: { backgroundColor: colors.surface, padding: 20, borderRadius: 12, marginBottom: 16 },
  cardTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: 'bold', marginBottom: 6 },
  cardDesc: { color: colors.textSecondary, fontSize: 14, marginBottom: 16 },
  actionBtn: { backgroundColor: colors.accentCyan, padding: 12, borderRadius: 8, alignItems: 'center' },
  actionBtnDone: { backgroundColor: colors.success || '#22c55e' },
  startBtn: { backgroundColor: colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  startBtnDisabled: { backgroundColor: colors.surfaceLight || '#333', opacity: 0.5 },
  pagination: { flexDirection: 'row', justifyContent: 'center', position: 'absolute', bottom: 40, width: '100%' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.cardBorder, marginHorizontal: 6 },
  dotActive: { backgroundColor: colors.primary },
});
