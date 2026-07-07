// Loads an animated CC0 avatar and drives its animation states. Scaled to about
// 1.8 m and standing on y = 0. Works with several models by resolving common
// clip name aliases (Walk/Walking, Run/Running).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CLIP_ALIASES = {
  Idle: ['Idle'],
  Walking: ['Walking', 'Walk'],
  Running: ['Running', 'Run'],
  Jump: ['Jump', 'JumpUp', 'Running', 'Run'],
};

export class Avatar {
  constructor() {
    this.root = new THREE.Group();
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.ready = false;
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
    const names = CLIP_ALIASES[name] || [name];
    for (const n of names) {
      if (this.actions[n]) return n;
    }
    return null;
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
