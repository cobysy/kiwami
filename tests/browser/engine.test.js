import { defineCustomElements } from 'jeep-sqlite/loader';
import { createBrowserDriver } from '../../src/db/drivers/browser-driver.js';
import { runEngineSuite } from '../shared/run-engine-suite.js';

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

let dbCounter = 0;

runEngineSuite('browser (jeep-sqlite)', async () => {
  await ensureJeepSqliteElement();
  dbCounter += 1;
  // Unique name per test run avoids colliding with IndexedDB state a
  // previous run left behind — this is a throwaway dev-test database, not
  // something that needs cleanup/reuse logic.
  return createBrowserDriver(`kiwami-test-${Date.now()}-${dbCounter}`);
});
