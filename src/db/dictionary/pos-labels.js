// Maps JMdict part-of-speech tags (entry_senses.pos, a JSON array per
// sense) down to the small set of coarse categories search results want to
// show ("verb" / "い-adj" / "な-adj" / "noun" / ...) instead of raw tags
// like v5k/adj-ix/vs-i. Full tag list:
// https://www.edrdg.org/jmdictdb/cgi-bin/edhelp.py?svc=jmdict&sid=#kw_pos

const TAG_CATEGORY = {
  n: 'noun', 'n-pref': 'noun', 'n-suf': 'noun', 'n-t': 'noun',
  pn: 'pron',
  num: 'num',
  ctr: 'ctr',
  adv: 'adv', 'adv-to': 'adv',
  conj: 'conj',
  prt: 'prt',
  int: 'int',
  pref: 'pref',
  suf: 'suf',
  exp: 'exp',
  cop: 'cop',
  aux: 'aux', 'aux-v': 'aux', 'aux-adj': 'aux',
  'adj-i': 'い-adj', 'adj-ix': 'い-adj', 'adj-ku': 'い-adj', 'adj-shiku': 'い-adj',
  'adj-na': 'な-adj', 'adj-nari': 'な-adj',
  'adj-no': 'の-adj',
  // adj-pn/adj-f (rentaishi: この/おかしな/...) attach directly to the noun
  // with no connecting particle, unlike the -adj categories above, so they
  // get their own real grammatical term instead of a fake "X-adj" label.
  'adj-pn': 'rentaishi',
  'adj-t': 'たる-adj',
  'adj-f': 'rentaishi',
};

// Every other JMdict verb-conjugation tag (v1/v5k/v2r-s/v4h/vk/vs/vz/...,
// ~70 of them) starts with "v" and isn't already in TAG_CATEGORY above, so
// they're bucketed as "verb" by prefix rather than listed by hand. `vt`/
// `vi` (transitive/intransitive) ride along on the same senses as a real
// verb tag and never need their own bucket.
function categoryOf(tag) {
  if (tag in TAG_CATEGORY) return TAG_CATEGORY[tag];
  if (tag.startsWith('v') && tag !== 'vt' && tag !== 'vi') return 'verb';
  return null;
}

const CATEGORY_ORDER = [
  'verb', 'い-adj', 'な-adj', 'の-adj', 'たる-adj', 'rentaishi', 'noun',
  'pron', 'num', 'ctr', 'adv', 'conj', 'prt', 'int', 'pref', 'suf', 'exp',
  'cop', 'aux',
];
const CATEGORY_RANK = new Map(CATEGORY_ORDER.map((category, i) => [category, i]));

/**
 * @param {string[][]} posBySense - one JMdict pos-tag array per sense
 *   (entry_senses.pos, already JSON.parse'd)
 * @returns {string[]} deduped display categories, in CATEGORY_ORDER
 */
export function summarizePos(posBySense) {
  const found = new Set();
  for (const tags of posBySense) {
    for (const tag of tags) {
      const category = categoryOf(tag);
      if (category) found.add(category);
    }
  }
  return [...found].sort((a, b) => CATEGORY_RANK.get(a) - CATEGORY_RANK.get(b));
}
