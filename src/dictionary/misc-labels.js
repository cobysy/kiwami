// Maps JMdict misc tags (entry_senses.misc, a JSON array per sense - see
// LABELS_SUBQUERY in dictionary-entries.js) to a display word and a pill
// color, keyed by category. Transcribed from the JMdict_e DTD's <!ENTITY>
// declarations:
// https://www.edrdg.org/jmdictdb/cgi-bin/edhelp.py?svc=jmdict&sid=#kw_misc
// obsc isn't in the current DTD (dropped from JMdict at some point) and
// doesn't appear in the built DB, but is mapped here too rather than
// silently falling back to the raw code, in case older data still has it.
//
// Color lives here, not in App.vue/CSS, so a tag's meaning and its display
// color are defined in one place - adding a tag can't leave it uncolored,
// and there's no parallel CSS class per category to keep in sync.
const MISC_CATEGORY_COLORS = {
  // Term is dated/no-longer-current - same red as posCategory()'s 'archaic'
  // pos bucket, so "old usage" reads as one consistent color across pos and
  // misc pills.
  archaic: '#ff7a7a',
  // Note about spelling/phrasing convention (kana-only, abbreviation,
  // idiom, ...) rather than a judgment about the word itself - green reads
  // as neutral/informational, fitting for e.g. "usually kana".
  usage: '#4ade80',
  // Politeness/formality register of the language itself.
  register: '#b18cf0',
  // Casual/subculture speech.
  slang: '#f2854d',
  // Derogatory, vulgar, or otherwise use-with-caution.
  sensitive: '#ff6f91',
  // Sense functions as a proper noun (person/place/product/... name).
  name: '#8fa3c8',
};

const MISC_LABELS = {
  // Archaic / dated currency
  arch: { label: 'archaic', category: 'archaic' },
  obs: { label: 'obsolete', category: 'archaic' },
  obsc: { label: 'obscure', category: 'archaic' },
  rare: { label: 'rare', category: 'archaic' },
  dated: { label: 'dated term', category: 'archaic' },
  hist: { label: 'historical term', category: 'archaic' },

  // Spelling/phrasing usage notes
  uk: { label: 'usually kana', category: 'usage' },
  abbr: { label: 'abbreviation', category: 'usage' },
  id: { label: 'idiomatic', category: 'usage' },
  'on-mim': { label: 'onomatopoeic', category: 'usage' },
  yoji: { label: 'yojijukugo', category: 'usage' },
  proverb: { label: 'proverb', category: 'usage' },
  quote: { label: 'quotation', category: 'usage' },

  // Politeness / formality register
  hon: { label: 'honorific', category: 'register' },
  hum: { label: 'humble language', category: 'register' },
  pol: { label: 'polite', category: 'register' },
  fam: { label: 'familiar language', category: 'register' },
  chn: { label: "children's language", category: 'register' },
  form: { label: 'formal/literary', category: 'register' },
  poet: { label: 'poetic term', category: 'register' },
  fem: { label: 'female term', category: 'register' },
  male: { label: 'male term', category: 'register' },

  // Slang
  col: { label: 'colloquial', category: 'slang' },
  sl: { label: 'slang', category: 'slang' },
  'm-sl': { label: 'manga slang', category: 'slang' },
  'net-sl': { label: 'internet slang', category: 'slang' },
  joc: { label: 'jocular', category: 'slang' },

  // Sensitive / use with caution
  derog: { label: 'derogatory', category: 'sensitive' },
  euph: { label: 'euphemistic', category: 'sensitive' },
  vulg: { label: 'vulgar', category: 'sensitive' },
  X: { label: 'X-rated', category: 'sensitive' },
  sens: { label: 'sensitive', category: 'sensitive' },

  // Proper-noun name types
  char: { label: 'character name', category: 'name' },
  company: { label: 'company name', category: 'name' },
  creat: { label: 'creature', category: 'name' },
  dei: { label: 'deity', category: 'name' },
  doc: { label: 'document name', category: 'name' },
  ev: { label: 'event', category: 'name' },
  fict: { label: 'fiction', category: 'name' },
  given: { label: 'given name', category: 'name' },
  group: { label: 'group name', category: 'name' },
  leg: { label: 'legend', category: 'name' },
  myth: { label: 'mythology', category: 'name' },
  obj: { label: 'object name', category: 'name' },
  organization: { label: 'organization name', category: 'name' },
  oth: { label: 'other name', category: 'name' },
  person: { label: 'person name', category: 'name' },
  place: { label: 'place name', category: 'name' },
  product: { label: 'product name', category: 'name' },
  relig: { label: 'religion', category: 'name' },
  serv: { label: 'service name', category: 'name' },
  ship: { label: 'ship name', category: 'name' },
  station: { label: 'station name', category: 'name' },
  surname: { label: 'surname', category: 'name' },
  unclass: { label: 'unclassified name', category: 'name' },
  work: { label: 'work name', category: 'name' },
};

export function miscLabel(tag) {
  return MISC_LABELS[tag]?.label ?? tag;
}

// Pill color for a misc tag, looked up via its category. Falls back to null
// (renders with the same default muted color as an untagged .tag pill) for
// any tag not in MISC_LABELS.
export function miscColor(tag) {
  return MISC_CATEGORY_COLORS[MISC_LABELS[tag]?.category] ?? null;
}
