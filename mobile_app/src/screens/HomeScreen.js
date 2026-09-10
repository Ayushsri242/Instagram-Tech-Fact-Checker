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
import { getApiLimits, getOfflineMode } from '../services/storage';

export default function HomeScreen({ navigation }) {
  const [url, setUrl] = useState('');
  const [limits, setLimits] = useState(null);
  const [isOffline, setIsOffline] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const fetchLimits = async () => {
        const offline = await getOfflineMode();
        setIsOffline(offline);
        if (!offline) {
          const l = await getApiLimits();
          setLimits(l);
        } else {
          setLimits(null);
        }
      };
      fetchLimits();
    }, [])
  );

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
            {isOffline ? (
              <Text style={styles.limitText}>OFFLINE MODE</Text>
            ) : limits ? (
              <Text style={styles.limitText}>
                API: {limits.remainingRequests} reqs left
              </Text>
            ) : null}
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.iconButton}>
            <Text style={styles.iconText}>Setup</Text>
          </TouchableOpacity>
        </View>

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
