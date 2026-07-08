// Builds the 3D town from OpenStreetMap features: buildings extruded to real
// heights, road ribbons, the etang and other water, and green spaces.
// All pure maths lives in ../lib (unit tested); this file is the three.js glue.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildingHeight, baseHeight } from '../lib/osm.js';
import { pickSpawn } from '../lib/spawn.js';
import { orientedBox, gableRoofPositions } from '../lib/roof.js';
import { chimneyFor } from '../lib/chimney.js';
import { scatterInPolygon } from '../lib/scatter.js';
import { lampPointsAlong } from '../lib/streetlamps.js';
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

// A single wind clock shared by every swaying material. main.js advances
// `windUniform.value` by the frame delta each tick, so trees and grass lean on
// the same breeze. Kept as one object so all injected shaders read one uniform.
export const windUniform = { value: 0 };

const glf = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

// Inject a gentle vertex sway into a standard material. The displacement grows
// with local height (so trunks and blade roots stay put), varies its phase by
// instance world position, and is applied before the instance matrix so it
// rotates naturally per instance. Only touches foliage and grass, which cast no
// shadows, so no custom depth material is needed.
function applyWind(mat, { speed = 1.1, amp = 0.3, href = 7.5 } = {}) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniform;
    shader.vertexShader =
      'uniform float uWindTime;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float wPhase = instanceMatrix[3].x * 0.12 + instanceMatrix[3].z * 0.12;
          float hn = clamp(position.y / ${glf(href)}, 0.0, 1.0);
          transformed.x += sin(uWindTime * ${glf(speed)} + wPhase) * hn * ${glf(amp)};
          transformed.z += cos(uWindTime * ${glf(speed * 0.8)} + wPhase) * hn * ${glf(amp * 0.7)};
        }`,
      );
  };
}

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

// A curated palette of real French/Breton town facade tones: lime-render
// creams and whites, warm beiges, pale stone and greige, with the odd pale
// ochre or grey-blue. Commons colours are listed more than once so they turn
// up more often than the rare accents.
const FACADE_PALETTE = [
  0xefe9dc, 0xefe9dc, 0xe9dfc9, 0xe9dfc9, 0xe3d7bd, 0xe3d7bd, 0xdccfb2, 0xdccfb2, 0xd6c8a6,
  0xcfc3aa, 0xe6ddcb, 0xe6ddcb, 0xd2c4a2, 0xcbb896, 0xd8cbb8, 0xc7b79a, 0xd0bfa0, 0xc3b5a4,
  0xcabfae, 0xb9a98f,
].map((hex) => new THREE.Color(hex));

function fract01(x) {
  return x - Math.floor(x);
}

function hashHue(i) {
  // Pick a facade tone deterministically, then jitter its lightness a little so
  // neighbours sharing a tone are not pixel-identical.
  const r = fract01(Math.sin(i * 12.9898) * 43758.5453);
  const base = FACADE_PALETTE[Math.floor(r * FACADE_PALETTE.length)];
  const c = base.clone();
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const jl = (fract01(Math.sin(i * 45.164) * 21421.1) - 0.5) * 0.08;
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + jl)));
  return c;
}

function slateColor(i) {
  // Per-roof tint that multiplies the real slate photo (the roof material map).
  // Kept near white so the photo colour dominates, with a faint Breton blue-grey
  // shift and a little lightness variation from house to house. If the texture is
  // ever missing the roofs fall back to a pale slate blue, not black.
  const t = fract01(Math.sin(i * 78.233) * 43758.5453);
  const hue = 0.58 + t * 0.03;
  const sat = 0.05 + ((i * 3) % 3) * 0.015;
  const lig = 0.82 + ((i * 5) % 6) * 0.02;
  return new THREE.Color().setHSL(hue, sat, lig);
}

// Give a merged geometry simple planar UVs from world X/Z, so a repeating
// texture tiles every `tile` metres at life size. Good for near-flat, top-lit
// surfaces such as roofs where a top-down projection reads correctly.
function planarUV(geo, tile) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / tile;
    uv[i * 2 + 1] = pos.getZ(i) / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// Load a tiling CC0 colour map from public/textures as an sRGB repeating texture.
function tiledTexture(name) {
  const tex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/${name}`);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const CHUNK_M = 150; // town chunk size in metres, for frustum and distance culling

// Split world placed geometries into a grid of square chunks and merge each cell
// into its own mesh, all sharing one material. Each mesh keeps its centre so the
// render loop can hide chunks past the haze, and three.js frustum culls the rest.
// This replaces one giant town mesh, which could never be culled, with many that
// can. Optional prep runs on each merged chunk (normals, planar UVs).
function chunkMeshes(geos, cell, material, prep) {
  const cells = new Map();
  for (const g of geos) {
    if (!g.boundingSphere) g.computeBoundingSphere();
    const c = g.boundingSphere.center;
    const key = `${Math.round(c.x / cell)}:${Math.round(c.z / cell)}`;
    let arr = cells.get(key);
    if (!arr) cells.set(key, (arr = []));
    arr.push(g);
  }
  const meshes = [];
  for (const arr of cells.values()) {
    const merged = mergeGeometries(arr, false);
    if (prep) prep(merged);
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.cull = merged.boundingSphere.center;
    meshes.push(mesh);
  }
  return meshes;
}

