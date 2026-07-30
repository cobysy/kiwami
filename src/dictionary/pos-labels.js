// Maps JMdict part-of-speech tags (entry_senses.pos, a JSON array per sense)
// to human-readable descriptions, for a tooltip alongside the raw code -
// codes like "adv"/"n"/"int" are meaningless to anyone who hasn't memorized
// the JMdict DTD. Transcribed from the JMdict_e DTD's <!ENTITY> declarations:
// https://www.edrdg.org/jmdictdb/cgi-bin/edhelp.py?svc=jmdict&sid=#kw_pos
export const POS_LABELS = {
  'adj-f': 'noun or verb acting prenominally',
  'adj-i': 'adjective (keiyoushi)',
  'adj-ix': "adjective (keiyoushi) - yoi/ii class",
  'adj-kari': "'kari' adjective (archaic)",
  'adj-ku': "'ku' adjective (archaic)",
  'adj-na': 'adjectival noun or quasi-adjective (keiyodoshi)',
  'adj-nari': 'archaic/formal form of na-adjective',
  'adj-no': "noun which may take the genitive case particle 'no'",
  'adj-pn': 'pre-noun adjectival (rentaishi)',
  'adj-shiku': "'shiku' adjective (archaic)",
  'adj-t': "'taru' adjective",
  adv: 'adverb (fukushi)',
  'adv-to': "adverb taking the 'to' particle",
  aux: 'auxiliary',
  'aux-adj': 'auxiliary adjective',
  'aux-v': 'auxiliary verb',
  conj: 'conjunction',
  cop: 'copula',
  ctr: 'counter',
  exp: 'expression (phrase, clause, etc.)',
  int: 'interjection (kandoushi)',
  n: 'noun (common) (futsuumeishi)',
  'n-adv': 'adverbial noun (fukushitekimeishi)',
  'n-pr': 'proper noun',
  'n-pref': 'noun, used as a prefix',
  'n-suf': 'noun, used as a suffix',
  'n-t': 'noun (temporal) (jisoumeishi)',
  num: 'numeric',
  pn: 'pronoun',
  pref: 'prefix',
  prt: 'particle',
  suf: 'suffix',
  unc: 'unclassified',
  'v-unspec': 'verb unspecified',
  v1: 'Ichidan verb',
  'v1-s': 'Ichidan verb - kureru special class',
  'v2a-s': "Nidan verb with 'u' ending (archaic)",
  'v2b-k': "Nidan verb (upper class) with 'bu' ending (archaic)",
  'v2b-s': "Nidan verb (lower class) with 'bu' ending (archaic)",
  'v2d-k': "Nidan verb (upper class) with 'dzu' ending (archaic)",
  'v2d-s': "Nidan verb (lower class) with 'dzu' ending (archaic)",
  'v2g-k': "Nidan verb (upper class) with 'gu' ending (archaic)",
  'v2g-s': "Nidan verb (lower class) with 'gu' ending (archaic)",
  'v2h-k': "Nidan verb (upper class) with 'hu/fu' ending (archaic)",
  'v2h-s': "Nidan verb (lower class) with 'hu/fu' ending (archaic)",
  'v2k-k': "Nidan verb (upper class) with 'ku' ending (archaic)",
  'v2k-s': "Nidan verb (lower class) with 'ku' ending (archaic)",
  'v2m-k': "Nidan verb (upper class) with 'mu' ending (archaic)",
  'v2m-s': "Nidan verb (lower class) with 'mu' ending (archaic)",
  'v2n-s': "Nidan verb (lower class) with 'nu' ending (archaic)",
  'v2r-k': "Nidan verb (upper class) with 'ru' ending (archaic)",
  'v2r-s': "Nidan verb (lower class) with 'ru' ending (archaic)",
  'v2s-s': "Nidan verb (lower class) with 'su' ending (archaic)",
  'v2t-k': "Nidan verb (upper class) with 'tsu' ending (archaic)",
  'v2t-s': "Nidan verb (lower class) with 'tsu' ending (archaic)",
  'v2w-s': "Nidan verb (lower class) with 'u' ending and 'we' conjugation (archaic)",
  'v2y-k': "Nidan verb (upper class) with 'yu' ending (archaic)",
  'v2y-s': "Nidan verb (lower class) with 'yu' ending (archaic)",
  'v2z-s': "Nidan verb (lower class) with 'zu' ending (archaic)",
  v4b: "Yodan verb with 'bu' ending (archaic)",
  v4g: "Yodan verb with 'gu' ending (archaic)",
  v4h: "Yodan verb with 'hu/fu' ending (archaic)",
  v4k: "Yodan verb with 'ku' ending (archaic)",
  v4m: "Yodan verb with 'mu' ending (archaic)",
  v4n: "Yodan verb with 'nu' ending (archaic)",
  v4r: "Yodan verb with 'ru' ending (archaic)",
  v4s: "Yodan verb with 'su' ending (archaic)",
  v4t: "Yodan verb with 'tsu' ending (archaic)",
  v5aru: 'Godan verb - -aru special class',
  v5b: "Godan verb with 'bu' ending",
  v5g: "Godan verb with 'gu' ending",
  v5k: "Godan verb with 'ku' ending",
  'v5k-s': 'Godan verb - Iku/Yuku special class',
  v5m: "Godan verb with 'mu' ending",
  v5n: "Godan verb with 'nu' ending",
  v5r: "Godan verb with 'ru' ending",
  'v5r-i': "Godan verb with 'ru' ending (irregular verb)",
  v5s: "Godan verb with 'su' ending",
  v5t: "Godan verb with 'tsu' ending",
  v5u: "Godan verb with 'u' ending",
  'v5u-s': "Godan verb with 'u' ending (special class)",
  v5uru: 'Godan verb - Uru old class verb (old form of Eru)',
  vi: 'intransitive verb',
  vk: 'Kuru verb - special class',
  vn: 'irregular nu verb',
  vr: 'irregular ru verb, plain form ends with -ri',
  vs: 'noun or participle which takes the aux. verb suru',
  'vs-c': 'su verb - precursor to the modern suru',
  'vs-i': 'suru verb - included',
  'vs-s': 'suru verb - special class',
  vt: 'transitive verb',
  vz: 'Ichidan verb - zuru verb (alternative form of -jiru verbs)',
};

