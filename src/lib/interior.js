// Interiors for the town's main buildings. The player walks up to a landmark's
// door and steps inside a small themed room (a church nave, the château hall,
// the market hall ...). Everything here is pure geometry so it is unit tested at
// 100%; the drawing lives in src/map2d/interior.js.

import { classifyLandmark, ringCentroid } from './map2d.js';
import { ringArea } from './props2d.js';

const LABEL = { church: 'Church', chateau: 'Château', halles: 'Les Halles', townhall: 'Mairie' };

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Pick a door on the footprint boundary. With the open-street points we choose
// the boundary vertex nearest to a street, so the door is always somewhere the
// road-only player can actually stand. Without them we fall back to the
// southern-most vertex (the side that faces the bottom of the north-up screen).
export function pickDoor(poly, roadPts) {
  let best = poly[0];
  if (roadPts && roadPts.length) {
    let bestD = Infinity;
    for (const p of poly) {
      let d = Infinity;
      for (const r of roadPts) {
        const dx = p[0] - r[0];
        const dn = p[1] - r[1];
        const dd = dx * dx + dn * dn;
        if (dd < d) d = dd;
      }
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  } else {
    let bestN = Infinity;
    for (const p of poly) {
      if (p[1] < bestN) {
        bestN = p[1];
        best = p;
      }
    }
  }
  return { x: best[0], n: best[1] };
}

// The main buildings a player can walk into: the tag-classified landmarks
// (church, chapel, halles, mairie) plus the château, taken as the largest
// historic footprint since the 2D data carries no building heights. Each entry
// carries its footprint ring, centroid, a reachable door and its area (used to
// size the interior).
export function enterableBuildings(features, project, roadPts) {
  const out = [];
  const add = (kind, label, poly) => {
    if (!poly || poly.length < 3) return;
    const c = ringCentroid(poly);
    const door = pickDoor(poly, roadPts);
    out.push({
      kind,
      label,
      poly,
      cx: c.x,
      cn: c.n,
      doorX: door.x,
      doorN: door.n,
      area: ringArea(poly),
    });
  };

  for (const f of features) {
    if (f.k !== 'building') continue;
    const k = classifyLandmark(f.t);
    if (k === 'church' || k === 'halles' || k === 'townhall' || k === 'chateau') {
      add(
        k,
        f.t.name || LABEL[k],
        f.g.map((p) => project(p[0], p[1])),
      );
    }
  }
  const hasChateau = out.some((b) => b.kind === 'chateau');

  // Fallback château: the largest historic footprint, used only when no
  // building was tagged as the castle (the real 2D data has no height or castle
  // tag, so the keep shows up merely as building=yes, historic=yes).
  if (!hasChateau) {
    let castle = null;
    let bestA = 0;
    for (const f of features) {
      if (f.k !== 'building' || !f.t || !f.t.historic) continue;
      if (classifyLandmark(f.t)) continue; // already added under its own landmark
      const poly = f.g.map((p) => project(p[0], p[1]));
      const a = ringArea(poly);
      if (a > bestA) {
        bestA = a;
        castle = { t: f.t, poly };
      }
    }
    if (castle) add('chateau', castle.t.name || LABEL.chateau, castle.poly);
  }

  return out;
}

// The building whose door the player is standing next to (nearest within
// radius), or null. Drives the "Press E to enter" prompt and the entry trigger.
export function enterableAt(buildings, x, n, radius) {
  let best = null;
  let bestD = radius;
  for (const b of buildings) {
    const d = Math.hypot(b.doorX - x, b.doorN - n);
    if (d <= bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

// Themed furniture for a room of the given kind, laid out in interior metres
// (origin top-left, y increasing downward; the door is at the bottom). Solid
// pieces block the player; non-solid ones (stained glass) are only drawn.
function buildProps(kind, w, h) {
  const props = [];
  if (kind === 'church') {
    props.push({ type: 'altar', x: w / 2 - 1.6, y: 1.4, w: 3.2, h: 1.3, solid: true });
    const aisle = 1.5;
    const pewW = w / 2 - aisle - 1.7;
    for (let y = 3.4; y <= h - 4; y += 2) {
      props.push({ type: 'pew', x: 1.2, y, w: pewW, h: 0.9, solid: true });
      props.push({ type: 'pew', x: w / 2 + aisle, y, w: pewW, h: 0.9, solid: true });
    }
    props.push({ type: 'glass', x: 0.15, y: h * 0.32, w: 0.5, h: 2.6, solid: false });
    props.push({ type: 'glass', x: w - 0.65, y: h * 0.32, w: 0.5, h: 2.6, solid: false });
  } else if (kind === 'chateau') {
    props.push({ type: 'hearth', x: w / 2 - 2.2, y: 0.35, w: 4.4, h: 1.2, solid: true });
    props.push({ type: 'table', x: w / 2 - 1.6, y: 3, w: 3.2, h: h - 7, solid: true });
    props.push({ type: 'brazier', x: 1.6, y: h - 4.2, w: 1.2, h: 1.2, solid: true });
    props.push({ type: 'brazier', x: w - 2.8, y: h - 4.2, w: 1.2, h: 1.2, solid: true });
  } else if (kind === 'halles') {
    const cell = (w - 3) / 3;
    for (let i = 0; i < 3; i++) {
      const x = 1.5 + i * cell;
      props.push({ type: 'stall', x, y: 3, w: cell - 0.6, h: 2, solid: true });
      props.push({ type: 'stall', x, y: h - 5, w: cell - 0.6, h: 2, solid: true });
    }
  } else {
    props.push({ type: 'desk', x: w / 2 - 2, y: 2, w: 4, h: 1.4, solid: true });
    props.push({ type: 'bench', x: 1.5, y: h / 2, w: w - 3, h: 0.9, solid: true });
  }
  return props;
}

// A small themed room sized from the real footprint area. Returns the room size,
// the spawn just inside the door, the exit mat rectangle and the furniture, all
// in interior metres.
export function buildInterior(kind, area) {
  const span = clamp(Math.sqrt(Math.max(area, 40)), 9, 26);
  let w;
  let h;
  if (kind === 'church') {
    w = clamp(span * 0.72, 9, 16);
    h = clamp(span * 1.35, 16, 30);
  } else if (kind === 'chateau') {
    w = clamp(span, 12, 24);
    h = clamp(span * 0.82, 10, 20);
  } else if (kind === 'halles') {
    w = clamp(span, 12, 24);
    h = clamp(span * 0.7, 9, 16);
  } else {
    w = clamp(span, 10, 18);
    h = clamp(span * 0.8, 8, 14);
  }
  const spawn = { x: w / 2, y: h - 3 };
  const exit = { x: w / 2 - 1.3, y: h - 1.5, w: 2.6, h: 1.3 };
  return { kind, w, h, spawn, exit, props: buildProps(kind, w, h) };
}

function hitsSolid(props, x, y, r) {
  for (const p of props) {
    if (!p.solid) continue;
    if (x + r > p.x && x - r < p.x + p.w && y + r > p.y && y - r < p.y + p.h) return true;
  }
  return false;
}

// Move the player inside a room. Axis-separated so they slide along walls and
// furniture instead of stopping dead, and clamped to the room's inner margin.
export function moveInInterior(spec, pos, dx, dy, radius) {
  const margin = radius + 0.35;
  let x = pos.x;
  let y = pos.y;
  const nx = clamp(x + dx, margin, spec.w - margin);
  if (!hitsSolid(spec.props, nx, y, radius)) x = nx;
  const ny = clamp(y + dy, margin, spec.h - margin);
  if (!hitsSolid(spec.props, x, ny, radius)) y = ny;
  return { x, y };
}

// Is the player standing on the door mat, ready to step back outside?
export function onExitMat(spec, pos) {
  const e = spec.exit;
  return pos.x >= e.x && pos.x <= e.x + e.w && pos.y >= e.y - 0.4 && pos.y <= e.y + e.h;
}
