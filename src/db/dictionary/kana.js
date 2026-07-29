// Runtime kana helpers for the query layer. Deliberately separate from
// scripts/lib/kana.mjs (build-time tooling) even though the katakana ->
// hiragana logic is identical — scripts/ and src/ are different deployment
// units (Node build pipeline vs. app bundle) and shouldn't import across
// that boundary.
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
