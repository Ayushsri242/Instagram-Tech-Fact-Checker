import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Linking,
  Share,
} from 'react-native';
import { colors } from '../theme/colors';
import { getReelById } from '../services/storage';

export default function ResultScreen({ route, navigation }) {
  const [reel, setReel] = useState(route?.params?.reel || null);

  useEffect(() => {
    let isMounted = true;
    const fetchReel = async () => {
      if (!reel && route?.params?.reelId) {
        try {
          const data = await getReelById(route.params.reelId);
          if (data && isMounted) {
            setReel(data);
          }
        } catch (err) {
          console.error("Error fetching reel:", err);
        }
      }
    };
    fetchReel();
    return () => { isMounted = false; };
  }, [route?.params?.reelId, reel]);

  if (!reel) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.scrollContent}>
          <Text style={styles.techTitle}>Loading Fact Check...</Text>
        </View>
      </SafeAreaView>
    );
  }

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

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Fact Check: ${reel.techName || reel.title}\nVerdict: ${reel.verdict || 'UNKNOWN'}\n\nConfidence: ${reel.confidenceScore || 'N/A'}%\n\nSummary: ${reel.summaryMarkdown || reel.factualReality}`,
      });
    } catch (error) {
      console.error('Error sharing', error);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header Card */}
        <View style={styles.card}>
          <Text style={styles.techTitle}>{reel.techName || reel.title}</Text>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, { borderColor: badgeColor, backgroundColor: badgeColor + '20' }]}>
              <Text style={[styles.badgeText, { color: badgeColor }]}>
                VERDICT: {reel.verdict || 'UNKNOWN'}
              </Text>
            </View>
            {!!reel.confidenceScore && (
              <View style={[styles.badge, { borderColor: colors.accentBlue, backgroundColor: colors.accentBlue + '20', marginLeft: 10 }]}>
                <Text style={[styles.badgeText, { color: colors.accentBlue }]}>
                  🎯 {reel.confidenceScore}% Sure
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.authorText}>👤 @{reel.author || 'Creator'} • 💰 {reel.pricingModel || 'Open Source'}</Text>
        </View>

        {/* Action Row */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.surfaceLight, borderWidth: 1, borderColor: colors.cardBorder }]}
            onPress={handleShare}
          >
            <Text style={[styles.actionButtonText, { color: colors.textPrimary }]}>📤 Share</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.accentCyan }]}
            onPress={() => navigation.navigate('Chat', { reel })}
          >
            <Text style={[styles.actionButtonText, { color: '#000' }]}>Ask AI</Text>
          </TouchableOpacity>
        </View>

        {/* Summary Card */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>📊 Analysis Summary</Text>
          <Text style={styles.summaryText}>{reel.summaryMarkdown || reel.factualReality}</Text>
        </View>

        {/* Claims Breakdown */}
        {Array.isArray(reel.claims) && reel.claims.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>🔍 Claims Breakdown</Text>
            {reel.claims.map((c, idx) => (
              <View key={idx} style={styles.claimItem}>
                <Text style={styles.claimText}>
                  {c.isTrue ? '🟩' : '🚩'} <Text style={styles.claimBold}>{c.claim}</Text>
                </Text>
                <Text style={styles.claimReason}>{c.reasoning}</Text>
              </View>
            ))}
          </View>
        ) : null}
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
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
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
  claimItem: {
    backgroundColor: colors.surfaceLight,
    padding: 12,
    borderRadius: 10,
    marginTop: 8,
  },
  claimText: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  claimBold: {
    fontWeight: 'bold',
  },
  claimReason: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    marginLeft: 24,
  },
});
