// Fetches individual mapped trees (natural=tree nodes and tree_row ways) for
// Châteaugiron and writes a compact list of [lon, lat] points the app instances
// as 3D trees. Kept separate from chateaugiron.json so the main data and its
// tests are untouched.
//
// Data © OpenStreetMap contributors, licensed under the ODbL.
// Usage: node scripts/fetch-trees.mjs [radiusMeters]

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CENTER = { lat: 48.0489, lon: -1.5019 };
const RADIUS = Number(process.argv[2] || 1600);

const query = `
[out:json][timeout:120];
(
  node["natural"="tree"](around:${RADIUS},${CENTER.lat},${CENTER.lon});
  way["natural"="tree_row"](around:${RADIUS},${CENTER.lat},${CENTER.lon});
);
out geom;
`;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Sample points every ~stepMeters along a tree_row polyline.
function densify(geometry, stepMeters = 9) {
  const mPerDegLat = 111320;
  const mPerDegLon = Math.cos((CENTER.lat * Math.PI) / 180) * 111320;
  const out = [];
  for (let i = 0; i < geometry.length - 1; i++) {
    const a = geometry[i];
    const b = geometry[i + 1];
    const dx = (b.lon - a.lon) * mPerDegLon;
    const dz = (b.lat - a.lat) * mPerDegLat;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / stepMeters));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([a.lon + (b.lon - a.lon) * t, a.lat + (b.lat - a.lat) * t]);
    }
  }
  return out;
}

async function run() {
  console.log(
    `Fetching Châteaugiron trees — radius ${RADIUS} m around ${CENTER.lat},${CENTER.lon}`,
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

  const points = [];
  for (const el of json.elements || []) {
    if (el.type === 'node' && typeof el.lon === 'number') {
      points.push([el.lon, el.lat]);
    } else if (el.type === 'way' && el.geometry && el.geometry.length >= 2) {
      for (const p of densify(el.geometry)) points.push(p);
    }
  }

  const payload = {
    meta: {
      source: 'OpenStreetMap via Overpass API',
      license: 'ODbL — © OpenStreetMap contributors',
      center: CENTER,
      radius_m: RADIUS,
      generated: new Date().toISOString(),
      count: points.length,
    },
    trees: points,
  };

  const outPath = resolve(__dirname, '../public/data/trees.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload));
  console.log(`\nWrote ${outPath} — ${points.length} trees`);
}

run().catch((err) => {
  console.error('\nFetch failed:', err.message);
  process.exit(1);
});
