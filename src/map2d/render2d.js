// Canvas rendering for the 2D top-down map. Draws the real OSM town in a clean
// Pokemon-overworld palette: grass, water, greens, roads, walkable paths and one
// block per real building, with the château and church picked out and labelled.
// North is up and east is to the right, so it matches a real map (not mirrored).

import { roadWidth } from '../lib/geometry.js';
import { isWalkableWay, ringCentroid, classifyLandmark } from '../lib/map2d.js';

const GRASS = '#8ccf77';
const GRASS_DARK = '#84c86d';
const GREEN = '#67b95a';
const GREEN_EDGE = '#57a94b';
const WATER = '#5bb8e8';
const WATER_EDGE = '#3f9ed6';
const ROAD_CASE = '#c7bda8';
const ROAD_TOP = '#efe9dc';
const PATH_CASE = '#d3b981';
const PATH_TOP = '#ecd6a2';
const B_OUTLINE = '#4a3f38';
const B_SHADOW = 'rgba(40,30,22,0.18)';

const ROOFS = [
  '#e59a9a',
  '#e7b183',
  '#eccf85',
  '#aad487',
  '#89c6d8',
  '#98afe0',
  '#c6a0d6',
  '#d99ab2',
  '#c3b199',
  '#d59f7e',
];

const LANDMARK_STYLE = {
  church: { roof: '#cf5049', label: 'Église Sainte-Marie-Madeleine' },
  chateau: { roof: '#98a0ac', label: 'Château de Châteaugiron' },
  halles: { roof: '#d99a3f', label: 'Les Halles' },
  townhall: { roof: '#b06fae', label: 'Mairie' },
};

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

// Project every feature to metres once, with a bounding box for view culling and
// a resolved draw style. Buildings are ordered north-to-south so their little
// drop shadows overlap correctly.
export function prepareFeatures(features, project) {
  const greens = [];
  const waters = [];
  const roads = [];
  const buildings = [];
  const labels = [];
  for (const f of features) {
    const pts = f.g.map((p) => project(p[0], p[1]));
    let minX = Infinity;
    let minN = Infinity;
    let maxX = -Infinity;
    let maxN = -Infinity;
    for (const [x, n] of pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (n < minN) minN = n;
      if (n > maxN) maxN = n;
    }
    const bbox = { minX, minN, maxX, maxN };
    if (f.k === 'green') {
      greens.push({ pts, bbox });
    } else if (f.k === 'water') {
      waters.push({ pts, bbox });
    } else if (f.k === 'road') {
      const hw = f.t && f.t.highway;
      roads.push({ pts, bbox, walk: isWalkableWay(hw), w: roadWidth(hw) });
    } else if (f.k === 'building') {
      const lm = classifyLandmark(f.t);
      const roof = lm
        ? LANDMARK_STYLE[lm].roof
        : ROOFS[Math.floor(hash(String(pts[0])) * ROOFS.length)];
      const c = ringCentroid(pts);
      buildings.push({ pts, bbox, roof, lm, cx: c.x, cn: c.n });
      if (lm) {
        labels.push({ text: LANDMARK_STYLE[lm].label, x: c.x, n: c.n, lm });
      } else if (f.t && f.t.name && (maxX - minX) * (maxN - minN) > 260) {
        labels.push({ text: f.t.name, x: c.x, n: c.n, lm: null });
      }
    }
  }
  buildings.sort((a, b) => b.cn - a.cn); // north first, south drawn on top
  return { greens, waters, roads, buildings, labels };
}

function inView(bbox, cam, hw, hh) {
  return !(
    bbox.maxX < cam.x - hw ||
    bbox.minX > cam.x + hw ||
    bbox.maxN < cam.n - hh ||
    bbox.minN > cam.n + hh
  );
}

function tracePath(ctx, pts, sx, sy) {
  ctx.beginPath();
  ctx.moveTo(sx(pts[0][0]), sy(pts[0][1]));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(sx(pts[i][0]), sy(pts[i][1]));
}

