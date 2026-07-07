// Headless smoke test: build must render the town without runtime errors.
// The three.js layer has no unit tests by design, so this is its safety net.
// Requires Google Chrome and puppeteer-core (installed on demand, not a dep).
//
// Usage: node scripts/smoke.mjs [url] [outPng]

import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || 'docs/preview.png';

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const ARGS = [
  '--no-sandbox',
  '--ignore-gpu-blocklist',
  '--enable-webgl',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--window-size=1600,900',
];

const browser = await puppeteer.launch({ executablePath: CHROME, args: ARGS });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });

// Wait for the world build to finish (main.js stores the projector when ready).
await page
  .waitForFunction('window.__proj !== undefined', { timeout: 60000 })
  .catch(() => errors.push('world did not finish building (window.__proj never set)'));

const info = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const btn = document.getElementById('start');
  return {
    hasCanvas: !!c,
    canvasW: c ? c.width : 0,
    canvasH: c ? c.height : 0,
    startLabel: btn ? btn.textContent : null,
    hud: document.getElementById('hud-count')?.textContent || '',
  };
});

await page.screenshot({ path: OUT });
await browser.close();

console.log('smoke result:', JSON.stringify(info, null, 2));
if (errors.length) {
  console.error('runtime errors:\n' + errors.join('\n'));
  process.exit(1);
}
if (!info.hasCanvas || info.canvasW < 100) {
  console.error('no canvas rendered');
  process.exit(1);
}
console.log(`OK — screenshot written to ${OUT}`);