// Lay a rectangular ground patch of triangles that follows the terrain. Center
// (cx,cz) with unit axes (ux,uz) and (vx,vz); half is the half-extent on each
// axis; the grid samples the true ground height at every vertex so the patch
// hugs slopes. Emitted as raw x,y,z triples (both windings, so it shows from
// above regardless of face side). Used for a paved parvis at the landmarks.
function pushGroundPatch(
  out,
  cx,
  cz,
  ux,
  uz,
  vx,
  vz,
  halfU,
  halfV,
  groundY,
  yOff,
  nu = 10,
  nv = 8,
) {
  const at = (s, t) => {
    const x = cx + ux * s * halfU + vx * t * halfV;
    const z = cz + uz * s * halfU + vz * t * halfV;
    return [x, groundY(x, z) + yOff, z];
  };
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const s0 = -1 + (2 * i) / nu;
      const s1 = -1 + (2 * (i + 1)) / nu;
      const t0 = -1 + (2 * j) / nv;
      const t1 = -1 + (2 * (j + 1)) / nv;
      const a = at(s0, t0);
      const b = at(s1, t0);
      const c = at(s1, t1);
      const d = at(s0, t1);
      out.push(...a, ...c, ...b, ...a, ...d, ...c);
    }
  }
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
function applyFacade(mat, tex, scale = 1 / 3.0) {
  if (!tex) return;
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
    buildChurchInterior({
      box,
      gy,
      wallH,
      chapel,
      interiorGeos,
      churchWallGeos: o.churchWallGeos,
      decorMeshes,
      colliders,
    });
    if (o.landmarks && !chapel) {
      const area = box.L * box.W;
      if (!o.landmarks.church || area > o.landmarks.church.area) {
        o.landmarks.church = { box, gy, wallH, area };
      }
    }
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
    setColorAttr(rgeo, new THREE.Color().setHSL(0.59, 0.06, 0.82));
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
  const { box, gy, wallH, chapel, interiorGeos, churchWallGeos, decorMeshes, colliders } = o;
  const { cx, cz, ux, uz, vx, vz, L, W } = box;
  const th = 0.5;
  const angU = Math.atan2(-uz, ux);
  const angV = Math.atan2(-vz, vx);
  const stone = new THREE.Color(0xc4bcac);
  const toWorld = (s, t) => [cx + ux * s + vx * t, cz + uz * s + vz * t];

  const floor = new THREE.BoxGeometry(2 * L, 0.3, 2 * W);
  floor.rotateY(angU);
  floor.translate(cx, gy - 0.15, cz);
  setColorAttr(floor, new THREE.Color(0x8f8676));
  interiorGeos.push(floor);

  const addWall = (a, b, h, y0, collide) => {
    const g = wallBoxGeo(a, b, h, y0, th);
    setColorAttr(g, stone);
    churchWallGeos.push(g);
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

// Furnish the inside of the keep: a stone floor, a wooden mezzanine reached by
// a spiral stair up the wall, glowing arrow slits, and warm interior light.
function buildKeepInterior(group, o) {
  const { kx, kz, gy, rWall, N, doorA } = o;
  const stoneFloor = new THREE.MeshStandardMaterial({
    color: 0x8a8272,
    roughness: 0.95,
    metalness: 0,
  });
  const wood = new THREE.MeshStandardMaterial({
    color: 0x6b4a2f,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const stepMat = new THREE.MeshStandardMaterial({
    color: 0x7d766a,
    roughness: 0.95,
    metalness: 0,
  });
  const slitMat = new THREE.MeshBasicMaterial({ color: 0xfff2d0 });

  const floor = new THREE.Mesh(new THREE.CircleGeometry(rWall - 0.4, N), stoneFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(kx, gy + 0.05, kz);
  floor.receiveShadow = true;
  group.add(floor);

  const galleryY = gy + 9;
  const gallery = new THREE.Mesh(new THREE.RingGeometry(2.8, rWall - 0.5, N), wood);
  gallery.rotation.x = -Math.PI / 2;
  gallery.position.set(kx, galleryY, kz);
  gallery.receiveShadow = true;
  gallery.castShadow = true;
  group.add(gallery);

  // Spiral stair rising to the mezzanine, starting opposite the doorway.
  const steps = 20;
  const rStair = rWall - 1.5;
  for (let k = 0; k < steps; k++) {
    const a = doorA + Math.PI + (k / steps) * 1.15 * Math.PI * 2;
    const st = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.28, 1.0), stepMat);
    st.rotation.y = -a;
    st.position.set(
      kx + Math.cos(a) * rStair,
      gy + 0.28 + (k / steps) * (galleryY - gy),
      kz + Math.sin(a) * rStair,
    );
    st.castShadow = true;
    group.add(st);
  }

  // Glowing arrow slits on a few facets, at three heights.
  const step = (Math.PI * 2) / N;
  for (const i of [5, 8, 11, 14]) {
    const a = i * step;
    for (const yy of [gy + 5, gy + 13, gy + 20]) {
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.8, 0.25), slitMat);
      slit.rotation.y = -a - Math.PI / 2;
      slit.position.set(kx + Math.cos(a) * (rWall - 0.05), yy, kz + Math.sin(a) * (rWall - 0.05));
      group.add(slit);
    }
  }

  // Warm interior light on two levels.
  for (const yy of [gy + 4, gy + 14]) {
    const l = new THREE.PointLight(0xffe0b0, 24, 34, 1.0);
    l.position.set(kx, yy, kz);
    group.add(l);
  }
}

// The Chateau de Chateaugiron: its signature is a tall round crenellated keep
// (the "grosse tour"). Placed at the real keep location, with two pepperpot
// turrets on the logis. Authored geometry, verified by screenshot.
// A granite war memorial (monument aux morts) for the church square, the kind
// every French town has. A stepped plinth, a tapered square shaft and a small
// domed top, in light granite. Placed to one side of the church forecourt on
// the true ground, with a small collider so the player walks around it. Modelled
// after the real Chateaugiron monument (photo: GO69, CC0, Wikimedia Commons).
function buildWarMemorial(group, church, groundY, colliders) {
  if (!church || !church.box) return;
  const { cx, cz, ux, uz, vx, vz, L } = church.box;
  const px = cx + ux * (-L - 9) + vx * -9;
  const pz = cz + uz * (-L - 9) + vz * -9;
  const gy = groundY(px, pz);
  const granite = new THREE.MeshStandardMaterial({
    color: 0x9c988f,
    roughness: 0.82,
    metalness: 0.0,
  });
  const graniteDark = new THREE.MeshStandardMaterial({
    color: 0x878379,
    roughness: 0.85,
    metalness: 0.0,
  });
  const mem = new THREE.Group();
  const add = (geo, y, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true;
    m.receiveShadow = true;
    mem.add(m);
  };
  // Stepped base.
  add(new THREE.BoxGeometry(3.2, 0.35, 3.2), 0.175, graniteDark);
  add(new THREE.BoxGeometry(2.5, 0.35, 2.5), 0.525, granite);
  add(new THREE.BoxGeometry(1.9, 0.4, 1.9), 0.9, granite);
  // Inscribed plinth (dado) where the names are carved on the real monument.
  add(new THREE.BoxGeometry(1.35, 1.15, 1.35), 1.675, granite);
  // Tapered square shaft (a four-sided prism from a low-segment cylinder).
  const shaft = new THREE.CylinderGeometry(0.42, 0.62, 3.2, 4);
  shaft.rotateY(Math.PI / 4);
  add(shaft, 2.25 + 1.6, granite);
  // Small drum and a domed cap, echoing the rotunda top of the real memorial.
  add(new THREE.CylinderGeometry(0.5, 0.55, 0.5, 12), 5.45 + 0.25, graniteDark);
  add(new THREE.ConeGeometry(0.48, 0.66, 14), 5.95 + 0.33, granite);
  // Carve the dedication into the dado face that greets the approach, so the
  // monument reads as the real monument aux morts. The panel matches the granite
  // so only the lettering shows, like an engraving. Guarded for headless builds.
  if (typeof document !== 'undefined' && document.createElement) {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 200;
    const g2 = cv.getContext('2d');
    g2.fillStyle = '#9c988f';
    g2.fillRect(0, 0, 256, 200);
    g2.fillStyle = '#312e29';
    g2.textAlign = 'center';
    g2.textBaseline = 'middle';
    g2.font = 'bold 30px Georgia, serif';
    g2.fillText('1914 · 1918', 128, 38);
    g2.font = 'bold 18px Georgia, serif';
    g2.fillText('AUX ENFANTS', 128, 88);
    g2.fillText('DE CHÂTEAUGIRON', 128, 112);
    g2.font = 'bold 30px Georgia, serif';
    g2.fillText('1939 · 1945', 128, 162);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const insc = new THREE.Mesh(
      new THREE.PlaneGeometry(1.06, 0.83),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }),
    );
    insc.position.set(0, 1.66, 0.682);
    mem.add(insc);
  }
  mem.position.set(px, gy, pz);
  mem.rotation.y = Math.atan2(-ux, -uz); // a flat face toward the approach
  group.add(mem);
  colliders.push({ minX: px - 1.05, maxX: px + 1.05, minZ: pz - 1.05, maxZ: pz + 1.05 });
}