// Draw the visible slice of the town, centred on the camera (in metres).
export function drawWorld(ctx, prepared, cam, W, H) {
  const ppm = cam.ppm;
  const sx = (x) => (x - cam.x) * ppm + W / 2;
  const sy = (n) => (cam.n - n) * ppm + H / 2;
  const hw = W / (2 * ppm) + 20;
  const hh = H / (2 * ppm) + 20;

  // Grass base + a soft checker so open ground is not a flat slab.
  ctx.fillStyle = GRASS;
  ctx.fillRect(0, 0, W, H);
  const tile = 48;
  ctx.fillStyle = GRASS_DARK;
  const ox = Math.floor(sx(0)) % (tile * 2);
  const oy = Math.floor(sy(0)) % (tile * 2);
  for (let y = -tile * 2; y < H + tile * 2; y += tile) {
    for (let x = -tile * 2; x < W + tile * 2; x += tile * 2) {
      const shift = (Math.floor((y - oy) / tile) % 2) * tile;
      ctx.fillRect(x + ox + shift, y + oy, tile, tile);
    }
  }

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Greens (parks, gardens, woodland).
  ctx.fillStyle = GREEN;
  ctx.strokeStyle = GREEN_EDGE;
  ctx.lineWidth = 1.5;
  for (const g of prepared.greens) {
    if (!inView(g.bbox, cam, hw, hh)) continue;
    tracePath(ctx, g.pts, sx, sy);
    ctx.closePath();
    ctx.fill();
  }

  // Water.
  ctx.fillStyle = WATER;
  ctx.strokeStyle = WATER_EDGE;
  ctx.lineWidth = 2;
  for (const w of prepared.waters) {
    if (!inView(w.bbox, cam, hw, hh)) continue;
    tracePath(ctx, w.pts, sx, sy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Roads: casing pass, then top pass. Vehicle roads first, walkable paths on
  // top so pavements read where they meet the streets.
  const order = [false, true];
  for (const walk of order) {
    ctx.strokeStyle = walk ? PATH_CASE : ROAD_CASE;
    for (const r of prepared.roads) {
      if (r.walk !== walk || !inView(r.bbox, cam, hw, hh)) continue;
      ctx.lineWidth = Math.max(2, r.w * ppm) + 3;
      tracePath(ctx, r.pts, sx, sy);
      ctx.stroke();
    }
    ctx.strokeStyle = walk ? PATH_TOP : ROAD_TOP;
    for (const r of prepared.roads) {
      if (r.walk !== walk || !inView(r.bbox, cam, hw, hh)) continue;
      ctx.lineWidth = Math.max(1.5, r.w * ppm);
      tracePath(ctx, r.pts, sx, sy);
      ctx.stroke();
    }
  }

  // Buildings: soft south-east shadow, then the roof block, then a dark outline.
  const shOff = Math.max(1.5, 2.2);
  ctx.lineWidth = Math.max(1, ppm * 0.35);
  for (const b of prepared.buildings) {
    if (!inView(b.bbox, cam, hw, hh)) continue;
    ctx.fillStyle = B_SHADOW;
    ctx.beginPath();
    ctx.moveTo(sx(b.pts[0][0]) + shOff, sy(b.pts[0][1]) + shOff);
    for (let i = 1; i < b.pts.length; i++)
      ctx.lineTo(sx(b.pts[i][0]) + shOff, sy(b.pts[i][1]) + shOff);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = b.roof;
    ctx.strokeStyle = B_OUTLINE;
    tracePath(ctx, b.pts, sx, sy);
    ctx.closePath();
    ctx.fill();
    if (ppm > 3) ctx.stroke();
  }

  // Landmark and named-building labels.
  drawLabels(ctx, prepared.labels, cam, hw, hh, sx, sy, ppm);
}

function drawLabels(ctx, labels, cam, hw, hh, sx, sy, ppm) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of labels) {
    if (l.x < cam.x - hw || l.x > cam.x + hw || l.n < cam.n - hh || l.n > cam.n + hh) continue;
    const big = !!l.lm;
    if (!big && ppm < 5.5) continue;
    const px = sx(l.x);
    const py = sy(l.n);
    if (big) {
      // A small marker so the landmark is easy to spot from afar.
      ctx.fillStyle = l.lm === 'church' ? '#cf5049' : l.lm === 'chateau' ? '#6b7280' : '#c98a2a';
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.font = big ? '700 13px system-ui, sans-serif' : '600 11px system-ui, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeText(l.text, px, py - (big ? 14 : 0));
    ctx.fillStyle = big ? '#2a2320' : '#4a423a';
    ctx.fillText(l.text, px, py - (big ? 14 : 0));
  }
}
