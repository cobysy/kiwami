import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeDriver } from '../../src/db/drivers/node-driver.js';
import { runDictionarySuite } from '../shared/run-dictionary-suite.js';

const DB_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../public/dictionary.db');

runDictionarySuite('node (node:sqlite)', async () => {
  const driver = createNodeDriver(DB_FILE, { readonly: true });
  await driver.open();
  return driver;
});
