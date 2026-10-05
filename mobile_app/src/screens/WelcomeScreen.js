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
  PermissionsAndroid
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
  const initialSlide = route?.params?.initialSlide || 0;
  const { width } = useWindowDimensions();
  const [currentSlide, setCurrentSlide] = useState(initialSlide);
  const scrollRef = useRef(null);

  const [hasGroqKey, setHasGroqKey] = useState(false);
  const [permState, setPermState] = useState({
    overlay: false,
    notifications: false,
    batteryUnrestricted: false,
    hasAutostartScreen: false
  });
  
  const refreshPermissions = useCallback(async () => {
    try {
      const s = await TechFactChecker.getPermissionState();
      setPermState(s || {
        overlay: false,
        notifications: false,
        batteryUnrestricted: false,
        hasAutostartScreen: false
      });
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

  useEffect(() => {
    refreshPermissions();
    checkGroqKey();

    const sub = AppState.addEventListener('change', async (next) => {
      if (next === 'active') {
        refreshPermissions();
        
        try {
          const hasKey = await getGroqApiKey();
          if (!hasKey) {
            const clipboardContent = await Clipboard.getStringAsync();
            if (clipboardContent && isGroqKey(clipboardContent.trim())) {
              await saveGroqApiKey(clipboardContent.trim());
              await Clipboard.setStringAsync('');
              setHasGroqKey(true);
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

  const askNotifications = async () => {
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN || result === PermissionsAndroid.RESULTS.DENIED) {
        await TechFactChecker.openNotificationSettings().catch(() => {});
      }
    } else {
      await TechFactChecker.openNotificationSettings().catch(() => {});
    }
    refreshPermissions();
  };

  const askBattery = () => {
    TechFactChecker.requestBatteryUnrestricted().catch(() => {});
  };

  const askAutostart = () => {
    TechFactChecker.openAutostartSettings().catch(() => {});
  };

  const finish = async () => {
    await AsyncStorage.setItem(PERMISSIONS_DONE_KEY, 'yes').catch(() => {});
    if (fromSettings) {
      navigation.goBack();
    } else {
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    }
  };

  const canStart = permState.overlay && hasGroqKey;

  useEffect(() => {
    if (currentSlide < 2) {
      navigation.setOptions({
        headerRight: () => (
          <TouchableOpacity
            style={{ paddingHorizontal: 10 }}
            onPress={() => {
              scrollRef.current?.scrollTo({ x: 2 * width, animated: true });
              setCurrentSlide(2);
            }}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 16, fontWeight: 'bold' }}>
              (Skip)
            </Text>
          </TouchableOpacity>
        ),
      });
    } else {
      navigation.setOptions({ headerRight: () => null });
    }
  }, [navigation, currentSlide, width]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={16}
        contentOffset={{ x: initialSlide * width, y: 0 }}
      >
        {/* Slide 1: Welcome */}
        <View style={[styles.slide, { width }]}>
          <Text style={styles.title}>Welcome to Assay</Text>
          <Text style={styles.subtitle}>Don't get scammed by fake tech reels.</Text>
          <Text style={styles.desc}>
            Assay helps you fact-check Instagram tech reels in real-time using AI.
          </Text>
          <TouchableOpacity style={styles.btn} onPress={goToNextSlide}>
            <Text style={styles.btnText}>Next</Text>
          </TouchableOpacity>
        </View>

        {/* Slide 2: How to Use */}
        <View style={[styles.slide, { width }]}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, justifyContent: 'center', flexGrow: 1 }}>
            <Text style={styles.title}>How to Use</Text>
            
            <View style={styles.instructionBlock}>
              <Text style={styles.instructionTitle}>1. The Doomscroll Bubble</Text>
              <Text style={styles.desc}>Tap 'Start Doomscroll Mode' on Home to spawn the bubble. Open Instagram, copy a tech reel's link, then tap the bubble. It turns orange, then blue when the link is received by the app.</Text>
            </View>

            <View style={styles.instructionBlock}>
              <Text style={styles.instructionTitle}>2. Manual Check</Text>
              <Text style={styles.desc}>Alternatively, copy an Instagram link, open Assay, paste it, and tap 'Check'. Wait for the analysis to finish.</Text>
            </View>

            <View style={styles.instructionBlock}>
              <Text style={styles.instructionTitle}>Notifications & Verdicts</Text>
              <Text style={styles.desc}>If notifications are enabled, you will receive updates about processing and when the verdict is ready. Click the notification or go to the History tab to view the summary.</Text>
            </View>

            <View style={styles.instructionBlock}>
              <Text style={styles.instructionTitle}>Ask AI</Text>
              <Text style={styles.desc}>Inside the fact-check report, use the 'Ask AI' button to chat with our chatbot for more information about the reel.</Text>
            </View>

            <TouchableOpacity style={styles.btn} onPress={goToNextSlide}>
              <Text style={styles.btnText}>Next</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* Slide 3: Hard Gate + Permissions */}
        <View style={[styles.slide, { width, paddingHorizontal: 0 }]}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 24, paddingBottom: 60, flexGrow: 1, justifyContent: 'center' }}>
            <Text style={styles.title}>Setup Requirements</Text>
            <Text style={styles.subtitle}>Configure these to let Assay work smoothly.</Text>

            {/* MANDATORY / HARD GATES */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>1. Groq API Key <Text style={styles.mandatoryBadge}>(Required)</Text></Text>
              <Text style={styles.cardDesc}>Powers the AI analysis. Get one free, then return here.</Text>
              <TouchableOpacity 
                style={[styles.actionBtn, hasGroqKey && styles.actionBtnDone]} 
                onPress={openGroqSettings}
                disabled={hasGroqKey}
              >
                <Text style={styles.btnText}>{hasGroqKey ? 'Connected ✓' : 'Get Free AI Key'}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>2. Display over other apps <Text style={styles.mandatoryBadge}>(Required)</Text></Text>
              <Text style={styles.cardDesc}>Required for the doomscroll bubble to appear over Instagram.</Text>
              <TouchableOpacity 
                style={[styles.actionBtn, permState.overlay && styles.actionBtnDone]} 
                onPress={openOverlaySettings}
                disabled={permState.overlay}
              >
                <Text style={styles.btnText}>{permState.overlay ? 'Granted ✓' : 'Grant Permission'}</Text>
              </TouchableOpacity>
            </View>

            {/* OPTIONAL */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>3. Notifications <Text style={styles.optionalBadge}>(Optional)</Text></Text>
              <Text style={styles.cardDesc}>Receive updates when a verdict is ready after you leave the app.</Text>
              <TouchableOpacity 
                style={[styles.actionBtn, permState.notifications && styles.actionBtnDone]} 
                onPress={askNotifications}
                disabled={permState.notifications}
              >
                <Text style={styles.btnText}>{permState.notifications ? 'Granted ✓' : 'Grant Permission'}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>4. Run in background <Text style={styles.optionalBadge}>(Optional)</Text></Text>
              <Text style={styles.cardDesc}>Lets the fact-check keep going while you are in Instagram.</Text>
              <TouchableOpacity 
                style={[styles.actionBtn, permState.batteryUnrestricted && styles.actionBtnDone]} 
                onPress={askBattery}
                disabled={permState.batteryUnrestricted}
              >
                <Text style={styles.btnText}>{permState.batteryUnrestricted ? 'Granted ✓' : 'Grant Permission'}</Text>
              </TouchableOpacity>
            </View>

            {permState.hasAutostartScreen && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>5. Keep running after restart <Text style={styles.optionalBadge}>(Optional)</Text></Text>
                <Text style={styles.cardDesc}>In battery usage, enable 'allow background activity' so the app continues to process.</Text>
                <TouchableOpacity 
                  style={styles.actionBtn} 
                  onPress={askAutostart}
                >
                  <Text style={styles.btnText}>Open Settings</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>6. In-App Updates <Text style={styles.optionalBadge}>(Built-in)</Text></Text>
              <Text style={styles.cardDesc}>I will edit your AndroidManifest.xml to add REQUEST_INSTALL_PACKAGES. Without this, Android blocks apps from updating themselves.</Text>
            </View>

            <TouchableOpacity
              style={[styles.startBtn, !canStart && styles.startBtnDisabled]}
              onPress={finish}
              disabled={!canStart}
            >
              <Text style={styles.btnText}>{fromSettings ? 'Save & Close' : 'Start App'}</Text>
            </TouchableOpacity>
          </ScrollView>
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
  skipBtn: { position: 'absolute', top: Platform.OS === 'android' ? 10 : 20, right: 16, zIndex: 10, padding: 8 },
  skipText: { color: colors.textSecondary, fontSize: 16, fontWeight: 'bold' },
  slide: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { color: colors.textPrimary, fontSize: 32, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' },
  subtitle: { color: colors.textSecondary, fontSize: 16, marginBottom: 24, textAlign: 'center' },
  desc: { color: colors.textPrimary, fontSize: 15, lineHeight: 22 },
  instructionBlock: { marginBottom: 20, backgroundColor: colors.surface, padding: 16, borderRadius: 12 },
  instructionTitle: { color: colors.accentCyan, fontSize: 18, fontWeight: 'bold', marginBottom: 6 },
  btn: { backgroundColor: colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  btnText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  card: { backgroundColor: colors.surface, padding: 16, borderRadius: 12, marginBottom: 12 },
  cardTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  mandatoryBadge: { color: colors.error || '#f87171', fontSize: 12, fontWeight: 'normal' },
  optionalBadge: { color: colors.textMuted, fontSize: 12, fontWeight: 'normal' },
  cardDesc: { color: colors.textSecondary, fontSize: 13, marginBottom: 12 },
  actionBtn: { backgroundColor: colors.accentCyan, padding: 12, borderRadius: 8, alignItems: 'center' },
  actionBtnDone: { backgroundColor: colors.success || '#22c55e' },
  startBtn: { backgroundColor: colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  startBtnDisabled: { backgroundColor: colors.surfaceLight || '#333', opacity: 0.5 },
  pagination: { flexDirection: 'row', justifyContent: 'center', position: 'absolute', bottom: 20, width: '100%' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.cardBorder, marginHorizontal: 6 },
  dotActive: { backgroundColor: colors.primary },
});
