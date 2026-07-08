// Entry point for the 2D top-down (Pokemon-style) map of Châteaugiron.
// It reuses the exact same OSM data and projection as the 3D game, so the
// streets, walkable paths and one-block-per-building all match reality 1:1.

import { makeProjector } from './lib/geo.js';
import {
  featureBounds,
  makeGrid,
  fillPolygon,
  stampSegment,
  roadHalfWidth,
  inputVector,
  facingFrom,
  glide,
  findOpenSpawn,
  classifyLandmark,
  isWalkableWay,
  ringCentroid,
  nearestPoint,
  mapTargets,
  namedPlaces,
  nearestWithin,
  travelSpeed,
} from './lib/map2d.js';
import {
  prepareFeatures,
  drawWorld,
  buildMinimapBase,
  drawMinimap,
  MARKER_COLOR,
} from './map2d/render2d.js';
import { drawTrainer } from './map2d/sprite.js';
import { treeSpots, lampSpots, benchSpots } from './lib/props2d.js';

const PLAYER_RADIUS = 0.6;
const STRIDE = 0.42; // metres per walk-frame flip
const SPRITE_UNIT = 2.4;

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const mini = document.getElementById('mini');
const mctx = mini.getContext('2d');
const hudPos = document.getElementById('pos');
const hudZoom = document.getElementById('zoom');
const hudMode = document.getElementById('mode');
const intro = document.getElementById('intro');
const placard = document.getElementById('placard');

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

