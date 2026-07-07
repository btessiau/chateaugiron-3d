// Builds the 3D town from OpenStreetMap features: buildings extruded to real
// heights, road ribbons, the étang and other water, and green spaces.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ROAD_WIDTH = {
  motorway: 12, trunk: 11, primary: 10, secondary: 8, tertiary: 6.5,
  unclassified: 5, residential: 5, living_street: 4.5, service: 3.5,
  pedestrian: 4, footway: 1.8, path: 1.6, cycleway: 2, track: 3, steps: 1.5,
};
const ROAD_COLOR = {
  primary: 0x3a3d42, secondary: 0x3d4045, tertiary: 0x42454a,
  residential: 0x46494e, service: 0x4a4d52, pedestrian: 0x6a5f4d,
  footway: 0x6f6350, path: 0x6f6350, cycleway: 0x4a4457, steps: 0x6f6350,
};
const DEFAULT_ROAD_W = 4;
const DEFAULT_ROAD_C = 0x45484d;

function parseMeters(v) {
  if (v == null) return null;
  const m = String(v).match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function buildingHeight(t) {
  let h = parseMeters(t.height);
  if (h == null) {
    const lvl = parseFloat(t['building:levels']);
    if (!isNaN(lvl)) h = lvl * 3.1 + 0.6;
  }
  if (h == null) h = 7.5;
  return Math.max(2.5, h);
}

function baseHeight(t) {
  const b = parseMeters(t.min_height);
  return b == null ? 0 : b;
}

function ringToShape(pts) {
  // pts: array of [x, z]. Shape uses (x, -z) so that after rotateX(-90°)
  // the polygon lands back at the correct (x, z) with +Z = north.
  let p = pts.slice();
  const a = p[0], b = p[p.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) p = p.slice(0, -1);
  if (p.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(p[0][0], -p[0][1]);
  for (let i = 1; i < p.length; i++) shape.lineTo(p[i][0], -p[i][1]);
  shape.closePath();
  return shape;
}

function setColorAttr(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

function hashHue(i) {
  // Deterministic warm stone / render palette for facade variety.
  const r = (Math.sin(i * 12.9898) * 43758.5453) % 1;
  const t = r - Math.floor(r);
  const hue = 0.09 + t * 0.05;          // warm (orange/tan) band
  const sat = 0.12 + ((i * 7) % 5) * 0.03;
  const lig = 0.58 + ((i * 13) % 7) * 0.02;
  return new THREE.Color().setHSL(hue, sat, lig);
}

export function buildWorld(scene, data, proj) {
  const project = (lonlat) => proj.project(lonlat[0], lonlat[1]);
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const track = (x, z) => {
    if (x < bounds.minX) bounds.minX = x; if (x > bounds.maxX) bounds.maxX = x;
    if (z < bounds.minZ) bounds.minZ = z; if (z > bounds.maxZ) bounds.maxZ = z;
  };

  const buildingGeos = [];
  const waterGeos = [];
  const greenGeos = [];
  const roadPos = [];
  const roadCol = [];
  const bCentroids = []; // for spawn selection

  let bi = 0;
  for (const f of data.features) {
    const pts = f.g.map(project);
    for (const [x, z] of pts) track(x, z);

    if (f.k === 'building') {
      // Skip stand-alone 3D parts (they overlap the main building) for V0.
      if (f.t['building:part'] && !f.t.building) continue;
      // Skip absurdly large footprints — almost always a data anomaly.
      let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
      for (const [x, z] of pts) { if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (z < mnz) mnz = z; if (z > mxz) mxz = z; }
      if (mxx - mnx > 350 || mxz - mnz > 350) continue;
      bCentroids.push({ x: (mnx + mxx) / 2, z: (mnz + mxz) / 2, r: 0.5 * Math.hypot(mxx - mnx, mxz - mnz) });

      const shape = ringToShape(pts);
      if (!shape) continue;
      const base = baseHeight(f.t);
      const top = buildingHeight(f.t);
      const depth = Math.max(1.5, top - base);
      let geo;
      try {
        geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
      } catch { continue; }
      geo.rotateX(-Math.PI / 2);
      if (base > 0) geo.translate(0, base, 0);
      setColorAttr(geo, hashHue(bi++));
      buildingGeos.push(geo);
    } else if (f.k === 'water') {
      const shape = ringToShape(pts);
      if (!shape) continue;
      let geo;
      try { geo = new THREE.ShapeGeometry(shape); } catch { continue; }
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, 0.1, 0);
      waterGeos.push(geo);
    } else if (f.k === 'green') {
      const shape = ringToShape(pts);
      if (!shape) continue;
      let geo;
      try { geo = new THREE.ShapeGeometry(shape); } catch { continue; }
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, 0.03, 0);
      greenGeos.push(geo);
    } else if (f.k === 'road') {
      addRoad(pts, f.t, roadPos, roadCol);
    }
  }

  const group = new THREE.Group();

  // Buildings — one merged mesh, coloured per building.
  if (buildingGeos.length) {
    const merged = mergeGeometries(buildingGeos, false);
    merged.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Green spaces.
  if (greenGeos.length) {
    const merged = mergeGeometries(greenGeos, false);
    const mat = new THREE.MeshStandardMaterial({ color: 0x5c7f45, roughness: 1.0, metalness: 0 });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Roads.
  if (roadPos.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(roadPos), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(roadCol), 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Water (the étang and friends).
  if (waterGeos.length) {
    const merged = mergeGeometries(waterGeos, false);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2f6d86, roughness: 0.18, metalness: 0.15, transparent: true, opacity: 0.92,
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  scene.add(group);

  return {
    bounds,
    counts: data.meta?.counts || {},
    spawn: pickSpawn(bCentroids),
    disposed: () => {},
  };
}

// Choose an open spot near the château to spawn, so the first view is the town
// rather than the inside of a wall. Picks the candidate with the most clearance.
function pickSpawn(centroids) {
  const radii = [55, 80, 110];
  const N = 28;
  let best = { x: 0, z: 95, clr: -Infinity };
  for (const R of radii) {
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = Math.cos(a) * R;
      const z = Math.sin(a) * R;
      let clr = Infinity;
      for (const b of centroids) {
        const d = Math.hypot(x - b.x, z - b.z) - b.r;
        if (d < clr) clr = d;
      }
      if (clr > best.clr) best = { x, z, clr };
    }
  }
  return best;
}

function addRoad(pts, tags, outPos, outCol) {
  const w = (ROAD_WIDTH[tags.highway] ?? DEFAULT_ROAD_W) / 2;
  const c = new THREE.Color(ROAD_COLOR[tags.highway] ?? DEFAULT_ROAD_C);
  const y = 0.06;

  // Perpendicular of each segment, in the X/Z plane.
  const segN = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dz = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) { segN.push(null); continue; }
    segN.push([-dz / len, dx / len]);
  }

  // Average adjacent segment normals to get a per-vertex offset direction.
  const vN = [];
  for (let i = 0; i < pts.length; i++) {
    const a = segN[i - 1] || null;
    const b = segN[i] || null;
    let nx = 0, nz = 0;
    if (a) { nx += a[0]; nz += a[1]; }
    if (b) { nx += b[0]; nz += b[1]; }
    const len = Math.hypot(nx, nz);
    if (len < 1e-4) { vN.push(null); continue; }
    vN.push([nx / len, nz / len]);
  }

  const push = (x, z) => { outPos.push(x, y, z); outCol.push(c.r, c.g, c.b); };

  for (let i = 0; i < pts.length - 1; i++) {
    const n0 = vN[i], n1 = vN[i + 1];
    if (!n0 || !n1) continue;
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[i + 1];
    const l0 = [x0 + n0[0] * w, z0 + n0[1] * w];
    const r0 = [x0 - n0[0] * w, z0 - n0[1] * w];
    const l1 = [x1 + n1[0] * w, z1 + n1[1] * w];
    const r1 = [x1 - n1[0] * w, z1 - n1[1] * w];
    // two triangles: l0, r0, l1  and  r0, r1, l1
    push(l0[0], l0[1]); push(r0[0], r0[1]); push(l1[0], l1[1]);
    push(r0[0], r0[1]); push(r1[0], r1[1]); push(l1[0], l1[1]);
  }
}

export function buildGround(scene, bounds) {
  const margin = 250;
  const w = (bounds.maxX - bounds.minX) + margin * 2;
  const h = (bounds.maxZ - bounds.minZ) + margin * 2;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const size = Math.max(w, h, 800);
  const geo = new THREE.PlaneGeometry(size, size);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x6d7353, roughness: 1.0, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, 0, cz);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}
