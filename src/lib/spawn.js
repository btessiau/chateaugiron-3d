// Choose an open spot near the origin (the château) to spawn the player, so the
// first view is the town rather than the inside of a wall. Picks the candidate
// point with the most clearance from building centroids.

export function pickSpawn(centroids) {
  const radii = [55, 80, 110];
  const count = 28;
  let best = { x: 0, z: 95, clr: -Infinity };
  for (const radius of radii) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      let clearance = Infinity;
      for (const b of centroids) {
        const d = Math.hypot(x - b.x, z - b.z) - b.r;
        if (d < clearance) clearance = d;
      }
      if (clearance > best.clr) best = { x, z, clr: clearance };
    }
  }
  return best;
}
