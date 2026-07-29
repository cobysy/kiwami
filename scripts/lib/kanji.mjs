// Kanji-detection helper for the build pipeline.
// CJK Unified Ideographs (U+4E00-U+9FFF) covers nearly all everyday kanji;
// Extension A (U+3400-U+4DBF) adds the rarer ones (mostly names/classical
// Chinese) that block doesn't include. \u escapes instead of the literal
// boundary characters, since a stray real kanji sitting in the middle of a
// regex reads as a typo at a glance rather than a deliberate range.
const KANJI_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

export function hasKanji(str) {
  return KANJI_RE.test(str);
}
