// Châteaugiron 3D — V0 entry point.
// Loads real OpenStreetMap data, builds the town at 1:1 scale, and lets you
// walk it in first person.

import * as THREE from 'three';
import { makeProjector, metresToLatLon } from './lib/geo.js';
import { makeHeightField } from './lib/terrain.js';
import { buildWorld, buildTerrain, buildGround } from './render/world.js';
import { Walker } from './render/controls.js';

const app = document.getElementById('app');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start');
const loadingEl = document.getElementById('loading');
const hudPos = document.getElementById('hud-pos');
const hudCount = document.getElementById('hud-count');

// ---- Renderer ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

// ---- Scene, sky, fog ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaccbef);
scene.fog = new THREE.Fog(0xbdd2ea, 420, 1600);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 4000);

// ---- Lights ----
const hemi = new THREE.HemisphereLight(0xbcd3ff, 0x55503f, 0.8);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff1dd, 2.5);
sun.position.set(-360, 520, 280);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
const S = 650;
Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 3000 });
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);
scene.add(sun.target);

// ---- Walker ----
const walker = new Walker(camera, renderer.domElement);

let data = null;
let ready = false;

async function init() {
  try {
    loadingEl.textContent = 'Loading map data…';
    const res = await fetch(`${import.meta.env.BASE_URL}data/chateaugiron.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    loadingEl.textContent = 'Map data missing. Run: npm run fetch-data';
    startBtn.textContent = 'No data';
    console.error(err);
    return;
  }

  const proj = makeProjector(data.meta.center);

  // Optional real terrain relief (IGN elevation). Falls back to flat if absent.
  let hf = null;
  try {
    const eres = await fetch(`${import.meta.env.BASE_URL}data/elevation.json`);
    if (eres.ok) hf = makeHeightField(await eres.json());
  } catch (err) {
    console.warn('No elevation data, using flat ground.', err);
  }

  loadingEl.textContent = 'Building the town…';

  // Let the browser paint the loading text before the heavy build.
  await new Promise((r) => setTimeout(r, 20));

  // Real aerial orthophoto for the ground (IGN). Optional.
  let ortho = null;
  try {
    ortho = await new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        `${import.meta.env.BASE_URL}textures/ortho.jpg`,
        resolve,
        undefined,
        reject,
      );
    });
    ortho.colorSpace = THREE.SRGBColorSpace;
    ortho.anisotropy = 8;
  } catch (err) {
    console.warn('No ortho texture, using plain ground.', err);
  }

  const world = buildWorld(scene, data, proj, hf, { skipGreen: !!ortho });
  if (hf) buildTerrain(scene, hf, ortho);
  else buildGround(scene, world.bounds);

  const groundAt = (x, z) => (hf ? hf.sample(x, z) : 0);

  // Spawn in an open spot near the château, looking toward it.
  const sp = world.spawn || { x: 18, z: 62 };
  walker.setGround(groundAt);
  walker.setPosition(sp.x, groundAt(sp.x, sp.z) + walker.eyeHeight, sp.z);
  camera.lookAt(0, groundAt(0, 0) + 6, 0);

  const c = data.meta.counts || {};
  hudCount.textContent = `${c.building || 0} buildings · ${c.road || 0} roads · ${c.water || 0} water · ${c.green || 0} green`;

  ready = true;
  startBtn.disabled = false;
  startBtn.textContent = 'Enter Châteaugiron';
  loadingEl.textContent = '';

  // Store projector + game internals for the HUD and for headless captures.
  window.__proj = proj;
  window.__game = { scene, camera, renderer, walker, getHeight: groundAt, hf };
}

startBtn.addEventListener('click', () => {
  if (ready) walker.lock();
});

walker.onLock(() => overlay.classList.add('hidden'));
walker.onUnlock(() => {
  overlay.classList.remove('hidden');
  startBtn.textContent = 'Resume walking';
});

// ---- HUD ----
let frame = 0;
function updateHud() {
  if (!ready || frame++ % 6 !== 0) return;
  const p = camera.position;
  const dist = Math.hypot(p.x, p.z).toFixed(0);
  let ll = '';
  if (window.__proj) {
    const g = metresToLatLon(window.__proj, p.x, p.z);
    ll = ` · ${g.lat.toFixed(5)}, ${g.lon.toFixed(5)}`;
  }
  hudPos.textContent = `${dist} m from château${ll}`;
}

// ---- Loop ----
const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
  walker.update(dt);
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

init();
