import { createNodeDriver } from '../../src/db/drivers/node-driver.js';
import { runDictionarySuite } from '../shared/run-dictionary-suite.js';

runDictionarySuite('node (node:sqlite)', async () => createNodeDriver(':memory:'));
