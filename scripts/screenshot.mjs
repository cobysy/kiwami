// npm run screenshot
//
// Launches a Vite dev server against the real public/dictionary.db.zst, drives
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
// Then captures a second shot, media/screenshot-fuzzy.png: the
// fuzzy-match view for "じゅびん", a plausible mishearing that matches nothing
// exactly, reached the way a user reaches it (the "Didn't find it? Try fuzzy
// search →" link under an empty result set) rather than via ?fuzzy=1. Shows
// the phonetically-close matches it surfaces instead — 尿瓶・しゅびん,
// 需品・じゅひん, 次便・じびん — each with its weighted edit distance (Δ).
//
// Requires public/dictionary.db.zst to exist first (npm run build:db) - the
// file App.vue's loadRealDictionary actually fetches (see that file and
// browser-sqlite-driver.js's ensureDatabaseFromUrl for the .zst/.zip switch).

import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'public/dictionary.db.zst');
const OUT_DIR = path.join(ROOT, 'media');
const OUT_PATH = path.join(OUT_DIR, 'screenshot.png');
const FUZZY_OUT_PATH = path.join(OUT_DIR, 'screenshot-fuzzy.png');
const WIDTH = 430;

// The viewport is taller than either shot's content needs (the app's
// min-height:100vh leaves a trailing blank area below the last section on the
// page), so clip the capture to the actual content height instead of
// screenshotting the full viewport.
//
// boundingBox() and the clip are both viewport-relative, so anything that
// scrolled the page would silently shift the capture: both flows below click
// something that scrolls its target into view in the app (revealArchaic and
// runFuzzy in App.vue), a no-op at this viewport height today but not if the
// result sets grow.
async function captureTo(page, bottomSelector, outPath) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const contentBottom = await page.locator(bottomSelector).boundingBox().then((box) => box.y + box.height);
  mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: WIDTH, height: contentBottom + 24 } });
  console.log(`Saved screenshot -> ${path.relative(process.cwd(), outPath)}`);
}

if (!existsSync(DB_PATH)) {
  console.error('public/dictionary.db.zst not found — run "npm run build:db" first.');
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
    viewport: { width: WIDTH, height: 2200 },
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

  // The archaic block is the last section on the page in this flow.
  await captureTo(page, '.archaic-block', OUT_PATH);

  // Second shot: the fuzzy-match view. Navigating back to the bare URL (rather
  // than opening a second page) resets App.vue's state - the expanded 長ける
  // card, the archaic switch - while keeping the cached database in this
  // context's IndexedDB, so the app is ready again without re-downloading it.
  // It has to be the bare URL and not a reload: the first shot's search synced
  // itself into the query string (syncUrl in App.vue), and reloading that would
  // race this flow's search against the restore of たける.
  await page.goto(url);
  await page.waitForSelector('.status-row.ready', { timeout: 30000 });

  await page.fill('.search-box input', 'じゅびん');
  await page.click('.search-btn');
  // Matching nothing is the premise of the shot, so assert the ordinary search
  // really did come up empty rather than capturing a fuzzy view nobody would
  // have had a reason to open.
  await page.waitForSelector('.results-meta');
  const count = await page.locator('.results-count').innerText();
  if (!count.startsWith('0 ')) throw new Error(`Expected "じゅびん" to match nothing exactly, got ${count} - the dictionary data or query layer changed.`);
  await page.click('.fuzzy-link');
  await page.waitForSelector('.fuzzy-section .result-card');

  await captureTo(page, '.fuzzy-section', FUZZY_OUT_PATH);
} finally {
  await browser.close();
  await server.close();
}
