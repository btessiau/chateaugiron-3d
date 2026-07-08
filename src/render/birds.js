// A few birds lazily circling over the town, to give the empty sky some life
// and pair with the birdsong ambience. Each bird is a camera-facing sprite with
// a soft gull silhouette; they orbit on varied circles with a gentle bob and a
// subtle wing-beat (horizontal scale oscillation). Kept small in number and dark
// grey so they read as distant birds, not specks.

import * as THREE from 'three';

function gullTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.clearRect(0, 0, s, s);
  g.strokeStyle = 'rgba(40,42,48,1)';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 6;
  // A shallow "M" gull shape: two wings dipping to a body in the middle.
  g.beginPath();
  g.moveTo(6, 26);
  g.quadraticCurveTo(20, 40, 32, 30);
  g.quadraticCurveTo(44, 40, 58, 26);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildBirds(count = 10, center = { x: -40, z: -120 }) {
  const tex = gullTexture();
  const group = new THREE.Group();
  const birds = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    });
    const sprite = new THREE.Sprite(mat);
    const size = 3.2 + rnd() * 2.2;
    sprite.scale.set(size, size * 0.5, 1);
    group.add(sprite);
    birds.push({
      sprite,
      size,
      r: 40 + rnd() * 120,
      h: 48 + rnd() * 34,
      phase: rnd() * Math.PI * 2,
      speed: (0.05 + rnd() * 0.08) * (rnd() < 0.5 ? -1 : 1),
      bob: 2 + rnd() * 3,
      flap: 6 + rnd() * 5,
    });
  }
  let t = 0;
  return {
    group,
    update(dt) {
      t += dt;
      for (const b of birds) {
        const a = b.phase + t * b.speed;
        b.sprite.position.set(
          center.x + Math.cos(a) * b.r,
          b.h + Math.sin(t * 0.8 + b.phase) * b.bob,
          center.z + Math.sin(a) * b.r,
        );
        const wing = 0.72 + 0.28 * Math.abs(Math.sin(t * b.flap + b.phase));
        b.sprite.scale.set(b.size * wing, b.size * 0.5, 1);
      }
    },
  };
}
