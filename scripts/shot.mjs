// Cinematic headless capture: positions the camera at a vantage point and
// renders one frame, so we can see the town (and terrain relief) from outside
// the normal first-person view. For development screenshots only.
//
// Usage: node scripts/shot.mjs [url] [outPng] [camX camY camZ lookX lookY lookZ]

import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://localhost:5199/';
const OUT = process.argv[3] || '/tmp/shot.png';
const nums = process.argv.slice(4).map(Number);
const [cx, cy, cz, lx, ly, lz] = nums.length === 6 ? nums : [260, 170, 320, 0, 5, 0];

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
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction('window.__game !== undefined', { timeout: 60000 });

await page.evaluate(
  ([campos, look]) => {
    const g = window.__game;
    document.getElementById('overlay')?.classList.add('hidden');
    g.camera.position.set(campos[0], campos[1], campos[2]);
    g.camera.lookAt(look[0], look[1], look[2]);
    g.renderer.render(g.scene, g.camera);
  },
  [
    [cx, cy, cz],
    [lx, ly, lz],
  ],
);

await new Promise((r) => setTimeout(r, 200));
await page.screenshot({ path: OUT });
await browser.close();
console.log(`shot written to ${OUT}`);
