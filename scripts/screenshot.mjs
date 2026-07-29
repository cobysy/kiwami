// npm run screenshot
//
// Launches a Vite dev server against the real public/dictionary.db.zip, drives
// the app in headless Chromium (Playwright, already a devDependency for
// tests/browser), and searches "たける" — simultaneously the potential form
// of 炊く/焚く ("to cook"/"to light a fire") and the reading of an archaic
// headword (梟帥・建, an ancient title for "leader of a powerful tribe" —
// as in the legendary hero name Yamato Takeru) — to demonstrate both
// deconjugation and the archaic/obsolete/rare block in the same screenshot.
// Also expands the 長ける result (a v1 verb, "to excel at") and opens its
// Conjugate panel, so the kanji breakdown (stroke count + on'yomi/kun'yomi),
// the conjugation panel, and the Tatoeba example-sentence panel (with
// furigana) are all visible in one shot. Saves the capture to
// media/screenshot.png for README.md.
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
const OUT_DIR = path.join(ROOT, 'media');
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

  await page.fill('.search-box input', 'たける');
  await page.click('.search-btn');
  await page.waitForSelector('.deconj-card');
  await page.waitForSelector('.result-card');

  // Reveal the archaic/obsolete/rare block (梟帥・建) below the main results,
  // alongside the deconjugation card above them.
  await page.click('.switch-row input[type="checkbox"]');
  await page.waitForSelector('.archaic-block');

  // 長ける (v1, "to excel at") - a verb result with a Tatoeba example
  // sentence, so its Conjugate button is present alongside the kanji
  // breakdown and examples.
  const headwords = await page.locator('.result-headword').allInnerTexts();
  const index = headwords.findIndex((h) => h.trim() === '長ける、闌ける');
  if (index === -1) throw new Error('Expected 長ける among the たける results - result set or ranking changed.');
  await page.locator('.result-card').nth(index).locator('.result-row').click();
  await page.waitForSelector('.detail-panel');
  await page.waitForSelector('.kanji-list, .detail-status');
  await page.click('.conjugate-btn');
  await page.waitForSelector('.conjugation-list');
  await page.waitForSelector('.sentence-list, .sentence-status');

  // The viewport is taller than the content needs (the app's min-height:100vh
  // leaves a trailing blank area below the archaic block, the last section on
  // the page), so clip the capture to the actual content height instead of
  // screenshotting the full viewport.
  const contentBottom = await page.locator('.archaic-block').boundingBox().then((box) => box.y + box.height);

  mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: OUT_PATH, clip: { x: 0, y: 0, width: 430, height: contentBottom + 24 } });
  console.log(`Saved screenshot -> ${path.relative(process.cwd(), OUT_PATH)}`);
} finally {
  await browser.close();
  await server.close();
}
