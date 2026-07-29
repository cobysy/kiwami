// npm run screenshot
//
// Launches a Vite dev server against the real public/dictionary.db, drives
// the app in headless Chromium (Playwright, already a devDependency for
// tests/browser), and searches "した" — simultaneously a real headword (下,
// "below") and the past tense of する ("to do") — to demonstrate
// deconjugation and the result list's tags/reading/gloss rendering in the
// same screenshot. Also expands the first result card so the Tatoeba
// example-sentence panel (with furigana) is visible too. Saves the capture
// to docs/screenshot.png for README.md.
//
// Requires public/dictionary.db to exist first (npm run build:db).

import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'public/dictionary.db');
const OUT_DIR = path.join(ROOT, 'docs');
const OUT_PATH = path.join(OUT_DIR, 'screenshot.png');

if (!existsSync(DB_PATH)) {
  console.error('public/dictionary.db not found — run "npm run build:db" first.');
  process.exit(1);
}

const server = await createServer({ root: ROOT });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch();
try {
  // iPhone-width viewport to match the app's mobile-first design (see
  // "Redesign App.vue with a dark, mobile-friendly UI"). deviceScaleFactor 2
  // captures at retina resolution so the PNG isn't soft when viewed in the
  // README.
  const page = await browser.newPage({
    viewport: { width: 430, height: 1900 },
    deviceScaleFactor: 2,
  });
  await page.goto(url);
  await page.waitForSelector('.status-row.ready', { timeout: 30000 });

  await page.fill('.search-box input', 'した');
  await page.click('.search-btn');
  await page.waitForSelector('.deconj-card');
  await page.waitForSelector('.result-card');

  await page.click('.result-row');
  await page.waitForSelector('.sentence-list, .sentence-status');

  mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: OUT_PATH });
  console.log(`Saved screenshot -> ${path.relative(process.cwd(), OUT_PATH)}`);
} finally {
  await browser.close();
  await server.close();
}