function buildChateau(group, groundY, colliders, landmarks = null) {
  const stone = new THREE.MeshStandardMaterial({ color: 0x8f887b, roughness: 0.9, metalness: 0.0 });
  const darkStone = new THREE.MeshStandardMaterial({
    color: 0x7d766a,
    roughness: 0.92,
    metalness: 0.0,
  });
  const slateTex = tiledTexture('roof-slate.jpg');
  slateTex.repeat.set(8, 3);
  const slate = new THREE.MeshStandardMaterial({
    map: slateTex,
    color: 0xbfc6cf,
    roughness: 0.6,
    metalness: 0.12,
  });
  const turretTex = tiledTexture('castle-wall.jpg');
  turretTex.repeat.set(4, 3);
  const turretStone = new THREE.MeshStandardMaterial({
    map: turretTex,
    roughness: 0.95,
    metalness: 0.0,
  });

  // Round keep (donjon), built as a faceted wall with a doorway so the great
  // tower is enterable. Facets approximate the drum and each gets a collider,
  // except the two that form the entrance arch.
  const kx = -77;
  const kz = -27;
  const gy = groundY(kx, kz);
  const shaftH = 27;
  const rTop = 6.2;
  const rWall = 6.5;
  const N = 18;
  const step = (Math.PI * 2) / N;
  const doorA = 0.95; // faces north-east, toward the town centre
  const lower = Math.floor(doorA / step);
  const openSet = new Set([((lower % N) + N) % N, (((lower + 1) % N) + N) % N]);
  const chord = 2 * rWall * Math.sin(step / 2) + 0.35;

  const wallGeos = [];
  for (let i = 0; i < N; i++) {
    const a = i * step;
    const wx = kx + Math.cos(a) * rWall;
    const wz = kz + Math.sin(a) * rWall;
    if (openSet.has(i)) {
      // Doorway: keep only the wall above the lintel so it reads as a gate.
      const lintelBase = gy + 4.6;
      const h = gy + shaftH - lintelBase;
      const lg = new THREE.BoxGeometry(chord, h, 0.7);
      lg.rotateY(-a - Math.PI / 2);
      lg.translate(wx, lintelBase + h / 2, wz);
      wallGeos.push(lg);
      continue;
    }
    const g = new THREE.BoxGeometry(chord, shaftH, 0.7);
    g.rotateY(-a - Math.PI / 2);
    g.translate(wx, gy + shaftH / 2, wz);
    wallGeos.push(g);
    colliders.push({
      minX: wx - chord / 2,
      maxX: wx + chord / 2,
      minZ: wz - chord / 2,
      maxZ: wz + chord / 2,
    });
  }
  const shaftTex = tiledTexture('castle-wall.jpg');
  shaftTex.repeat.set(1, 9);
  const shaftMat = new THREE.MeshStandardMaterial({
    map: shaftTex,
    roughness: 0.95,
    metalness: 0.0,
  });
  const shaft = new THREE.Mesh(mergeGeometries(wallGeos, false), shaftMat);
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  group.add(shaft);
  buildKeepInterior(group, { kx, kz, gy, shaftH, rWall, N, doorA });
  if (landmarks) {
    landmarks.keep = { kx, kz, gy, rWall, shaftH, doorA };
  }

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

  // Two pepperpot turrets flanking the logis.
  for (const [tx, tz] of [
    [-101, -14],
    [-79, 6],
  ]) {
    const tgy = groundY(tx, tz);
    addTurret(group, tx, tz, tgy, 3.1, 15, 8, turretStone, slate);
    colliders.push({ minX: tx - 3.4, maxX: tx + 3.4, minZ: tz - 3.4, maxZ: tz + 3.4 });
  }
}