export function posLabel(tag) {
  return POS_LABELS[tag] ?? tag;
}

// Short, plain-English labels for the visible tag pill itself (POS_LABELS'
// DTD-transcribed descriptions are accurate but too long to sit inline next
// to a headword, e.g. "Godan verb with 'ru' ending"). The Godan/Yodan/Nidan
// verb families collapse the ending-letter distinction (v5r/v5u/v5k/... all
// read "godan verb") since that detail isn't meaningful to a reader who
// doesn't already know the JMdict scheme - it's still available via the
// tag's full posLabel() in the hover tooltip.
const POS_SHORT_LABELS = {
  'adj-f': 'prenominal',
  'adj-i': 'i-adjective',
  'adj-ix': 'i-adjective (ii/yoi)',
  'adj-kari': 'adjective (archaic)',
  'adj-ku': 'adjective (archaic)',
  'adj-na': 'na-adjective',
  'adj-nari': 'na-adjective (archaic)',
  'adj-no': 'no-adjective',
  'adj-pn': 'pre-noun adjectival',
  'adj-shiku': 'adjective (archaic)',
  'adj-t': 'taru-adjective',
  adv: 'adverb',
  'adv-to': 'adverb (to)',
  aux: 'auxiliary',
  'aux-adj': 'aux. adjective',
  'aux-v': 'aux. verb',
  conj: 'conjunction',
  cop: 'copula',
  ctr: 'counter',
  exp: 'expression',
  int: 'interjection',
  n: 'noun',
  'n-adv': 'adverbial noun',
  'n-pr': 'proper noun',
  'n-pref': 'noun prefix',
  'n-suf': 'noun suffix',
  'n-t': 'temporal noun',
  num: 'numeral',
  pn: 'pronoun',
  pref: 'prefix',
  prt: 'particle',
  suf: 'suffix',
  unc: 'unclassified',
  'v-unspec': 'verb',
  v1: 'ichidan verb',
  'v1-s': 'ichidan verb',
  v5aru: 'godan verb',
  'v5k-s': 'godan verb',
  'v5r-i': 'godan verb',
  'v5u-s': 'godan verb',
  v5uru: 'godan verb',
  vi: 'intransitive',
  vk: 'kuru verb',
  vn: 'nu verb (archaic)',
  vr: 'ru verb (archaic)',
  vs: 'suru verb',
  'vs-c': 'suru verb (archaic)',
  'vs-i': 'suru verb',
  'vs-s': 'suru verb',
  vt: 'transitive',
  vz: 'zuru verb',
};

