// Verdict labels, colours and "when" text shared by Home's Recent checks and
// History, so both lists read the same.

const VERDICT_STYLE = {
  TRUE: ['True', '#22c55e'],
  PARTIALLY_TRUE: ['Partly true', '#eab308'],
  HYPE: ['Hype', '#a855f7'],
  MISLEADING: ['Misleading', '#f97316'],
  FAKE: ['Fake', '#ef4444'],
  FAILED: ["Couldn't check", '#64748B'],
  NOT_TECH: ['Not a tech post', '#64748B'],
};
export const verdictLabel = (v) => (VERDICT_STYLE[v] || [String(v || 'Unknown').replace(/_/g, ' ')])[0];
export const verdictColor = (v) => (VERDICT_STYLE[v] || [null, '#64748B'])[1];

// When a check was saved. savedAt is set from Oct 13; failed checks before
// that carry createdAt. Anything older has no time at all (null).
export const savedTime = (r) => {
  if (r && r.savedAt) return r.savedAt;
  const t = r && r.createdAt ? Date.parse(r.createdAt) : NaN;
  return Number.isFinite(t) ? t : null;
};

export const timeAgo = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  if (m < 1440) return Math.round(m / 60) + ' h ago';
  return Math.round(m / 1440) + ' d ago';
};

// Built by hand: Intl date formatting is not reliable on every Hermes build.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const clockTime = (ms) => {
  const d = new Date(ms);
  const h = d.getHours();
  return ((h % 12) || 12) + ':' + String(d.getMinutes()).padStart(2, '0') + (h < 12 ? ' AM' : ' PM');
};

const dayStart = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// "Today", "Yesterday", "Oct 11" (or "Oct 11, 2025" in another year).
export const dayLabel = (ms) => {
  const today = dayStart(Date.now());
  const day = dayStart(ms);
  if (day === today) return 'Today';
  if (day === today - 86400000) return 'Yesterday';
  const d = new Date(ms);
  const label = MONTHS[d.getMonth()] + ' ' + d.getDate();
  return d.getFullYear() === new Date().getFullYear() ? label : label + ', ' + d.getFullYear();
};

// Today's checks say "3 min ago"; older days show the clock time under a date header.
export const whenText = (ms) => (dayStart(ms) === dayStart(Date.now()) ? timeAgo(ms) : clockTime(ms));
