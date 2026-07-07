// Fetches a real aerial orthophoto for Chateaugiron from the IGN Geoplateforme
// WMS (HR.ORTHOIMAGERY.ORTHOPHOTOS, French open data, no API key) and saves it
// as the ground texture. The image covers exactly the terrain grid extent, so
// it maps 1:1 onto the world.
//
// Usage: node scripts/fetch-ortho.mjs [sizeMeters] [pixels] [outName]

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeProjector, metresToLatLon } from '../src/lib/geo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CENTER = { lat: 48.0489, lon: -1.5019 };
const SIZE = Number(process.argv[2] || 3400); // must match the terrain grid
const PX = Number(process.argv[3] || 4000); // <= 5010 (WMS limit)
const OUT = process.argv[4] || 'ortho.jpg';

const proj = makeProjector(CENTER);
const half = SIZE / 2;
const sw = metresToLatLon(proj, -half, -half);
const ne = metresToLatLon(proj, half, half);

// WMS 1.3.0 with EPSG:4326 expects BBOX as latMin,lonMin,latMax,lonMax.
const bbox = `${sw.lat},${sw.lon},${ne.lat},${ne.lon}`;
const url =
  'https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
  '&LAYERS=HR.ORTHOIMAGERY.ORTHOPHOTOS&STYLES=&CRS=EPSG:4326' +
  `&BBOX=${bbox}&WIDTH=${PX}&HEIGHT=${PX}&FORMAT=image/jpeg`;

async function run() {
  console.log(`Fetching IGN ortho ${PX}x${PX} for ${SIZE} m around ${CENTER.lat},${CENTER.lon}`);
  console.log(`bbox (lat,lon): ${bbox}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IGN WMS HTTP ${res.status}: ${await res.text()}`);
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image')) {
    throw new Error(`Expected an image, got ${type}: ${(await res.text()).slice(0, 300)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const outPath = resolve(__dirname, `../public/textures/${OUT}`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);
  console.log(`\nWrote ${outPath} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
}

run().catch((err) => {
  console.error('\nOrtho fetch failed:', err.message);
  process.exit(1);
});
