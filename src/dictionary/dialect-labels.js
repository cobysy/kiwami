// Maps JMdict dialect tags (entry_senses.dial, a JSON array per sense) to
// display labels. This is a 1:1 rename, not a many-to-one bucketing:
// JMdict's dialect tags are already the display categories a user would
// filter by ("Kansai-ben"), so there's no coarser grouping to do. Full tag
// list:
// https://www.edrdg.org/jmdictdb/cgi-bin/edhelp.py?svc=jmdict&sid=#kw_dial
export const DIALECT_LABELS = {
  bra: 'Brazilian',
  hob: 'Hokkaido-ben',
  ksb: 'Kansai-ben',
  ktb: 'Kantou-ben',
  kyb: 'Kyoto-ben',
  kyu: 'Kyushu-ben',
  nab: 'Nagano-ben',
  osb: 'Osaka-ben',
  rkb: 'Ryukyu-ben',
  thb: 'Touhoku-ben',
  tsb: 'Tosa-ben',
  tsug: 'Tsugaru-ben',
};

export function dialectLabel(tag) {
  return DIALECT_LABELS[tag] ?? tag;
}

// Pill color per dialect tag, defined here rather than as a single flat CSS
// color in App.vue (same reasoning as misc-labels.js/pos-labels.js). Unlike
// those, dialect tags have no shared category to color by - each one is
// already its own maximally-specific label (see the comment above) - so
// each gets its own hue instead of a bucket sharing one color: a result list
// mixing several dialects reads at a glance which is which, not just "this
// is regional". Evenly spaced around the color wheel in tag order, same
// saturation/lightness family as the other pill palettes.
const DIALECT_COLORS = {
  bra: '#e49a81',
  hob: '#e4cb81',
  ksb: '#cbe481',
  ktb: '#9ae481',
  kyb: '#81e49a',
  kyu: '#81e4cb',
  nab: '#81cbe4',
  osb: '#819ae4',
  rkb: '#9a81e4',
  thb: '#cb81e4',
  tsb: '#e481cb',
  tsug: '#e4819a',
};

// fetchEntriesByIds (dictionary-entries.js) maps entry_senses.dial's raw
// tags to display labels before results ever reach the UI - r.dialect
// carries labels like 'Kansai-ben', never the raw 'ksb' - so dialectColor()
// has to key off the label too. Built once from DIALECT_COLORS (which stays
// tag-keyed so it lines up with DIALECT_LABELS above for easy review).
const DIALECT_COLORS_BY_LABEL = Object.fromEntries(
  Object.entries(DIALECT_LABELS).map(([tag, label]) => [label, DIALECT_COLORS[tag]]),
);

export function dialectColor(label) {
  return DIALECT_COLORS_BY_LABEL[label] ?? null;
}

// [tag, label] pairs sorted by label, for populating a filter dropdown/chip
// list without every caller re-deriving the sort.
export const DIALECT_OPTIONS = Object.entries(DIALECT_LABELS)
  .sort(([, a], [, b]) => a.localeCompare(b));
