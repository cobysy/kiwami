// npm run screenshot
//
// Captures the README's screenshots: one tight crop per feature rather than
// one full-page dump of the whole app. A 1600px-tall shot of every panel at
// once shows everything and explains nothing - the README pairs each of these
// crops with a sentence about the one thing it shows, so each shot has to be
// cropped to that one thing.
//
// Drives the real app (Vite dev server against the real
// public/dictionary.db.zst, headless Chromium via Playwright - already a
// devDependency for tests/browser) through three flows and crops regions out
// of each:
//
//   たける   - a query that is simultaneously the potential form of 炊く/焚く
//              and the reading of an archaic headword (梟帥・建, an ancient
//              title for "leader of a powerful tribe", as in Yamato Takeru),
//              so one search demonstrates the search bar, deconjugation, an
//              expanded entry (kanji + conjugation + examples) and the
//              archaic block.
//   食*      - wildcard search, with the kanji-count filter set to 2, for the
//              filter panel and the wildcard result list.
//   しずもん - a plausible mishearing of しつもん (質問, "question") that
//              matches nothing exactly, for the fuzzy view. Reached the way a
//              user reaches it (the "Didn't find it? Try fuzzy search →" link
//              under an empty result set) rather than via ?fuzzy=1.
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
// iPhone-width viewport to match the app's mobile-first design (see "Redesign
// App.vue with a dark, mobile-friendly UI"). Every crop keeps the full width,
// so the shots stack in the README as consistent phone-width slices.
const WIDTH = 430;
// Tall enough that any region below is fully on screen after capture() scrolls
// its top edge to the top of the viewport.
const HEIGHT = 1600;

if (!existsSync(DB_PATH)) {
  console.error('public/dictionary.db.zst not found — run "npm run build:db" first.');
  process.exit(1);
}

