// Idle townsfolk. Loads the CC0 human once and clones it (skeleton + meshes)
// into several standing people with the Idle animation, so the town feels
// inhabited. Each clone shares the source materials (already skin-corrected),
// gets its own animation mixer, a contact shadow, and rests on the terrain.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { skinToneFor, SKIN_LINEAR } from '../lib/skin.js';

const SHIRTS = [
  '#3a4a63',
  '#6d3b3b',
  '#4b5d3a',
  '#7a6a3f',
  '#843c2e',
  '#2f5561',
  '#8a8f96',
  '#55506a',
];
const PANTS = ['#2b2f3a', '#3b3326', '#4a4a4a', '#25384a', '#5a4632', '#33302b'];
const HAIR = ['#2a1c0a', '#5a3a18', '#8a6a2a', '#cbb47a', '#5a5a5a', '#d8d8d8', '#12100c'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Give one cloned townsperson their own materials with varied clothing, hair
// and skin, so the crowd does not look like copies of one man.
function varyMaterials(model, rng) {
  const shirt = SHIRTS[(rng() * SHIRTS.length) | 0];
  const pants = PANTS[(rng() * PANTS.length) | 0];
  const hair = HAIR[(rng() * HAIR.length) | 0];
  const skinMul = 0.8 + rng() * 0.45;
  model.traverse((o) => {
    if (!o.isMesh) return;
    const arr = Array.isArray(o.material) ? o.material : [o.material];
    const out = arr.map((m) => {
      const c = m.clone();
      const n = String(c.name || '').toLowerCase();
      if (n === 'shirt') c.color.set(shirt);
      else if (n === 'pants') c.color.set(pants);
      else if (n === 'hair') c.color.set(hair);
      else if (n === 'skin' || n === 'face' || n === 'head' || n === 'body') {
        c.color.setRGB(SKIN_LINEAR.r * skinMul, SKIN_LINEAR.g * skinMul, SKIN_LINEAR.b * skinMul);
      }
      return c;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
}

function contactShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.24)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    opacity: 0.85,
  });
  const geo = new THREE.PlaneGeometry(1.4, 1.4);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.03;
  mesh.renderOrder = 2;
  return mesh;
}

export async function buildNPCs(url, specs, getHeight) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const src = gltf.scene;
  src.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const tone = m && m.color ? skinToneFor(m.name) : null;
        if (tone) m.color.setRGB(tone.r, tone.g, tone.b);
      }
    }
  });

  const idle = gltf.animations.find((c) => /idle/i.test(c.name)) || gltf.animations[0] || null;

  const group = new THREE.Group();
  const mixers = [];
  let idx = 0;
  for (const s of specs) {
    const model = cloneSkinned(src);
    varyMaterials(model, mulberry32(0x9e37 + idx * 2654435761));
    idx += 1;
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y;
    if (h > 0) model.scale.setScalar((1.8 * (s.scale || 1)) / h);
    const box2 = new THREE.Box3().setFromObject(model);
    model.position.y -= box2.min.y;
    model.rotation.y = s.yaw || 0;

    const root = new THREE.Group();
    root.add(model);
    root.add(contactShadow());
    root.position.set(s.x, getHeight(s.x, s.z), s.z);
    group.add(root);

    if (idle) {
      const mixer = new THREE.AnimationMixer(model);
      const action = mixer.clipAction(idle);
      action.time = Math.random() * idle.duration;
      action.play();
      mixers.push(mixer);
    }
  }

  return {
    group,
    update(dt) {
      for (const m of mixers) m.update(dt);
    },
  };
}
