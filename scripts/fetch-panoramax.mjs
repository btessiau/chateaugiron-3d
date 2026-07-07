// Fetches real street-level photo positions of Châteaugiron from Panoramax
// (federated open street imagery) and writes a compact index the app uses to
// show the nearest actual photo of where the player stands. Only positions and
// remote image URLs are stored, so the repo stays small and images load from
// the Panoramax CDN at runtime.
//
// Imagery © Panoramax contributors, licensed under CC BY-SA 4.0.
// Usage: node scripts/fetch-panoramax.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CENTER = { lat: 48.0489, lon: -1.5019 };
const BBOX = '-1.512,48.043,-1.492,48.057'; // minLon,minLat,maxLon,maxLat
const BASE = 'https://api.panoramax.xyz/api';

async function run() {
  console.log(`Fetching Châteaugiron street photos from Panoramax — bbox ${BBOX}`);
  let url = `${BASE}/search?bbox=${BBOX}&limit=1000`;
  const features = [];
  let guard = 0;
  while (url && guard < 20) {
    const res = await fetch(url, { headers: { Accept: 'application/geo+json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const data = await res.json();
    for (const f of data.features || []) features.push(f);
    const next = (data.links || []).find((l) => l.rel === 'next');
    url = next ? next.href : null;
    guard++;
  }

  const photos = features
    .filter((f) => f.assets && f.assets.sd && f.geometry)
    .map((f) => ({
      id: f.id,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      az: Math.round(f.properties['view:azimuth'] ?? 0),
      sd: f.assets.sd.href,
      hd: f.assets.hd ? f.assets.hd.href : f.assets.sd.href,
      by: f.properties.exif?.['Exif.Image.Artist'] || 'Panoramax contributor',
      at: (f.properties.datetime || '').slice(0, 10),
    }));

  const payload = {
    meta: {
      source: 'Panoramax (panoramax.openstreetmap.fr) via api.panoramax.xyz',
      license: 'CC BY-SA 4.0 — © Panoramax contributors',
      center: CENTER,
      bbox: BBOX,
      generated: new Date().toISOString(),
      count: photos.length,
    },
    photos,
  };

  const outPath = resolve(__dirname, '../public/data/panoramax.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload));
  console.log(`\nWrote ${outPath} — ${photos.length} street photos`);
}

run().catch((err) => {
  console.error('\nFetch failed:', err.message);
  process.exit(1);
});
