import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { colors } from '../theme/colors';
import { getAllReels, deleteReelById } from '../services/storage';
import { verdictLabel, verdictColor, savedTime, dayLabel, whenText } from '../services/verdicts';

// Newest first, under "Today", "Yesterday", "Oct 11"... (Oct 13: History had no
// times at all). Checks saved before times were recorded go under "Earlier".
const groupByDay = (reels) => {
  const sections = [];
  for (const r of reels) {
    const t = savedTime(r);
    const title = t ? dayLabel(t) : 'Earlier';
    let sec = sections.find((x) => x.title === title);
    if (!sec) sections.push((sec = { title, data: [] }));
    sec.data.push(r);
  }
  const at = (sec) => savedTime(sec.data[0]) || 0;
  return sections.sort((a, b) => at(b) - at(a));
};

export default function HistoryScreen({ navigation }) {
  const [reels, setReels] = useState([]);

  const loadReels = async () => {
    const data = await getAllReels();
    setReels(data);
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadReels();
    });
    return unsubscribe;
  }, [navigation]);

  const handleDelete = async (reelId) => {
    await deleteReelById(reelId);
    loadReels();
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* The screen header already says "History"; a second title repeated it. */}
      {reels.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No saved fact-checks yet.</Text>
          <Text style={styles.emptySubtext}>Analyze or share a reel to start!</Text>
        </View>
      ) : (
        <SectionList
          sections={groupByDay(reels)}
          keyExtractor={(item) => item.reelId}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => <Text style={styles.dayHeader}>{section.title}</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => navigation.navigate('Result', { reel: item })}
            >
              <View style={[styles.verdictDot, { backgroundColor: verdictColor(item.verdict) }]} />
              <View style={styles.cardInfo}>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.techName || item.title}</Text>
                <Text style={styles.cardMeta}>
                  {verdictLabel(item.verdict)}{savedTime(item) ? '  ·  ' + whenText(savedTime(item)) : ''}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleDelete(item.reelId)}
              >
                <Text style={styles.deleteText}>🗑️</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  dayHeader: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 8,
  },
  verdictDot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  cardMeta: { color: colors.textSecondary, fontSize: 12.5, marginTop: 3 },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  emptySubtext: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderColor: colors.cardBorder,
    borderWidth: 1,
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: 'bold',
  },
  cardSubtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  cardVerdict: {
    color: colors.accentCyan,
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 4,
  },
  deleteButton: {
    padding: 8,
  },
  deleteText: {
    fontSize: 16,
  },
});
