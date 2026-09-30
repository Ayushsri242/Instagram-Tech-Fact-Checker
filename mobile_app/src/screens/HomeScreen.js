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
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { getApiLimits, getOfflineMode, getLatestResult, markLatestSeen } from '../services/storage';
import { describeLimits } from '../services/api';

export default function HomeScreen({ navigation }) {
  const [url, setUrl] = useState('');
  const [limits, setLimits] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const [latest, setLatest] = useState(null);
  const [now, setNow] = useState(Date.now());

  useFocusEffect(
    useCallback(() => {
      const refresh = async () => {
        const offline = await getOfflineMode();
        setIsOffline(offline);
        setLimits(offline ? null : await getApiLimits());
        const l = await getLatestResult();
        // Only a fresh, unopened result earns the banner.
        setLatest(l && !l.seen && Date.now() - l.finishedAt < 24 * 3600000 ? l : null);
        setNow(Date.now());
      };
      refresh();
      // The per-minute token window resets within a minute; re-read while this
      // screen is showing so the header is not frozen at its last value.
      const timer = setInterval(refresh, 5000);
      return () => clearInterval(timer);
    }, [])
  );

  const openLatest = async () => {
    if (!latest) return;
    await markLatestSeen();
    setLatest(null);
    navigation.navigate('Result', { reelId: latest.reelId });
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
            <Text style={styles.iconText}>Setup</Text>
          </TouchableOpacity>
        </View>

        {/* A result that finished while the user was elsewhere. Without this, a
            user who left mid-analysis and came back after Android had killed
            the app landed here with no sign anything had happened. */}
        {!!latest && (
          <TouchableOpacity style={styles.readyBanner} onPress={openLatest}>
            <Text style={styles.readyTitle}>Verdict ready: {latest.verdict.replace('_', ' ')}</Text>
            <Text style={styles.readySub} numberOfLines={1}>{latest.techName} - tap to open</Text>
          </TouchableOpacity>
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
  readyTitle: { color: colors.accentCyan, fontSize: 15, fontWeight: 'bold' },
  readySub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
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