// A procedurally painted leafy canopy on a transparent background, used as a
// crossed-billboard impostor so trees read as soft foliage at eye level instead
// of faceted blobs. Drawn once and reused for every tree; per-tree colour comes
// from instanceColor. No external asset, no licence, fully deterministic.
let _foliageTex = null;
function foliageTexture() {
  if (_foliageTex) return _foliageTex;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  let s = 20;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const cx = size * 0.5;
  const cy = size * 0.44;
  const RX = size * 0.36;
  const RY = size * 0.4;
  const puffs = [];
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.pow(rnd(), 0.75);
    const px = cx + Math.cos(a) * rr * RX;
    const py = cy + Math.sin(a) * rr * RY - RY * 0.05;
    const pr = size * (0.1 + rnd() * 0.11) * (1 - rr * 0.22);
    puffs.push({ px, py, pr });
  }
  puffs.sort((A, B) => B.py - A.py);
  for (const p of puffs) {
    const grd = g.createRadialGradient(p.px, p.py - p.pr * 0.45, p.pr * 0.08, p.px, p.py, p.pr);
    const hv = 1 - p.py / size;
    const L = Math.min(1, (0.6 + hv * 0.6) * (0.7 + rnd() * 0.4));
    grd.addColorStop(0, `rgba(${(150 * L) | 0},${(190 * L) | 0},${(88 * L) | 0},1)`);
    grd.addColorStop(0.6, `rgba(${(70 * L) | 0},${(120 * L) | 0},${(52 * L) | 0},0.96)`);
    grd.addColorStop(1, `rgba(${(45 * L) | 0},${(84 * L) | 0},${(40 * L) | 0},0)`);
    g.fillStyle = grd;
    g.beginPath();
    g.arc(p.px, p.py, p.pr, 0, Math.PI * 2);
    g.fill();
  }
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 24) {
      const n = (rnd() - 0.5) * 26;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n * 0.6;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _foliageTex = tex;
  return tex;
}

// Two crossed vertical quads carrying the foliage texture, base at y=0.
function foliageGeo() {
  const W = 5.6;
  const H = 6.2;
  const base = 1.3; // canopy overlaps the trunk top
  const a = new THREE.PlaneGeometry(W, H);
  a.translate(0, base + H / 2, 0);
  const b = new THREE.PlaneGeometry(W, H);
  b.rotateY(Math.PI / 2);
  b.translate(0, base + H / 2, 0);
  return mergeGeometries([a, b], false);
}

// Build instanced billboard trees: a solid trunk cylinder plus a crossed foliage
// impostor, both driven by the same placements. Returns a Group so it drops into
// the same call sites as the old low-poly tree mesh.
function instanceBillboardTrees(placements, groundY) {
  if (!placements.length) return null;
  const n = placements.length;
  const group = new THREE.Group();

  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 2.6, 5).toNonIndexed();
  trunkGeo.translate(0, 1.3, 0);
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x5b4327,
    roughness: 0.95,
    metalness: 0,
  });
  const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
  trunk.castShadow = true;
  trunk.receiveShadow = true;

  const foliageMat = new THREE.MeshStandardMaterial({
    map: foliageTexture(),
    alphaTest: 0.32,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
  applyWind(foliageMat, { speed: 1.1, amp: 0.32, href: 7.5 });
  const foliage = new THREE.InstancedMesh(foliageGeo(), foliageMat, n);
  // The aerial ground already carries baked canopy shadows, so the impostors do
  // not cast their own (which would show as crossed rectangles).
  foliage.castShadow = false;
  foliage.receiveShadow = false;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scl = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const p = placements[i];
    q.setFromAxisAngle(up, (i * 2.399963) % (Math.PI * 2));
    scl.set(p.s, p.s * (0.92 + (i % 5) * 0.05), p.s);
    pos.set(p.x, groundY(p.x, p.z) - 0.1, p.z);
    m.compose(pos, q, scl);
    trunk.setMatrixAt(i, m);
    foliage.setMatrixAt(i, m);
    const b = 0.82 + fract01(Math.sin(i * 3.71) * 9137.13) * 0.3;
    const w = (fract01(Math.sin(i * 1.73) * 3571.31) - 0.5) * 0.16;
    col.setRGB(Math.min(1, b * (1 + w)), Math.min(1, b * 1.05), Math.min(1, b * (1 - w * 0.6)));
    foliage.setColorAt(i, col);
  }
  trunk.instanceMatrix.needsUpdate = true;
  foliage.instanceMatrix.needsUpdate = true;
  if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
  group.add(trunk, foliage);
  return group;
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
  const mesh = instanceBillboardTrees(placements, groundY);
  if (mesh) group.add(mesh);
}

// A tuft of grass blades on a transparent background, drawn once and reused as a
// crossed-billboard so lawns and verges near the player read as real grass
// instead of a flat aerial photo. No external asset.
let _grassTex = null;
function grassTexture() {
  if (_grassTex) return _grassTex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  let s = 3;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const base = size * 0.98;
  for (let i = 0; i < 18; i++) {
    const x0 = size * (0.15 + rnd() * 0.7);
    const h = size * (0.5 + rnd() * 0.45);
    const sway = (rnd() - 0.5) * size * 0.26;
    const w = size * (0.032 + rnd() * 0.026);
    const tipx = x0 + sway;
    const tipy = base - h;
    const midx = x0 + sway * 0.4;
    const midy = base - h * 0.5;
    const m = rnd();
    const grd = g.createLinearGradient(0, base, 0, tipy);
    grd.addColorStop(0, `rgb(${(52 + m * 32) | 0},${(92 + m * 34) | 0},${(38 + m * 18) | 0})`);
    grd.addColorStop(1, `rgb(${(132 + m * 60) | 0},${(178 + m * 55) | 0},${(72 + m * 34) | 0})`);
    g.strokeStyle = grd;
    g.lineWidth = w;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x0, base);
    g.quadraticCurveTo(midx, midy, tipx, tipy);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _grassTex = tex;
  return tex;
}