const server = await createServer({ root: ROOT });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch();
try {
  // deviceScaleFactor 2 captures at retina resolution so the PNGs aren't soft
  // when the README scales them down.
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
  });

  // The topbar is position:sticky, so anything scrolled under it is covered by
  // it - a crop that starts at the top of the viewport would have the brand
  // bar pasted over its first rows. Leave the bar's height of slack above every
  // region and the region lands below it, uncovered.
  const stickyHeight = () => page.locator('.topbar').evaluate((el) => el.getBoundingClientRect().height);

  /**
   * Crops the page from the top edge of `top` to the bottom edge of `bottom`
   * (same element when omitted) and writes it to media/<name>.png.
   *
   * boundingBox() and screenshot()'s clip are both viewport-relative, so a
   * region below the fold would otherwise be captured as whatever happens to
   * be on screen. Scroll it into place first, then measure - never the other
   * way round. The two pads are separate because they trade off against
   * different things: breathing room versus a sliver of the neighbouring card
   * bleeding into the shot.
   */
  async function capture(name, top, bottom = top, { padTop = 14, padBottom = 14 } = {}) {
    const documentTop = await top.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, documentTop - padTop - (await stickyHeight())));
    const topBox = await top.boundingBox();
    const bottomBox = await bottom.boundingBox();
    const y = Math.max(0, topBox.y - padTop);
    const cropBottom = bottomBox.y + bottomBox.height + padBottom;
    // A region taller than the viewport would be silently truncated into a
    // shot that looks fine and is missing its last panel - fail instead.
    if (cropBottom > HEIGHT) throw new Error(`${name}: region is ${Math.ceil(cropBottom - y)}px tall, taller than the ${HEIGHT}px viewport — raise HEIGHT or crop less.`);
    const outPath = path.join(OUT_DIR, `${name}.png`);
    mkdirSync(OUT_DIR, { recursive: true });
    await page.screenshot({ path: outPath, clip: { x: 0, y, width: WIDTH, height: cropBottom - y } });
    console.log(`Saved ${path.relative(process.cwd(), outPath)}`);
  }

  // The main result list is the first .result-list on the page; the archaic
  // block's and the fuzzy view's lists come after it.
  const resultCards = page.locator('.result-list').first().locator('.result-card');

  // --- たける: search bar, deconjugation, entry detail, archaic block -------
  await page.goto(url);
  await page.waitForSelector('.status-row.ready', { timeout: 30000 });

  await page.fill('.search-box input', 'たける');
  await page.click('.search-btn');
  await page.waitForSelector('.deconj-card');
  await page.waitForSelector('.result-card');

  // The app's identity: brand, "Ready" (the database is local, so readiness is
  // a real state), the query, and the wildcard tip.
  await capture('shot-search', page.locator('.topbar'), page.locator('.hint'), { padTop: 0 });

  // Deconjugation, immediately above the results it explains.
  await capture('shot-deconjugate', page.locator('.deconj-card'), resultCards.nth(1), { padBottom: 4 });

  // 長ける (v1, "to excel at") - a verb result with a Tatoeba example
  // sentence, so its Conjugate button is present alongside the kanji
  // breakdown and examples, and the whole expanded card fits one crop.
  const headwords = await page.locator('.result-headword').allInnerTexts();
  const index = headwords.findIndex((h) => h.trim() === '長ける、闌ける');
  if (index === -1) throw new Error('Expected 長ける among the たける results - result set or ranking changed.');
  const detailCard = resultCards.nth(index);
  await detailCard.locator('.result-row').click();
  await page.waitForSelector('.detail-panel');
  await page.waitForSelector('.kanji-list, .detail-status');
  await page.click('.conjugate-btn');
  await page.waitForSelector('.conjugation-list');
  await page.waitForSelector('.sentence-list, .sentence-status');
  // Tight to the card: the cards in a result list sit flush against each other,
  // so any padding here is a slice of the neighbouring entry.
  await capture('shot-detail', detailCard, detailCard, { padTop: 3, padBottom: 3 });

  // The archaic/obsolete/rare block (梟帥・建), hidden behind its own switch
  // and kept out of the main ranking rather than dropped from the index.
  await page.click('.switch-row input[type="checkbox"]');
  await page.waitForSelector('.archaic-block');
  await capture('shot-archaic', page.locator('.archaic-block'));

  // --- 食*: filter panel and wildcard results ------------------------------
  // Navigating back to the bare URL (rather than opening a second page) resets
  // App.vue's state - the expanded card, the archaic switch - while keeping the
  // cached database in this context's IndexedDB, so the app is ready again
  // without re-downloading it. It has to be the bare URL and not a reload: the
  // previous search synced itself into the query string (syncUrl in App.vue),
  // and reloading that would race this flow's search against the restore.
  await page.goto(url);
  await page.waitForSelector('.status-row.ready', { timeout: 30000 });

  await page.fill('.search-box input', '食*');
  await page.click('.search-btn');
  await page.waitForSelector('.result-card');
  // Kanji count 2, so the filter shot shows a filter actually engaged and the
  // result shot below it is the matching two-kanji list.
  await page.locator('.filter-group', { hasText: 'Kanji count' }).locator('.segment', { hasText: /^2$/ }).click();
  await page.waitForSelector('.tier-wildcard');
  await capture('shot-filters', page.locator('.filters'));
  await capture('shot-wildcard', page.locator('.results-meta'), resultCards.nth(2), { padBottom: 4 });

  // --- しずもん: fuzzy matches ---------------------------------------------
  await page.goto(url);
  await page.waitForSelector('.status-row.ready', { timeout: 30000 });

  await page.fill('.search-box input', 'しずもん');
  await page.click('.search-btn');
  // Matching nothing is the premise of the shot, so assert the ordinary search
  // really did come up empty rather than capturing a fuzzy view nobody would
  // have had a reason to open.
  await page.waitForSelector('.results-meta');
  const count = await page.locator('.results-count').innerText();
  if (!count.startsWith('0 ')) throw new Error(`Expected "しずもん" to match nothing exactly, got ${count} - the dictionary data or query layer changed.`);
  await page.click('.fuzzy-link');
  await page.waitForSelector('.fuzzy-section .result-card');
  // 質問 is the point of the shot: assert it ranked first rather than shipping
  // a crop that has quietly stopped demonstrating anything.
  const topFuzzy = await page.locator('.fuzzy-section .result-headword').first().innerText();
  if (topFuzzy.trim() !== '質問') throw new Error(`Expected 質問 as the top fuzzy match for しずもん, got ${topFuzzy} - the fuzzy ranking or dictionary data changed.`);
  await capture(
    'shot-fuzzy',
    page.locator('.fuzzy-heading'),
    page.locator('.fuzzy-section .result-card').nth(2),
    { padBottom: 4 },
  );
} finally {
  await browser.close();
  await server.close();
}