const keys = { up: false, down: false, left: false, right: false, run: false, bike: false };
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
  } else if (e.code === 'KeyB') {
    keys.bike = !keys.bike;
    updateMode();
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

// Show whether the player is on foot or on the bicycle.
function updateMode() {
  if (!hudMode) return;
  hudMode.textContent = keys.bike ? 'cycling' : 'on foot';
  hudMode.classList.toggle('bike', keys.bike);
}

async function main() {
  resize();
  const res = await fetch(`${import.meta.env.BASE_URL}data/chateaugiron.json`);
  const data = await res.json();
  const proj = makeProjector(data.meta.center);
  const project = proj.project;

  const prepared = prepareFeatures(data.features, project);

  // Little 2.5D props: real OSM trees, lamp posts along the streets, and a couple
  // of benches in each park. Trees come from their own OSM extract.
  let treePts = [];
  try {
    const tr = await fetch(`${import.meta.env.BASE_URL}data/trees.json`);
    const td = await tr.json();
    treePts = td.trees || [];
  } catch {
    treePts = [];
  }
  const props = {
    trees: treeSpots(treePts, project),
    lamps: lampSpots(prepared.roads),
    benches: benchSpots(data.features, project),
  };

  // Collision grid. The map starts fully blocked; we carve the road and path
  // network as the only passable ground, then re-block any building or water on
  // top. So the player can only ever move on real streets and walkable paths.
  const bounds = featureBounds(data.features, project);
  const grid = makeGrid(bounds, 1);
  grid.data.fill(1);
  for (const f of data.features) {
    if (f.k !== 'road') continue;
    const hw = roadHalfWidth(f.t && f.t.highway);
    const pts = f.g.map((p) => project(p[0], p[1]));
    for (let i = 0; i + 1 < pts.length; i++) {
      stampSegment(grid, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], hw, 0);
    }
  }
  for (const f of data.features) {
    if (f.k === 'building' || f.k === 'water') {
      fillPolygon(
        grid,
        f.g.map((p) => project(p[0], p[1])),
      );
    }
  }

  // Road vertices, split into walkable ways and everything else. Used to seed
  // the spawn and the landmark jumps on open ground (roads are never blocked).
  const walkVerts = [];
  const roadVerts = [];
  for (const f of data.features) {
    if (f.k !== 'road') continue;
    const bucket = isWalkableWay(f.t && f.t.highway) ? walkVerts : roadVerts;
    for (const p of f.g) bucket.push(project(p[0], p[1]));
  }
  const seedVerts = walkVerts.length ? walkVerts : roadVerts;

  // Move onto the nearest open street to a world point, so we never land inside
  // a building.
  function openStreetNear(tx, tn) {
    const near = nearestPoint(seedVerts, tx, tn) || { x: tx, n: tn };
    return findOpenSpawn(grid, near.x, near.n, PLAYER_RADIUS);
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
  }
  const spawn = openStreetNear(spawnX, spawnN);

  // Real, locatable landmarks for the "near ..." readout, the minimap markers
  // and the jump menu (church, château, the étang and the jardin).
  const targets = mapTargets(data.features, project);

  // Every named building, for the "you are at ..." placard when the player
  // walks up to one.
  const places = namedPlaces(data.features, project);

  // Whole-town minimap, pre-rendered once, plus the "jump to" buttons.
  const miniBase = buildMinimapBase(prepared, bounds, mini.width);

  const player = { x: spawn.x, n: spawn.n };
  let facing = 'up';
  let frame = 0;
  let strideAcc = 0;
  let posTimer = 0;

  // Small debug hook (mirrors the 3D game's window.__game) so headless probes
  // can jump the camera and read the player position.
  if (typeof window !== 'undefined') {
    window.__map2d = {
      get pos() {
        return { x: player.x, n: player.n };
      },
      setPos(x, n) {
        player.x = x;
        player.n = n;
      },
      setZoom(z) {
        zoom = z;
      },
    };
  }

  // Jump to a landmark by kind, landing on the nearest open street to it.
  function jumpTo(kind) {
    const t = targets.find((x) => x.kind === kind);
    if (!t) return;
    const s = openStreetNear(t.x, t.n);
    player.x = s.x;
    player.n = s.n;
    if (intro && !intro.classList.contains('hidden')) intro.classList.add('hidden');
  }

  // Build the jump buttons from the landmarks that actually exist, with a
  // colour dot matching the minimap marker. Number keys 1..n jump too.
  const jumpBox = document.getElementById('jump');
  jumpBox.textContent = '';
  const jumpKeys = {};
  targets.forEach((t, i) => {
    const btn = document.createElement('button');
    const dot = document.createElement('i');
    dot.className = 'd';
    dot.style.background = MARKER_COLOR[t.kind] || '#c98a2a';
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(t.label));
    btn.addEventListener('click', () => {
      jumpTo(t.kind);
      btn.blur();
    });
    jumpBox.appendChild(btn);
    if (i < 9) jumpKeys[`Digit${i + 1}`] = t.kind;
  });
  window.addEventListener('keydown', (e) => {
    if (jumpKeys[e.code]) jumpTo(jumpKeys[e.code]);
  });
  updateMode();

  let last = performance.now();
  function frameLoop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    const v = inputVector(keys);
    const speed = travelSpeed(keys);
    const moved = v.len > 0;
    if (moved) {
      const next = glide(grid, player, v.dx * speed * dt, v.dn * speed * dt, PLAYER_RADIUS);
      const realDist = Math.abs(next.x - player.x) + Math.abs(next.n - player.n);
      player.x = next.x;
      player.n = next.n;
      facing = facingFrom(v.dx, v.dn, facing);
      // On the bike the wheels spin fast; on foot the legs flip every stride.
      strideAcc += realDist;
      const strideStep = keys.bike ? STRIDE * 1.6 : STRIDE;
      if (strideAcc >= strideStep) {
        strideAcc = 0;
        frame = frame === 0 ? 1 : 0;
      }
    } else {
      frame = 0;
      strideAcc = 0;
    }

    const cam = { x: player.x, n: player.n, ppm: zoom };
    drawWorld(ctx, prepared, cam, W, H, props);
    drawTrainer(ctx, W / 2, H / 2 + 8, facing, frame, SPRITE_UNIT, keys.bike);
    drawMinimap(mctx, miniBase, player, targets, cam, W, H);

    posTimer += dt;
    if (posTimer > 0.2) {
      posTimer = 0;
      updateReadout(targets, player);
      updatePlacard(places, player);
      hudZoom.textContent = `zoom ${zoom}× · ${(1 / zoom).toFixed(2)} m/px`;
    }
    requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(frameLoop);
}

function updateReadout(targets, player) {
  let best = null;
  let bestD = Infinity;
  for (const t of targets) {
    const d = Math.hypot(t.x - player.x, t.n - player.n);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  if (best) {
    hudPos.textContent = `near ${best.label} · ${Math.round(bestD)} m`;
  } else {
    hudPos.textContent = 'Châteaugiron';
  }
}

// Raise a placard naming the building the player is standing at, once they are
// within a few metres of a named place. Hidden again as they walk away.
let placardName = null;
function updatePlacard(places, player) {
  const hit = nearestWithin(places, player.x, player.n, 12);
  const name = hit ? hit.place.label : null;
  if (name === placardName) return;
  placardName = name;
  if (name) {
    placard.textContent = name;
    placard.classList.add('show');
  } else {
    placard.classList.remove('show');
  }
}

main().catch((err) => {
  hudPos.textContent = 'Failed to load the map.';
  console.error(err);
});
