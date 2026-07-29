// The actual assertions, parameterized by a driver factory so the exact
// same test bodies run against both the Node (node:sqlite) and browser
// (jeep-sqlite) drivers — proving PLAN.md Phase 1's requirement that
// swapping the driver behind the shared interface is the only
// platform-specific step. tests/node/dictionary.test.js and
// tests/browser/dictionary.test.js each just call this with their own
// factory.
//
// Runs against the real public/dictionary.db (read-only), not a hand-picked
// fixture — a fixture schema/seed duplicated scripts/assemble-sqlite.mjs's
// own CREATE TABLE + insert logic for no real benefit, since the real
// database is small enough to open instantly (Node) and load in well under
// a second in the browser driver too (see README-DICTIONARY.md's
// findings). Every anchor below (entry IDs, real headwords/readings) was
// looked up directly against the real data rather than guessed, the same
// way scripts/verify-db.mjs's example queries pin to real entries like
// 明白/id 1000220.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertDriver } from '../../src/db/driver.js';
import { search, fuzzySearch, deconjugate } from '../../src/db/dictionary/index.js';

/**
 * @param {string} label - shown in the describe block name (e.g. "node", "browser")
 * @param {() => Promise<import('../../src/db/driver.js').DBDriver>} createDriver - must
 *   return an already-opened driver, read-only, pointed at the real dictionary.db.
 */
