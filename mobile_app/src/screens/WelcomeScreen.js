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
  PermissionsAndroid,
  Alert,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { colors } from '../theme/colors';
import HowItWorks from '../components/HowItWorks';
import { saveGroqApiKey, getGroqApiKey, restoreGroqKeyFromBackup } from '../services/secrets';
import { isGroqKey } from '../services/api';

const { TechFactChecker } = NativeModules;
const AUTOSTART_KEY = 'autostart_confirmed';
export const PERMISSIONS_DONE_KEY = '@tfc_permissions_done';

export default function WelcomeScreen({ navigation, route }) {
  const fromSettings = route?.params?.fromSettings;
  const initialSlide = route?.params?.initialSlide || 0;
  const { width } = useWindowDimensions();
  const [currentSlide, setCurrentSlide] = useState(initialSlide);
  const scrollRef = useRef(null);

  const [hasGroqKey, setHasGroqKey] = useState(false);
  // The maker's auto-launch switch cannot be read by any app, so after the
  // user visits that screen we ask once and remember the answer (Oct 12).
  const [autostartConfirmed, setAutostartConfirmed] = useState(false);
  const autostartVisited = useRef(false);
  useEffect(() => {
    AsyncStorage.getItem(AUTOSTART_KEY).then((v) => setAutostartConfirmed(v === 'yes')).catch(() => {});
  }, []);
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
        if (autostartVisited.current) {
          autostartVisited.current = false;
          Alert.alert(
            'Keep running after restart',
            "Did you turn on 'Allow background activity' (or 'Auto-launch') for Assay?",
            [
              { text: 'Not yet', style: 'cancel' },
              {
                text: 'Yes',
                onPress: () => {
                  AsyncStorage.setItem(AUTOSTART_KEY, 'yes').catch(() => {});
                  setAutostartConfirmed(true);
                },
              },
            ]
          );
        }
        
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

  // Android 13+ blocks this permission for apps installed from a file
  // ("App was denied access"). After the first try, show how to unlock it:
  // the App info ⋮ menu only appears once the user has hit the block (Oct 21).
  const [overlayTried, setOverlayTried] = useState(false);
  const openOverlaySettings = () => {
    setOverlayTried(true);
    TechFactChecker.openOverlaySettings().catch(() => {});
  };

  const openGroqSettings = async () => {
    Linking.openURL('https://console.groq.com/keys');
  };

  // Reinstalled: read the key back from Downloads/Assay instead of making a new one.
  const restoreKey = async () => {
    try {
      const key = await restoreGroqKeyFromBackup();
      if (key) setHasGroqKey(true);
      else alert('No key found. Pick the file "assay_groq_key.txt" in Downloads > Assay.');
    } catch (e) {
      alert('Could not read the backup: ' + e.message);
    }
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

  // Done only if the user said yes AND Android does not report the app as
  // background-restricted (that part Android can tell us).
  const autostartDone = autostartConfirmed && !permState.backgroundRestricted;

  const askAutostart = () => {
    autostartVisited.current = true;
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
        <View style={[styles.slide, { width, paddingVertical: 0 }]}>
          {/* Scrolls on small screens or large system text (Oct 14: the logo and
              the button were cut off on a friend's phone). */}
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: 24 }}>
          {/* Oct 13: the slide was three lines of text in empty space. */}
          <Image source={require('../../assets/icon.png')} style={styles.logo} />
          <Text style={styles.title}>Welcome to Assay</Text>
          <Text style={styles.subtitle}>Don't get scammed by fake tech reels.</Text>
          {[
            ['✓', 'Checks every claim in a reel or post against the web'],
            ['⚡', 'Works while you scroll - one tap on the bubble'],
            ['💬', 'Ask follow-up questions about any post'],
          ].map(([icon, text]) => (
            <View key={text} style={styles.feature}>
              <Text style={styles.featureIcon}>{icon}</Text>
              <Text style={styles.featureText}>{text}</Text>
            </View>
          ))}
          <TouchableOpacity style={styles.nextBtn} onPress={goToNextSlide}>
            <Text style={styles.nextBtnText}>Get started</Text>
          </TouchableOpacity>
          </ScrollView>
        </View>

        {/* Slide 2: How to Use */}
        <View style={[styles.slide, { width, paddingTop: 8, paddingBottom: 12, justifyContent: 'flex-start' }]}>
          {/* Animated scenes instead of paragraphs (Oct 12: nobody read the
              text). HowItWorks scrolls itself and pins its own Next button. */}
          <HowItWorks onDone={goToNextSlide} />
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
              {!hasGroqKey && (
                <TouchableOpacity onPress={restoreKey} style={styles.restoreBtn}>
                  <Text style={styles.restoreText}>Reinstalled? Restore key from backup</Text>
                  <Text style={styles.restoreHint}>Then tap the file named assay_groq_key.txt</Text>
                </TouchableOpacity>
              )}
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
              {overlayTried && !permState.overlay && (
                <View style={styles.helpBox}>
                  <Text style={styles.helpTitle}>Blocked by Android? ("App was denied access")</Text>
                  <Text style={styles.helpStep}>1. Tap Open App info below.</Text>
                  <Text style={styles.helpStep}>2. Tap ⋮ (top right) → Allow restricted settings, then confirm with your PIN.</Text>
                  <Text style={styles.helpStep}>3. Come back, tap Grant Permission again, find Assay in the list and turn it on.</Text>
                  <TouchableOpacity style={styles.helpBtn} onPress={() => Linking.openSettings().catch(() => {})}>
                    <Text style={styles.helpBtnText}>Open App info</Text>
                  </TouchableOpacity>
                </View>
              )}
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
                  style={[styles.actionBtn, autostartDone && styles.actionBtnDone]} 
                  onPress={askAutostart}
                >
                  <Text style={styles.btnText}>{autostartDone ? 'Done ✓' : 'Open Settings'}</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>6. In-App Updates <Text style={styles.optionalBadge}>(Built-in)</Text></Text>
              <Text style={styles.cardDesc}>Assay tells you when a new version is out. You can also check for updates any time in Settings and install the latest one from there.</Text>
            </View>

            <Text style={[styles.cardDesc, { marginBottom: 12 }]}>
              Assay shares anonymous check logs (reel link, verdict, errors) to improve accuracy. You can turn this off in Settings.
            </Text>

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

      {/* No page dots (Oct 13): they sat under the tutorial's own buttons, and
          the active dot used colors.primary, which does not exist - so only
          two of the three ever showed. Every slide has its own button now. */}
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
  // colors.primary does not exist, so styles.btn drew no button at all.
  nextBtn: { backgroundColor: colors.accentCyan, paddingVertical: 15, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  nextBtnText: { color: '#000', fontSize: 16, fontWeight: 'bold' },
  logo: { width: 80, height: 80, borderRadius: 22, alignSelf: 'center', marginBottom: 20 },
  feature: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8 },
  featureIcon: { color: colors.accentCyan, fontSize: 18, width: 30 },
  featureText: { color: colors.textPrimary, fontSize: 14.5, flex: 1, lineHeight: 20 },
  card: { backgroundColor: colors.surface, padding: 16, borderRadius: 12, marginBottom: 12 },
  cardTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  mandatoryBadge: { color: colors.error || '#f87171', fontSize: 12, fontWeight: 'normal' },
  optionalBadge: { color: colors.textMuted, fontSize: 12, fontWeight: 'normal' },
  cardDesc: { color: colors.textSecondary, fontSize: 13, marginBottom: 12 },
  helpBox: { marginTop: 12, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.surfaceLight },
  helpTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: 'bold', marginBottom: 8 },
  helpStep: { color: colors.textSecondary, fontSize: 13, marginBottom: 6 },
  helpBtn: { marginTop: 6, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.accentCyan, alignItems: 'center' },
  helpBtnText: { color: colors.accentCyan, fontSize: 15, fontWeight: 'bold' },
  actionBtn: { backgroundColor: colors.accentCyan, padding: 12, borderRadius: 8, alignItems: 'center' },
  restoreHint: { color: colors.textMuted, fontSize: 12, marginTop: 2, textAlign: 'center' },
  restoreBtn: { marginTop: 10, padding: 6, alignItems: 'center' },
  restoreText: { color: colors.accentCyan, fontSize: 13, textDecorationLine: 'underline' },
  actionBtnDone: { backgroundColor: colors.success || '#22c55e' },
  startBtn: { backgroundColor: colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  startBtnDisabled: { backgroundColor: colors.surfaceLight || '#333', opacity: 0.5 },
  pagination: { flexDirection: 'row', justifyContent: 'center', position: 'absolute', bottom: 20, width: '100%' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.cardBorder, marginHorizontal: 6 },
  dotActive: { backgroundColor: colors.primary },
});
