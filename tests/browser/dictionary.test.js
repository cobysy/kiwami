import { defineCustomElements } from 'jeep-sqlite/loader';
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
  // no-ops on subsequent runs once it's present.
  await ensureDatabaseFromUrl('dictionary', '/dictionary.db');
  const driver = createBrowserDriver('dictionary', { readonly: true });
  await driver.open();
  return driver;
});