function grassGeo() {
  const W = 0.9;
  const H = 0.42;
  const a = new THREE.PlaneGeometry(W, H);
  a.translate(0, H / 2, 0);
  const b = new THREE.PlaneGeometry(W, H);
  b.rotateY(Math.PI / 2);
  b.translate(0, H / 2, 0);
  return mergeGeometries([a, b], false);
}

function instanceGrass(placements, groundY) {
  if (!placements.length) return null;
  const n = placements.length;
  const grassMat = new THREE.MeshStandardMaterial({
    map: grassTexture(),
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
  });
  applyWind(grassMat, { speed: 1.6, amp: 0.14, href: 0.42 });
  const mesh = new THREE.InstancedMesh(grassGeo(), grassMat, n);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scl = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const p = placements[i];
    q.setFromAxisAngle(up, fract01(Math.sin(i * 12.9898) * 43758.5453) * Math.PI * 2);
    const sc = p.s * (0.55 + fract01(Math.sin(i * 7.13) * 1531.7) * 0.5);
    scl.set(sc, sc * (0.8 + fract01(Math.sin(i * 3.7) * 917.1) * 0.6), sc);
    pos.set(p.x, groundY(p.x, p.z) + 0.02, p.z);
    m.compose(pos, q, scl);
    mesh.setMatrixAt(i, m);
    const b = 0.8 + fract01(Math.sin(i * 2.11) * 6521.3) * 0.35;
    const y = (fract01(Math.sin(i * 1.27) * 2287.9) - 0.5) * 0.18;
    col.setRGB(Math.min(1, b * (1 + y)), Math.min(1, b * 1.06), Math.min(1, b * (1 - y)));
    mesh.setColorAt(i, col);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

// Scatter grass tufts across non-wooded green polygons, but only near the town
// core (within `radius` of the origin) so the foreground lawns gain real detail
// without flooding the whole map with instances.
function buildGrass(group, grassPolys, groundY, radius = 320, exclude = null) {
  const MAX = 16000;
  const r2 = radius * radius;
  const placements = [];
  let seed = 101;
  for (const gp of grassPolys) {
    if (placements.length >= MAX) break;
    const pts = scatterInPolygon(gp.ring, 2.1, seed++);
    for (const p of pts) {
      if (p.x * p.x + p.z * p.z > r2) continue;
      if (exclude) {
        const dx = p.x - exclude.x;
        const dz = p.z - exclude.z;
        if (dx * dx + dz * dz < exclude.r2) continue;
      }
      placements.push(p);
      if (placements.length >= MAX) break;
    }
  }
  const mesh = instanceGrass(placements, groundY);
  if (mesh) group.add(mesh);
}

// Street lamps: a dark metal post with a warm lantern, instanced along the
// larger roads near the town core. Purely decorative vertical street furniture
// so the streets read less bare; the lantern glass has a faint emissive glow so
// it still reads at midday.
const LIT_ROADS = new Set([
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'unclassified',
  'living_street',
  'pedestrian',
  'primary_link',
  'secondary_link',
  'tertiary_link',
]);

// Roads that carry a few parked cars along the curb. Pedestrian ways and the
// through primaries are left clear.
const CAR_ROADS = new Set([
  'secondary',
  'tertiary',
  'residential',
  'unclassified',
  'living_street',
]);

// Paved-stone ways of the historic core: the square by the eglise and the
// approaches to the chateau. Only these pedestrian types, and only near the two
// landmarks (the CORE disc), get real cobblestone. The modern outer roads and
// through traffic stay asphalt, which is how the town actually looks.
const COBBLE_ROADS = new Set(['pedestrian', 'living_street', 'footway', 'path', 'steps']);
const CORE = { x: -70, z: -120, r: 210 };

// The tight medieval centre around the chateau-eglise axis. Small vehicular
// lanes here (not the modern through-roads) were historically paved in stone,
// so they get cobbles too. Chateaugiron is a labelled "Petite Cite de
// Caractere" with a genuinely cobbled old town.
const COBBLE_CORE_ROADS = new Set(['residential', 'service', 'unclassified']);
const CORE_TIGHT = { x: -70, z: -120, r: 135 };

function lampGeoParts() {
  const pole = new THREE.CylinderGeometry(0.08, 0.13, 4.4, 6);
  pole.translate(0, 2.2, 0);
  const lantern = new THREE.BoxGeometry(0.32, 0.46, 0.32);
  lantern.translate(0, 4.55, 0);
  return { pole, lantern };
}

function buildLamps(group, roadLines, groundY, opts = {}) {
  const spacing = opts.spacing || 38;
  const radius = opts.radius || 560;
  const MAX = opts.max || 620;
  const r2 = radius * radius;
  const pts = [];
  for (const rd of roadLines) {
    if (pts.length >= MAX) break;
    if (!LIT_ROADS.has(rd.hw)) continue;
    const off = roadWidth(rd.hw) / 2 + 1.3;
    for (const l of lampPointsAlong(rd.pts, spacing, off)) {
      if (l.x * l.x + l.z * l.z > r2) continue;
      pts.push(l);
      if (pts.length >= MAX) break;
    }
  }
  if (!pts.length) return;
  const { pole, lantern } = lampGeoParts();
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a30,
    roughness: 0.6,
    metalness: 0.5,
  });
  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xffe6b0,
    emissive: 0xffcf7a,
    emissiveIntensity: 0.9,
    roughness: 0.5,
  });
  const poles = new THREE.InstancedMesh(pole, poleMat, pts.length);
  const lanterns = new THREE.InstancedMesh(lantern, lanternMat, pts.length);
  poles.castShadow = true;
  poles.receiveShadow = false;
  lanterns.castShadow = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    q.setFromAxisAngle(up, p.angle);
    pos.set(p.x, groundY(p.x, p.z), p.z);
    m.compose(pos, q, one);
    poles.setMatrixAt(i, m);
    lanterns.setMatrixAt(i, m);
  }
  poles.instanceMatrix.needsUpdate = true;
  lanterns.instanceMatrix.needsUpdate = true;
  group.add(poles);
  group.add(lanterns);
}

