// Pure geometry to skin a real building front with a photographed facade.
// Given a footprint's oriented box and a point on the open (street) side, pick
// the long wall that faces the street and return where to hang a flush photo
// panel, its yaw, and the available wall width. No three.js so it stays unit
// tested. buildWorld records the anchors, landmarkPhotos turns them into meshes.

// box: { cx, cz, ux, uz, vx, vz, L, W } from roof.js orientedBox. The two long
// (eaves) walls sit at the box centre +/- v * W and each span 2 * L along u.
// (faceX, faceZ): a point on the side the wall should face, e.g. the street.
// Returns { x, z, yaw, width, normalX, normalZ } for a plane whose +Z front
// points out along the chosen wall's outward normal.
export function facadePlacement(box, faceX, faceZ) {
  const { cx, cz, vx, vz, L, W } = box;
  const pOutX = cx + vx * W;
  const pOutZ = cz + vz * W;
  const nOutX = cx - vx * W;
  const nOutZ = cz - vz * W;
  const dPlus = (pOutX - faceX) ** 2 + (pOutZ - faceZ) ** 2;
  const dMinus = (nOutX - faceX) ** 2 + (nOutZ - faceZ) ** 2;
  const sign = dPlus <= dMinus ? 1 : -1;
  const normalX = sign * vx;
  const normalZ = sign * vz;
  return {
    x: cx + normalX * W,
    z: cz + normalZ * W,
    yaw: Math.atan2(normalX, normalZ),
    width: 2 * L,
    normalX,
    normalZ,
  };
}

// Fit a photo of the given aspect (w / h) inside a wall of maxW by maxH while
// preserving the aspect, then anchor it to the ground: the returned rectangle is
// centred horizontally and its bottom edge sits on the wall base. Returns the
// drawn width and height plus the centre height above the base.
export function fitFacade(maxW, maxH, aspect) {
  let h = maxH;
  let w = h * aspect;
  if (w > maxW) {
    w = maxW;
    h = w / aspect;
  }
  return { w, h, centerY: h / 2 };
}
