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
    ).resolves.toBeUndefined();

    const reopened = createBrowserDriver('dictionary', { readonly: true });
    await reopened.open();
    const rows = await reopened.all('SELECT COUNT(*) as n FROM entries');
    expect(rows[0].n).toBeGreaterThan(0);
    await reopened.close();
  });
});
