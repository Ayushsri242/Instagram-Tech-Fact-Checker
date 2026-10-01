import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  NativeModules,
  PermissionsAndroid,
  Platform,
  AppState,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme/colors';
import { trace } from '../services/trace';

const { TechFactChecker } = NativeModules;

export const PERMISSIONS_DONE_KEY = '@tfc_permissions_done';
// The auto-start setting lives in vendor screens with no API to read it back,
// so the only record of it is the user saying they turned it on.
const AUTOSTART_CONFIRMED_KEY = '@tfc_autostart_confirmed';

// Explain, then ask - one row at a time, never a wall of popups.
//
// The app does its work while the user is in another app: they paste a link
// and leave, or tap the doomscroll bubble over Instagram. That only works with
// permissions Android denies by default, and on the OnePlus test phone the
// missing one was decisive - the OEM froze the app (`OplusHansManager: freeze
// uid`), the bubble sat orange, and nothing ran until the app was reopened.
// Users do not find these settings on their own, which is why every app that
// works in the background shows a screen like this one.
export default function PermissionsScreen({ navigation, route }) {
  const fromSettings = route?.params?.fromSettings;
  const [state, setState] = useState(null);
  const [autostartDone, setAutostartDone] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await TechFactChecker.getPermissionState();
      setState(s);
      trace('permissions: battery=' + s.batteryUnrestricted + ' overlay=' + s.overlay +
        ' notifications=' + s.notifications + ' maker=' + s.manufacturer + ' autostartScreen=' + s.hasAutostartScreen);
    } catch (e) {
      trace('permissions: could not read state - ' + (e && e.message));
    }
    try {
      setAutostartDone((await AsyncStorage.getItem(AUTOSTART_CONFIRMED_KEY)) === 'yes');
    } catch (e) {
      // treat as not done
    }
  }, []);

  // Every permission is granted on a system screen, so re-read when the user
  // comes back from one rather than trusting a stale snapshot.
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const askNotifications = async () => {
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      trace('permissions: notification prompt -> ' + result);
      // After two denials Android stops showing the prompt at all.
      if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN || result === PermissionsAndroid.RESULTS.DENIED) {
        await TechFactChecker.openNotificationSettings().catch(() => {});
      }
    } else {
      await TechFactChecker.openNotificationSettings().catch(() => {});
    }
    refresh();
  };

  const openAutostart = async () => {
    const via = await TechFactChecker.openAutostartSettings().catch(() => null);
    trace('permissions: autostart screen opened via ' + via);
    // There is no way to read the vendor toggle back. Opening the screen is the
    // best signal available; the user can always come back here.
    await AsyncStorage.setItem(AUTOSTART_CONFIRMED_KEY, 'yes').catch(() => {});
    setAutostartDone(true);
  };

  const finish = async () => {
    await AsyncStorage.setItem(PERMISSIONS_DONE_KEY, 'yes').catch(() => {});
    trace('permissions: setup finished');
    if (fromSettings) navigation.goBack();
    else navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  const maker = String((state && state.manufacturer) || '').toLowerCase();
  const rows = state ? [
    {
      key: 'notifications',
      title: 'Notifications',
      why: 'Tells you when a verdict is ready after you leave the app.',
      done: state.notifications,
      action: askNotifications,
    },
    {
      key: 'battery',
      title: 'Run in background',
      why: 'Lets the fact check keep going while you are in Instagram. Without it Android can pause the app mid-check.',
      done: state.batteryUnrestricted,
      action: () => TechFactChecker.requestBatteryUnrestricted().catch(() => {}),
    },
    {
      key: 'overlay',
      title: 'Display over other apps',
      why: 'Needed only for the doomscroll bubble that floats over Instagram.',
      done: state.overlay,
      action: () => TechFactChecker.openOverlaySettings().catch(() => {}),
      optional: true,
    },
    ...(state.hasAutostartScreen ? [{
      key: 'autostart',
      title: 'Auto-start',
      why: (maker ? maker.charAt(0).toUpperCase() + maker.slice(1) : 'Your phone') +
        ' has its own app freezer on top of Android. Turn Tech Fact Checker ON in the screen that opens.',
      done: autostartDone,
      action: openAutostart,
    }] : []),
  ] : [];

  const required = rows.filter((r) => !r.optional);
  const allRequiredDone = required.length > 0 && required.every((r) => r.done);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Let it work in the background</Text>
        <Text style={styles.subtitle}>
          Paste a link, go back to scrolling - the verdict arrives as a notification.
          These permissions make that possible.
        </Text>

        {!state && <Text style={styles.subtitle}>Checking...</Text>}

        {rows.map((r) => (
          <View key={r.key} style={[styles.row, r.done && styles.rowDone]}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={styles.rowTitle}>
                {r.done ? 'Done: ' : ''}{r.title}{r.optional ? '  (optional)' : ''}
              </Text>
              <Text style={styles.rowWhy}>{r.why}</Text>
            </View>
            {!r.done && (
              <TouchableOpacity style={styles.allowBtn} onPress={r.action}>
                <Text style={styles.allowText}>Allow</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}

        <TouchableOpacity
          style={[styles.continueBtn, !allRequiredDone && styles.continueMuted]}
          onPress={finish}
        >
          <Text style={[styles.continueText, allRequiredDone && { color: '#000' }]}>
            {allRequiredDone ? 'Continue' : 'Skip for now'}
          </Text>
        </TouchableOpacity>
        {!allRequiredDone && !!state && (
          <Text style={styles.footnote}>
            You can come back to this from Settings. Without these, results only arrive while the app is open.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 48 },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: 'bold', marginTop: 12 },
  subtitle: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 14,
    marginBottom: 10,
  },
  rowDone: { borderColor: colors.success || '#22c55e', opacity: 0.75 },
  rowTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  rowWhy: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: 3 },
  allowBtn: { backgroundColor: colors.accentCyan, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8 },
  allowText: { color: '#000', fontWeight: 'bold' },
  continueBtn: {
    marginTop: 18,
    backgroundColor: colors.accentCyan,
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  continueMuted: { backgroundColor: colors.surfaceLight || colors.surface, borderWidth: 1, borderColor: colors.cardBorder },
  continueText: { color: colors.textPrimary, fontWeight: 'bold', fontSize: 16 },
  footnote: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 10 },
});
