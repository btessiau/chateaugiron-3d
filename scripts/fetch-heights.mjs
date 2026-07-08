// Enriches the OpenStreetMap building footprints in public/data/chateaugiron.json
// with REAL building heights from IGN BD TOPO (Geoplateforme WFS, Etalab open
// licence, free, no key). BD TOPO gives, per building, the ground, eaves and
// ridge altitudes, so we can derive a real wall (eaves) height and a real roof
// rise for each footprint, instead of guessing from storeys.
//
// It writes two tags onto each matched building, reusing the OSM tag names the
// renderer already understands:
//   height       -> real eaves height in metres (wall extrude in the renderer)
//   roof:height  -> real ridge-minus-eaves rise in metres (the pitched roof)
//
// Buildings with no BD TOPO match keep their storey guess. Run this AFTER
// scripts/fetch-osm.mjs (it edits chateaugiron.json in place).
//
// Usage: node scripts/fetch-heights.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'public', 'data', 'chateaugiron.json');
const WFS = 'https://data.geopf.fr/wfs/ows';
const LAYER = 'BDTOPO_V3:batiment';
const PAGE = 1000;

function ringCentroid(ring) {
  let sx = 0,
    sy = 0;
  for (const p of ring) {
    sx += p[0];
    sy += p[1];
  }
  return [sx / ring.length, sy / ring.length];
}

// Ray-casting point in polygon on [lon, lat] rings (planar is fine at town scale).
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];
    const hit = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

async function fetchAll(bbox) {
  const [lonMin, latMin, lonMax, latMax] = bbox;
  const out = [];
  for (let start = 0; start < 40000; start += PAGE) {
    const url =
      `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=${LAYER}` +
      `&SRSNAME=EPSG:4326&BBOX=${lonMin},${latMin},${lonMax},${latMax},EPSG:4326` +
      `&COUNT=${PAGE}&STARTINDEX=${start}&OUTPUTFORMAT=application/json`;
    const res = await fetch(url, { headers: { 'User-Agent': 'chateaugiron-3d/heights' } });
    if (!res.ok) throw new Error(`WFS ${res.status} at start ${start}`);
    const j = await res.json();
    const feats = j.features || [];
    for (const f of feats) {
      const p = f.properties || {};
      const g = f.geometry;
      if (!g) continue;
      const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
      const gr = p.altitude_maximale_sol;
      const eave = p.altitude_minimale_toit;
      const ridge = p.altitude_maximale_toit;
      const hauteur = typeof p.hauteur === 'number' ? p.hauteur : parseFloat(p.hauteur);
      for (const poly of polys) {
        const ring = poly[0];
        if (!ring || ring.length < 4) continue;
        const c = ringCentroid(ring);
        out.push({ ring, c, gr, eave, ridge, hauteur });
      }
    }
    process.stdout.write(`  fetched ${out.length} BD TOPO parts (start ${start})\r`);
    if (feats.length < PAGE) break;
  }
  process.stdout.write('\n');
  return out;
}

function buildGrid(parts, cell) {
  const grid = new Map();
  const key = (a, b) => `${Math.floor(a / cell)}:${Math.floor(b / cell)}`;
  for (const part of parts) {
    const k = key(part.c[0], part.c[1]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(part);
  }
  return { grid, cell, key };
}

function nearby(index, lon, lat) {
  const { grid, cell } = index;
  const gx = Math.floor(lon / cell);
  const gy = Math.floor(lat / cell);
  const res = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const arr = grid.get(`${gx + dx}:${gy + dy}`);
      if (arr) res.push(...arr);
    }
  }
  return res;
}

function heightsFor(part) {
  const { gr, eave, ridge, hauteur } = part;
  if (
    typeof gr === 'number' &&
    typeof eave === 'number' &&
    typeof ridge === 'number' &&
    eave >= gr &&
    ridge >= eave
  ) {
    const wall = Math.max(2.0, +(eave - gr).toFixed(1));
    const rise = Math.max(0, +(ridge - eave).toFixed(1));
    return { wall, rise };
  }
  if (Number.isFinite(hauteur) && hauteur > 0) {
    return { wall: Math.max(2.0, +hauteur.toFixed(1)), rise: null };
  }
  return null;
}

async function main() {
  const data = JSON.parse(readFileSync(DATA, 'utf8'));
  const buildings = data.features.filter((f) => f.k === 'building');
  let lonMin = Infinity,
    latMin = Infinity,
    lonMax = -Infinity,
    latMax = -Infinity;
  for (const f of buildings) {
    for (const p of f.g) {
      if (p[0] < lonMin) lonMin = p[0];
      if (p[0] > lonMax) lonMax = p[0];
      if (p[1] < latMin) latMin = p[1];
      if (p[1] > latMax) latMax = p[1];
    }
  }
  const m = 0.001;
  const bbox = [lonMin - m, latMin - m, lonMax + m, latMax + m];
  console.log('OSM buildings:', buildings.length, 'bbox', bbox.map((v) => v.toFixed(4)).join(','));

  console.log('Fetching IGN BD TOPO buildings...');
  const parts = await fetchAll(bbox);
  console.log('BD TOPO parts:', parts.length);

  const index = buildGrid(parts, 0.0006);
  let matched = 0,
    withRoof = 0;
  for (const f of buildings) {
    const [lon, lat] = ringCentroid(f.g);
    const cands = nearby(index, lon, lat);
    let hit = cands.find((part) => inRing(lon, lat, part.ring));
    if (!hit) {
      // Nearest centroid within ~9 m as a fallback for footprint mismatches.
      let best = null,
        bestD = 9e9;
      for (const part of cands) {
        const dl = (part.c[0] - lon) * 74000;
        const dm = (part.c[1] - lat) * 111320;
        const d = dl * dl + dm * dm;
        if (d < bestD) {
          bestD = d;
          best = part;
        }
      }
      if (best && bestD < 81) hit = best;
    }
    if (!hit) continue;
    const h = heightsFor(hit);
    if (!h) continue;
    f.t.height = String(h.wall);
    if (h.rise != null && h.rise >= 0.6) {
      f.t['roof:height'] = String(h.rise);
      withRoof++;
    }
    matched++;
  }
  console.log(
    `Matched ${matched}/${buildings.length} buildings (${((100 * matched) / buildings.length).toFixed(0)}%), ${withRoof} with a real roof rise.`,
  );

  writeFileSync(DATA, JSON.stringify(data));
  console.log('Wrote', DATA);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