export function posShortLabel(tag) {
  if (POS_SHORT_LABELS[tag]) return POS_SHORT_LABELS[tag];
  if (tag.startsWith('v5')) return 'godan verb';
  if (tag.startsWith('v4')) return 'yodan verb (archaic)';
  if (tag.startsWith('v2')) return 'nidan verb (archaic)';
  return tag;
}

// Tags whose JMdict description explicitly calls them archaic - the v2/v4
// conjugation classes, plus the handful of named forms (adj-kari/-ku/-shiku,
// adj-nari, vn, vr, vs-c) the DTD marks the same way. Checked before the
// verb/adjective buckets below so an archaic verb (e.g. v2r-k) is flagged as
// archaic first - that's the more useful signal to a reader than "verb".
const ARCHAIC_POS = new Set([
  'adj-kari', 'adj-ku', 'adj-nari', 'adj-shiku',
  'v2a-s', 'v2b-k', 'v2b-s', 'v2d-k', 'v2d-s', 'v2g-k', 'v2g-s', 'v2h-k', 'v2h-s',
  'v2k-k', 'v2k-s', 'v2m-k', 'v2m-s', 'v2n-s', 'v2r-k', 'v2r-s', 'v2s-s', 'v2t-k',
  'v2t-s', 'v2w-s', 'v2y-k', 'v2y-s', 'v2z-s',
  'v4b', 'v4g', 'v4h', 'v4k', 'v4m', 'v4n', 'v4r', 'v4s', 'v4t',
  'vn', 'vr', 'vs-c',
]);

// Every pos tag in the JMdict_e DTD (verified against the built DB's actual
// distinct entry_senses.pos values) resolves to exactly one of these 8
// buckets - nothing is left to fall through to an uncolored 'other', which
// previously left common categories like noun/interjection uncolored just
// because they weren't verbs or adjectives.
// Precedence: 'archaic' > 'adjective' > 'verb' > 'noun' > 'adverb' >
// 'interjection' > 'expression' > 'function', checked in that order so e.g.
// an archaic verb (v2r-k) is flagged archaic first.
export function posCategory(tag) {
  if (ARCHAIC_POS.has(tag)) return 'archaic';
  if (tag.startsWith('adj-') || tag === 'aux-adj') return 'adjective';
  if (tag.startsWith('v') || tag === 'aux-v' || tag === 'cop') return 'verb';
  if (tag.startsWith('n') || ['ctr', 'num', 'pn', 'pref', 'suf'].includes(tag)) return 'noun';
  if (tag === 'adv' || tag === 'adv-to') return 'adverb';
  if (tag === 'int') return 'interjection';
  if (tag === 'exp') return 'expression';
  if (['prt', 'conj', 'aux', 'unc'].includes(tag)) return 'function';
  return 'other';
}

// Pill color per posCategory() bucket, defined here rather than as CSS
// classes in App.vue so a tag's color travels with its categorization logic.
// 'archaic' reuses misc-labels.js's archaic red so "old usage" reads as one
// consistent color across pos and misc pills. No 'other' entry - posCategory
// never actually returns it for a known DTD tag (see above), so it's a
// defensive fallback for an unrecognized future tag only, not a bucket any
// current pill lands in.
const POS_CATEGORY_COLORS = {
  archaic: '#ff7a7a',
  verb: '#7dabf8',
  adjective: '#d78be0',
  noun: '#4dd9e8',
  adverb: '#b5e64d',
  interjection: '#ff9a5c',
  expression: '#e8c14d',
  function: '#9fa8da',
};

export function posColor(tag) {
  return POS_CATEGORY_COLORS[posCategory(tag)] ?? null;
}
