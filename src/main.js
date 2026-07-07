// Châteaugiron 3D — V0 entry point.
// Loads real OpenStreetMap data, builds the town at 1:1 scale, and lets you
// walk it in first person.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { makeProjector, metresToLatLon } from './lib/geo.js';
import { makeHeightField } from './lib/terrain.js';
import { buildGrid, collide } from './lib/collision.js';
import { sunPosition } from './lib/sun.js';
import { buildWorld, buildTerrain, buildGround, addTreePoints } from './render/world.js';
import { Player } from './render/player.js';
import { Avatar } from './render/avatar.js';
import { Minimap } from './render/minimap.js';
import { compassFromYaw } from './lib/minimap.js';
import { addPhotoPoints } from './render/photos.js';
import { addLandmarkPhotos } from './render/landmarkPhotos.js';
import { nearestIndex } from './lib/nearest.js';

const app = document.getElementById('app');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start');
const loadingEl = document.getElementById('loading');
const hudPos = document.getElementById('hud-pos');
const hudCount = document.getElementById('hud-count');
const compassEl = document.getElementById('compass');
const minimapEl = document.getElementById('minimap');
let minimap = null;
let photoLayer = null;
const photoEl = document.getElementById('photo');
const photoImg = document.getElementById('photo-img');
const photoCap = document.getElementById('photo-cap');
const photoClose = document.getElementById('photo-close');

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
scene.fog = new THREE.Fog(0xbdd2ea, 500, 1900);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 4000);

// Physical sky dome with a sun disc. The sun direction is shared with the
// directional light below so shadows line up with the visible sun.
const SUN_ELEV = 42;
const SUN_AZIM = 138;
const sunDir = sunPosition(SUN_ELEV, SUN_AZIM, 1);
const sky = new Sky();
sky.scale.setScalar(10000);
sky.material.uniforms.turbidity.value = 3.2;
sky.material.uniforms.rayleigh.value = 1.4;
sky.material.uniforms.mieCoefficient.value = 0.006;
sky.material.uniforms.mieDirectionalG.value = 0.8;
sky.material.uniforms.sunPosition.value.set(sunDir.x, sunDir.y, sunDir.z);
scene.add(sky);

// Bake the sky into an environment map, used only as a reflection for the
// water below (not for scene lighting, which would blow out the buildings).
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
const skyEnv = pmrem.fromScene(sky, 0, 0.1, 100000).texture;
pmrem.dispose();

// ---- Lights ----
const hemi = new THREE.HemisphereLight(0xc4d8ff, 0x8a8168, 1.1);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff1dd, 2.6);
sun.position.set(sunDir.x * 700, sunDir.y * 700, sunDir.z * 700);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
const S = 650;
Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 3000 });
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);
scene.add(sun.target);

// Soft sky fill from the shaded side so north faces and foliage undersides do
// not read as black. No shadows and low intensity, so it lifts the dark sides
// without flattening the sunlit look.
const fill = new THREE.DirectionalLight(0xaec6ea, 0.5);
fill.position.set(-sunDir.x * 600, 420, -sunDir.z * 600);
scene.add(fill);