// Short stone chimneys seated on the gable ends of pitched roofs. One instanced
// box mesh keeps the whole town's worth cheap. `specs` come from chimneyFor.
function buildChimneys(group, specs) {
  if (!specs || !specs.length) return;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x6f6558,
    roughness: 0.95,
    metalness: 0,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, specs.length);
  mesh.name = 'chimneys';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const h = Math.max(0.6, s.top - s.base);
    q.setFromAxisAngle(up, s.angle);
    pos.set(s.x, s.base + h / 2, s.z);
    scale.set(s.size, h, s.size);
    m.compose(pos, q, scale);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
}

// A few parked cars along the curbs, so the streets read as an inhabited town
// rather than an empty model. Bodies, cabins and wheels are three instanced
// meshes; per-car body colour comes from a muted real-world palette. Curb
// points reuse the tested lampPointsAlong spacing math.
const CAR_COLORS = [0xdfe1e3, 0xb8bdc2, 0x6b6f74, 0x24262b, 0x2a3b57, 0x6e2b2b, 0x9c8f77, 0x3a5c46];

function carGeoParts() {
  const body = new THREE.BoxGeometry(4.2, 0.72, 1.8);
  body.translate(0, 0.69, 0); // wheels sit at y 0, body just above them
  const cabin = new THREE.BoxGeometry(2.2, 0.52, 1.6);
  cabin.translate(-0.15, 1.31, 0); // lower cabin toward the rear, on the body
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 12);
  wheel.rotateZ(Math.PI / 2); // lay the axle across the car
  return { body, cabin, wheel };
}

function buildCars(group, roadLines, groundY, opts = {}) {
  const spacing = opts.spacing || 50;
  const radius = opts.radius || 430;
  const MAX = opts.max || 130;
  const r2 = radius * radius;
  const spots = [];
  let ri = 0;
  for (const rd of roadLines) {
    if (spots.length >= MAX) break;
    ri++;
    if (!CAR_ROADS.has(rd.hw)) continue;
    const side = ri % 2 === 0 ? 1 : -1; // alternate the parking side per road
    const off = side * (roadWidth(rd.hw) / 2 - 0.9);
    let idx = 0;
    for (const s of lampPointsAlong(rd.pts, spacing, off)) {
      idx++;
      if (Math.abs((Math.sin((ri * 13.1 + idx) * 41.7) * 3271.7) % 1) < 0.42) continue; // leave gaps
      if (s.x * s.x + s.z * s.z > r2) continue;
      spots.push(s);
      if (spots.length >= MAX) break;
    }
  }
  if (!spots.length) return;

  const { body, cabin, wheel } = carGeoParts();
  const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.3 });
  const cabinMat = new THREE.MeshStandardMaterial({
    color: 0x121319,
    roughness: 0.35,
    metalness: 0.1,
  });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.85 });

  const bodies = new THREE.InstancedMesh(body, bodyMat, spots.length);
  const cabins = new THREE.InstancedMesh(cabin, cabinMat, spots.length);
  const wheels = new THREE.InstancedMesh(wheel, wheelMat, spots.length * 4);
  bodies.name = 'cars';
  bodies.castShadow = true;
  bodies.receiveShadow = true;
  cabins.castShadow = true;
  wheels.castShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  const col = new THREE.Color();
  const wheelLocals = [
    new THREE.Vector3(1.35, 0.33, 0.78),
    new THREE.Vector3(1.35, 0.33, -0.78),
    new THREE.Vector3(-1.35, 0.33, 0.78),
    new THREE.Vector3(-1.35, 0.33, -0.78),
  ];
  const tmp = new THREE.Vector3();
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    const gy = groundY(s.x, s.z);
    q.setFromAxisAngle(up, s.angle);
    pos.set(s.x, gy, s.z);
    m.compose(pos, q, one);
    bodies.setMatrixAt(i, m);
    cabins.setMatrixAt(i, m);
    col.setHex(
      CAR_COLORS[Math.floor(Math.abs((Math.sin(i * 91.3) * 7219.1) % 1) * CAR_COLORS.length)],
    );
    bodies.setColorAt(i, col);
    for (let w = 0; w < 4; w++) {
      tmp.copy(wheelLocals[w]).applyQuaternion(q).add(pos);
      m.compose(tmp, q, one);
      wheels.setMatrixAt(i * 4 + w, m);
    }
  }
  bodies.instanceMatrix.needsUpdate = true;
  cabins.instanceMatrix.needsUpdate = true;
  wheels.instanceMatrix.needsUpdate = true;
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
  group.add(bodies);
  group.add(cabins);
  group.add(wheels);
}

