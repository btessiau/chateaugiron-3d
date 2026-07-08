// Canvas rendering for the 2D top-down map. Draws the real OSM town in a clean
// Pokemon-overworld palette: grass, water, greens, roads, walkable paths and one
// block per real building, with the château and church picked out and labelled.
// North is up and east is to the right, so it matches a real map (not mirrored).

import { roadWidth } from '../lib/geometry.js';
import {
  isWalkableWay,
  ringCentroid,
  classifyLandmark,
  buildingHeight,
  roadLabelAnchor,
} from '../lib/map2d.js';
import { worldToMinimap, minimapScale } from '../lib/minimap.js';

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
const B_SHADOW = 'rgba(40,30,22,0.16)';
// Cream facade walls for ordinary houses: the south face catches light, the
// other faces are shaded so each block reads as a little 3D box.
const WALL_FRONT = '#f2e9d7';
const WALL_SIDE = '#dccdb4';
const DOOR = '#6f4d33';
const DOOR_EDGE = '#47301d';
const WIN_GLASS = '#cfe6f4';
const WIN_EDGE = '#8b7a5f';
// Little 2.5D props on the greens and kerbs.
const PROP_SHADOW = 'rgba(40,30,22,0.18)';
const TREE_TRUNK = '#8a6a45';
const TREE_LEAF = '#6cc05a';
const TREE_LEAF_SH = '#54a848';
const TREE_LEAF_HI = '#8bd472';
const TREE_LEAF_EDGE = 'rgba(60,95,45,0.5)';
const LAMP_POST = '#5f656e';
const LAMP_GLOW = '#ffe0a0';
const LAMP_GLOW_EDGE = '#e6b45a';
const BENCH_TOP = '#bb8642';
const BENCH_SH = '#8c5f2c';
// How tall a real metre draws, relative to the map scale. A touch under 1 keeps
// the dense old town readable while still giving buildings real height.
const VSCALE = 0.85;

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
  church: {
    roof: '#cf5049',
    wallFront: '#ece5d6',
    wallSide: '#cfc6b2',
    label: 'Église Sainte-Marie-Madeleine',
  },
  chateau: {
    roof: '#9aa2ae',
    wallFront: '#cdd2d8',
    wallSide: '#aeb4bd',
    label: 'Château de Châteaugiron',
  },
  halles: { roof: '#d99a3f', wallFront: '#efe6d2', wallSide: '#d4c7a9', label: 'Les Halles' },
  townhall: { roof: '#b06fae', wallFront: '#efe6d4', wallSide: '#d3c4b3', label: 'Mairie' },
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
  const roadLabels = [];
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
      if (f.t && f.t.name) {
        const a = roadLabelAnchor(pts);
        if (a) roadLabels.push({ text: f.t.name, x: a.x, n: a.n, angle: a.angle, len: a.len });
      }
    } else if (f.k === 'building') {
      const lm = classifyLandmark(f.t);
      const style = lm ? LANDMARK_STYLE[lm] : null;
      const roof = style ? style.roof : ROOFS[Math.floor(hash(String(pts[0])) * ROOFS.length)];
      const wallFront = style ? style.wallFront : WALL_FRONT;
      const wallSide = style ? style.wallSide : WALL_SIDE;
      const c = ringCentroid(pts);
      buildings.push({
        pts,
        bbox,
        roof,
        wallFront,
        wallSide,
        h: buildingHeight(f.t),
        lm,
        cx: c.x,
        cn: c.n,
      });
      if (lm) {
        labels.push({ text: LANDMARK_STYLE[lm].label, x: c.x, n: c.n, lm, h: buildingHeight(f.t) });
      } else if (f.t && f.t.name && (maxX - minX) * (maxN - minN) > 260) {
        labels.push({ text: f.t.name, x: c.x, n: c.n, lm: null, h: buildingHeight(f.t) });
      }
    }
  }
  buildings.sort((a, b) => b.cn - a.cn); // north first, south drawn on top
  return { greens, waters, roads, buildings, labels, roadLabels };
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

// A point on a facade in its own frame: u runs along the ground edge, v rises
// vertically up the wall. Used to place doors and windows so they slant with
// the building.
function facadePoint(f, u, v) {
  return [f.x0 + f.ex * u, f.y0 + f.ey * u - v];
}

function faceRect(ctx, f, u0, u1, v0, v1) {
  const a = facadePoint(f, u0, v0);
  const b = facadePoint(f, u1, v0);
  const c = facadePoint(f, u1, v1);
  const d = facadePoint(f, u0, v1);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.lineTo(c[0], c[1]);
  ctx.lineTo(d[0], d[1]);
  ctx.closePath();
}

