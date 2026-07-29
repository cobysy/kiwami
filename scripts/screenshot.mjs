// npm run screenshot
//
// Launches a Vite dev server against the real public/dictionary.db.zip, drives
// the app in headless Chromium (Playwright, already a devDependency for
// tests/browser), and searches "した" — simultaneously a real headword (下,
// "below") and the past tense of する ("to do") — to demonstrate
// deconjugation and the result list's tags/reading/gloss rendering in the
// same screenshot. Also expands the 親しむ result (a v5m verb) and opens its
// Conjugate panel, so the kanji breakdown (stroke count + on'yomi/kun'yomi),
// the conjugation panel, and the Tatoeba example-sentence panel (with
// furigana) are all visible in one shot. Saves the capture to
// docs/screenshot.png for README.md.
//
// Requires public/dictionary.db.zip to exist first (npm run build:db).

import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'public/dictionary.db.zip');
const OUT_DIR = path.join(ROOT, 'docs');
const OUT_PATH = path.join(OUT_DIR, 'screenshot.png');

if (!existsSync(DB_PATH)) {
  console.error('public/dictionary.db.zip not found — run "npm run build:db" first.');
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
    viewport: { width: 430, height: 2200 },
    deviceScaleFactor: 2,
  });
  await page.goto(url);
  await page.waitForSelector('.status-row.ready', { timeout: 30000 });

  await page.fill('.search-box input', 'した');
  await page.click('.search-btn');
  await page.waitForSelector('.deconj-card');
  await page.waitForSelector('.result-card');

  // 親しむ (v5m, "to be intimate with") - a verb result, so its Conjugate
  // button is present alongside the kanji breakdown and examples.
  const headwords = await page.locator('.result-headword').allInnerTexts();
  const index = headwords.findIndex((h) => h.trim() === '親しむ');
  if (index === -1) throw new Error('Expected 親しむ among the した results - result set or ranking changed.');
  await page.locator('.result-card').nth(index).locator('.result-row').click();
  await page.waitForSelector('.detail-panel');
  await page.waitForSelector('.kanji-list, .detail-status');
  await page.click('.conjugate-btn');
  await page.waitForSelector('.conjugation-list');
  await page.waitForSelector('.sentence-list, .sentence-status');

  mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: OUT_PATH });
  console.log(`Saved screenshot -> ${path.relative(process.cwd(), OUT_PATH)}`);
} finally {
  await browser.close();
  await server.close();
}
