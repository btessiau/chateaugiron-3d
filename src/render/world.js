// Builds the 3D town from OpenStreetMap features: buildings extruded to real
// heights, road ribbons, the etang and other water, and green spaces.
// All pure maths lives in ../lib (unit tested); this file is the three.js glue.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildingHeight, baseHeight } from '../lib/osm.js';
import { pickSpawn } from '../lib/spawn.js';
import { orientedBox, gableRoofPositions } from '../lib/roof.js';
import { scatterInPolygon } from '../lib/scatter.js';
import { isChurch, isChapel, towerPlacement, pyramidPositions } from '../lib/landmark.js';
import {
  roadWidth,
  roadColor,
  buildRoadRibbon,
  boundsOf,
  isOversized,
  normalizeRing,
  polygonArea,
  doorwayGap,
} from '../lib/geometry.js';

// Build one thin oriented wall box between two ground points [x, z].
function wallBoxGeo(p0, p1, wallH, gy, th) {
  const dx = p1[0] - p0[0];
  const dz = p1[1] - p0[1];
  const len = Math.hypot(dx, dz);
  const g = new THREE.BoxGeometry(len + th, wallH, th);
  g.rotateY(Math.atan2(-dz, dx));
  g.translate((p0[0] + p1[0]) / 2, gy + wallH / 2, (p0[1] + p1[1]) / 2);
  return g;
}

// Approximate a wall with a run of small square colliders so the doorway gap
// stays open whatever angle the wall sits at.
function pushWallColliders(p0, p1, colliders, half = 0.6) {
  const dx = p1[0] - p0[0];
  const dz = p1[1] - p0[1];
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(len / 1.2));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = p0[0] + dx * t;
    const z = p0[1] + dz * t;
    colliders.push({ minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half });
  }
}

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

function slateColor(i) {
  // Breton roofs are mostly grey-blue slate, with a little tone variation.
  const r = (Math.sin(i * 78.233) * 43758.5453) % 1;
  const t = r - Math.floor(r);
  const hue = 0.58 + t * 0.04;
  const sat = 0.04 + ((i * 3) % 4) * 0.02;
  const lig = 0.28 + ((i * 5) % 6) * 0.022;
  return new THREE.Color().setHSL(hue, sat, lig);
}