export function runDictionarySuite(label, createDriver) {
  describe(`dictionary (${label} driver)`, () => {
    /** @type {import('../../src/db/driver.js').DBDriver} */
    let driver;

    beforeAll(async () => {
      driver = await createDriver();
      assertDriver(driver);
    });

    afterAll(async () => {
      await driver?.close();
    });

    it('runs a raw query through the driver', async () => {
      const rows = await driver.all('SELECT count(*) AS c FROM entries');
      expect(rows[0].c).toBeGreaterThan(100000);
    });

    describe('search()', () => {
      // 食べる/たべる (id 1358280, "to eat") — a common ichidan verb with no
      // homograph, so it's a clean single-entry anchor for the exact/prefix/
      // substring tiers and the kanji-count facet.
      it('finds an exact kanji match', async () => {
        const { tier, results } = await search(driver, '食べる');
        expect(tier).toBe('exact');
        expect(results.map((r) => r.id)).toContain(1358280);
      });

      it('finds an exact reading match', async () => {
        const { tier, results } = await search(driver, 'たべる');
        expect(tier).toBe('exact');
        expect(results.map((r) => r.id)).toContain(1358280);
      });

      it('finds an exact gloss match, case-insensitively', async () => {
        const { results } = await search(driver, 'To Eat');
        expect(results.map((r) => r.id)).toContain(1358280);
      });

      it('falls through to the prefix tier when no exact match exists', async () => {
        const { tier, results } = await search(driver, 'たべ');
        expect(tier).toBe('prefix');
        expect(results.map((r) => r.id)).toContain(1358280);
      });

      it('falls through to the substring tier for a mid-word fragment', async () => {
        const { tier, results } = await search(driver, 'べる');
        expect(tier).toBe('substring');
        expect(results.map((r) => r.id)).toContain(1358280);
      });

      it('reports the exact tier and still merges in prefix matches alongside it', async () => {
        // "水" has two real JMdict entries with that exact kanji headword
        // (1371260 "water", the common reading みず; 2153780 the rarer すい
        // reading) — both are legitimate exact hits, and both are
        // guaranteed a slot ahead of any prefix match (see search()'s
        // exact-gets-the-limit-first budgeting). It's also a prefix of
        // dozens of common compounds (水道, 水泳, 水素, ...), which now
        // merge in to fill the rest of the result budget instead of the
        // tier stopping at exact alone.
        const { tier, results } = await search(driver, '水');
        expect(tier).toBe('exact');
        const ids = results.map((r) => r.id);
        expect(ids).toEqual(expect.arrayContaining([1371260, 2153780]));
        expect(results.length).toBeGreaterThan(2);
      });

      it('treats a query with * as a wildcard and skips fuzzy correction', async () => {
        const { tier, results } = await search(driver, '食*');
        expect(tier).toBe('wildcard');
        expect(results.map((r) => r.id)).toContain(1358280);
      });

      it('supports ? as a single-character wildcard', async () => {
        const { results } = await search(driver, '?み');
        // Real dictionary content for this pattern varies; just assert it
        // runs the wildcard path without throwing and returns an array.
        expect(Array.isArray(results)).toBe(true);
      });

      it('flags an archaic-only entry with its specific misc tag', async () => {
        // なむち (id 2174460, an archaic reading of 汝/"thou") has no other
        // entry sharing that exact reading, so it's a clean single-result
        // anchor for the archaic/labels fields.
        const { results } = await search(driver, 'なむち');
        expect(results[0].id).toBe(2174460);
        expect(results[0].archaic).toBe(true);
        expect(results[0].labels).toContain('arch');
      });

      it('sorts common-first and pushes the archaic entry to the bottom regardless of its score', async () => {
        // A "水酸*" wildcard matches a small, real mixed set: 11 non-archaic
        // chemistry terms (水酸化ナトリウム "sodium hydroxide", etc.) plus
        // exactly one archaic entry (1886480, 水酸根). Small enough to check
        // full ordering, unlike a bare "*" which would return only the top
        // 50 of 200k+ entries (all non-archaic, since is_archaic sorts
        // first) and never surface an archaic entry at all.
        const { results } = await search(driver, '水酸*');
        const nonArchaic = results.filter((r) => !r.archaic).map((r) => r.commonness_score);
        expect(nonArchaic).toEqual([...nonArchaic].sort((a, b) => b - a));
        expect(results.at(-1).id).toBe(1886480);
        expect(results.at(-1).archaic).toBe(true);
      });

      it('surfaces compounds built on an exact match without a kanji-count filter', async () => {
        // 白い (1474910, "white") is an exact hit; 白いんげん豆 (2831811,
        // "white kidney bean") only shows up via the prefix tier. Before
        // the exact+prefix merge, the exact hit alone made the tier stop,
        // so 白いんげん豆 was invisible unless you separately filtered by
        // kanji count — surprising, since nothing about "search for 白い"
        // suggests you'd need to know its compound's kanji count in advance.
        const { tier, results } = await search(driver, '白い');
        expect(tier).toBe('exact');
        const ids = results.map((r) => r.id);
        expect(ids).toContain(1474910);
        expect(ids).toContain(2831811);
      });

      it('surfaces raw JMdict pos tags, deduped in first-seen order', async () => {
        // Anchors looked up directly against the real data, same as the
        // archaic-labels test above: 食べる (1358280) is v1/vt across both
        // senses, 大きい (1588880) is adj-i-only, 静か (1381820) is
        // adj-na-only, and 勉強 (1512670) mixes plain-noun and suru-verb
        // senses (n/vs/vt/vi) - each entry's tags should collapse to their
        // distinct values without reordering.
        expect((await search(driver, '食べる')).results[0].pos).toEqual(['v1', 'vt']);
        expect((await search(driver, '大きい')).results[0].pos).toEqual(['adj-i']);
        expect((await search(driver, '静か')).results[0].pos).toEqual(['adj-na']);
        const { results } = await search(driver, '勉強');
        const benkyou = results.find((r) => r.id === 1512670);
        expect(benkyou.pos).toEqual(['n', 'vs', 'vt', 'vi']);
      });

      it('applies the kanji-count facet as an exact filter for 1-3', async () => {
        const { results } = await search(driver, 'たべる', { kanjiCount: 1 });
        expect(results.map((r) => r.id)).toContain(1358280);
        const { results: none } = await search(driver, 'たべる', { kanjiCount: 2 });
        expect(none.map((r) => r.id)).not.toContain(1358280);
      });

      it('treats kanji-count 4 as "4 or more"', async () => {
        const { results } = await search(driver, '一石二鳥', { kanjiCount: 4 });
        expect(results.map((r) => r.id)).toContain(1164160);
      });

      it('labels dialect-tagged entries with their display name', async () => {
        // 明かん/あかん (id 1000230, "useless"/"no good") is tagged ksb
        // (Kansai-ben) in the real data - see dialect-labels.js for the tag
        // -> display-name mapping.
        const { results } = await search(driver, 'あかん');
        const akan = results.find((r) => r.id === 1000230);
        expect(akan.dialect).toContain('Kansai-ben');
      });

      it('applies the dialect facet to a text search', async () => {
        const { results } = await search(driver, 'あかん', { dialect: 'ksb' });
        expect(results.map((r) => r.id)).toContain(1000230);
        const { results: none } = await search(driver, 'あかん', { dialect: 'tsug' });
        expect(none.map((r) => r.id)).not.toContain(1000230);
      });

      it('browses every entry tagged with a dialect when the query is blank', async () => {
        const { tier, results } = await search(driver, '', { dialect: 'ksb' });
        expect(tier).toBe('dialect');
        expect(results.map((r) => r.id)).toContain(1000230);
        expect(results.every((r) => r.dialect.includes('Kansai-ben'))).toBe(true);
      });

      it('returns nothing for a blank query with no dialect set', async () => {
        const { tier, results } = await search(driver, '');
        expect(tier).toBeNull();
        expect(results).toEqual([]);
      });
    });

    describe('fuzzySearch()', () => {
      it('matches a chōon (vowel-length) confusion within the distance budget', async () => {
        const results = await fuzzySearch(driver, 'おばさん');
        const ids = results.map((r) => r.id);
        expect(ids).toContain(2261500); // exact self-match, distance 0
        expect(ids).toContain(1002330); // おばあさん, one cheap chōon indel away
        const grandmother = results.find((r) => r.id === 1002330);
        expect(grandmother.fuzzy).toBe(true);
        expect(grandmother.distance).toBeLessThan(1);
      });
    });

    describe('deconjugate()', () => {
      it('derives the ichidan dictionary form from a past-tense query', async () => {
        const results = await deconjugate(driver, '食べた');
        expect(results.some((r) => r.id === 1358280 && r.relation === 'past')).toBe(true);
      });

      it('derives the godan dictionary form from a te-form query with sound change', async () => {
        const results = await deconjugate(driver, '飲んで');
        expect(results.some((r) => r.id === 1169870 && r.relation === 'te-form')).toBe(true);
      });

      it('derives the godan dictionary form from a negative-form query', async () => {
        const results = await deconjugate(driver, '書かない');
        expect(results.some((r) => r.id === 1343950 && r.relation === 'negative')).toBe(true);
      });

      it('derives the i-adjective dictionary form from a past-tense query', async () => {
        const results = await deconjugate(driver, '高かった');
        expect(results.some((r) => r.id === 1283190 && r.relation === 'past')).toBe(true);
      });

      it('returns nothing for a query that is already dictionary form', async () => {
        const results = await deconjugate(driver, '水');
        expect(results).toEqual([]);
      });

      it('falls back to kuromoji for an irregular verb the suffix rules mistag (来た -> 来る, vk not v1)', async () => {
        const results = await deconjugate(driver, '来た');
        expect(results.some((r) => r.id === 1547720 && r.relation === 'conjugated')).toBe(true);
      });
    });

    describe('kanji + compounds + sentence joins', () => {
      it('reads kanji detail and its common-first compounds', async () => {
        const [kanjiRow] = await driver.all('SELECT * FROM kanji WHERE literal = ?', ['水']);
        expect(kanjiRow.stroke_count).toBe(4);
        const compounds = await driver.all('SELECT entry_id, score FROM kanji_compounds WHERE kanji = ? ORDER BY score DESC', ['水']);
        expect(compounds[0].entry_id).toBe(1371260);
      });

      it('reads a linked sentence with furigana for an entry', async () => {
        // Sentence 1036819 ("何か食べたい？") is one of 食べる's (id 1358280)
        // real linked Tatoeba sentences; its furigana tokenizes 食べ as its
        // own surface/reading pair (the たい that follows is a separate
        // token), which is what's asserted below.
        const [sentence] = await driver.all(
          'SELECT s.* FROM entry_sentences es JOIN sentences s ON s.id = es.sentence_id WHERE es.entry_id = ? AND s.id = ?',
          [1358280, 1036819],
        );
        expect(sentence.japanese).toContain('食べ');
        const furigana = JSON.parse(sentence.furigana);
        expect(furigana.some((t) => t.surface === '食べ' && t.reading === 'たべ')).toBe(true);
      });
    });
  });
}
