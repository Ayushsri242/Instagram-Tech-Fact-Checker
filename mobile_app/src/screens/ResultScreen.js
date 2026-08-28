import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Linking,
} from 'react-native';
import { colors } from '../theme/colors';

export default function ResultScreen({ route, navigation }) {
  const { reel } = route.params;
  const [showTranscript, setShowTranscript] = useState(false);

  const getBadgeColor = (verdict) => {
    switch (verdict?.toUpperCase()) {
      case 'TRUE':
        return colors.verdictTrue;
      case 'PARTIALLY_TRUE':
        return colors.verdictPartial;
      case 'HYPE':
        return colors.verdictHype;
      case 'MISLEADING':
        return colors.verdictMisleading;
      case 'FAKE':
        return colors.verdictFake;
      default:
        return colors.verdictUnknown;
    }
  };

  const badgeColor = getBadgeColor(reel?.verdict);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header Card */}
        <View style={styles.card}>
          <Text style={styles.techTitle}>{reel.techName || reel.title}</Text>
          <View style={[styles.badge, { borderColor: badgeColor, backgroundColor: badgeColor + '20' }]}>
            <Text style={[styles.badgeText, { color: badgeColor }]}>
              VERDICT: {reel.verdict || 'UNKNOWN'}
            </Text>
          </View>
          <Text style={styles.authorText}>👤 @{reel.author || 'Creator'} • 💰 {reel.pricingModel || 'Open Source'}</Text>
        </View>

        {/* Action Row */}
        <View style={styles.actionRow}>
          {reel.githubUrl && (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.accentBlue }]}
              onPress={() => Linking.openURL(reel.githubUrl)}
            >
              <Text style={styles.actionButtonText}>GitHub Repo</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.accentCyan }]}
            onPress={() => navigation.navigate('Chat', { reelId: reel.reelId, techName: reel.techName })}
          >
            <Text style={[styles.actionButtonText, { color: '#000' }]}>Ask AI</Text>
          </TouchableOpacity>
        </View>

        {/* Summary Card */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>📊 Analysis Summary</Text>
          <Text style={styles.summaryText}>{reel.summaryMarkdown || reel.factualReality}</Text>
        </View>

        {/* Verified Tools Breakdown */}
        {reel.tools && reel.tools.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>💡 Verified Tools ({reel.tools.length})</Text>
            {reel.tools.map((tool, idx) => (
              <View key={idx} style={styles.toolItem}>
                <Text style={styles.toolName}>📦 {tool.name}</Text>
                {tool.pipCommand && <Text style={styles.pipCode}>{tool.pipCommand}</Text>}
                {tool.githubRepo && (
                  <TouchableOpacity onPress={() => Linking.openURL(`https://github.com/${tool.githubRepo}`)}>
                    <Text style={styles.repoLink}>https://github.com/{tool.githubRepo}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Collapsible Transcript */}
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.transcriptHeader}
            onPress={() => setShowTranscript(!showTranscript)}
          >
            <Text style={styles.sectionTitle}>🎙️ Speech / Caption</Text>
            <Text style={styles.toggleText}>{showTranscript ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
          {showTranscript && (
            <Text style={styles.transcriptText}>{reel.rawTranscript || 'No transcript available.'}</Text>
          )}
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderColor: colors.cardBorder,
    borderWidth: 1,
  },
  techTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 8,
  },
  badgeText: {
    fontWeight: 'bold',
    fontSize: 13,
  },
  authorText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  summaryText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  toolItem: {
    backgroundColor: colors.surfaceLight,
    padding: 12,
    borderRadius: 10,
    marginTop: 8,
  },
  toolName: {
    color: colors.textPrimary,
    fontWeight: 'bold',
    fontSize: 14,
  },
  pipCode: {
    color: colors.accentCyan,
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 4,
  },
  repoLink: {
    color: colors.accentBlue,
    fontSize: 12,
    marginTop: 4,
    textDecorationLine: 'underline',
  },
  transcriptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleText: {
    color: colors.accentCyan,
    fontSize: 13,
  },
  transcriptText: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: 'monospace',
    marginTop: 8,
  },
});
