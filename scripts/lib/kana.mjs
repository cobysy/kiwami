// Katakana -> hiragana conversion for furigana display (kuromoji readings are
// always katakana; JMdict readings are already stored in their native kana).
const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const HIRAGANA_OFFSET = 0x60;

export function toHiragana(str) {
  let out = '';
  for (const ch of str) {
    const code = ch.codePointAt(0);
    out += code >= KATAKANA_START && code <= KATAKANA_END
      ? String.fromCodePoint(code - HIRAGANA_OFFSET)
      : ch;
  }
  return out;
}
