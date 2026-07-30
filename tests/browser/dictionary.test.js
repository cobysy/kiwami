import { defineCustomElements } from 'jeep-sqlite/loader';
import { describe, expect, it } from 'vitest';
import { createBrowserDriver, ensureDatabaseFromUrl } from '../../src/dictionary/sqlite-drivers/browser-sqlite-driver.js';
import { runDictionarySuite } from '../shared/run-dictionary-suite.js';

let jeepReady = null;
function ensureJeepSqliteElement() {
  jeepReady ??= (async () => {
    if (!customElements.get('jeep-sqlite')) {
      await defineCustomElements(window);
    }
    if (!document.querySelector('jeep-sqlite')) {
      document.body.appendChild(document.createElement('jeep-sqlite'));
    }
    await customElements.whenDefined('jeep-sqlite');
  })();
  return jeepReady;
}

runDictionarySuite('browser (jeep-sqlite)', async () => {
  await ensureJeepSqliteElement();
  // Fetched once and cached in IndexedDB by jeep-sqlite; ensureDatabaseFromUrl
  // no-ops on subsequent runs once it's present. .zst is the format the app
  // actually ships (see App.vue's DICTIONARY_FILE) - exercises
  // importZstdDatabase, not jeep-sqlite's built-in DEFLATE unzip.
  await ensureDatabaseFromUrl('dictionary', '/dictionary.db.zst');
  const driver = createBrowserDriver('dictionary', { readonly: true });
  await driver.open();
  return driver;
});

// Regression test for the app's reload button: it closes the (readonly)
// driver connection and then re-fetches with force:true, which needs to
// delete the existing IndexedDB copy — see ensureDatabaseFromUrl's jsdoc
// for why that delete needs its own RW connection.
describe('reload with force', () => {
  it('re-fetches after closing the readonly driver', async () => {
    await ensureJeepSqliteElement();
    await ensureDatabaseFromUrl('dictionary', '/dictionary.db.zst');
    const driver = createBrowserDriver('dictionary', { readonly: true });
    await driver.open();
    await driver.close();

    await expect(
      ensureDatabaseFromUrl('dictionary', '/dictionary.db.zst', { force: true })
    ).resolves.toBe('forced');

    const reopened = createBrowserDriver('dictionary', { readonly: true });
    await reopened.open();
    const rows = await reopened.all('SELECT COUNT(*) as n FROM entries');
    expect(rows[0].n).toBeGreaterThan(0);
    await reopened.close();
  });
});

// The deploy case: presence alone can't tell a current cached database from
// one imported two builds ago, so ensureDatabaseFromUrl compares the shipped
// manifest's sha256 against the fingerprint recorded at import time. Without
// this, every browser that visited an older build keeps querying its schema
// until someone hits reload by hand.
describe('stale cache detection', () => {
  const REAL_MANIFEST = '/dictionary.manifest.json';
  // Same shape, different bytes advertised - stands in for the next deploy.
  const OTHER_BUILD = `data:application/json,${encodeURIComponent(JSON.stringify({
    file: 'dictionary.db.zst', bytes: 1, sha256: 'dead'.repeat(16),
  }))}`;

  it('re-imports a drifted copy and leaves a current one alone', async () => {
    await ensureJeepSqliteElement();

    // Whatever ran before this left a database imported without a manifest, so
    // there's no fingerprint on record - the upgrade-from-an-older-build path,
    // which re-imports once to learn what it's holding.
    expect(await ensureDatabaseFromUrl('dictionary', '/dictionary.db.zst', { manifestUrl: REAL_MANIFEST })).toBe('drifted');
    // Fingerprinted now, and matching: no download.
    expect(await ensureDatabaseFromUrl('dictionary', '/dictionary.db.zst', { manifestUrl: REAL_MANIFEST })).toBe(null);
    // A build advertising other bytes.
    expect(await ensureDatabaseFromUrl('dictionary', '/dictionary.db.zst', { manifestUrl: OTHER_BUILD })).toBe('drifted');
    // A manifest that can't be fetched or parsed means "can't tell", which has
    // to keep the working copy rather than spend a 40MB re-download - this is
    // the offline case.
    expect(await ensureDatabaseFromUrl('dictionary', '/dictionary.db.zst', { manifestUrl: '/no-such-manifest.json' })).toBe(null);

    // Still queryable after all that, and back on the real fingerprint.
    expect(await ensureDatabaseFromUrl('dictionary', '/dictionary.db.zst', { manifestUrl: REAL_MANIFEST })).toBe('drifted');
    const driver = createBrowserDriver('dictionary', { readonly: true });
    await driver.open();
    const rows = await driver.all('SELECT COUNT(*) as n FROM entries');
    expect(rows[0].n).toBeGreaterThan(0);
    await driver.close();
  });
});