export function addTreePoints(scene, points, proj, groundY) {
  const placements = points.map((ll, i) => {
    const [x, z] = proj.project(ll[0], ll[1]);
    const r = (Math.sin(i * 45.11) * 43758.5453) % 1;
    const t = r - Math.floor(r);
    return { x, z, s: 0.85 + t * 0.7 };
  });
  const mesh = instanceBillboardTrees(placements, groundY);
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
  const groundY = (x, z) => (hf ? hf.sampleSmooth(x, z) : 0);
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
  const chimneySpecs = [];
  const towerGeos = [];
  const spireGeos = [];
  const interiorGeos = [];
  const churchWallGeos = [];
  const decorMeshes = [];
  const waterGeos = [];
  const greenGeos = [];
  const roadPos = [];
  const roadCol = [];
  const cobblePos = [];
  const bCentroids = [];
  const colliders = [];
  const woods = [];
  const grassPolys = [];
  const roadLines = [];
  const landmarks = { church: null, keep: null, oldtown: [] };

  // A few real old-town buildings get their street front skinned with a
  // photographed Chateaugiron facade (see src/render/landmarkPhotos.js). Each
  // entry is matched to the real footprint nearest its centroid; `face` is a
  // point on the open street side so the correct wall is chosen.
  const oldTownHosts = [
    { at: [23.2, 29.1], photo: 'oldtown_facade_02', face: [31.4, 31.7] },
    { at: [-0.9, -42.1], photo: 'oldtown_facade_01', face: [-1.7, -32.5] },
    { at: [-37.0, -187.5], photo: 'oldtown_facade_03', face: [-35.0, -193.4] },
  ];
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
          churchWallGeos,
          decorMeshes,
          colliders,
          landmarks,
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

      // Skin this footprint's street front with a real facade photo when it is
      // one of the curated old-town hosts.
      for (const host of oldTownHosts) {
        if (host.claimed) continue;
        if (Math.hypot(cx - host.at[0], cz - host.at[1]) <= 2.5) {
          landmarks.oldtown.push({
            box,
            gy: groundY(cx, cz) + base,
            height: Math.max(1.5, top - base),
            face: host.face,
            photo: host.photo,
          });
          host.claimed = true;
          break;
        }
      }

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

        // Most of these roofs carry a Breton gable-end stone chimney. Skip a
        // seeded third so the rooftops are not uniform, and only near the core.
        if (
          cx * cx + cz * cz <= 620 * 620 &&
          Math.abs((Math.sin(bi * 91.7) * 4137.13) % 1) < 0.66
        ) {
          const chim = chimneyFor(box, wallTop, roofH, bi);
          if (chim) chimneySpecs.push(chim);
        }
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
      else grassPolys.push({ ring: pts });
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
      addRoad(pts, f.t, roadPos, roadCol, groundY, cobblePos);
      roadLines.push({ pts, hw: f.t.highway });
    }
  }

  // Paved aprons at the two landmarks the player walks to. OSM has no square or
  // pedestrian-area polygons here, so the open forecourts would otherwise stay a
  // blurry aerial smear at eye level. A cobbled parvis at the church door and a
  // stone apron at the keep gate replace that near-field blur where the player
  // actually stands and looks.
  if (landmarks.church) {
    const { cx, cz, ux, uz, vx, vz, L, W } = landmarks.church.box;
    const depth = 5.0; // reaches out from the entrance
    const px = cx + ux * -(L + depth);
    const pz = cz + uz * -(L + depth);
    pushGroundPatch(cobblePos, px, pz, ux, uz, vx, vz, depth, Math.min(W, 8), groundY, 0.07);
  }
  if (landmarks.keep) {
    const { kx, kz, rWall, doorA } = landmarks.keep;
    const ox = Math.cos(doorA);
    const oz = Math.sin(doorA);
    const depth = 5.0;
    const gx = kx + ox * rWall;
    const gz = kz + oz * rWall;
    const cxp = gx + ox * depth;
    const czp = gz + oz * depth;
    pushGroundPatch(cobblePos, cxp, czp, ox, oz, -oz, ox, depth, 4.5, groundY, 0.07);
  }

  // Spawn the player in the church square, a place they can name at a glance:
  // the steeple ahead, the heritage boards and the war memorial around them, on
  // a cobbled forecourt. Fall back to the open-spot picker if the church is
  // somehow absent. yaw faces the facade so the first frame is the church.
  let spawn;
  if (landmarks.church) {
    const { cx, cz, ux, uz, vx, vz, L } = landmarks.church.box;
    const back = L + 18;
    spawn = {
      x: cx - ux * back,
      z: cz - uz * back,
      yaw: Math.atan2(-ux, -uz),
      ux,
      uz,
      vx,
      vz,
    };
  } else {
    const s = pickSpawn(bCentroids);
    spawn = { x: s.x, z: s.z, yaw: Math.atan2(s.x, s.z), ux: 1, uz: 0, vx: 0, vz: 1 };
  }
  // A cobbled apron under the spawn, so the first ground underfoot reads as real
  // paving instead of the blurry aerial photo. Oriented to the approach.
  pushGroundPatch(
    cobblePos,
    spawn.x,
    spawn.z,
    spawn.ux,
    spawn.uz,
    spawn.vx,
    spawn.vz,
    9,
    9,
    groundY,
    0.07,
  );

  const group = new THREE.Group();
  const cullables = [];

  // Walls: one shared material across every chunk. The facade shader is world
  // space, so chunks tile seamlessly. Split into a grid so far and off-screen
  // chunks stop drawing, instead of one town-sized mesh that never culled.
  if (buildingGeos.length) {
    const wallMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    applyFacade(wallMat, makeFacadeTexture());
    for (const mesh of chunkMeshes(buildingGeos, CHUNK_M, wallMat, (g) =>
      g.computeVertexNormals(),
    )) {
      group.add(mesh);
      cullables.push(mesh);
    }
  }

  if (roofGeos.length) {
    const roofMat = new THREE.MeshStandardMaterial({
      map: tiledTexture('roof-slate.jpg'),
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    for (const mesh of chunkMeshes(roofGeos, CHUNK_M, roofMat, (g) => planarUV(g, 3.0))) {
      group.add(mesh);
      cullables.push(mesh);
    }
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

  // Church nave walls: their own mesh so real CC0 stone can be tiled over them
  // with the vertical-triplanar facade shader (world-space, so the long walls
  // do not stretch). Inside and outside both read as stacked granite.
  if (churchWallGeos.length) {
    const merged = mergeGeometries(churchWallGeos, false);
    merged.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    applyFacade(mat, tiledTexture('castle-wall.jpg'), 1 / 2.4);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

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

  if (cobblePos.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cobblePos), 3));
    geo.computeVertexNormals();
    planarUV(geo, 2.5);
    const mat = new THREE.MeshStandardMaterial({
      map: tiledTexture('cobblestone.jpg'),
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    group.add(mesh);
  }

  let waterGeo = null;
  if (waterGeos.length) {
    waterGeo = mergeGeometries(waterGeos, false);
  }

  scene.add(group);

  buildTrees(group, woods, groundY);
  buildGrass(group, grassPolys, groundY, 320, { x: spawn.x, z: spawn.z, r2: 110 });
  buildLamps(group, roadLines, groundY);
  buildChimneys(group, chimneySpecs);
  buildCars(group, roadLines, groundY);
  buildChateau(group, groundY, colliders, landmarks);
  buildWarMemorial(group, landmarks.church, groundY, colliders);

  return {
    bounds,
    counts: data.meta?.counts || {},
    spawn,
    colliders,
    waterGeo,
    landmarks,
    cullables,
    disposed: () => {},
  };
}

function addRoad(pts, tags, outPos, outCol, groundY, cobbleOut) {
  const ribbon = buildRoadRibbon(pts, roadWidth(tags.highway), 0);
  if (!ribbon.length) return;
  // Cobble the historic-core paved ways; everything else stays asphalt.
  if (cobbleOut) {
    let sx = 0;
    let sz = 0;
    for (const p of pts) {
      sx += p[0];
      sz += p[1];
    }
    const cx = sx / pts.length;
    const cz = sz / pts.length;
    const inCore = (cx - CORE.x) ** 2 + (cz - CORE.z) ** 2 <= CORE.r * CORE.r;
    const inTight =
      (cx - CORE_TIGHT.x) ** 2 + (cz - CORE_TIGHT.z) ** 2 <= CORE_TIGHT.r * CORE_TIGHT.r;
    const cobble =
      (COBBLE_ROADS.has(tags.highway) && inCore) ||
      (COBBLE_CORE_ROADS.has(tags.highway) && inTight);
    if (cobble) {
      for (let i = 0; i < ribbon.length; i += 3) {
        const x = ribbon[i];
        const z = ribbon[i + 2];
        cobbleOut.push(x, groundY(x, z) + 0.07, z);
      }
      return;
    }
  }
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
// orthophoto is draped on top, mapped 1:1 to the world. Pass opts.size to drape
// a smaller, higher resolution photo over just the town core: it sits on top of
// the base ground with a polygon offset and fades out at its edge so there is no
// visible seam where the sharp photo meets the wider, softer one.
export function buildTerrain(scene, hf, texture = null, opts = {}) {
  const overlay = !!opts.size;
  const size = overlay ? opts.size : hf.size;
  const half = size / 2;
  const seg = overlay ? Math.max(2, Math.round(size / 5)) : (hf.n - 1) * 3;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, hf.sampleSmooth(x, z));
    uv.setXY(i, (x + half) / size, (z + half) / size);
  }
  pos.needsUpdate = true;
  uv.needsUpdate = true;
  geo.computeVertexNormals();
  const mat = texture
    ? new THREE.MeshStandardMaterial({ map: texture, roughness: 0.97, metalness: 0 })
    : new THREE.MeshStandardMaterial({ color: 0x6f7551, roughness: 1.0, metalness: 0 });
  if (texture) addGroundDetail(mat, overlay ? half : null);
  if (overlay) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    mat.transparent = true;
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  if (overlay) mesh.renderOrder = 1;
  scene.add(mesh);
  return mesh;
}

// Blend a tiling, world-space procedural grain into the aerial ground so it
// keeps some tooth up close instead of dissolving into a blurry photo. When a
// feather half size is given, also fade the photo out towards its square edge so
// a sharp core overlay melts into the wider ground below with no hard seam. Pure
// shader tweak, verified by headless screenshots.
function addGroundDetail(mat, featherHalf = null) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundXZ = position.xz;');
    let grain = `#include <map_fragment>
{
  // Tame the cold blue haze the aerial photo carries in shadow and near field so
  // the eye level ground reads as natural stone and earth, not a blue smear. Only
  // pixels where blue outweighs red and green are pulled toward a warm grey, so
  // the green lawns and the warm roofs keep their colour.
  float blueCast = clamp(diffuseColor.b - max(diffuseColor.r, diffuseColor.g), 0.0, 1.0);
  float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(1.06, 1.0, 0.9), clamp(blueCast * 2.2, 0.0, 0.85));
}
{
  float n = gNoise(vGroundXZ*0.7)*0.55 + gNoise(vGroundXZ*2.7)*0.3 + gNoise(vGroundXZ*8.0)*0.15;
  diffuseColor.rgb *= (0.82 + 0.36*n);
}
{
  float gd = distance(cameraPosition.xz, vGroundXZ);
  float gnear = 1.0 - smoothstep(3.0, 16.0, gd);
  float gfine = gNoise(vGroundXZ*6.5)*0.5 + gNoise(vGroundXZ*21.0)*0.5;
  diffuseColor.rgb *= mix(1.0, 0.74 + 0.5*gfine, gnear);
}`;
    if (featherHalf) {
      grain += `
{
  float fd = max(abs(vGroundXZ.x), abs(vGroundXZ.y)) / ${featherHalf.toFixed(1)};
  diffuseColor.a *= 1.0 - smoothstep(0.80, 0.98, fd);
}`;
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vGroundXZ;
float gHash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float gNoise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(gHash(i),gHash(i+vec2(1.,0.)),u.x),
             mix(gHash(i+vec2(0.,1.)),gHash(i+vec2(1.,1.)),u.x), u.y);
}`,
      )
      .replace('#include <map_fragment>', grain);
  };
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