// A tiling window pattern drawn on a canvas. One window per tile; the building
// material repeats it across facades in world units so windows are life sized.
function makeFacadeTexture() {
  const s = 128;
  const cv =
    typeof document !== 'undefined' && document.createElement
      ? document.createElement('canvas')
      : null;
  if (!cv) return null;
  cv.width = s;
  cv.height = s;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f0ebe1'; // near-white so the stone vertex colour shows
  ctx.fillRect(0, 0, s, s);

  // Window opening.
  const x0 = s * 0.28;
  const y0 = s * 0.14;
  const w = s * 0.44;
  const h = s * 0.6;
  ctx.fillStyle = '#c8bfae'; // stone frame
  ctx.fillRect(x0 - 4, y0 - 4, w + 8, h + 8);
  ctx.fillStyle = '#3d4a57'; // glass
  ctx.fillRect(x0, y0, w, h);
  // Mullions.
  ctx.strokeStyle = '#e7e0d3';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0 + w / 2, y0);
  ctx.lineTo(x0 + w / 2, y0 + h);
  ctx.moveTo(x0, y0 + h / 2);
  ctx.lineTo(x0 + w, y0 + h / 2);
  ctx.stroke();
  // Sill.
  ctx.fillStyle = '#b7ad9b';
  ctx.fillRect(x0 - 5, y0 + h + 3, w + 10, 4);

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Multiply a tiling facade texture onto the vertical walls of the merged
// building mesh, in world space, leaving roofs and flat tops untouched.
function applyFacade(mat, tex) {
  if (!tex) return;
  const scale = 1 / 3.0; // one window tile per ~3 m
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFacade = { value: tex };
    shader.uniforms.uFacadeScale = { value: scale };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      )
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\n  vWN = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D uFacade;\nuniform float uFacadeScale;\nvarying vec3 vWPos;\nvarying vec3 vWN;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 n = normalize(vWN);
          float up = smoothstep(0.45, 0.8, abs(n.y));
          float wx = abs(n.x);
          float wz = abs(n.z);
          float sum = wx + wz + 1e-4;
          vec3 tx = texture2D(uFacade, vWPos.zy * uFacadeScale).rgb;
          vec3 tz = texture2D(uFacade, vWPos.xy * uFacadeScale).rgb;
          vec3 wall = (tx * wx + tz * wz) / sum;
          diffuseColor.rgb = mix(diffuseColor.rgb * wall, diffuseColor.rgb, up);
        }`,
      );
  };
}

// A low-poly broadleaf tree: brown trunk plus a chunky green canopy, coloured by
// vertex so one InstancedMesh can draw the whole woodland.
function makeTreeGeometry() {
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, 1.7, 5).toNonIndexed();
  trunk.translate(0, 0.85, 0);
  paint(trunk, new THREE.Color(0x6b4f31));
  const c1 = new THREE.IcosahedronGeometry(1.6, 0);
  c1.scale(1, 0.9, 1);
  c1.translate(0, 2.7, 0);
  paint(c1, new THREE.Color(0x3f6b32));
  const c2 = new THREE.IcosahedronGeometry(1.15, 0);
  c2.translate(0.5, 3.7, 0.2);
  paint(c2, new THREE.Color(0x4c7d3a));
  return mergeGeometries([trunk, c1, c2], false);
}

function paint(geo, color) {
  setColorAttr(geo, color);
}

function isWooded(tags) {
  return (
    tags.landuse === 'forest' ||
    tags.landuse === 'orchard' ||
    tags.natural === 'wood' ||
    tags.natural === 'scrub'
  );
}

function treeSpacing(tags) {
  if (tags.landuse === 'orchard') return 9;
  if (tags.natural === 'scrub') return 12;
  return 8;
}

// Turn a church or chapel footprint into an enterable landmark: a hollow stone
// nave with a doorway, furniture and glowing glass, a steep slate roof, and a
// bell tower topped by a pyramidal spire that rises above the roof line.
function buildChurchInto(o) {
  const {
    pts,
    tags,
    cx,
    cz,
    groundY,
    buildingGeos,
    roofGeos,
    towerGeos,
    spireGeos,
    interiorGeos,
    decorMeshes,
    colliders,
  } = o;
  const chapel = isChapel(tags) && !isChurch(tags);
  const embed = 1.5;
  const wallH = chapel ? 6.5 : 11;
  const box = orientedBox(pts);
  const gy = groundY(cx, cz);

  if (box.L >= 4 && box.W >= 3) {
    buildChurchInterior({ box, gy, wallH, chapel, interiorGeos, decorMeshes, colliders });
  } else {
    // Too small to hollow out cleanly: keep a solid stone block.
    const shape = ringToShape(pts);
    if (shape) {
      try {
        const geo = new THREE.ExtrudeGeometry(shape, {
          depth: wallH + embed,
          bevelEnabled: false,
          steps: 1,
        });
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, gy - embed, 0);
        setColorAttr(geo, new THREE.Color(0x9c9484));
        buildingGeos.push(geo);
      } catch {
        /* skip degenerate footprint */
      }
    }
    colliders.push({ minX: cx - box.L, maxX: cx + box.L, minZ: cz - box.W, maxZ: cz + box.W });
  }

  if (box.L >= 1.5 && box.W >= 1.0) {
    const roofH = Math.min(Math.max(box.W * 1.05, 2.0), 7.5);
    const rp = gableRoofPositions(box, gy + wallH, roofH);
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rp), 3));
    rgeo.computeVertexNormals();
    setColorAttr(rgeo, new THREE.Color(0x333b47));
    roofGeos.push(rgeo);
  }

  // Bell tower + spire, rising from the roof line so the nave stays clear.
  const t = towerPlacement(box);
  const towerH = chapel ? 9 : 16;
  const towerBase = gy + wallH - 1;
  const tgeo = new THREE.BoxGeometry(t.half * 2, towerH, t.half * 2);
  tgeo.translate(t.x, towerBase + towerH / 2, t.z);
  towerGeos.push(tgeo);

  const spireH = chapel ? 6 : 15;
  const sp = pyramidPositions(
    t.x,
    t.z,
    towerBase + towerH,
    t.half * 1.05,
    spireH,
    box.ux,
    box.uz,
    box.vx,
    box.vz,
  );
  spireGeos.push(sp);
}

// Build the hollow, furnished, enterable inside of a church nave.
function buildChurchInterior(o) {
  const { box, gy, wallH, chapel, interiorGeos, decorMeshes, colliders } = o;
  const { cx, cz, ux, uz, vx, vz, L, W } = box;
  const th = 0.5;
  const angU = Math.atan2(-uz, ux);
  const angV = Math.atan2(-vz, vx);
  const stone = new THREE.Color(0xa79f90);
  const toWorld = (s, t) => [cx + ux * s + vx * t, cz + uz * s + vz * t];

  const floor = new THREE.BoxGeometry(2 * L, 0.3, 2 * W);
  floor.rotateY(angU);
  floor.translate(cx, gy - 0.15, cz);
  setColorAttr(floor, new THREE.Color(0x8f8676));
  interiorGeos.push(floor);

  const addWall = (a, b, h, y0, collide) => {
    const g = wallBoxGeo(a, b, h, y0, th);
    setColorAttr(g, stone);
    interiorGeos.push(g);
    if (collide) pushWallColliders(a, b, colliders, 0.55);
  };

  // Long side walls.
  for (const sign of [1, -1]) {
    addWall(toWorld(-L, sign * W), toWorld(L, sign * W), wallH, gy, true);
  }
  // Apse (far) wall, solid.
  addWall(toWorld(L, -W), toWorld(L, W), wallH, gy, true);

  // Entrance wall with a central doorway.
  const doorW = chapel ? 2.2 : 3.2;
  for (const p of doorwayGap(W, doorW)) {
    addWall(toWorld(-L, p.center - p.half), toWorld(-L, p.center + p.half), wallH, gy, true);
  }
  // Lintel over the doorway (no collider, walk under it).
  const lintelH = 1.1;
  addWall(
    toWorld(-L, -doorW / 2 - 0.2),
    toWorld(-L, doorW / 2 + 0.2),
    lintelH,
    gy + wallH - lintelH,
    false,
  );

  // Altar near the apse.
  const [ax, az] = toWorld(L - 1.6, 0);
  const altar = new THREE.BoxGeometry(1.0, 1.1, 2.0);
  altar.rotateY(angU);
  altar.translate(ax, gy + 0.55, az);
  setColorAttr(altar, new THREE.Color(0xd8cdb4));
  interiorGeos.push(altar);

  // Pews either side of a central aisle.
  const wood = new THREE.Color(0x6b4a2f);
  const aisle = 1.1;
  const blockHalf = (W * 0.82 - aisle) / 2;
  if (blockHalf > 0.4) {
    const blockCenter = aisle + blockHalf;
    for (let s = -L + 2.2; s <= L - 2.6; s += 1.5) {
      for (const sign of [1, -1]) {
        const [px, pz] = toWorld(s, sign * blockCenter);
        const pg = new THREE.BoxGeometry(blockHalf * 2, 0.85, 0.5);
        pg.rotateY(angV);
        pg.translate(px, gy + 0.42, pz);
        setColorAttr(pg, wood);
        interiorGeos.push(pg);
      }
    }
  }

  // Stained glass: glowing boxes set into the long walls.
  const palette = [0x3b6fd6, 0xd64b3b, 0xe3b23c, 0x2fa36b, 0x8a4fc7];
  const glassN = chapel ? 2 : 3;
  const glassH = Math.min(3.2, wallH * 0.5);
  let ci = 0;
  for (const sign of [1, -1]) {
    for (let k = 0; k < glassN; k++) {
      const s = -L + ((k + 1) * 2 * L) / (glassN + 1);
      const [gx, gz] = toWorld(s, sign * (W - 0.05));
      const gg = new THREE.BoxGeometry(1.2, glassH, 0.2);
      gg.rotateY(angU);
      gg.translate(gx, gy + wallH * 0.52, gz);
      decorMeshes.push(new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ color: palette[ci % 5] })));
      ci++;
    }
  }

  // Warm fill lights spaced along the nave so the whole interior reads.
  const nLights = Math.max(2, Math.round((2 * L) / 18));
  for (let i = 0; i < nLights; i++) {
    const s = -L + ((i + 0.5) / nLights) * 2 * L;
    const [lx, lz] = toWorld(s, 0);
    const light = new THREE.PointLight(0xffe7c4, chapel ? 16 : 30, 42, 1.0);
    light.position.set(lx, gy + wallH * 0.72, lz);
    decorMeshes.push(light);
  }
}

// A cylindrical stone turret with a conical slate roof (a "poivriere"),
// characteristic of French chateaux. Adds meshes straight into the group.
function addTurret(group, x, z, gy, radius, height, coneH, stoneMat, slateMat) {
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.05, height, 14),
    stoneMat,
  );
  shaft.position.set(x, gy + height / 2, z);
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  group.add(shaft);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(radius * 1.25, coneH, 14), slateMat);
  cone.position.set(x, gy + height + coneH / 2, z);
  cone.castShadow = true;
  group.add(cone);
}

// The Chateau de Chateaugiron: its signature is a tall round crenellated keep
// (the "grosse tour"). Placed at the real keep location, with two pepperpot
// turrets on the logis. Authored geometry, verified by screenshot.
function buildChateau(group, groundY, colliders) {
  const stone = new THREE.MeshStandardMaterial({ color: 0x8f887b, roughness: 0.9, metalness: 0.0 });
  const darkStone = new THREE.MeshStandardMaterial({
    color: 0x7d766a,
    roughness: 0.92,
    metalness: 0.0,
  });
  const slate = new THREE.MeshStandardMaterial({
    color: 0x2f3743,
    roughness: 0.6,
    metalness: 0.12,
  });

  // Round keep (donjon).
  const kx = -77;
  const kz = -27;
  const gy = groundY(kx, kz);
  const shaftH = 27;
  const rTop = 6.2;
  const rBot = 6.9;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, shaftH, 18), stone);
  shaft.position.set(kx, gy + shaftH / 2, kz);
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  group.add(shaft);

  // Corbel band (machicolation) just under the parapet.
  const band = new THREE.Mesh(new THREE.CylinderGeometry(rTop + 0.6, rTop, 1.6, 18), darkStone);
  band.position.set(kx, gy + shaftH + 0.8, kz);
  band.castShadow = true;
  group.add(band);

  // Crenellated parapet: alternating merlons around the rim.
  const merlonCount = 12;
  for (let i = 0; i < merlonCount; i++) {
    const a = (i / merlonCount) * Math.PI * 2;
    const mx = kx + Math.cos(a) * (rTop + 0.1);
    const mz = kz + Math.sin(a) * (rTop + 0.1);
    const merlon = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.2, 1.3), stone);
    merlon.position.set(mx, gy + shaftH + 1.7 + 1.1, mz);
    merlon.rotation.y = -a;
    merlon.castShadow = true;
    group.add(merlon);
  }
  colliders.push({ minX: kx - rBot, maxX: kx + rBot, minZ: kz - rBot, maxZ: kz + rBot });

  // Two pepperpot turrets flanking the logis.
  for (const [tx, tz] of [
    [-101, -14],
    [-79, 6],
  ]) {
    const tgy = groundY(tx, tz);
    addTurret(group, tx, tz, tgy, 3.1, 15, 8, darkStone, slate);
    colliders.push({ minX: tx - 3.4, maxX: tx + 3.4, minZ: tz - 3.4, maxZ: tz + 3.4 });
  }
}

// Build one InstancedMesh for a list of tree placements ({ x, z, s }).
function instanceTrees(placements, groundY) {
  if (!placements.length) return null;
  const geo = makeTreeGeometry();
  if (!geo) return null;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, placements.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scl = new THREE.Vector3();
  const pos = new THREE.Vector3();
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    q.setFromAxisAngle(up, (i * 2.399963) % (Math.PI * 2));
    scl.set(p.s, p.s * (0.9 + (i % 5) * 0.05), p.s);
    pos.set(p.x, groundY(p.x, p.z) - 0.2, p.z);
    m.compose(pos, q, scl);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// Scatter instanced trees across every wooded polygon, up to a budget.
function buildTrees(group, woods, groundY) {
  const MAX = 16000;
  const placements = [];
  let seed = 1;
  for (const w of woods) {
    if (placements.length >= MAX) break;
    const pts = scatterInPolygon(w.ring, w.spacing, seed++);
    for (const p of pts) {
      placements.push(p);
      if (placements.length >= MAX) break;
    }
  }
  const mesh = instanceTrees(placements, groundY);
  if (mesh) group.add(mesh);
}

// Instance individual mapped trees from projected [lon, lat] points.
export function addTreePoints(scene, points, proj, groundY) {
  const placements = points.map((ll, i) => {
    const [x, z] = proj.project(ll[0], ll[1]);
    const r = (Math.sin(i * 45.11) * 43758.5453) % 1;
    const t = r - Math.floor(r);
    return { x, z, s: 0.85 + t * 0.7 };
  });
  const mesh = instanceTrees(placements, groundY);
  if (mesh) scene.add(mesh);
  return mesh;
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

export function buildWorld(scene, data, proj, hf = null, options = {}) {
  const project = (lonlat) => proj.project(lonlat[0], lonlat[1]);
  const groundY = (x, z) => (hf ? hf.sample(x, z) : 0);
  const skipGreen = !!options.skipGreen;
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const track = (x, z) => {
    if (x < bounds.minX) bounds.minX = x;
    if (x > bounds.maxX) bounds.maxX = x;
    if (z < bounds.minZ) bounds.minZ = z;
    if (z > bounds.maxZ) bounds.maxZ = z;
  };

  const buildingGeos = [];
  const roofGeos = [];
  const towerGeos = [];
  const spireGeos = [];
  const interiorGeos = [];
  const decorMeshes = [];
  const waterGeos = [];
  const greenGeos = [];
  const roadPos = [];
  const roadCol = [];
  const bCentroids = [];
  const colliders = [];
  const woods = [];

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

      // Churches and chapels become enterable landmarks: a hollow stone nave with
      // a doorway, furniture and glowing glass, a steep slate roof, and a bell
      // tower topped by a spire. They get their own wall colliders (not a solid
      // footprint block) so the player can walk inside.
      if (isChurch(f.t) || isChapel(f.t)) {
        buildChurchInto({
          pts,
          tags: f.t,
          cx,
          cz,
          groundY,
          buildingGeos,
          roofGeos,
          towerGeos,
          spireGeos,
          interiorGeos,
          decorMeshes,
          colliders,
        });
        bi++;
        continue;
      }

      colliders.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });

      const shape = ringToShape(pts);
      if (!shape) continue;
      const base = baseHeight(f.t);
      const top = buildingHeight(f.t, polygonArea(pts), bi);
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
      setColorAttr(geo, hashHue(bi));
      buildingGeos.push(geo);

      // Pitched slate roof on top of the wall. Skip tiny footprints and very
      // large ones (big commercial or civic blocks read better flat).
      const box = orientedBox(pts);
      const area4 = 4 * box.L * box.W;
      if (box.L >= 1.5 && box.W >= 1.0 && box.W <= 22 && area4 <= 2200) {
        const roofH = Math.min(Math.max(box.W * 0.8, 1.0), 4.5);
        const wallTop = groundY(cx, cz) + base + Math.max(1.5, top - base);
        const rp = gableRoofPositions(box, wallTop, roofH);
        const rgeo = new THREE.BufferGeometry();
        rgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rp), 3));
        rgeo.computeVertexNormals();
        setColorAttr(rgeo, slateColor(bi));
        roofGeos.push(rgeo);
      }
      bi++;
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
      if (isWooded(f.t)) woods.push({ ring: pts, spacing: treeSpacing(f.t) });
      if (skipGreen) continue;
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
    applyFacade(mat, makeFacadeTexture());
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (roofGeos.length) {
    const merged = mergeGeometries(roofGeos, false);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (towerGeos.length) {
    const merged = mergeGeometries(towerGeos, false);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x9c9484,
      roughness: 0.85,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (interiorGeos.length) {
    const merged = mergeGeometries(interiorGeos, false);
    merged.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  for (const m of decorMeshes) group.add(m);

  if (spireGeos.length) {
    let total = 0;
    for (const s of spireGeos) total += s.length;
    const arr = new Float32Array(total);
    let off = 0;
    for (const s of spireGeos) {
      arr.set(s, off);
      off += s.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2f3743,
      roughness: 0.6,
      metalness: 0.12,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
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

  let waterGeo = null;
  if (waterGeos.length) {
    waterGeo = mergeGeometries(waterGeos, false);
  }

  scene.add(group);

  buildTrees(group, woods, groundY);
  buildChateau(group, groundY, colliders);

  return {
    bounds,
    counts: data.meta?.counts || {},
    spawn: pickSpawn(bCentroids),
    colliders,
    waterGeo,
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
// the mesh reproduces the measured elevations exactly. An optional aerial
// orthophoto is draped on top, mapped 1:1 to the world.
export function buildTerrain(scene, hf, texture = null) {
  const geo = new THREE.PlaneGeometry(hf.size, hf.size, hf.n - 1, hf.n - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, hf.sample(x, z));
    uv.setXY(i, (x + hf.half) / hf.size, (z + hf.half) / hf.size);
  }
  pos.needsUpdate = true;
  uv.needsUpdate = true;
  geo.computeVertexNormals();
  const mat = texture
    ? new THREE.MeshStandardMaterial({ map: texture, roughness: 0.97, metalness: 0 })
    : new THREE.MeshStandardMaterial({ color: 0x6f7551, roughness: 1.0, metalness: 0 });
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
