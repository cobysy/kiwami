// Decoders for the compact delimiter-based encoding scripts/assemble-sqlite.mjs
// writes into free-text string-array/structured columns (kanji onyomi/kunyomi/
// meanings, entry_readings.restrict_to, entry_senses.xref/lsource, sentences.
// furigana) instead of JSON - see that file's comment on encodeList for why
// (no repeated quotes/brackets/key-names/`true`/`false` literals across
// 60k-260k rows). U+001F/U+001E ("unit separator"/"record separator") are the
// same delimiters used there.
const LIST_SEP = '\x1f';
const FIELD_SEP = '\x1e';

/** @param {string|null} value @returns {string[]|null} */
export function decodeList(value) {
  if (value == null) return null;
  return value === '' ? [] : value.split(LIST_SEP);
}

/** @param {string} value @returns {Array<{ surface: string, reading: string|null }>} */
export function decodeFurigana(value) {
  if (value === '') return [];
  return value.split(LIST_SEP).map((token) => {
    const i = token.indexOf(FIELD_SEP);
    return i === -1
      ? { surface: token, reading: null }
      : { surface: token.slice(0, i), reading: token.slice(i + 1) };
  });
}

/** @param {string|null} value @returns {Array<{ lang: string, text: string, partial: boolean, wasei: boolean }>} */
export function decodeLsource(value) {
  if (value == null) return [];
  return value.split(LIST_SEP).map((item) => {
    const [lang, text, flags] = item.split(FIELD_SEP);
    return { lang, text, partial: flags.includes('p'), wasei: flags.includes('w') };
  });
}
