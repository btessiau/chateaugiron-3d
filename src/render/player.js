// Dual-mode player controller: first person and third person, switchable with V.
// Mouse look drives yaw and pitch, WASD moves relative to the camera, Space
// jumps, Shift runs. Pure maths lives in ../lib/camera.js (unit tested).

import * as THREE from 'three';
import { moveVector, orbitOffset, clampPitch } from '../lib/camera.js';

export class Player {
  constructor(camera, domElement, avatar = null) {
    this.camera = camera;
    this.dom = domElement;
    this.avatar = avatar;

    this.eyeHeight = 1.7;
    this.walkSpeed = 3.4; // m/s
    this.runSpeed = 8.5; // m/s
    this.jumpSpeed = 6.0;
    this.gravity = 18.0;

    this.mode = 'third'; // 'first' | 'third'
    this.dist = 6.5; // third-person camera distance
    this.yaw = 0;
    this.pitch = -0.15;

    this.pos = new THREE.Vector3();
    this.vy = 0;
    this.onGround = true;
    this.ground = null;
    this.collider = null;
    this.radius = 0.45;

    this.keys = { forward: false, back: false, left: false, right: false, run: false };
    this._locked = false;
    this._lockFns = [];
    this._unlockFns = [];
    this._sens = 0.0022;
    this._heading = 0;
    this._moving = false;
    this._running = false;

    document.addEventListener('pointerlockchange', () => this._onLockChange());
    document.addEventListener('keydown', (e) => this._onKey(e, true));
    document.addEventListener('keyup', (e) => this._onKey(e, false));
    document.addEventListener('mousemove', (e) => this._onMouse(e));

    this.camera.rotation.order = 'YXZ';
  }

  lock() {
    this.dom.requestPointerLock();
  }
  unlock() {
    document.exitPointerLock();
  }
  get isLocked() {
    return this._locked;
  }
  onLock(fn) {
    this._lockFns.push(fn);
  }
  onUnlock(fn) {
    this._unlockFns.push(fn);
  }

  setGround(fn) {
    this.ground = fn;
  }
  setCollider(fn) {
    this.collider = fn;
  }
  setPosition(x, y, z) {
    this.pos.set(x, y, z);
    this._placeAvatar();
  }

  _onLockChange() {
    this._locked = document.pointerLockElement === this.dom;
    (this._locked ? this._lockFns : this._unlockFns).forEach((f) => f());
  }

  _onMouse(e) {
    if (!this._locked) return;
    this.yaw -= e.movementX * this._sens;
    this.pitch = clampPitch(this.pitch - e.movementY * this._sens);
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
      case 'Space':
        if (down && this.onGround) {
          this.vy = this.jumpSpeed;
          this.onGround = false;
        }
        break;
      case 'KeyV':
        if (down) this.mode = this.mode === 'third' ? 'first' : 'third';
        break;
      default:
        return;
    }
  }

  _groundAt(x, z) {
    return this.ground ? this.ground(x, z) : 0;
  }

  update(dt) {
    if (this._locked) {
      const speed = this.keys.run ? this.runSpeed : this.walkSpeed;
      const mv = moveVector(this.keys, this.yaw, speed, dt);
      if (mv.moving) {
        this.pos.x += mv.dx;
        this.pos.z += mv.dz;
        this._heading = mv.heading;
      }
      if (this.collider) {
        const [nx, nz] = this.collider(this.pos.x, this.pos.z, this.radius);
        this.pos.x = nx;
        this.pos.z = nz;
      }
      this._moving = mv.moving;
      this._running = this.keys.run && mv.moving;

      // Gravity and jump.
      this.vy -= this.gravity * dt;
      let feetY = this.pos.y + this.vy * dt;
      const gy = this._groundAt(this.pos.x, this.pos.z);
      if (feetY <= gy) {
        feetY = gy;
        this.vy = 0;
        this.onGround = true;
      } else {
        this.onGround = false;
      }
      this.pos.y = feetY;

      this._placeCamera();
    } else {
      this.pos.y = this._groundAt(this.pos.x, this.pos.z);
      this._moving = false;
      this._running = false;
    }

    this._placeAvatar();
    if (this.avatar) this.avatar.update(dt);
  }

  _placeCamera() {
    if (this.mode === 'first') {
      this.camera.position.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    } else {
      const tx = this.pos.x;
      const ty = this.pos.y + 1.5;
      const tz = this.pos.z;
      const off = orbitOffset(this.yaw, this.pitch, this.dist);
      this.camera.position.set(tx + off.x, ty + off.y, tz + off.z);
      this.camera.lookAt(tx, ty, tz);
    }
  }

  _placeAvatar() {
    if (!this.avatar) return;
    this.avatar.root.visible = this.mode === 'third';
    this.avatar.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.avatar.root.rotation.y = this._heading;
    let state = 'Idle';
    if (!this.onGround) state = 'Jump';
    else if (this._running) state = 'Running';
    else if (this._moving) state = 'Walking';
    this.avatar.setState(state);
  }
}
