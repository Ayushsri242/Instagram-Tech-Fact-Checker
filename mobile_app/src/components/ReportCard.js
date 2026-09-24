import React, { useState } from 'react';
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
  const [showSources, setShowSources] = useState(false);
  const verdict = VERDICT_STYLE[report.verdict] || VERDICT_STYLE.UNKNOWN;
  const { claims = [], tools = [], gotchas = [], references = [], confidence = null } = report;

  return (
    <View style={styles.card}>
      <View style={[styles.verdictBar, { backgroundColor: verdict.color }]}>
        <Text style={styles.verdictText}>{verdict.label}</Text>
      </View>

      {!!techName && techName !== 'Unknown Technology' && (
        <Text style={[styles.techName, techName === 'Unidentified' && styles.techUnknown]}>
          {techName === 'Unidentified' ? 'Could not identify the tool' : techName}
        </Text>
      )}

      {/* Existence and framing are separate questions. The chip above judges the
          framing; this line reports what the evidence confirmed, which is a
          fact rather than an opinion. */}
      {!!report.toolsReal && report.toolsReal.total > 0 && (
        <Text style={styles.toolsReal}>
          {report.toolsReal.verified}/{report.toolsReal.total} tools verified to exist
          {report.toolsReal.missing > 0 ? ' · ' + report.toolsReal.missing + ' not found' : ''}
        </Text>
      )}

      {!!report.factualReality && (
        <Text style={styles.reality}>{report.factualReality}</Text>
      )}

      {/* Not the model's opinion of itself: this is computed from whether the
          subject was confirmed, how much of the post was readable, how many
          tools the evidence verified, and how many sources carried real page
          text. */}
      {!!confidence && (
        <Text style={styles.confidence}>
          {confidence.score}% confidence
          {confidence.why && confidence.why.length > 0 ? ' - ' + confidence.why.join(', ') : ''}
        </Text>
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

      {/* Sources were hidden to keep the card short, which also removed the
          reader's only way to check it. References are built exclusively from
          pages the pipeline actually fetched, so this list is the evidence the
          verdict rests on - collapsed by default, one tap to audit. */}
      {references.length > 0 && (
        <View style={styles.section}>
          <TouchableOpacity onPress={() => setShowSources(!showSources)}>
            <Text style={styles.sourcesToggle}>
              {showSources ? 'HIDE SOURCES' : 'SHOW SOURCES (' + references.length + ')'}
            </Text>
          </TouchableOpacity>
          {showSources && references.map((r, i) => (
            <TouchableOpacity key={`r${i}`} onPress={() => openUrl(r.url)}>
              <Text style={styles.sourceTitle} numberOfLines={1}>{i + 1}. {r.title || r.url}</Text>
              <Text style={styles.sourceUrl} numberOfLines={1}>{r.url}</Text>
            </TouchableOpacity>
          ))}
        </View>
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
  techUnknown: { color: colors.textMuted, fontSize: 16, fontStyle: 'italic' },
  toolsReal: { color: colors.textMuted, fontSize: 12, marginBottom: 6 },
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
  confidence: { color: colors.textMuted, fontSize: 11.5, lineHeight: 16, marginTop: 6 },
  sourcesToggle: {
    color: colors.accentCyan,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    marginBottom: 5,
  },
  sourceTitle: { color: colors.textPrimary, fontSize: 12.5, marginTop: 6 },
  sourceUrl: { color: colors.textMuted, fontSize: 11 },
});
