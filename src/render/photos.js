// Places subtle markers at the real Panoramax photo capture points and keeps a
// projected list the app uses to find the nearest actual photograph of where
// the player stands. Imagery © Panoramax contributors, CC BY-SA 4.0.

import * as THREE from 'three';

export function addPhotoPoints(scene, photos, proj, groundY) {
  const points = [];
  for (const p of photos) {
    const [x, z] = proj.project(p.lon, p.lat);
    points.push({ x, z, ...p });
  }
  if (!points.length) return { points, mesh: null };

  const geo = new THREE.OctahedronGeometry(0.5);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x39d7ff,
    transparent: true,
    opacity: 0.66,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, points.length);
  mesh.name = 'photoMarkers';
  const m = new THREE.Matrix4();
  points.forEach((pt, i) => {
    m.makeTranslation(pt.x, groundY(pt.x, pt.z) + 2.7, pt.z);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { points, mesh };
}
