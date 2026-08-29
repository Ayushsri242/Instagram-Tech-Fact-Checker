import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { colors } from '../theme/colors';
import { analyzeReelApi } from '../services/api';
import { saveReelResult } from '../services/storage';

export default function HomeScreen({ navigation }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');

  const sampleReels = [
    { label: '5 LLM Libs', url: 'https://www.instagram.com/p/DcOJpsKDEht/' },
    { label: 'Hindi Reel', url: 'https://www.instagram.com/reel/DcXzQH5si-A/' },
    { label: '/eli5 Prompt', url: 'https://www.instagram.com/reel/DcYcqi5TePT/' },
  ];

  const handleAnalyze = async (targetUrl = url) => {
    if (!targetUrl.trim()) return;
    setLoading(true);
    setStatusText('🔍 Ingesting media & analyzing claims...');

    try {
      const result = await analyzeReelApi(targetUrl.trim());
      await saveReelResult(result);
      setLoading(false);
      navigation.navigate('Result', { reel: result });
    } catch (e) {
      setLoading(false);
      alert(`Analysis failed: ${e.message}`);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={[styles.header, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
          <View>
            <Text style={styles.title}>Tech Fact Checker</Text>
            <Text style={styles.subtitle}>100% Free • Local-First Micro-Agent</Text>
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={{ padding: 8, backgroundColor: colors.surface, borderRadius: 8 }}>
            <Text style={{ color: colors.primary, fontWeight: 'bold' }}>Setup</Text>
          </TouchableOpacity>
        </View>

        {/* Input Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Paste Instagram Reel / Carousel Link</Text>
          <TextInput
            style={styles.input}
            placeholder="https://www.instagram.com/reel/..."
            placeholderTextColor={colors.textMuted}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
          />

          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.disabledButton]}
            onPress={() => handleAnalyze()}
            disabled={loading || !url.trim()}
          >
            {loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.primaryButtonText}>Run Fact Check</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Loading status */}
        {loading && (
          <View style={styles.statusCard}>
            <Text style={styles.statusTitle}>⚙️ Processing Pipeline</Text>
            <Text style={styles.statusDesc}>{statusText}</Text>
          </View>
        )}

        {/* Quick Samples */}
        <Text style={styles.sectionHeader}>💡 Quick Sample Reels</Text>
        <View style={styles.samplesRow}>
          {sampleReels.map((item, idx) => (
            <TouchableOpacity
              key={idx}
              style={styles.sampleChip}
              onPress={() => {
                setUrl(item.url);
                handleAnalyze(item.url);
              }}
            >
              <Text style={styles.sampleChipText}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Feature info */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>📱 Instagram Share Sheet</Text>
          <Text style={styles.infoText}>
            1. Tap Share on any Reel inside Instagram{'\n'}
            2. Select "Tech Fact Checker"{'\n'}
            3. Instant multimodal fact-check & code extraction
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  header: {
    marginVertical: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: colors.accentCyan,
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderColor: colors.cardBorder,
    borderWidth: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 12,
  },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    color: colors.textPrimary,
    fontSize: 14,
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: colors.accentCyan,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 15,
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderColor: colors.accentCyan,
    borderWidth: 1,
  },
  statusTitle: {
    color: colors.accentCyan,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statusDesc: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 4,
  },
  samplesRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sampleChip: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  sampleChipText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '500',
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  infoText: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },
});
