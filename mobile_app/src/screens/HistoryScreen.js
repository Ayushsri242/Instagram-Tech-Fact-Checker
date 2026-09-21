import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { colors } from '../theme/colors';
import { getAllReels, deleteReelById } from '../services/storage';

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
      <View style={styles.header}>
        <Text style={styles.title}>Saved Library</Text>
      </View>

      {reels.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No saved fact-checks yet.</Text>
          <Text style={styles.emptySubtext}>Analyze or share a reel to start!</Text>
        </View>
      ) : (
        <FlatList
          data={reels}
          keyExtractor={(item) => item.reelId}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => navigation.navigate('Result', { reel: item })}
            >
              <View style={styles.cardInfo}>
                <Text style={styles.cardTitle}>{item.techName || item.title}</Text>
                <Text style={styles.cardSubtitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.cardVerdict}>{item.verdict}</Text>
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
    padding: 16,
    gap: 12,
  },
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
    padding: 16,
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
