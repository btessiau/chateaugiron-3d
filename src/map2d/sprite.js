// A small procedural "trainer" sprite drawn with rectangles, in the chunky
// spirit of a Pokemon overworld character. No external art, so nothing to
// license. It faces four ways and has a two-frame walk cycle.

const SKIN = '#f1c9a0';
const SKIN_SHADE = '#d9a878';
const HAIR = '#5a3a22';
const CAP = '#e0483c';
const CAP_SHADE = '#b8352c';
const SHIRT = '#3f7fd6';
const SHIRT_SHADE = '#2f63ab';
const TROUSERS = '#39434f';
const SHOES = '#26292e';
const OUTLINE = 'rgba(30,24,20,0.55)';

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

// Draw the trainer so their feet sit at (cx, cy). `u` is one sprite unit in
// pixels; the whole figure is about 12u wide and 22u tall. `frame` is 0 or 1.
export function drawTrainer(ctx, cx, cy, facing, frame, u) {
  const bob = frame === 1 ? -u * 0.6 : 0; // gentle up-bob on the second frame
  const top = cy - 22 * u + bob;

  // Soft contact shadow, on the ground (not bobbing).
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(cx, cy - u * 0.6, 7 * u, 2.6 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Legs + shoes, with an alternating stride.
  const stride = frame === 1 ? u * 1.1 : 0;
  const legY = top + 15 * u;
  const legH = 5 * u;
  if (facing === 'left' || facing === 'right') {
    rect(ctx, cx - 2.4 * u, legY, 2.6 * u, legH - stride, TROUSERS);
    rect(ctx, cx - 0.2 * u, legY, 2.6 * u, legH, TROUSERS);
    rect(ctx, cx - 2.4 * u, legY + legH - stride - u, 2.6 * u, u * 1.4, SHOES);
    rect(ctx, cx - 0.2 * u, legY + legH - u, 2.6 * u, u * 1.4, SHOES);
  } else {
    rect(ctx, cx - 3.3 * u, legY, 2.8 * u, legH - stride, TROUSERS);
    rect(ctx, cx + 0.5 * u, legY, 2.8 * u, legH, TROUSERS);
    rect(ctx, cx - 3.3 * u, legY + legH - stride - u, 2.8 * u, u * 1.4, SHOES);
    rect(ctx, cx + 0.5 * u, legY + legH - u, 2.8 * u, u * 1.4, SHOES);
  }

  // Torso.
  const bodyW = 9 * u;
  const bodyH = 8 * u;
  const bodyX = cx - bodyW / 2;
  const bodyY = top + 8 * u;
  rect(ctx, bodyX, bodyY, bodyW, bodyH, SHIRT);
  rect(ctx, bodyX, bodyY, bodyW, u * 1.4, SHIRT_SHADE); // collar shade

  // Arms (swing opposite to the legs).
  const armSwing = frame === 1 ? u * 0.8 : -u * 0.4;
  rect(ctx, bodyX - 2.2 * u, bodyY + u + armSwing, 2.4 * u, 5.5 * u, SHIRT_SHADE);
  rect(ctx, bodyX + bodyW - 0.2 * u, bodyY + u - armSwing, 2.4 * u, 5.5 * u, SHIRT_SHADE);
  // Hands.
  rect(ctx, bodyX - 2.0 * u, bodyY + 6 * u + armSwing, 2 * u, 1.8 * u, SKIN);
  rect(ctx, bodyX + bodyW, bodyY + 6 * u - armSwing, 2 * u, 1.8 * u, SKIN);

  // Head.
  const headR = 5 * u;
  const headCx = cx;
  const headCy = top + 4 * u;
  ctx.save();
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(headCx, headCy, headR, 0, Math.PI * 2);
  ctx.fill();
  // Side shade for a little roundness.
  ctx.fillStyle = SKIN_SHADE;
  ctx.beginPath();
  ctx.arc(
    headCx + (facing === 'left' ? -1.4 * u : 1.4 * u),
    headCy + u,
    headR * 0.7,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  // Cap: hair band + peaked cap, with a brim pointing the way we face.
  rect(ctx, headCx - headR, headCy - headR * 0.2, headR * 2, headR * 0.9, HAIR);
  ctx.save();
  ctx.fillStyle = CAP;
  ctx.beginPath();
  ctx.arc(headCx, headCy - u * 0.8, headR * 1.02, Math.PI, Math.PI * 2);
  ctx.fill();
  if (facing === 'up') {
    rect(ctx, headCx - headR, headCy - u * 1.2, headR * 2, u * 1.4, CAP_SHADE);
  } else if (facing === 'left') {
    rect(ctx, headCx - headR - 2.2 * u, headCy - u * 0.9, 2.6 * u, u * 1.6, CAP_SHADE);
  } else if (facing === 'right') {
    rect(ctx, headCx + headR - 0.4 * u, headCy - u * 0.9, 2.6 * u, u * 1.6, CAP_SHADE);
  } else {
    rect(ctx, headCx - 3 * u, headCy + u * 0.4, 6 * u, u * 1.5, CAP_SHADE);
  }
  ctx.restore();

  // Face: only the front and side views show eyes.
  if (facing === 'down') {
    rect(ctx, headCx - 2.4 * u, headCy + u * 1.2, 1.5 * u, 1.7 * u, '#2a2320');
    rect(ctx, headCx + 1.0 * u, headCy + u * 1.2, 1.5 * u, 1.7 * u, '#2a2320');
  } else if (facing === 'left') {
    rect(ctx, headCx - 2.6 * u, headCy + u * 1.1, 1.5 * u, 1.7 * u, '#2a2320');
  } else if (facing === 'right') {
    rect(ctx, headCx + 1.1 * u, headCy + u * 1.1, 1.5 * u, 1.7 * u, '#2a2320');
  }

  // Thin outline pass around the torso for a drawn look.
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1, u * 0.5);
  ctx.strokeRect(Math.round(bodyX), Math.round(bodyY), Math.round(bodyW), Math.round(bodyH));
}
