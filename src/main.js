// Châteaugiron 3D — V0 entry point.
// Loads real OpenStreetMap data, builds the town at 1:1 scale, and lets you
// walk it in first person.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { makeProjector, metresToLatLon } from './lib/geo.js';
import { makeHeightField } from './lib/terrain.js';
import { buildGrid, collide } from './lib/collision.js';
import { sunPosition } from './lib/sun.js';
import {
  buildWorld,
  buildTerrain,
  buildGround,
  addTreePoints,
  windUniform,
} from './render/world.js';
import { Player } from './render/player.js';
import { Avatar } from './render/avatar.js';
import { Minimap } from './render/minimap.js';
import { compassFromYaw } from './lib/minimap.js';
import { addPhotoPoints } from './render/photos.js';
import { addLandmarkPhotos } from './render/landmarkPhotos.js';
import { nearestIndex } from './lib/nearest.js';
import { Ambience } from './render/ambience.js';
import { buildNPCs } from './render/npcs.js';
import { buildBirds } from './render/birds.js';

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
const soundEl = document.getElementById('sound');

// Gentle public-domain outdoor ambience, started by the Enter gesture.
const ambience = new Ambience(`${import.meta.env.BASE_URL}audio/ambience.ogg`);
function updateSoundLabel() {
  if (soundEl) soundEl.textContent = ambience.muted ? '🔇 sound' : '🔊 sound';
}
function toggleSound() {
  ambience.toggleMute();
  updateSoundLabel();
}
if (soundEl) soundEl.addEventListener('click', toggleSound);

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
sky.material.uniforms.turbidity.value = 4.0;
sky.material.uniforms.rayleigh.value = 2.4;
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
const S = 420;
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

// ---- Postprocessing ----
// The scene renders into an HDR, multisampled buffer so image effects can be
// layered without losing edge antialiasing. Ambient occlusion adds the soft
// contact shadow where walls meet the street and under the eaves, a gentle
// bloom lifts only the brightest speculars, and the final pass tone maps back
// to the screen. This is the biggest single step toward a photographic look.
const drawSize = renderer.getDrawingBufferSize(new THREE.Vector2());
const hdrTarget = new THREE.WebGLRenderTarget(drawSize.x, drawSize.y, {
  type: THREE.HalfFloatType,
  samples: 4,
});
const composer = new EffectComposer(renderer, hdrTarget);
composer.addPass(new RenderPass(scene, camera));

const gtao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
gtao.output = GTAOPass.OUTPUT.Default;
gtao.updateGtaoMaterial({
  radius: 0.75,
  distanceExponent: 1.0,
  thickness: 1.2,
  scale: 1.0,
  samples: 16,
  distanceFallOff: 1.0,
  screenSpaceRadius: false,
});
composer.addPass(gtao);

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.16,
  0.5,
  0.9,
);
composer.addPass(bloom);

composer.addPass(new OutputPass());

function renderFrame() {
  composer.render();
}

// ---- Walker ----
let player = null;
let avatar = null;
let npcs = null;
let birds = null;
let water = null;
let waterNormals = null;

// A few birds circling over the old town, for a little life in the sky.
birds = buildBirds();
scene.add(birds.group);

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

  // A few idle townsfolk in the open ground ahead of the spawn, so the town
  // feels lived in the moment you enter. Placed along the initial view
  // direction with lateral spread, on the terrain, facing varied ways.
  try {
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const layout = [
      { f: 12, p: -5, yaw: 2.7 },
      { f: 17, p: 8, yaw: -1.4 },
      { f: 23, p: -11, yaw: 3.9, scale: 1.03 },
      { f: 21, p: 4, yaw: 0.5 },
      { f: 29, p: -3, yaw: 3.2, scale: 0.94 },
      { f: 14, p: 14, yaw: -2.4, scale: 0.97 },
    ];
    const specs = layout.map((l) => ({
      x: sp.x + fwd.x * l.f + side.x * l.p,
      z: sp.z + fwd.z * l.f + side.z * l.p,
      yaw: l.yaw,
      scale: l.scale,
    }));

    // A few more people at the two landmarks the player walks to, so the town
    // is alive there too. Each spot is nudged out of any building by the same
    // collider used for the player, so nobody stands inside a wall.
    const pushPerson = (x, z, tx, tz, scale) => {
      const [nx, nz] = collide(grid, world.colliders, x, z, 0.6);
      specs.push({ x: nx, z: nz, yaw: Math.atan2(tx - nx, tz - nz), scale });
    };
    const ch = world.landmarks && world.landmarks.church;
    if (ch && ch.box) {
      const { cx, cz, ux, uz, vx, vz, L } = ch.box;
      const tw = (s, t) => [cx + ux * s + vx * t, cz + uz * s + vz * t];
      const [dx, dz] = tw(-L, 0); // the church door
      let p = tw(-L - 4, -3.5);
      pushPerson(p[0], p[1], dx, dz, 1.0);
      p = tw(-L - 6.5, 3);
      pushPerson(p[0], p[1], dx, dz, 0.97);
    }
    const kp = world.landmarks && world.landmarks.keep;
    if (kp) {
      const dirx = Math.cos(kp.doorA);
      const dirz = Math.sin(kp.doorA);
      const gx = kp.kx + dirx * (kp.rWall + 3.5);
      const gz = kp.kz + dirz * (kp.rWall + 3.5);
      pushPerson(gx - dirz * 3, gz + dirx * 3, kp.kx, kp.kz, 1.02);
      pushPerson(gx + dirz * 2.5, gz - dirx * 2.5, kp.kx, kp.kz, 0.98);
    }

    npcs = await buildNPCs(
      `${import.meta.env.BASE_URL}models/gltf/casual_male.glb`,
      specs,
      groundAt,
    );
    scene.add(npcs.group);
  } catch (err) {
    console.warn('No townsfolk.', err);
    npcs = null;
  }

  const c = data.meta.counts || {};
  hudCount.textContent = `${c.building || 0} buildings · ${c.road || 0} roads · ${c.water || 0} water · ${c.green || 0} green`;

  ready = true;
  startBtn.disabled = false;
  startBtn.textContent = 'Enter Châteaugiron';
  loadingEl.textContent = '';

  // Store projector + game internals for the HUD and for headless captures.
  window.__proj = proj;
  window.__game = {
    scene,
    camera,
    renderer,
    player,
    avatar,
    getHeight: groundAt,
    hf,
    water,
    ambience,
    landmarks: world.landmarks,
    render: renderFrame,
  };
}

startBtn.addEventListener('click', () => {
  ambience.start();
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
  } else if (e.code === 'KeyM') {
    toggleSound();
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
  windUniform.value += dt;
  if (player) player.update(dt);
  if (npcs) npcs.update(dt);
  if (birds) birds.update(dt);
  if (waterNormals) {
    waterNormals.offset.x += dt * 0.012;
    waterNormals.offset.y += dt * 0.009;
  }
  updateHud();
  renderFrame();
  requestAnimationFrame(tick);
}
tick();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

init();
