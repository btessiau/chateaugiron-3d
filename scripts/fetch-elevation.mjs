// Fetches a real elevation heightfield for Chateaugiron from the IGN
// Geoplateforme altimetry REST API (RGE ALTI, French open data, no API key).
//
// The grid is stored in world metres centred on the chateau, so the renderer
// can sample it directly. Heights are stored relative to the chateau, so the
// town centre sits near y = 0.
//
// Usage: node scripts/fetch-elevation.mjs [sizeMeters] [n]

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeProjector, metresToLatLon } from '../src/lib/geo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CENTER = { lat: 48.0489, lon: -1.5019 };
const SIZE = Number(process.argv[2] || 3400); // metres across the grid
const N = Number(process.argv[3] || 128); // samples per side

const ENDPOINT = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
const RESOURCE = 'ign_rge_alti_wld';
const MAX_PER_REQ = 5000;

const proj = makeProjector(CENTER);
const half = SIZE / 2;
const spacing = SIZE / (N - 1);

// Build sample points in world coordinates, row 0 = south (-z).
const points = [];
for (let iz = 0; iz < N; iz++) {
  const z = -half + iz * spacing;
  for (let ix = 0; ix < N; ix++) {
    const x = -half + ix * spacing;
    const { lat, lon } = metresToLatLon(proj, x, z);
    points.push({ ix, iz, lat, lon });
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchBatch(batch) {
  const lon = batch.map((p) => p.lon.toFixed(7)).join('|');
  const lat = batch.map((p) => p.lat.toFixed(7)).join('|');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      lon,
      lat,
      resource: RESOURCE,
      delimiter: '|',
      zonly: 'true',
    }),
  });
  if (!res.ok) throw new Error(`IGN elevation HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.elevations;
}

async function run() {
  console.log(`Elevation grid ${N}x${N} over ${SIZE} m around ${CENTER.lat},${CENTER.lon}`);
  const z = new Array(N * N).fill(0);
  const batches = chunk(points, MAX_PER_REQ);
  let filled = 0;
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    console.log(`-> batch ${b + 1}/${batches.length} (${batch.length} points)`);
    const zs = await fetchBatch(batch);
    zs.forEach((val, i) => {
      const p = batch[i];
      z[p.iz * N + p.ix] = val === -99999 ? null : val;
      filled++;
    });
    if (b < batches.length - 1) await new Promise((r) => setTimeout(r, 250));
  }

  // Fill any gaps (out of coverage) with a neighbour so the mesh stays smooth.
  const centerIdx = Math.floor(N / 2) * N + Math.floor(N / 2);
  const baseZ = z[centerIdx] ?? 0;
  let lastGood = baseZ;
  for (let i = 0; i < z.length; i++) {
    if (z[i] == null) z[i] = lastGood;
    else lastGood = z[i];
  }

  // Store relative to the chateau so the centre sits near y = 0.
  let min = Infinity;
  let max = -Infinity;
  const rel = z.map((v) => {
    const r = v - baseZ;
    if (r < min) min = r;
    if (r > max) max = r;
    return Math.round(r * 100) / 100;
  });

  const payload = {
    meta: {
      source: 'IGN Geoplateforme RGE ALTI',
      license: 'Etalab Licence Ouverte / IGN',
      center: CENTER,
      size_m: SIZE,
      n: N,
      spacing_m: Math.round(spacing * 100) / 100,
      baseElevation_m: Math.round(baseZ * 100) / 100,
      min_m: Math.round(min * 100) / 100,
      max_m: Math.round(max * 100) / 100,
      generated: new Date().toISOString(),
    },
    z: rel,
  };

  const outPath = resolve(__dirname, '../public/data/elevation.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload));
  const kb = (JSON.stringify(payload).length / 1024).toFixed(0);
  console.log(`\nWrote ${outPath} (${kb} KB) — ${filled} samples`);
  console.log(`Relief: ${payload.meta.min_m} m to ${payload.meta.max_m} m around the chateau`);
}

run().catch((err) => {
  console.error('\nElevation fetch failed:', err.message);
  process.exit(1);
});
