import React from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

// The "What's new" card (see services/whatsNew.js). App shows it once after an
// update; Settings opens it on demand.
export default function WhatsNewModal({ notes, onClose }) {
  if (!notes) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{notes.title}</Text>
          <ScrollView style={styles.list}>
            {notes.items.map((line, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.dot}>•</Text>
                <Text style={styles.item}>{line}</Text>
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.btn} onPress={onClose}>
            <Text style={styles.btnText}>Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 22, borderWidth: 1, borderColor: colors.cardBorder, maxHeight: '80%' },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: 'bold', marginBottom: 14 },
  list: { marginBottom: 18 },
  row: { flexDirection: 'row', marginBottom: 12 },
  dot: { color: colors.accentCyan, fontSize: 16, marginRight: 8, lineHeight: 22 },
  item: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, flex: 1 },
  btn: { backgroundColor: colors.accentBlue, padding: 14, borderRadius: 10, alignItems: 'center' },
  btnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
});
