// Builds the 3D town from OpenStreetMap features: buildings extruded to real
// heights, road ribbons, the etang and other water, and green spaces.
// All pure maths lives in ../lib (unit tested); this file is the three.js glue.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildingHeight, baseHeight } from '../lib/osm.js';
import { pickSpawn } from '../lib/spawn.js';
import {
  roadWidth,
  roadColor,
  buildRoadRibbon,
  boundsOf,
  isOversized,
  normalizeRing,
} from '../lib/geometry.js';

function ringToShape(pts) {
  // pts: array of [x, z]. Shape uses (x, -z) so that after rotateX(-90 deg)
  // the polygon lands back at the correct (x, z) with +Z = north.
  const p = normalizeRing(pts);
  if (!p) return null;
  const shape = new THREE.Shape();
  shape.moveTo(p[0][0], -p[0][1]);
  for (let i = 1; i < p.length; i++) shape.lineTo(p[i][0], -p[i][1]);
  shape.closePath();
  return shape;
}

function setColorAttr(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

function hashHue(i) {
  // Deterministic warm stone palette for facade variety.
  const r = (Math.sin(i * 12.9898) * 43758.5453) % 1;
  const t = r - Math.floor(r);
  const hue = 0.09 + t * 0.05;
  const sat = 0.12 + ((i * 7) % 5) * 0.03;
  const lig = 0.58 + ((i * 13) % 7) * 0.02;
  return new THREE.Color().setHSL(hue, sat, lig);
}

// Push each vertex of a flat, world-space geometry up onto the terrain.
function drapeGeo(geo, groundY, offset) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, groundY(pos.getX(i), pos.getZ(i)) + offset);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

export function buildWorld(scene, data, proj, hf = null) {
  const project = (lonlat) => proj.project(lonlat[0], lonlat[1]);
  const groundY = (x, z) => (hf ? hf.sample(x, z) : 0);
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const track = (x, z) => {
    if (x < bounds.minX) bounds.minX = x;
    if (x > bounds.maxX) bounds.maxX = x;
    if (z < bounds.minZ) bounds.minZ = z;
    if (z > bounds.maxZ) bounds.maxZ = z;
  };

  const buildingGeos = [];
  const waterGeos = [];
  const greenGeos = [];
  const roadPos = [];
  const roadCol = [];
  const bCentroids = [];

  let bi = 0;
  for (const f of data.features) {
    const pts = f.g.map(project);
    for (const [x, z] of pts) track(x, z);

    if (f.k === 'building') {
      if (f.t['building:part'] && !f.t.building) continue;
      const b = boundsOf(pts);
      if (isOversized(b)) continue;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      bCentroids.push({
        x: cx,
        z: cz,
        r: 0.5 * Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ),
      });

      const shape = ringToShape(pts);
      if (!shape) continue;
      const base = baseHeight(f.t);
      const top = buildingHeight(f.t);
      const embed = 1.5; // sink the base into the terrain so slopes leave no gap
      const depth = Math.max(1.5, top - base) + embed;
      let geo;
      try {
        geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
      } catch {
        continue;
      }
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, groundY(cx, cz) + base - embed, 0);
      setColorAttr(geo, hashHue(bi++));
      buildingGeos.push(geo);
    } else if (f.k === 'water') {
      const shape = ringToShape(pts);
      if (!shape) continue;
      let geo;
      try {
        geo = new THREE.ShapeGeometry(shape);
      } catch {
        continue;
      }
      geo.rotateX(-Math.PI / 2);
      const wb = boundsOf(pts);
      const wy = groundY((wb.minX + wb.maxX) / 2, (wb.minZ + wb.maxZ) / 2);
      geo.translate(0, wy + 0.1, 0);
      waterGeos.push(geo);
    } else if (f.k === 'green') {
      const shape = ringToShape(pts);
      if (!shape) continue;
      let geo;
      try {
        geo = new THREE.ShapeGeometry(shape);
      } catch {
        continue;
      }
      geo.rotateX(-Math.PI / 2);
      drapeGeo(geo, groundY, 0.03);
      greenGeos.push(geo);
    } else if (f.k === 'road') {
      addRoad(pts, f.t, roadPos, roadCol, groundY);
    }
  }

  const group = new THREE.Group();

  if (buildingGeos.length) {
    const merged = mergeGeometries(buildingGeos, false);
    merged.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (greenGeos.length) {
    const merged = mergeGeometries(greenGeos, false);
    const mat = new THREE.MeshStandardMaterial({ color: 0x5c7f45, roughness: 1.0, metalness: 0 });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (roadPos.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(roadPos), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(roadCol), 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (waterGeos.length) {
    const merged = mergeGeometries(waterGeos, false);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2f6d86,
      roughness: 0.18,
      metalness: 0.15,
      transparent: true,
      opacity: 0.92,
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

function addRoad(pts, tags, outPos, outCol, groundY) {
  const ribbon = buildRoadRibbon(pts, roadWidth(tags.highway), 0);
  if (!ribbon.length) return;
  const c = new THREE.Color(roadColor(tags.highway));
  for (let i = 0; i < ribbon.length; i += 3) {
    const x = ribbon[i];
    const z = ribbon[i + 2];
    outPos.push(x, groundY(x, z) + 0.06, z);
    outCol.push(c.r, c.g, c.b);
  }
}

// Real terrain relief from the IGN heightfield. Vertices align to the grid, so
// the mesh reproduces the measured elevations exactly.
export function buildTerrain(scene, hf) {
  const geo = new THREE.PlaneGeometry(hf.size, hf.size, hf.n - 1, hf.n - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, hf.sample(pos.getX(i), pos.getZ(i)));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x6f7551, roughness: 1.0, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

export function buildGround(scene, bounds) {
  const margin = 250;
  const w = bounds.maxX - bounds.minX + margin * 2;
  const h = bounds.maxZ - bounds.minZ + margin * 2;
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
