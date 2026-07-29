// Romaji -> hiragana conversion, so a query typed in latin letters (e.g.
// "jibun") can still search kanji/reading text (自分/じぶん) rather than
// only ever matching English glosses - see search.js, which uses this to
// build a separate kana query for the kanji/reading fields while glosses
// keep searching the raw text. Delegates the actual romaji rules (digraphs,
// sokuon doubling, the ん-before-vowel/y ambiguity, chōon spellings, ...) to
// wanakana rather than re-deriving them by hand.
import { toHiragana } from 'wanakana';

/**
 * Converts `input` to hiragana and returns it only if every character
 * converted - i.e. it was actually romaji, not an English word/phrase that
 * happens to be all letters (wanakana leaves unmapped characters as-is
 * rather than failing, so a leftover latin letter in the output is the
 * signal that this wasn't romaji). Already-kana or kanji input passes
 * through unchanged and counts as "converted".
 */
export function romajiToHiragana(input) {
  const kana = toHiragana(input);
  return /[a-z]/i.test(kana) ? null : kana;
}
