// Entry point for the 2D top-down (Pokemon-style) map of Châteaugiron.
// It reuses the exact same OSM data and projection as the 3D game, so the
// streets, walkable paths and one-block-per-building all match reality 1:1.

import { makeProjector } from './lib/geo.js';
import {
  featureBounds,
  makeGrid,
  fillPolygon,
  inputVector,
  facingFrom,
  stepPlayer,
  findOpenSpawn,
  classifyLandmark,
  isWalkableWay,
  ringCentroid,
  nearestPoint,
} from './lib/map2d.js';
import { prepareFeatures, drawWorld } from './map2d/render2d.js';
import { drawTrainer } from './map2d/sprite.js';

const WALK_SPEED = 4.6; // metres per second
const RUN_SPEED = 9.5;
const PLAYER_RADIUS = 1.0;
const STRIDE = 0.42; // metres per walk-frame flip
const SPRITE_UNIT = 2.4;

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const hudPos = document.getElementById('pos');
const hudZoom = document.getElementById('zoom');
const intro = document.getElementById('intro');

let W = 0;
let H = 0;
let dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = canvas.clientWidth;
  H = canvas.clientHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);

const keys = { up: false, down: false, left: false, right: false, run: false };
const KEYMAP = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};
let zoom = 6.5;
window.addEventListener('keydown', (e) => {
  if (KEYMAP[e.code]) {
    keys[KEYMAP[e.code]] = true;
    e.preventDefault();
  } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    keys.run = true;
  } else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
    zoom = Math.min(14, zoom + 1);
  } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
    zoom = Math.max(3, zoom - 1);
  }
  if (intro && !intro.classList.contains('hidden')) intro.classList.add('hidden');
});
window.addEventListener('keyup', (e) => {
  if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false;
  else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.run = false;
});
canvas.addEventListener(
  'wheel',
  (e) => {
    zoom = Math.max(3, Math.min(14, zoom - Math.sign(e.deltaY)));
    e.preventDefault();
  },
  { passive: false },
);

async function main() {
  resize();
  const res = await fetch(`${import.meta.env.BASE_URL}data/chateaugiron.json`);
  const data = await res.json();
  const proj = makeProjector(data.meta.center);
  const project = proj.project;

  const prepared = prepareFeatures(data.features, project);

  // Collision grid: buildings and water block, everything else is walkable.
  const bounds = featureBounds(data.features, project);
  const grid = makeGrid(bounds, 1);
  for (const f of data.features) {
    if (f.k === 'building' || f.k === 'water') {
      fillPolygon(
        grid,
        f.g.map((p) => project(p[0], p[1])),
      );
    }
  }

  // Spawn on the nearest street or path to the church, so the player starts on
  // open ground with the steeple in view and clear room to walk.
  let spawnX = 0;
  let spawnN = 0;
  const church = data.features.find(
    (f) => f.k === 'building' && classifyLandmark(f.t) === 'church',
  );
  if (church) {
    const c = ringCentroid(church.g.map((p) => project(p[0], p[1])));
    spawnX = c.x;
    spawnN = c.n;
    // Collect walkable-way vertices (fall back to any road) and seed on the
    // closest one to the church.
    const walk = [];
    const anyRoad = [];
    for (const f of data.features) {
      if (f.k !== 'road') continue;
      const bucket = isWalkableWay(f.t && f.t.highway) ? walk : anyRoad;
      for (const p of f.g) bucket.push(project(p[0], p[1]));
    }
    const near = nearestPoint(walk.length ? walk : anyRoad, c.x, c.n);
    if (near) {
      spawnX = near.x;
      spawnN = near.n;
    }
  }
  const spawn = findOpenSpawn(grid, spawnX, spawnN, PLAYER_RADIUS);

  // Landmark anchors for the "near ..." readout.
  const landmarks = prepared.labels.filter((l) => l.lm);

  const player = { x: spawn.x, n: spawn.n };
  let facing = 'up';
  let frame = 0;
  let strideAcc = 0;
  let posTimer = 0;

  let last = performance.now();
  function frameLoop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    const v = inputVector(keys);
    const speed = keys.run ? RUN_SPEED : WALK_SPEED;
    const moved = v.len > 0;
    if (moved) {
      const next = stepPlayer(grid, player, v.dx * speed * dt, v.dn * speed * dt, PLAYER_RADIUS);
      const realDist = Math.abs(next.x - player.x) + Math.abs(next.n - player.n);
      player.x = next.x;
      player.n = next.n;
      facing = facingFrom(v.dx, v.dn, facing);
      strideAcc += realDist;
      if (strideAcc >= STRIDE) {
        strideAcc = 0;
        frame = frame === 0 ? 1 : 0;
      }
    } else {
      frame = 0;
      strideAcc = 0;
    }

    const cam = { x: player.x, n: player.n, ppm: zoom };
    drawWorld(ctx, prepared, cam, W, H);
    drawTrainer(ctx, W / 2, H / 2 + 8, facing, frame, SPRITE_UNIT);

    posTimer += dt;
    if (posTimer > 0.2) {
      posTimer = 0;
      updateReadout(landmarks, player);
      hudZoom.textContent = `zoom ${zoom}× · ${(1 / zoom).toFixed(2)} m/px`;
    }
    requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(frameLoop);
}

function updateReadout(landmarks, player) {
  let best = null;
  let bestD = Infinity;
  for (const l of landmarks) {
    const d = Math.hypot(l.x - player.x, l.n - player.n);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  if (best) {
    hudPos.textContent = `near ${best.text} · ${Math.round(bestD)} m`;
  } else {
    hudPos.textContent = 'Châteaugiron';
  }
}

main().catch((err) => {
  hudPos.textContent = 'Failed to load the map.';
  console.error(err);
});
