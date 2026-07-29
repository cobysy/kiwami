// Forward verb conjugation for the result card's "Conjugate" button, backed
// by jconj-js's table-based engine (see lib/jconj.js, NOTICE.md) instead of
// a hand-rolled rule set - it already encodes every irregular okurigana
// sound-change (行く's 行って not 行いて, する's suppletive 出来る potential,
// etc.) straight from JMdictDB's own conjugation data.
//
// Still deliberately not a full conjugation table: only a handful of forms
// are surfaced (negative/polite/te/past/potential/passive/causative), each
// split into { stem, ending } - by diffing the conjugated text against the
// dictionary form's own text - so the UI can grey out the stem and
// highlight only the kana that actually change.
import { jconjugate } from './lib/jconj.js';
import jconjTables from './lib/jconj-tables.json';

// JMdict pos tag -> jconj-tables.json kwpos id. Bare 'vs' is deliberately
// excluded: it marks a noun that merely *can* take する (e.g. 勉強), not a
// conjugatable verb entry itself (that would be 勉強する, tagged vs-i/vs-s).
const POS_ID = {
  v1: 28,
  v5b: 31,
  v5g: 32,
  v5k: 33,
  'v5k-s': 34,
  v5m: 35,
  v5n: 36,
  v5r: 37,
  v5s: 39,
  v5t: 40,
  v5u: 41,
  vk: 45,
  'vs-s': 47,
  'vs-i': 48,
};

// (conj id, neg, fml) per jconj's conj.csv - see NOTICE.md.
const FORMS = [
  { label: 'Negative', conj: 1, neg: true, fml: false },
  { label: 'Polite', conj: 1, neg: false, fml: true },
  { label: 'Te-form', conj: 3, neg: false, fml: false },
  { label: 'Past', conj: 2, neg: false, fml: false },
  { label: 'Potential', conj: 5, neg: false, fml: false },
  { label: 'Passive', conj: 6, neg: false, fml: false },
  { label: 'Causative', conj: 7, neg: false, fml: false },
];

function commonPrefixLength(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * @param {string|null} kanji - the entry's kanji headword, if any
 * @param {string} reading - the entry's kana reading (dictionary form)
 * @param {string[]} pos - JMdict pos tags for the entry
 * @returns {Array<{ label: string, stem: string, ending: string }> | null}
 */
export function conjugate(kanji, reading, pos) {
  const posTag = pos.find((p) => POS_ID[p]);
  if (!posTag) return null;
  const posId = POS_ID[posTag];

  let base = kanji || reading;
  // する itself has a rare kanji spelling (為る) that doesn't end in する -
  // conjugating through it mechanically produces forms nobody actually
  // writes (為ない instead of しない), since 為 sits outside the kana region
  // that's supposed to carry the sound change. Compound suru-verbs (e.g.
  // 勉強する) don't have this problem - their kanji portion is a fixed noun
  // stem before する, so they're left on the kanji base.
  if ((posTag === 'vs-i' || posTag === 'vs-s') && kanji && !kanji.endsWith('する')) {
    base = reading;
  }

  const combined = jconjugate(base, '', posId, jconjTables);
  const baseText = combined[`${posId},1,false,false`] ?? base;

  const results = [];
  for (const f of FORMS) {
    const text = combined[`${posId},${f.conj},${f.neg},${f.fml}`];
    if (!text) continue;
    const common = commonPrefixLength(baseText, text);
    results.push({ label: f.label, stem: text.slice(0, common), ending: text.slice(common) });
  }
  return results.length > 0 ? results : null;
}
