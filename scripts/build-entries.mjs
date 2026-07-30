// npm run build:db -- entries
//
// Parses data/raw/jmdict/JMdict_e into normalized dictionary entries: kanji
// forms, readings, senses/glosses (English only, since JMdict_e is already
// the English-only export), part-of-speech/field/misc/dialect tags, loanword
// source-language info (lsource - not English-only, e.g. xml:lang="kor" for
// a Korean loanword), priority markers, a derived numeric commonness score,
// and kanji_count on the headword. Nothing here decides whether an entry is
// archaic — that's derived from the misc tags at query time instead (see
// src/dictionary/archaic.js) so revising the rule doesn't mean rebuilding the
// database.
//
// Output: data/build/entries.ndjson (one JSON object per entry, newline
// delimited — used instead of a single JSON array so later steps and the
// final SQLite assembly can stream it without holding the whole dictionary
// as one JSON blob).

import { readFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { resolveDtdEntities } from './lib/xml-dtd-entities.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN_FILE = path.join(__dirname, '../data/raw/jmdict/JMdict_e');
const OUT_DIR = path.join(__dirname, '../data/build');
const OUT_FILE = path.join(OUT_DIR, 'entries.ndjson');

const REPEATABLE = new Set([
  'entry', 'k_ele', 'r_ele', 'ke_inf', 'ke_pri', 're_inf', 're_pri', 're_restr',
  'sense', 'pos', 'field', 'misc', 'dial', 'gloss', 'xref', 'ant', 's_inf',
  'stagk', 'stagr', 'lsource',
]);

const TIER1_PRIORITY = new Set(['news1', 'ichi1', 'spec1', 'gai1']);
const TIER2_PRIORITY = new Set(['news2', 'ichi2', 'spec2', 'gai2']);
const KANJI_RE = /[一-鿿㐀-䶿]/g;

function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'object' && '#text' in node) return String(node['#text']);
  return String(node);
}

function attr(node, name) {
  return typeof node === 'object' && node != null ? node[`@_${name}`] : undefined;
}

// <lsource xml:lang="kor" ls_type="part" ls_wasei="y">annyeong</lsource> -
// element text (if any - the DTD allows an empty lsource, meaning "this word
// is a loan from this language" with no source word/phrase recorded) plus
// its three attributes. xml:lang defaults to "eng" per the DTD when absent.
// Can't reuse textOf() here: an attributes-only lsource (no text content)
// parses to an object with no '#text' key, and textOf's fallback for that
// case (String(node)) would yield the literal string "[object Object]".
function lsourceOf(node) {
  const text = typeof node === 'object' && node != null
    ? ('#text' in node ? String(node['#text']) : '')
    : String(node ?? '');
  return {
    lang: attr(node, 'xml:lang') ?? 'eng',
    text,
    partial: attr(node, 'ls_type') === 'part',
    wasei: attr(node, 'ls_wasei') !== undefined,
  };
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function commonnessScore(priorityTags) {
  let score = 0;
  for (const tag of priorityTags) {
    if (TIER1_PRIORITY.has(tag)) score += 5;
    else if (TIER2_PRIORITY.has(tag)) score += 2;
    else {
      const nf = /^nf(\d{2})$/.exec(tag);
      if (nf) score += Math.max(0, 49 - Number(nf[1])) / 10;
    }
  }
  return Math.round(score * 10) / 10;
}

console.log('Reading JMdict_e...');
const raw = readFileSync(IN_FILE, 'utf8');

console.log('Resolving DTD entities...');
const { xml } = resolveDtdEntities(raw, 'JMdict');

console.log('Parsing XML...');
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  isArray: (tagName) => REPEATABLE.has(tagName),
});
const doc = parser.parse(xml);
const entries = doc.JMdict.entry;
console.log(`Parsed ${entries.length} entries.`);

mkdirSync(OUT_DIR, { recursive: true });
const out = createWriteStream(OUT_FILE, { encoding: 'utf8' });

let written = 0;
for (const e of entries) {
  const kanji = asArray(e.k_ele).map((k) => ({
    text: textOf(k.keb),
    info: asArray(k.ke_inf).map(textOf),
    priority: asArray(k.ke_pri).map(textOf),
  }));

  const readings = asArray(e.r_ele).map((r) => ({
    text: textOf(r.reb),
    noKanji: r.re_nokanji !== undefined,
    restrictTo: r.re_restr ? asArray(r.re_restr).map(textOf) : null,
    info: asArray(r.re_inf).map(textOf),
    priority: asArray(r.re_pri).map(textOf),
  }));

  const senses = asArray(e.sense).map((s) => ({
    pos: asArray(s.pos).map(textOf),
    field: asArray(s.field).map(textOf),
    misc: asArray(s.misc).map(textOf),
    dial: asArray(s.dial).map(textOf),
    lsource: asArray(s.lsource).map(lsourceOf),
    glosses: asArray(s.gloss).map(textOf).filter(Boolean),
    xref: asArray(s.xref).map(textOf),
    antonym: asArray(s.ant).map(textOf),
    info: s.s_inf ? asArray(s.s_inf).map(textOf).join('; ') : null,
    restrictToKanji: s.stagk ? asArray(s.stagk).map(textOf) : null,
    restrictToReading: s.stagr ? asArray(s.stagr).map(textOf) : null,
  }));

  const headword = kanji[0]?.text || readings[0]?.text || '';
  const allPriority = new Set([
    ...kanji.flatMap((k) => k.priority),
    ...readings.flatMap((r) => r.priority),
  ]);
  const normalized = {
    id: Number(textOf(e.ent_seq)),
    kanji,
    readings,
    senses,
    kanjiCount: (headword.match(KANJI_RE) || []).length,
    commonnessScore: commonnessScore(allPriority),
  };

  out.write(JSON.stringify(normalized) + '\n');
  written++;
}
out.end();

console.log(`Wrote ${written} entries to ${OUT_FILE}`);
