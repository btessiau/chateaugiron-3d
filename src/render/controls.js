// First-person walking controller built on three.js PointerLockControls.
// Human eye height, walk and run speeds, WASD + mouse look.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

export class Walker {
  constructor(camera, domElement) {
    this.eyeHeight = 1.7;
    this.walkSpeed = 3.4; // m/s
    this.runSpeed = 8.5; // m/s
    this.controls = new PointerLockControls(camera, domElement);
    this.camera = camera;

    this.keys = { forward: false, back: false, left: false, right: false, run: false };
    this._velocity = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this.ground = null; // (x, z) => terrain height, or null for flat

    this._onKey = this._onKey.bind(this);
    document.addEventListener('keydown', (e) => this._onKey(e, true));
    document.addEventListener('keyup', (e) => this._onKey(e, false));
  }

  get object() {
    return this.controls.object;
  }

  lock() {
    this.controls.lock();
  }
  unlock() {
    this.controls.unlock();
  }
  get isLocked() {
    return this.controls.isLocked;
  }

  onLock(fn) {
    this.controls.addEventListener('lock', fn);
  }
  onUnlock(fn) {
    this.controls.addEventListener('unlock', fn);
  }

  setPosition(x, y, z) {
    this.controls.object.position.set(x, y, z);
  }

  setGround(fn) {
    this.ground = fn;
  }

  _onKey(e, down) {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.forward = down;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.keys.back = down;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.keys.left = down;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.keys.right = down;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keys.run = down;
        break;
      default:
        return;
    }
  }

  update(dt) {
    if (!this.controls.isLocked) return;
    const speed = this.keys.run ? this.runSpeed : this.walkSpeed;

    this._dir.set(0, 0, 0);
    if (this.keys.forward) this._dir.z += 1;
    if (this.keys.back) this._dir.z -= 1;
    if (this.keys.right) this._dir.x += 1;
    if (this.keys.left) this._dir.x -= 1;
    if (this._dir.lengthSq() > 0) this._dir.normalize();

    this.controls.moveForward(this._dir.z * speed * dt);
    this.controls.moveRight(this._dir.x * speed * dt);

    const p = this.controls.object.position;
    const gy = this.ground ? this.ground(p.x, p.z) : 0;
    p.y = gy + this.eyeHeight;
  }
}
