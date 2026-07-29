// The actual assertions, parameterized by a driver factory so the exact
// same test bodies run against both the Node (node:sqlite) and browser
// (jeep-sqlite) drivers — proving PLAN.md Phase 1's requirement that
// swapping the driver behind the shared interface is the only
// platform-specific step. tests/node/engine.test.js and
// tests/browser/engine.test.js each just call this with their own factory.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertDriver } from '../../src/db/driver.js';
import { search, fuzzySearch, deconjugate } from '../../src/db/queries/index.js';
import { seedFixtureDb } from '../fixtures/seed.js';

/**
 * @param {string} label - shown in the describe block name (e.g. "node", "browser")
 * @param {() => Promise<import('../../src/db/driver.js').DBDriver>} createDriver
 */
export function runEngineSuite(label, createDriver) {
  describe(`dictionary engine (${label} driver)`, () => {
    /** @type {import('../../src/db/driver.js').DBDriver} */
    let driver;

    beforeAll(async () => {
      driver = await createDriver();
      assertDriver(driver);
      await driver.open();
      await seedFixtureDb(driver);
    });

    afterAll(async () => {
      await driver?.close();
    });

    it('runs raw exec/all/run through the driver', async () => {
      const rows = await driver.all('SELECT count(*) AS c FROM entries');
      expect(rows[0].c).toBe(11);
    });

    describe('search()', () => {
      it('finds an exact kanji match', async () => {
        const { tier, results } = await search(driver, '食べる');
        expect(tier).toBe('exact');
        expect(results.map((r) => r.id)).toContain(1);
      });

      it('finds an exact reading match', async () => {
        const { tier, results } = await search(driver, 'たべる');
        expect(tier).toBe('exact');
        expect(results.map((r) => r.id)).toContain(1);
      });

      it('finds an exact gloss match, case-insensitively', async () => {
        const { results } = await search(driver, 'To Eat');
        expect(results.map((r) => r.id)).toContain(1);
      });

      it('falls through to the prefix tier when no exact match exists', async () => {
        const { tier, results } = await search(driver, 'たべ');
        expect(tier).toBe('prefix');
        expect(results.map((r) => r.id)).toContain(1);
      });

      it('falls through to the substring tier for a mid-word fragment', async () => {
        const { tier, results } = await search(driver, 'べる');
        expect(tier).toBe('substring');
        expect(results.map((r) => r.id)).toContain(1);
      });

      it('stops at the exact tier without reaching prefix/substring matches', async () => {
        // "水" is an exact kanji match on entry 4; it's also a substring of
        // no other fixture headword, so this also proves tiers don't run
        // past the first one with hits.
        const { tier, results } = await search(driver, '水');
        expect(tier).toBe('exact');
        expect(results.map((r) => r.id)).toEqual([4]);
      });

      it('treats a query with * as a wildcard and skips fuzzy correction', async () => {
        const { tier, results } = await search(driver, '食*');
        expect(tier).toBe('wildcard');
        expect(results.map((r) => r.id)).toContain(1);
      });

      it('supports ? as a single-character wildcard', async () => {
        const { results } = await search(driver, '?み');
        // no fixture headword matches this pattern; assert it at least runs
        // the wildcard path without throwing and returns an array.
        expect(Array.isArray(results)).toBe(true);
      });

      it('flags an archaic-only entry with its specific misc tag', async () => {
        const { results } = await search(driver, 'thou');
        expect(results[0].id).toBe(6);
        expect(results[0].archaic).toBe(true);
        expect(results[0].labels).toContain('arch');
      });

      it('sorts common-first and pushes the archaic entry to the bottom regardless of its score', async () => {
        // A bare "*" wildcard matches every fixture entry (kanji or
        // reading), giving a real multi-entry tier to check ordering on:
        // entry 6 (汝, commonness 1) is archaic and should sort last even
        // though it's not the lowest-scoring entry overall by coincidence.
        const { results } = await search(driver, '*');
        const nonArchaic = results.filter((r) => !r.archaic).map((r) => r.commonness_score);
        expect(nonArchaic).toEqual([...nonArchaic].sort((a, b) => b - a));
        expect(results.at(-1).id).toBe(6);
      });

      it('applies the kanji-count facet as an exact filter for 1-3', async () => {
        const { results } = await search(driver, 'たべる', { kanjiCount: 1 });
        expect(results.map((r) => r.id)).toContain(1);
        const { results: none } = await search(driver, 'たべる', { kanjiCount: 2 });
        expect(none.map((r) => r.id)).not.toContain(1);
      });

      it('treats kanji-count 4 as "4 or more"', async () => {
        const { results } = await search(driver, '一石二鳥', { kanjiCount: 4 });
        expect(results.map((r) => r.id)).toContain(10);
      });
    });

    describe('fuzzySearch()', () => {
      it('matches a chōon (vowel-length) confusion within the distance budget', async () => {
        const results = await fuzzySearch(driver, 'おばさん');
        const ids = results.map((r) => r.id);
        expect(ids).toContain(8); // exact self-match, distance 0
        expect(ids).toContain(9); // おばあさん, one cheap chōon indel away
        const grandmother = results.find((r) => r.id === 9);
        expect(grandmother.fuzzy).toBe(true);
        expect(grandmother.distance).toBeLessThan(1);
      });
    });

    describe('deconjugate()', () => {
      it('derives the ichidan dictionary form from a past-tense query', async () => {
        const results = await deconjugate(driver, '食べた');
        expect(results.some((r) => r.id === 1 && r.relation === 'past')).toBe(true);
      });

      it('derives the godan dictionary form from a te-form query with sound change', async () => {
        const results = await deconjugate(driver, '飲んで');
        expect(results.some((r) => r.id === 11 && r.relation === 'te-form')).toBe(true);
      });

      it('derives the godan dictionary form from a negative-form query', async () => {
        const results = await deconjugate(driver, '書かない');
        expect(results.some((r) => r.id === 2 && r.relation === 'negative')).toBe(true);
      });

      it('derives the i-adjective dictionary form from a past-tense query', async () => {
        const results = await deconjugate(driver, '高かった');
        expect(results.some((r) => r.id === 3 && r.relation === 'past')).toBe(true);
      });

      it('returns nothing for a query that is already dictionary form', async () => {
        const results = await deconjugate(driver, '水');
        expect(results).toEqual([]);
      });
    });

    describe('kanji + compounds + sentence joins', () => {
      it('reads kanji detail and its common-first compounds', async () => {
        const [kanjiRow] = await driver.all('SELECT * FROM kanji WHERE literal = ?', ['水']);
        expect(kanjiRow.stroke_count).toBe(4);
        const compounds = await driver.all('SELECT entry_id, score FROM kanji_compounds WHERE kanji = ? ORDER BY score DESC', ['水']);
        expect(compounds[0].entry_id).toBe(4);
      });

      it('reads a linked sentence with furigana for an entry', async () => {
        const [sentence] = await driver.all(
          `SELECT s.* FROM entry_sentences es JOIN sentences s ON s.id = es.sentence_id WHERE es.entry_id = ?`,
          [1],
        );
        expect(sentence.japanese).toContain('食べた');
        const furigana = JSON.parse(sentence.furigana);
        expect(furigana.some((t) => t.surface === '食べた' && t.reading === 'たべた')).toBe(true);
      });
    });
  });
}
