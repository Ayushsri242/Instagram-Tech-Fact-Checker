import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { colors } from '../theme/colors';

// Renders the fact-check report from structured fields.
//
// The previous version asked the model for a markdown string and printed it in
// a single <Text>. React Native has no markdown renderer, so tables arrived as
// raw pipes, ** survived as literal asterisks, and ChatScreen carried ten
// regexes trying to scrub it after the fact. Fields in, components out - the
// layout is now the app's job and cannot be broken by the model.

const VERDICT_STYLE = {
  TRUE: { label: 'TRUE', color: '#22c55e' },
  PARTIALLY_TRUE: { label: 'PARTIALLY TRUE', color: '#eab308' },
  HYPE: { label: 'HYPE', color: '#f97316' },
  MISLEADING: { label: 'MISLEADING', color: '#ef4444' },
  FAKE: { label: 'FAKE', color: '#dc2626' },
  UNKNOWN: { label: 'UNKNOWN', color: '#94a3b8' },
};

const STATUS_STYLE = {
  verified: { label: 'verified', color: '#22c55e' },
  not_found: { label: 'not found', color: '#ef4444' },
  unverified: { label: 'unverified', color: '#94a3b8' },
};

const Section = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const Bullet = ({ children }) => (
  <View style={styles.bulletRow}>
    <Text style={styles.bulletDot}>•</Text>
    <Text style={styles.bulletText}>{children}</Text>
  </View>
);

const openUrl = (url) => Linking.openURL(url).catch(() => {});

export default function ReportCard({ report, techName }) {
  if (!report) return null;
  const verdict = VERDICT_STYLE[report.verdict] || VERDICT_STYLE.UNKNOWN;
  // report.references is still populated (and still built only from pages we
  // actually fetched) - it is just not rendered. The card was too long, and the
  // per-tool repo links already carry the useful ones.
  const { claims = [], tools = [], gotchas = [] } = report;

  return (
    <View style={styles.card}>
      <View style={[styles.verdictBar, { backgroundColor: verdict.color }]}>
        <Text style={styles.verdictText}>{verdict.label}</Text>
      </View>

      {!!techName && techName !== 'Unknown Technology' && (
        <Text style={styles.techName}>{techName}</Text>
      )}

      {!!report.factualReality && (
        <Text style={styles.reality}>{report.factualReality}</Text>
      )}

      {claims.length > 0 && (
        <Section title="WHAT WAS CLAIMED">
          {claims.map((c, i) => <Bullet key={`c${i}`}>{c}</Bullet>)}
        </Section>
      )}

      {tools.length > 0 && (
        <Section title="TOOLS">
          {tools.map((t, i) => {
            const status = STATUS_STYLE[t.status] || STATUS_STYLE.unverified;
            const repoUrl = t.repo
              ? (t.repo.startsWith('http') ? t.repo : `https://github.com/${t.repo}`)
              : null;
            return (
              <View key={`t${i}`} style={styles.tool}>
                <View style={styles.toolHeader}>
                  <Text style={styles.toolName}>{t.name}</Text>
                  <View style={[styles.badge, { borderColor: status.color }]}>
                    <Text style={[styles.badgeText, { color: status.color }]}>{status.label}</Text>
                  </View>
                </View>
                {!!t.whatItDoes && <Text style={styles.toolBody}>{t.whatItDoes}</Text>}
                {!!repoUrl && (
                  <TouchableOpacity onPress={() => openUrl(repoUrl)}>
                    <Text style={styles.link} numberOfLines={1}>{t.repo}</Text>
                  </TouchableOpacity>
                )}
                {!!t.install && <Text style={styles.code}>{t.install}</Text>}
                {!!t.caveat && <Text style={styles.caveat}>{t.caveat}</Text>}
              </View>
            );
          })}
        </Section>
      )}

      {gotchas.length > 0 && (
        <Section title="GOTCHAS">
          {gotchas.map((g, i) => <Bullet key={`g${i}`}>{g}</Bullet>)}
        </Section>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 13,
    marginVertical: 6,
    overflow: 'hidden',
  },
  verdictBar: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    marginBottom: 10,
  },
  verdictText: { color: '#000', fontWeight: '800', fontSize: 12, letterSpacing: 0.8 },
  techName: { color: colors.textPrimary, fontSize: 19, fontWeight: '700', marginBottom: 4 },
  reality: { color: colors.textPrimary, fontSize: 14, lineHeight: 19, marginBottom: 2 },
  section: { marginTop: 11 },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    marginBottom: 5,
  },
  bulletRow: { flexDirection: 'row', marginBottom: 3, paddingRight: 4 },
  bulletDot: { color: colors.accentCyan, fontSize: 14, lineHeight: 19, marginRight: 7 },
  bulletText: { color: colors.textPrimary, fontSize: 13.5, lineHeight: 19, flex: 1 },
  tool: {
    borderLeftWidth: 2,
    borderLeftColor: colors.cardBorder,
    paddingLeft: 10,
    marginBottom: 9,
  },
  toolHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  toolName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  badge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  toolBody: { color: colors.textPrimary, fontSize: 13, lineHeight: 18, marginTop: 2 },
  link: { color: colors.accentCyan, fontSize: 13, marginTop: 4 },
  code: {
    color: colors.textPrimary,
    fontSize: 12,
    fontFamily: 'monospace',
    backgroundColor: colors.background,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 5,
    marginTop: 5,
    overflow: 'hidden',
  },
  caveat: { color: colors.warning || '#eab308', fontSize: 12, lineHeight: 18, marginTop: 5 },
});
