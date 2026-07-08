// Fetches real map data for Châteaugiron from the OpenStreetMap Overpass API
// and writes a trimmed JSON the web app loads at runtime.
//
// Data © OpenStreetMap contributors, licensed under the ODbL.
// Usage: node scripts/fetch-osm.mjs [radiusMeters]
//
// Node 18+ has a global fetch, so there are no dependencies.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, trimTags } from '../src/lib/osm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Château de Châteaugiron — the world origin (0,0) of the game.
const CENTER = { lat: 48.0489, lon: -1.5019 };
const RADIUS = Number(process.argv[2] || 1600); // metres around the château

const M_PER_DEG_LAT = 111320;
const mPerDegLon = Math.cos((CENTER.lat * Math.PI) / 180) * 111320;
const dLat = RADIUS / M_PER_DEG_LAT;
const dLon = RADIUS / mPerDegLon;
const bbox = {
  minlat: CENTER.lat - dLat,
  minlon: CENTER.lon - dLon,
  maxlat: CENTER.lat + dLat,
  maxlon: CENTER.lon + dLon,
};

const query = `
[out:json][timeout:180][bbox:${bbox.minlat},${bbox.minlon},${bbox.maxlat},${bbox.maxlon}];
(
  way["building"];
  way["building:part"];
  way["highway"];
  way["natural"="water"];
  way["water"];
  way["waterway"="riverbank"];
  way["landuse"];
  way["leisure"];
  way["natural"="wood"];
  way["natural"="scrub"];
  way["natural"="grassland"];
  way["natural"="tree_row"];
  way["barrier"];
  relation["natural"="water"];
  relation["water"];
);
out geom;
`;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

async function run() {
  console.log(
    `Fetching Châteaugiron OSM data — radius ${RADIUS} m around ${CENTER.lat},${CENTER.lon}`,
  );
  console.log(
    `bbox: ${bbox.minlat.toFixed(5)},${bbox.minlon.toFixed(5)},${bbox.maxlat.toFixed(5)},${bbox.maxlon.toFixed(5)}`,
  );

  let json = null;
  let lastErr = null;
  for (const url of ENDPOINTS) {
    try {
      console.log(`-> ${url}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      json = await res.json();
      break;
    } catch (err) {
      console.warn(`   failed: ${err.message}`);
      lastErr = err;
    }
  }
  if (!json) throw lastErr || new Error('All Overpass endpoints failed');

  const counts = { building: 0, road: 0, water: 0, green: 0, barrier: 0 };
  const features = [];

  for (const el of json.elements || []) {
    const tags = el.tags || {};

    // Water bodies mapped as multipolygon relations (a lake or pond, often with
    // an island): each outer-role member ring becomes its own water polygon.
    // Inner rings (islands) are skipped, so the fill stays a simple ring.
    if (el.type === 'relation') {
      const isWater = tags.natural === 'water' || tags.water || tags.waterway === 'riverbank';
      if (!isWater || !Array.isArray(el.members)) continue;
      const t = trimTags(tags);
      for (const m of el.members) {
        if (m.type !== 'way' || m.role !== 'outer' || !m.geometry || m.geometry.length < 3)
          continue;
        const g = m.geometry.map((p) => [p.lon, p.lat]);
        features.push({ k: 'water', t, g });
        counts.water++;
      }
      continue;
    }

    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const kind = classify(tags);
    if (!kind) continue;
    // geometry as [lon, lat] pairs
    const g = el.geometry.map((p) => [p.lon, p.lat]);
    features.push({ k: kind, t: trimTags(tags), g });
    counts[kind]++;
  }

  const payload = {
    meta: {
      source: 'OpenStreetMap via Overpass API',
      license: 'ODbL — © OpenStreetMap contributors',
      center: CENTER,
      radius_m: RADIUS,
      bbox,
      generated: new Date().toISOString(),
      counts,
    },
    features,
  };

  const outPath = resolve(__dirname, '../public/data/chateaugiron.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload));
  const kb = (JSON.stringify(payload).length / 1024).toFixed(0);
  console.log(`\nWrote ${outPath} (${kb} KB)`);
  console.log(
    `Features: ${features.length}  |  buildings ${counts.building}, roads ${counts.road}, water ${counts.water}, green ${counts.green}, barriers ${counts.barrier}`,
  );
}

run().catch((err) => {
  console.error('\nFetch failed:', err.message);
  process.exit(1);
});