// A centred door at the base of the front facade, with a window either side.
function drawFacadeDetail(ctx, f, hpx) {
  const L = f.L;
  ctx.lineWidth = 1;
  const dw = Math.max(5, Math.min(L * 0.22, 12));
  const dh = Math.min(hpx * 0.62, dw * 2);
  const uc = L / 2;
  faceRect(ctx, f, uc - dw / 2, uc + dw / 2, 0, dh);
  ctx.fillStyle = DOOR;
  ctx.fill();
  ctx.strokeStyle = DOOR_EDGE;
  ctx.stroke();

  if (L > 30 && hpx > 16) {
    const ww = Math.max(4, Math.min(L * 0.13, 8));
    const wh = ww * 1.1;
    const v0 = Math.min(hpx * 0.42, hpx - wh - 3);
    if (v0 > 3) {
      for (const u of [L * 0.24, L * 0.76]) {
        if (Math.abs(u - uc) < dw / 2 + ww) continue;
        faceRect(ctx, f, u - ww / 2, u + ww / 2, v0, v0 + wh);
        ctx.fillStyle = WIN_GLASS;
        ctx.fill();
        ctx.strokeStyle = WIN_EDGE;
        ctx.stroke();
      }
    }
  }
}

// A round toy tree: ground shadow, short trunk, layered canopy raised up-screen.
function drawTree(ctx, px, py, ppm) {
  const h = 4.5 * ppm * VSCALE;
  const r = Math.max(3.5, 1.7 * ppm);
  ctx.fillStyle = PROP_SHADOW;
  ctx.beginPath();
  ctx.ellipse(px + h * 0.18, py + 1.5, r * 0.95, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = TREE_TRUNK;
  ctx.lineWidth = Math.max(1.4, ppm * 0.28);
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px, py - h);
  ctx.stroke();
  const cy = py - h;
  ctx.fillStyle = TREE_LEAF_SH;
  ctx.beginPath();
  ctx.arc(px, cy + r * 0.3, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = TREE_LEAF;
  ctx.beginPath();
  ctx.arc(px, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = TREE_LEAF_HI;
  ctx.beginPath();
  ctx.arc(px - r * 0.33, cy - r * 0.33, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = TREE_LEAF_EDGE;
  ctx.lineWidth = Math.max(0.8, ppm * 0.1);
  ctx.beginPath();
  ctx.arc(px, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

// A lantern lamp post: shadow, thin post, warm glowing head.
function drawLamp(ctx, px, py, ppm) {
  const h = 4.2 * ppm * VSCALE;
  ctx.fillStyle = PROP_SHADOW;
  ctx.beginPath();
  ctx.ellipse(
    px + h * 0.16,
    py + 1.5,
    Math.max(3, ppm * 0.55),
    Math.max(1.4, ppm * 0.26),
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.strokeStyle = LAMP_POST;
  ctx.lineWidth = Math.max(1.2, ppm * 0.16);
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px, py - h);
  ctx.stroke();
  const r = Math.max(2.2, ppm * 0.42);
  ctx.fillStyle = LAMP_GLOW;
  ctx.beginPath();
  ctx.arc(px, py - h, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = LAMP_GLOW_EDGE;
  ctx.lineWidth = Math.max(0.8, ppm * 0.12);
  ctx.stroke();
}

// A park bench: shadow, a raised seat slab and a thin backrest behind it.
function drawBench(ctx, px, py, ppm) {
  const w = Math.max(6, 1.8 * ppm);
  const d = Math.max(2.4, 0.55 * ppm);
  const h = 0.8 * ppm * VSCALE;
  ctx.fillStyle = PROP_SHADOW;
  ctx.beginPath();
  ctx.ellipse(px, py + 1, w * 0.6, d * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BENCH_SH;
  ctx.fillRect(px - w / 2, py - h - d * 1.4, w, d * 0.7); // backrest
  ctx.fillStyle = BENCH_TOP;
  ctx.fillRect(px - w / 2, py - h - d * 0.5, w, d); // seat
}

// Draw the trees, lamps and benches in view, north-to-south so nearer ones
// overlap correctly. Detail is layered on with zoom so the far view stays clean.
export function drawProps(ctx, props, cam, W, H) {
  const ppm = cam.ppm;
  if (!props || ppm < 3.5) return;
  const sx = (x) => (x - cam.x) * ppm + W / 2;
  const sy = (n) => (cam.n - n) * ppm + H / 2;
  const hw = W / (2 * ppm) + 20;
  const hh = H / (2 * ppm) + 20;
  const vis = (x, n) => !(x < cam.x - hw || x > cam.x + hw || n < cam.n - hh || n > cam.n + hh);

  const items = [];
  for (const t of props.trees) if (vis(t.x, t.n)) items.push({ k: 0, x: t.x, n: t.n });
  if (ppm >= 5)
    for (const l of props.lamps) if (vis(l.x, l.n)) items.push({ k: 1, x: l.x, n: l.n });
  if (ppm >= 6)
    for (const b of props.benches) if (vis(b.x, b.n)) items.push({ k: 2, x: b.x, n: b.n });
  items.sort((a, b) => b.n - a.n);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const it of items) {
    const px = sx(it.x);
    const py = sy(it.n);
    if (it.k === 0) drawTree(ctx, px, py, ppm);
    else if (it.k === 1) drawLamp(ctx, px, py, ppm);
    else drawBench(ctx, px, py, ppm);
  }
}

// Draw the visible slice of the town, centred on the camera (in metres).
export function drawWorld(ctx, prepared, cam, W, H, props) {
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

  // Trees, lamps and benches sit on the ground, under the buildings.
  drawProps(ctx, props, cam, W, H);

  // Street names, drawn on the road surface (under the buildings) when zoomed in.
  drawStreetLabels(ctx, prepared.roadLabels, cam, hw, hh, sx, sy, ppm);

  // Buildings as 2.5D blocks: a height-scaled ground shadow, cream facade walls
  // that rise up-screen (south face lit, other faces shaded), a door and windows
  // on the front, then the coloured roof on top. Sorted north-to-south so nearer
  // walls and roofs overlap right.
  const outline = ppm > 3;
  const lw = Math.max(0.8, ppm * 0.12);
  const detail = ppm > 4.5;
  ctx.lineWidth = lw;
  for (const b of prepared.buildings) {
    if (!inView(b.bbox, cam, hw, hh)) continue;
    const n = b.pts.length;
    const base = new Array(n);
    for (let i = 0; i < n; i++) base[i] = [sx(b.pts[i][0]), sy(b.pts[i][1])];
    const hpx = b.h * ppm * VSCALE;

    // Screen centroid, to orient each wall's outward normal.
    let ccx = 0;
    let ccy = 0;
    for (let i = 0; i < n - 1; i++) {
      ccx += base[i][0];
      ccy += base[i][1];
    }
    ccx /= n - 1;
    ccy /= n - 1;

    // Cast shadow on the ground, longer for taller buildings.
    const shv = Math.min(2 + hpx * 0.15, 16);
    ctx.fillStyle = B_SHADOW;
    ctx.beginPath();
    ctx.moveTo(base[0][0] + shv, base[0][1] + shv);
    for (let i = 1; i < n; i++) ctx.lineTo(base[i][0] + shv, base[i][1] + shv);
    ctx.closePath();
    ctx.fill();

    // Facade walls: one quad per footprint edge, from the ground up to the eaves.
    // Track the longest south-facing edge to hang the front door on.
    ctx.lineWidth = lw;
    ctx.strokeStyle = B_OUTLINE;
    let front = null;
    for (let i = 0; i < n - 1; i++) {
      const [x0, y0] = base[i];
      const [x1, y1] = base[i + 1];
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      let nx = y1 - y0;
      let ny = -(x1 - x0);
      if ((mx - ccx) * nx + (my - ccy) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      const faceFront = ny > 0; // normal points south = lit front
      ctx.fillStyle = faceFront ? b.wallFront : b.wallSide;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1, y1 - hpx);
      ctx.lineTo(x0, y0 - hpx);
      ctx.closePath();
      ctx.fill();
      if (outline) ctx.stroke();
      if (faceFront) {
        const L = Math.hypot(x1 - x0, y1 - y0);
        if (L > 1 && (!front || L > front.L))
          front = { x0, y0, x1, y1, L, ex: (x1 - x0) / L, ey: (y1 - y0) / L };
      }
    }

    // Door and windows on the main front facade (only ordinary houses, zoomed in).
    if (detail && front && !b.lm && hpx > 14 && front.L > 16) {
      drawFacadeDetail(ctx, front, hpx);
    }

    // Roof: the footprint raised by the wall height, in the building's colour.
    ctx.lineWidth = lw;
    ctx.fillStyle = b.roof;
    ctx.strokeStyle = B_OUTLINE;
    ctx.beginPath();
    ctx.moveTo(base[0][0], base[0][1] - hpx);
    for (let i = 1; i < n; i++) ctx.lineTo(base[i][0], base[i][1] - hpx);
    ctx.closePath();
    ctx.fill();
    if (outline) ctx.stroke();
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
    const py = sy(l.n) - (l.h || 0) * ppm * VSCALE; // float above the roof
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

// Street names run along the road surface when zoomed in. Each name is drawn
// rotated to match its road, kept upright, with a soft white halo. Names are
// de-duplicated on screen so a street split into many OSM ways is not repeated
// every few metres.
function drawStreetLabels(ctx, roadLabels, cam, hw, hh, sx, sy, ppm) {
  if (!roadLabels || ppm < 5) return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 10px system-ui, sans-serif';
  const placed = [];
  for (const l of roadLabels) {
    if (l.x < cam.x - hw || l.x > cam.x + hw || l.n < cam.n - hh || l.n > cam.n + hh) continue;
    if (l.len * ppm < 70) continue; // too short on screen to read
    const px = sx(l.x);
    const py = sy(l.n);
    // Skip if the same name was already drawn nearby this frame.
    let dupe = false;
    for (const p of placed) {
      if (p.text === l.text && Math.hypot(p.px - px, p.py - py) < 240) {
        dupe = true;
        break;
      }
    }
    if (dupe) continue;
    placed.push({ text: l.text, px, py });
    // North is up (sy flips n), so the screen angle is the negated world angle.
    let a = -l.angle;
    if (a > Math.PI / 2) a -= Math.PI;
    if (a < -Math.PI / 2) a += Math.PI;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeText(l.text, 0, 0);
    ctx.fillStyle = '#5a5148';
    ctx.fillText(l.text, 0, 0);
    ctx.restore();
  }
}

export const MARKER_COLOR = {
  church: '#cf5049',
  chateau: '#6b7280',
  halles: '#d99a3f',
  townhall: '#b06fae',
  etang: '#5bb8e8',
  jardin: '#4a9e46',
};

function miniPath(c, pts, P) {
  const a = P(pts[0][0], pts[0][1]);
  c.beginPath();
  c.moveTo(a.u, a.v);
  for (let i = 1; i < pts.length; i++) {
    const p = P(pts[i][0], pts[i][1]);
    c.lineTo(p.u, p.v);
  }
}

// Render the whole town once onto an offscreen canvas: greens, water, faint
// roads and every building footprint. The result is blitted each frame so the
// live minimap only has to draw the moving bits on top.
export function buildMinimapBase(prepared, bounds, size) {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const c = cv.getContext('2d');
  const mPerPx = minimapScale(bounds, size);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minN + bounds.maxN) / 2;
  const P = (x, n) => worldToMinimap(x, n, cx, cz, mPerPx, size);

  c.fillStyle = '#bfe3a8';
  c.fillRect(0, 0, size, size);
  c.lineJoin = 'round';
  c.fillStyle = 'rgba(103,185,90,0.75)';
  for (const g of prepared.greens) {
    miniPath(c, g.pts, P);
    c.fill();
  }
  c.fillStyle = '#7cc6ec';
  for (const w of prepared.waters) {
    miniPath(c, w.pts, P);
    c.fill();
  }
  c.strokeStyle = 'rgba(255,255,255,0.8)';
  c.lineWidth = 0.7;
  for (const r of prepared.roads) {
    miniPath(c, r.pts, P);
    c.stroke();
  }
  c.fillStyle = 'rgba(84,64,50,0.6)';
  for (const b of prepared.buildings) {
    miniPath(c, b.pts, P);
    c.fill();
  }
  return { canvas: cv, mPerPx, cx, cz, size };
}

// Draw the live minimap: the static base, then the current view rectangle, the
// landmark dots and the player, north-up.
export function drawMinimap(mctx, base, player, targets, cam, W, H) {
  const { canvas, mPerPx, cx, cz, size } = base;
  const P = (x, n) => worldToMinimap(x, n, cx, cz, mPerPx, size);
  mctx.clearRect(0, 0, size, size);
  mctx.drawImage(canvas, 0, 0);

  // The slice of town shown in the main view.
  const halfW = W / (2 * cam.ppm);
  const halfH = H / (2 * cam.ppm);
  const tl = P(cam.x - halfW, cam.n + halfH);
  const br = P(cam.x + halfW, cam.n - halfH);
  mctx.strokeStyle = 'rgba(30,26,22,0.65)';
  mctx.lineWidth = 1.4;
  mctx.strokeRect(tl.u, tl.v, br.u - tl.u, br.v - tl.v);

  for (const t of targets) {
    const p = P(t.x, t.n);
    mctx.fillStyle = MARKER_COLOR[t.kind] || '#c98a2a';
    mctx.beginPath();
    mctx.arc(p.u, p.v, 3.4, 0, Math.PI * 2);
    mctx.fill();
    mctx.strokeStyle = '#fff';
    mctx.lineWidth = 1.2;
    mctx.stroke();
  }

  const pp = P(player.x, player.n);
  mctx.fillStyle = '#e0483c';
  mctx.beginPath();
  mctx.arc(pp.u, pp.v, 3.6, 0, Math.PI * 2);
  mctx.fill();
  mctx.strokeStyle = '#fff';
  mctx.lineWidth = 1.6;
  mctx.stroke();
}
