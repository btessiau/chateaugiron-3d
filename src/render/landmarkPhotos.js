// Places real, openly licensed photographs of Châteaugiron's landmarks into
// the scene: the actual Sainte-Marie-Madeleine altar and organ inside the
// church, and a heritage board with the real château by the keep gate. The
// image list and licences come from public/data/landmarks-photos.json, fetched
// by scripts/fetch-wikimedia.mjs. All images are CC0 / CC BY / CC BY-SA and are
// credited on an in-world caption under each panel.

import * as THREE from 'three';
import { facadePlacement, fitFacade } from '../lib/facadeAnchor.js';

const loader = new THREE.TextureLoader();

function loadTex(url) {
  const t = loader.load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// A small dark caption card: title on top, author and licence below.
function captionTexture(lines) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const w = 512;
  const h = 150;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1b1610';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ece4d3';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 34px Georgia, serif';
  ctx.fillText(lines[0] || '', 18, 42);
  ctx.font = '22px Georgia, serif';
  ctx.fillStyle = '#c6bca6';
  ctx.fillText(lines[1] || '', 18, 92);
  ctx.fillText(lines[2] || '', 18, 124);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function capLines(entry, title) {
  const by = entry.author ? `© ${entry.author}` : '© contributors';
  let provider = '';
  if (entry.source && entry.source.includes('flickr.com')) provider = ' · Flickr';
  else if (entry.source && entry.source.includes('wikimedia.org'))
    provider = ' · Wikimedia Commons';
  return [title, by, `${entry.license}${provider}`];
}

// A framed, unlit photo panel of the given height, keeping the image aspect,
// with an optional caption card hung just below it. Built in the XY plane with
// its front face pointing +Z, then oriented and positioned by the caller.
function photoPanel(url, aspect, height, caption) {
  const grp = new THREE.Group();
  const w = height * aspect;
  const photo = new THREE.Mesh(
    new THREE.PlaneGeometry(w, height),
    new THREE.MeshBasicMaterial({ map: loadTex(url), side: THREE.DoubleSide }),
  );
  grp.add(photo);
  const frame = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 0.26, height + 0.26),
    new THREE.MeshBasicMaterial({ color: 0x241c12, side: THREE.DoubleSide }),
  );
  frame.position.z = -0.03;
  grp.add(frame);
  if (caption) {
    const ct = captionTexture(caption);
    if (ct) {
      const cw = w + 0.26;
      const chh = cw * 0.16;
      const cap = new THREE.Mesh(
        new THREE.PlaneGeometry(cw, chh),
        new THREE.MeshBasicMaterial({ map: ct, side: THREE.DoubleSide }),
      );
      cap.position.set(0, -height / 2 - chh / 2 - 0.1, 0.01);
      grp.add(cap);
    }
  }
  return grp;
}

function pick(manifest, cat, re) {
  const arr = manifest[cat];
  if (!arr || !arr.length) return null;
  if (re) return arr.find((e) => re.test(e.file)) || null;
  return arr[0];
}

// Y rotation that aligns the panel's local X with the short axis (vx, vz) and
// then flips it so its front face points from `from` toward `to`.
function faceAngle(vx, vz, fromX, fromZ, toX, toZ) {
  const base = Math.atan2(-vz, vx);
  const nx = -vz;
  const nz = vx;
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  return nx * dx + nz * dz < 0 ? base + Math.PI : base;
}

function placeChurchPhotos(scene, ch, manifest, base) {
  const { box, gy, wallH } = ch;
  const { cx, cz, ux, uz, vx, vz, L, W } = box;
  const toWorld = (s, t) => [cx + ux * s + vx * t, cz + uz * s + vz * t];
  const [doorX, doorZ] = toWorld(-L, 0);
  const [apseX, apseZ] = toWorld(L, 0);

  // Real altarpiece raised behind the 3D altar table, at the apse.
  const altar = pick(manifest, 'church_interior', /altar/) || pick(manifest, 'church_interior');
  if (altar) {
    const aspect = altar.w / altar.h;
    let ph = wallH * 0.62;
    if (ph * aspect > 2 * W * 0.8) ph = (2 * W * 0.8) / aspect;
    const [x, z] = toWorld(L - 0.45, 0);
    const g = photoPanel(
      base + altar.file,
      aspect,
      ph,
      capLines(altar, 'Maitre-autel, Sainte-Marie-Madeleine'),
    );
    g.rotation.y = faceAngle(vx, vz, x, z, doorX, doorZ);
    g.position.set(x, gy + 1.7 + ph / 2, z);
    scene.add(g);
  }

  // Real organ over the entrance, facing back down the nave.
  const organ = pick(manifest, 'church_interior', /organ/);
  if (organ) {
    const aspect = organ.w / organ.h;
    let ph = wallH * 0.42;
    if (ph * aspect > 2 * W * 0.55) ph = (2 * W * 0.55) / aspect;
    const [x, z] = toWorld(-L + 0.45, 0);
    const g = photoPanel(base + organ.file, aspect, ph, capLines(organ, 'Orgue de tribune'));
    g.rotation.y = faceAngle(vx, vz, x, z, apseX, apseZ);
    g.position.set(x, gy + wallH * 0.6, z);
    scene.add(g);
  }

  // Heritage board with the real church facade, set to the SIDE of the parvis
  // (a small gallery) so it never blocks the view of the real steeple ahead.
  const facade =
    pick(manifest, 'church_exterior', /exterior_03/) ||
    pick(manifest, 'church_exterior', /exterior_02/);
  if (facade) {
    const aspect = facade.w / facade.h;
    const ph = 3.2;
    const [x, z] = toWorld(-L - 6, 9);
    const [apX, apZ] = toWorld(-L - 40, 0);
    const g = photoPanel(
      base + facade.file,
      aspect,
      ph,
      capLines(facade, 'Eglise Sainte-Marie-Madeleine'),
    );
    g.rotation.y = faceAngle(vx, vz, x, z, apX, apZ);
    g.position.set(x, gy + 1.1 + ph / 2, z);
    scene.add(g);
  }
}

