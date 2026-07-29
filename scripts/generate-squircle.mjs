// npm run generate-squircle -- [--canvas 1024] [--content 1024] [--n 5] [--step 1]
//
// Prints an SVG <polygon> `points` attribute tracing a true superellipse
// ("squircle") — the actual curve iOS/macOS app icons use for their rounded
// corners, not a circular-arc rounded-rect approximation. Used to build the
// clipPath/shape in media/icon-ios-1024.svg, media/icon-macos-1024.svg, and
// public/favicon.svg (which is a byte-for-byte copy of icon-macos-1024.svg —
// see that file's history for why hand-approximating this per-file drifted
// out of sync and looked wrong).
//
// --canvas is the full SVG viewBox size (square). --content is the size of
// the squircle itself, centered in the canvas — for iOS icons that's the
// same as --canvas (full bleed, OS applies its own mask); for macOS icons
// Apple's Big Sur template insets it to ~80.5% of the canvas (e.g. 824 in a
// 1024 canvas) so you can draw your own drop shadow around it. --n is the
// superellipse exponent (5 is the standard "squircle" value). --step is the
// angular sampling step in degrees (lower = smoother curve, more points).
//
// Example: the exact command that produced icon-macos-1024.svg's polygon
//   npm run generate-squircle -- --canvas 1024 --content 824 --n 5 --step 1

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : parseFloat(process.argv[i + 1]);
}

const canvas = arg('canvas', 1024);
const content = arg('content', canvas);
const n = arg('n', 5);
const step = arg('step', 1);

const a = content / 2;
const cx = canvas / 2;
const cy = canvas / 2;

const pts = [];
for (let deg = 0; deg < 360; deg += step) {
  const t = (deg * Math.PI) / 180;
  const ct = Math.cos(t);
  const st = Math.sin(t);
  const x = cx + a * Math.sign(ct) * Math.abs(ct) ** (2 / n);
  const y = cy + a * Math.sign(st) * Math.abs(st) ** (2 / n);
  pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
}

console.log(pts.join(' '));
