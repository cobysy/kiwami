// npm run rasterize-svg -- <input.svg> <output.png> <size>
//
// Rasterizes an SVG to a PNG at an exact pixel size, preserving true alpha
// transparency. Used for the app-icon/favicon family (media/icon-*.svg,
// public/favicon.svg): icon-macos-1024.svg and favicon.svg are transparent
// outside their squircle, and that transparency has to survive rasterization
// unchanged, since favicon.ico and the macOS icon PNG are placed directly
// onto browser tabs / the dock without any further masking.
//
// Do NOT use `qlmanage -t` (macOS QuickLook thumbnails) for this: it silently
// composites transparent pixels onto opaque white, which is invisible in a
// flat preview but turns into a visible white box around the icon wherever
// it's actually used. Playwright's `page.screenshot({ omitBackground: true })`
// is what actually keeps alpha, so that's the one existing tool in this repo
// (already a devDependency via scripts/screenshot.mjs) able to do this
// correctly headlessly.
//
// Example: regenerate every favicon.ico source size after editing favicon.svg
//   npm run rasterize-svg -- public/favicon.svg /tmp/favicon-32.png 32

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const [, , svgPath, outPath, sizeArg] = process.argv;
if (!svgPath || !outPath || !sizeArg) {
  console.error('Usage: npm run rasterize-svg -- <input.svg> <output.png> <size>');
  process.exit(1);
}
const size = parseInt(sizeArg, 10);
const svg = readFileSync(svgPath, 'utf8');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(`
    <html><body style="margin:0;padding:0;background:transparent;">
      <div style="width:${size}px;height:${size}px;">${svg}</div>
    </body></html>
  `);
  await page.locator('svg').first().evaluate((el, s) => {
    el.setAttribute('width', s);
    el.setAttribute('height', s);
  }, size);
  await page.screenshot({ path: outPath, omitBackground: true });
  console.log(`Saved ${outPath} @ ${size}px`);
} finally {
  await browser.close();
}
