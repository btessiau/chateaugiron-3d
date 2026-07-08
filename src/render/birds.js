// A few birds lazily circling over the town, to give the empty sky some life
// and pair with the birdsong ambience. Each bird is a simple solid chevron: two
// thin wings that meet at the body, in a flat unlit dark grey. No textures and
// no alpha, so they render as a clean little gull silhouette everywhere instead
// of the black boxes a transparent sprite can leave behind. They orbit on varied
// circles with a gentle bob, bank along their heading and beat their wings.

import * as THREE from 'three';

// Two wings, each built so its inner end sits at the origin so a z-rotation
// lifts or drops the tip (the wing-beat). One extends to +x, the other to -x.
function wingGeometry(dir) {
  const g = new THREE.BoxGeometry(1, 0.06, 0.24);
  g.translate(0.5 * dir, 0, 0);
  return g;
}

export function buildBirds(count = 10, center = { x: -40, z: -120 }) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x3b3f47 });
  const rightGeo = wingGeometry(1);
  const leftGeo = wingGeometry(-1);
  const group = new THREE.Group();
  const birds = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < count; i++) {
    const bird = new THREE.Group();
    const size = 2.4 + rnd() * 1.8;
    const right = new THREE.Mesh(rightGeo, mat);
    const left = new THREE.Mesh(leftGeo, mat);
    bird.add(right);
    bird.add(left);
    bird.scale.setScalar(size);
    group.add(bird);
    birds.push({
      bird,
      left,
      right,
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
        b.bird.position.set(
          center.x + Math.cos(a) * b.r,
          b.h + Math.sin(t * 0.8 + b.phase) * b.bob,
          center.z + Math.sin(a) * b.r,
        );
        // Face along the circle tangent (direction of travel).
        b.bird.rotation.y = -a + (b.speed > 0 ? -Math.PI / 2 : Math.PI / 2);
        // Wing-beat: a shallow dihedral that opens and closes, tips up.
        const beat = 0.28 + 0.32 * Math.abs(Math.sin(t * b.flap + b.phase));
        b.right.rotation.z = beat;
        b.left.rotation.z = -beat;
      }
    },
  };
}
