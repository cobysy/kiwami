// npm run build:db -- kanji
//
// Parses data/raw/kanjidic/kanjidic2.xml into a normalized kanji table:
// character, on'yomi (katakana), kun'yomi (hiragana, with okurigana dot
// notation preserved as-is, e.g. "あわ.れ"), English meanings, stroke count,
// and classical radical number (used later for the "same radical" similar-
// kanji grouping).
//
// KANJIDIC2 has no custom DTD entities (unlike JMdict_e), so this parses
// directly with fast-xml-parser, no entity-resolution step needed.
//
// Output: data/build/kanji.ndjson (one JSON object per character).

import { readFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN_FILE = path.join(__dirname, '../data/raw/kanjidic/kanjidic2.xml');
const OUT_DIR = path.join(__dirname, '../data/build');
const OUT_FILE = path.join(OUT_DIR, 'kanji.ndjson');

const REPEATABLE = new Set([
  'character', 'cp_value', 'rad_value', 'dic_ref', 'q_code', 'rmgroup',
  'reading', 'meaning', 'nanori',
]);

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function attr(node, name) {
  return node?.[`@_${name}`];
}

function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'object' && '#text' in node) return String(node['#text']);
  return String(node);
}

console.log('Reading kanjidic2.xml...');
const raw = readFileSync(IN_FILE, 'utf8');

console.log('Parsing XML...');
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  isArray: (tagName) => REPEATABLE.has(tagName),
});
const doc = parser.parse(raw);
const characters = doc.kanjidic2.character;
console.log(`Parsed ${characters.length} characters.`);

mkdirSync(OUT_DIR, { recursive: true });
const out = createWriteStream(OUT_FILE, { encoding: 'utf8' });

let written = 0;
for (const c of characters) {
  const radicals = asArray(c.radical?.rad_value);
  const classicalRadical = radicals.find((r) => attr(r, 'rad_type') === 'classical');

  const rmgroups = asArray(c.reading_meaning?.rmgroup);
  const onyomi = [];
  const kunyomi = [];
  const meanings = [];
  for (const group of rmgroups) {
    for (const r of asArray(group.reading)) {
      const type = attr(r, 'r_type');
      if (type === 'ja_on') onyomi.push(textOf(r));
      else if (type === 'ja_kun') kunyomi.push(textOf(r));
    }
    for (const m of asArray(group.meaning)) {
      // No m_lang attribute means English (KANJIDIC2 default), skip fr/es/pt/etc.
      if (attr(m, 'm_lang') === undefined) meanings.push(textOf(m));
    }
  }

  const normalized = {
    literal: textOf(c.literal),
    onyomi,
    kunyomi,
    meanings,
    strokeCount: c.misc?.stroke_count ? Number(asArray(c.misc.stroke_count).map(textOf)[0]) : null,
    grade: c.misc?.grade != null ? Number(textOf(c.misc.grade)) : null,
    jlpt: c.misc?.jlpt != null ? Number(textOf(c.misc.jlpt)) : null,
    frequency: c.misc?.freq != null ? Number(textOf(c.misc.freq)) : null,
    radicalNumber: classicalRadical ? Number(textOf(classicalRadical)) : null,
  };

  out.write(JSON.stringify(normalized) + '\n');
  written++;
}
out.end();

console.log(`Wrote ${written} kanji to ${OUT_FILE}`);
