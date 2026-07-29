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

// [tag, label] pairs sorted by label, for populating a filter dropdown/chip
// list without every caller re-deriving the sort.
export const DIALECT_OPTIONS = Object.entries(DIALECT_LABELS)
  .sort(([, a], [, b]) => a.localeCompare(b));
