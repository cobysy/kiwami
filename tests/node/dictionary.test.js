import { createNodeDriver } from '../../src/dictionary/sqlite-drivers/node-sqlite-driver.js';
import { runDictionarySuite } from '../shared/run-dictionary-suite.js';
import { ensureDictionaryDb } from '../../scripts/unzip-db.mjs';

runDictionarySuite('node (node:sqlite)', async () => {
  const dbFile = await ensureDictionaryDb();
  const driver = createNodeDriver(dbFile, { readonly: true });
  await driver.open();
  return driver;
});