// A small heritage-trail cluster along the SIDE of the church parvis: framed
// boards of two more real Chateaugiron monuments (Les Halles, an old rue
// d'Yaigne house), lined up next to the church facade board as a side gallery
// so the central view to the real steeple stays clear. Each carries its own
// author and licence, and faces the approaching player.
function placeHeritageTrail(scene, ch, manifest, base) {
  const arr = manifest.heritage_trail;
  if (!arr || !arr.length) return;
  const { box, gy } = ch;
  const { cx, cz, ux, uz, vx, vz, L } = box;
  const toWorld = (s, t) => [cx + ux * s + vx * t, cz + uz * s + vz * t];
  const [apX, apZ] = toWorld(-L - 40, 0); // approach point down the parvis axis
  const ph = 3.2;
  const sPos = [-L - 10, -L - 14];
  for (let i = 0; i < sPos.length && i < arr.length; i++) {
    const entry = arr[i];
    const aspect = entry.w / entry.h;
    const [x, z] = toWorld(sPos[i], 9);
    const g = photoPanel(
      base + entry.file,
      aspect,
      ph,
      capLines(entry, entry.title || 'Patrimoine'),
    );
    g.rotation.y = faceAngle(vx, vz, x, z, apX, apZ);
    g.position.set(x, gy + 1.1 + ph / 2, z);
    scene.add(g);
  }
}

function placeKeepBoard(scene, kp, manifest, base) {
  const ext =
    pick(manifest, 'chateau_exterior', /donjon_sun/) ||
    pick(manifest, 'chateau_exterior', /exterior_04/) ||
    pick(manifest, 'chateau_exterior', /facade_01/) ||
    pick(manifest, 'chateau_exterior');
  if (!ext) return;
  const { kx, kz, gy, rWall, doorA } = kp;
  const aspect = ext.w / ext.h;
  const ph = 3.4;
  const dirx = Math.cos(doorA);
  const dirz = Math.sin(doorA);
  const dist = rWall + 5;
  const x = kx + dirx * dist;
  const z = kz + dirz * dist;
  const g = photoPanel(base + ext.file, aspect, ph, capLines(ext, 'Le donjon'));
  // Front face points outward along the door direction, toward the approach.
  g.rotation.y = Math.atan2(dirx, dirz);
  g.position.set(x, gy + 1.1 + ph / 2, z);
  scene.add(g);
}

// A small heritage plaque (title + credit) mounted low on a house wall, the way
// French old towns label their protected facades. Returned as a mesh in the XY
// plane, front +Z, to be oriented and placed by the caller.
function plaque(caption) {
  const ct = captionTexture(caption);
  if (!ct) return null;
  const w = 1.5;
  const h = w * 0.29;
  const grp = new THREE.Group();
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 0.08, h + 0.08),
    new THREE.MeshBasicMaterial({ color: 0x140f0a, side: THREE.DoubleSide }),
  );
  back.position.z = -0.01;
  grp.add(back);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: ct, side: THREE.DoubleSide }),
  );
  grp.add(face);
  return grp;
}

// Skin a handful of real old-town building fronts with photographed Chateaugiron
// facades so they read as the actual half-timbered houses, with a small credit
// plaque mounted low on the wall.
function placeOldTownFacades(scene, hosts, manifest, base) {
  const arr = manifest.oldtown_facade || [];
  for (const host of hosts) {
    const entry = arr.find((e) => e.file.includes(host.photo));
    if (!entry) continue;
    const pl = facadePlacement(host.box, host.face[0], host.face[1]);
    const aspect = entry.w / entry.h;
    const { w, h, centerY } = fitFacade(pl.width * 0.98, host.height, aspect);
    const proud = 0.08;
    const photo = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: loadTex(base + entry.file), side: THREE.DoubleSide }),
    );
    photo.rotation.y = pl.yaw;
    photo.position.set(pl.x + pl.normalX * proud, host.gy + centerY, pl.z + pl.normalZ * proud);
    scene.add(photo);

    const pq = plaque(capLines(entry, 'Maison a pans de bois'));
    if (pq) {
      pq.rotation.y = pl.yaw;
      pq.position.set(
        pl.x + pl.normalX * (proud + 0.02),
        host.gy + 1.4,
        pl.z + pl.normalZ * (proud + 0.02),
      );
      // Nudge the plaque toward one side of the wall so it does not cover a door.
      const sx = -Math.sin(pl.yaw);
      const sz = Math.cos(pl.yaw);
      pq.position.x += sx * (w / 2 - 1.0);
      pq.position.z += sz * (w / 2 - 1.0);
      scene.add(pq);
    }
  }
}

export async function addLandmarkPhotos(scene, landmarks, base = './') {
  if (!landmarks) return null;
  let manifest = null;
  try {
    const res = await fetch(`${base}data/landmarks-photos.json`);
    if (res.ok) manifest = await res.json();
  } catch {
    manifest = null;
  }
  if (!manifest) return null;
  if (landmarks.church) placeChurchPhotos(scene, landmarks.church, manifest, base);
  if (landmarks.church) placeHeritageTrail(scene, landmarks.church, manifest, base);
  if (landmarks.keep) placeKeepBoard(scene, landmarks.keep, manifest, base);
  if (landmarks.oldtown && landmarks.oldtown.length) {
    placeOldTownFacades(scene, landmarks.oldtown, manifest, base);
  }
  return manifest;
}
