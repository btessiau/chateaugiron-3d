// Loads an animated CC0 avatar and drives its animation states. Scaled to about
// 1.8 m and standing on y = 0. Works with several models by resolving common
// clip name aliases (Walk/Walking, Run/Running).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { resolveClip } from '../lib/clip.js';
import { skinToneFor } from '../lib/skin.js';

const CLIP_ALIASES = {
  Idle: ['Idle'],
  Walking: ['Walking', 'Walk'],
  Running: ['Running', 'Run'],
  Jump: ['Jump', 'JumpUp', 'Running', 'Run'],
};

// A soft round contact shadow that sits under the feet so the character reads as
// planted on the ground instead of floating. It is a child of the avatar root, so
// it follows the walker and hides with it in first person.
function makeContactShadow() {
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
    opacity: 0.9,
  });
  const geo = new THREE.PlaneGeometry(1.5, 1.5);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.03;
  mesh.renderOrder = 2;
  return mesh;
}

export class Avatar {
  constructor() {
    this.root = new THREE.Group();
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.ready = false;
    this.root.add(makeContactShadow());
  }

  async load(url, options = {}) {
    const modelYaw = options.modelYaw || 0;
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    const model = gltf.scene;
    model.traverse((o) => {
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

    // Scale to a human height, then drop so the feet rest on y = 0.
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y;
    if (h > 0) model.scale.setScalar(1.8 / h);
    const box2 = new THREE.Box3().setFromObject(model);
    model.position.y -= box2.min.y;
    model.rotation.y = modelYaw;

    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    this.ready = true;
    this.setState('Idle');
    return this;
  }

  _resolve(name) {
    return resolveClip(Object.keys(this.actions), CLIP_ALIASES[name] || [name]);
  }

  setState(name) {
    if (!this.ready || this.current === name) return;
    const clip = this._resolve(name);
    if (!clip) return;
    const next = this.actions[clip];
    next.reset().fadeIn(0.2).play();
    if (this.current) {
      const prev = this._resolve(this.current);
      if (prev && prev !== clip) this.actions[prev].fadeOut(0.2);
    }
    this.current = name;
  }

  update(dt) {
    if (this.mixer) this.mixer.update(dt);
  }
}
