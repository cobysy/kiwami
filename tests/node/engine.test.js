import { createNodeDriver } from '../../src/db/drivers/node-driver.js';
import { runEngineSuite } from '../shared/run-engine-suite.js';

runEngineSuite('node (node:sqlite)', async () => createNodeDriver(':memory:'));