// ---- Walker ----
let player = null;
let avatar = null;
let water = null;
let waterNormals = null;

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

  // Real aerial orthophoto for the ground (IGN). Optional. A wide, softer photo
  // covers the whole terrain, and a sharper photo of the town core is draped on
  // top so the ground the player actually walks on holds detail up close.
  const loadTex = (name) =>
    new Promise((resolve) => {
      new THREE.TextureLoader().load(
        `${import.meta.env.BASE_URL}textures/${name}`,
        (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 16;
          resolve(t);
        },
        undefined,
        () => resolve(null),
      );
    });
  const ortho = await loadTex('ortho.jpg');
  const orthoCore = await loadTex('ortho-core.jpg');
  if (!ortho) console.warn('No ortho texture, using plain ground.');

  const world = buildWorld(scene, data, proj, hf, { skipGreen: !!ortho });
  if (hf) {
    buildTerrain(scene, hf, ortho);
    if (orthoCore) buildTerrain(scene, hf, orthoCore, { size: 1500 });
  } else buildGround(scene, world.bounds);

  // North-up minimap built once from the projected town features.
  try {
    minimap = new Minimap(minimapEl).build(data.features, proj);
  } catch (err) {
    console.warn('Minimap unavailable.', err);
    minimap = null;
  }

  // Animated water for the etang and streams: a low-roughness surface that
  // reflects the baked sky environment and catches a sun glint.
  if (world.waterGeo) {
    const normals = new THREE.TextureLoader().load(
      `${import.meta.env.BASE_URL}textures/waternormals.jpg`,
    );
    normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
    normals.repeat.set(0.12, 0.12);
    waterNormals = normals;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x183d52,
      roughness: 0.06,
      metalness: 0.0,
      normalMap: normals,
      normalScale: new THREE.Vector2(0.45, 0.45),
      envMap: skyEnv,
      envMapIntensity: 0.8,
      transparent: true,
      opacity: 0.94,
    });
    water = new THREE.Mesh(world.waterGeo, mat);
    water.receiveShadow = true;
    scene.add(water);
  }

  const groundAt = (x, z) => (hf ? hf.sampleSmooth(x, z) : 0);

  // Individual mapped trees (OSM natural=tree), instanced. Optional.
  try {
    const tres = await fetch(`${import.meta.env.BASE_URL}data/trees.json`);
    if (tres.ok) {
      const td = await tres.json();
      if (td.trees && td.trees.length) addTreePoints(scene, td.trees, proj, groundAt);
    }
  } catch (err) {
    console.warn('No tree data.', err);
  }

  // Real street photos of the town (Panoramax). Markers plus a P-key viewer
  // that shows the nearest actual photograph of where the player stands.
  try {
    const pres = await fetch(`${import.meta.env.BASE_URL}data/panoramax.json`);
    if (pres.ok) {
      const pd = await pres.json();
      if (pd.photos && pd.photos.length) {
        photoLayer = addPhotoPoints(scene, pd.photos, proj, groundAt);
      }
    }
  } catch (err) {
    console.warn('No street photos.', err);
  }

  // Real CC-licensed landmark photos: the actual church altar and organ inside
  // the church, and a heritage board with the real château by the keep gate.
  try {
    await addLandmarkPhotos(scene, world.landmarks, import.meta.env.BASE_URL);
  } catch (err) {
    console.warn('No landmark photos.', err);
  }

  // Animated CC0 avatar for third person. Optional.
  avatar = new Avatar();
  try {
    await avatar.load(`${import.meta.env.BASE_URL}models/gltf/casual_male.glb`, { modelYaw: 0 });
    scene.add(avatar.root);
  } catch (err) {
    console.warn('No avatar model, third person disabled.', err);
    avatar = null;
  }

  player = new Player(camera, renderer.domElement, avatar);
  player.onLock(onLock);
  player.onUnlock(onUnlock);

  // Building collision from footprint boxes in a spatial grid.
  const grid = buildGrid(world.colliders, 24);
  player.setCollider((x, z, r) => collide(grid, world.colliders, x, z, r));

  // Spawn in an open spot near the château, looking toward it.
  const sp = world.spawn || { x: 18, z: 62 };
  player.setGround(groundAt);
  player.setPosition(sp.x, groundAt(sp.x, sp.z), sp.z);
  // Frame the avatar from behind, looking toward the château.
  player.yaw = Math.atan2(sp.x, sp.z);
  player._placeCamera();

  const c = data.meta.counts || {};
  hudCount.textContent = `${c.building || 0} buildings · ${c.road || 0} roads · ${c.water || 0} water · ${c.green || 0} green`;

  ready = true;
  startBtn.disabled = false;
  startBtn.textContent = 'Enter Châteaugiron';
  loadingEl.textContent = '';

  // Store projector + game internals for the HUD and for headless captures.
  window.__proj = proj;
  window.__game = { scene, camera, renderer, player, avatar, getHeight: groundAt, hf, water };
}

startBtn.addEventListener('click', () => {
  if (ready) player.lock();
});

function onLock() {
  overlay.classList.add('hidden');
}
function onUnlock() {
  if (photoOpen) return;
  overlay.classList.remove('hidden');
  startBtn.textContent = 'Resume';
}

// Real street-photo viewer. Shows the nearest actual Panoramax photograph of
// where the player stands. Acts like a pause screen while open.
let photoOpen = false;
function openNearestPhoto() {
  if (!photoLayer || !photoLayer.points.length || !player) return;
  const pp = player.pos || camera.position;
  const { index, distance } = nearestIndex(photoLayer.points, pp.x, pp.z);
  if (index < 0) return;
  const ph = photoLayer.points[index];
  photoImg.src = ph.sd;
  photoCap.innerHTML =
    `Real photo of this spot · ${Math.round(distance)} m away · camera facing ${ph.az}° · ${ph.at}<br>` +
    `© ${ph.by}, <a href="https://panoramax.fr" target="_blank" rel="noopener">Panoramax</a>, licensed CC BY-SA 4.0`;
  photoEl.classList.remove('hidden');
  photoOpen = true;
  if (document.exitPointerLock) document.exitPointerLock();
}
function closePhoto() {
  if (!photoOpen) return;
  photoEl.classList.add('hidden');
  photoOpen = false;
  overlay.classList.remove('hidden');
  startBtn.textContent = 'Resume';
}
photoClose.addEventListener('click', closePhoto);
photoEl.addEventListener('click', (e) => {
  if (e.target === photoEl) closePhoto();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') {
    e.preventDefault();
    if (photoOpen) closePhoto();
    else openNearestPhoto();
  } else if (e.code === 'Escape' && photoOpen) {
    closePhoto();
  }
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
  if (player && minimap) {
    const pp = player.pos || p;
    minimap.draw(pp.x, pp.z, player.yaw);
    const c = compassFromYaw(player.yaw);
    compassEl.textContent = `${c.cardinal} · ${c.deg.toFixed(0)}°`;
    if (photoLayer && photoLayer.points.length) {
      const n = nearestIndex(photoLayer.points, pp.x, pp.z);
      hudPos.textContent += ` · real photo ${Math.round(n.distance)} m (P)`;
    }
  }
}

// ---- Loop ----
const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (player) player.update(dt);
  if (waterNormals) {
    waterNormals.offset.x += dt * 0.012;
    waterNormals.offset.y += dt * 0.009;
  }
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
