// Loads the animated CC0 avatar (RobotExpressive by Tomas Laulhe / Don McCurdy)
// and drives its animation states. Scaled to about 1.8 m and standing on y=0.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class Avatar {
  constructor() {
    this.root = new THREE.Group();
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.ready = false;
  }

  async load(url) {
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

    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    this.ready = true;
    this.setState('Idle');
    return this;
  }

  setState(name) {
    if (!this.ready || this.current === name || !this.actions[name]) return;
    const next = this.actions[name];
    next.reset().fadeIn(0.2).play();
    if (this.current && this.actions[this.current]) this.actions[this.current].fadeOut(0.2);
    this.current = name;
  }

  update(dt) {
    if (this.mixer) this.mixer.update(dt);
  }
}
