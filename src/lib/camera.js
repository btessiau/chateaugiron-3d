// Pure camera + movement maths shared by first and third person. No three.js so
// it stays unit tested. Yaw is rotation about +Y; at yaw 0 the player faces -Z.

export function clampPitch(pitch, min = -1.35, max = 1.35) {
  return Math.max(min, Math.min(max, pitch));
}

// Horizontal move for the given key input and yaw. Forward is -Z at yaw 0.
// Returns the world delta (dx, dz) scaled by speed*dt, whether the player is
// moving, and the heading the avatar should face (rotation.y).
export function moveVector(input, yaw, speed, dt) {
  const fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
  const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  // forward = (-s, -c), right = (c, -s)
  let dx = fwd * -s + strafe * c;
  let dz = fwd * -c + strafe * -s;
  const len = Math.hypot(dx, dz);
  if (len === 0) return { dx: 0, dz: 0, moving: false, heading: 0 };
  const k = (speed * dt) / len;
  dx *= k;
  dz *= k;
  return { dx, dz, moving: true, heading: Math.atan2(-dx, -dz) };
}

// Camera offset from the target so the camera sits behind the player and looks
// where the player faces. Pitch tilts it up or down.
export function orbitOffset(yaw, pitch, distance) {
  const cp = Math.cos(pitch);
  return {
    x: Math.sin(yaw) * cp * distance,
    y: -Math.sin(pitch) * distance,
    z: Math.cos(yaw) * cp * distance,
  };
}
