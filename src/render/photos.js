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

  const geo = new THREE.OctahedronGeometry(1);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x6fd0e6,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, points.length);
  mesh.name = 'photoMarkers';
  mesh.renderOrder = 2;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3(0.32, 0.5, 0.32);
  const pos = new THREE.Vector3();
  points.forEach((pt, i) => {
    pos.set(pt.x, groundY(pt.x, pt.z) + 3.5, pt.z);
    m.compose(pos, q, scl);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { points, mesh };
}
