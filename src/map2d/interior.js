// Draws the inside of a landmark: a small themed room the player has stepped
// into. Pure canvas drawing, sized from the interior spec built in
// src/lib/interior.js. No coverage gate here (it is rendering), the geometry it
// relies on is tested there.

import { drawTrainer } from './sprite.js';

const BACKDROP = '#181410';
const WALL = '#6f6252';
const WALL_TOP = '#8a7c69';
const FLOOR = '#bcae95';
const FLOOR_ALT = '#b2a488';
const FLOOR_LINE = 'rgba(90,74,52,0.18)';
const CHURCH_FLOOR = '#c6bba6';

const PEW = '#7a5230';
const PEW_TOP = '#8f6338';
const ALTAR = '#d8b45a';
const ALTAR_CLOTH = '#b23b3b';
const TABLE = '#6e4a2c';
const TABLE_TOP = '#835a36';
const HEARTH = '#332a23';
const FIRE = '#ff9d3c';
const FIRE_CORE = '#ffd27a';
const STALL = '#9c6b3c';
const STALL_ROOF = '#c0894f';
const DESK = '#6e4a2c';
const BENCH = '#8a7350';
const MAT = '#3f9e57';
const MAT_EDGE = '#2f7e43';

// Map interior metres to screen. Returns the transform helpers + pixels-per-m.
function fit(spec, W, H) {
  const pad = 3;
  const ppm = Math.min(W / (spec.w + pad * 2), H / (spec.h + pad * 2));
  const ox = (W - spec.w * ppm) / 2;
  const oy = (H - spec.h * ppm) / 2;
  return {
    ppm,
    ox,
    oy,
    sx: (x) => ox + x * ppm,
    sy: (y) => oy + y * ppm,
  };
}

function drawProp(ctx, p, t) {
  const x = t.sx(p.x);
  const y = t.sy(p.y);
  const w = p.w * t.ppm;
  const h = p.h * t.ppm;
  if (p.type === 'altar') {
    ctx.fillStyle = ALTAR_CLOTH;
    ctx.fillRect(x, y + h * 0.4, w, h * 0.6);
    ctx.fillStyle = ALTAR;
    ctx.fillRect(x, y, w, h * 0.45);
  } else if (p.type === 'pew') {
    ctx.fillStyle = PEW;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = PEW_TOP;
    ctx.fillRect(x, y, w, Math.max(2, h * 0.35));
  } else if (p.type === 'glass') {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#e05a6a');
    g.addColorStop(0.5, '#f2c14e');
    g.addColorStop(1, '#4f7fd0');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  } else if (p.type === 'table') {
    ctx.fillStyle = TABLE;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = TABLE_TOP;
    ctx.fillRect(x, y, w, Math.max(2, h * 0.12));
  } else if (p.type === 'hearth') {
    ctx.fillStyle = HEARTH;
    ctx.fillRect(x, y, w, h);
    const cx = x + w / 2;
    const cy = y + h * 0.6;
    const r = Math.min(w, h) * 0.5;
    const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
    g.addColorStop(0, FIRE_CORE);
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.type === 'brazier') {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.max(w, h) * 0.7;
    const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
    g.addColorStop(0, FIRE);
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a3128';
    ctx.fillRect(x + w * 0.3, y + h * 0.4, w * 0.4, h * 0.6);
  } else if (p.type === 'stall') {
    ctx.fillStyle = STALL;
    ctx.fillRect(x, y + h * 0.35, w, h * 0.65);
    ctx.fillStyle = STALL_ROOF;
    ctx.fillRect(x - 1, y, w + 2, h * 0.4);
  } else if (p.type === 'desk') {
    ctx.fillStyle = DESK;
    ctx.fillRect(x, y, w, h);
  } else if (p.type === 'bench') {
    ctx.fillStyle = BENCH;
    ctx.fillRect(x, y, w, h);
  }
}

// Draw the whole interior scene into the canvas.
export function drawInterior(ctx, spec, ppos, facing, frame, W, H, label) {
  const t = fit(spec, W, H);

  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, W, H);

  // Wall frame behind the floor.
  const wall = 0.7 * t.ppm;
  ctx.fillStyle = WALL;
  ctx.fillRect(t.ox - wall, t.oy - wall, spec.w * t.ppm + wall * 2, spec.h * t.ppm + wall * 2);
  ctx.fillStyle = WALL_TOP;
  ctx.fillRect(t.ox - wall, t.oy - wall, spec.w * t.ppm + wall * 2, wall);

  // Floor + subtle flagstone grid.
  ctx.fillStyle = spec.kind === 'church' ? CHURCH_FLOOR : FLOOR;
  ctx.fillRect(t.ox, t.oy, spec.w * t.ppm, spec.h * t.ppm);
  ctx.fillStyle = FLOOR_ALT;
  for (let gy = 2; gy < spec.h; gy += 2) {
    for (let gx = ((gy / 2) % 2) * 2; gx < spec.w; gx += 4) {
      ctx.fillRect(t.sx(gx), t.sy(gy), 2 * t.ppm, 2 * t.ppm);
    }
  }
  ctx.strokeStyle = FLOOR_LINE;
  ctx.lineWidth = 1;
  for (let gx = 2; gx < spec.w; gx += 2) {
    ctx.beginPath();
    ctx.moveTo(t.sx(gx), t.oy);
    ctx.lineTo(t.sx(gx), t.oy + spec.h * t.ppm);
    ctx.stroke();
  }

  // A soft daylight wash from the door (bottom) so the far end reads deeper.
  const wash = ctx.createLinearGradient(0, t.oy, 0, t.oy + spec.h * t.ppm);
  wash.addColorStop(0, 'rgba(20,10,0,0.28)');
  wash.addColorStop(1, 'rgba(255,240,210,0.12)');
  ctx.fillStyle = wash;
  ctx.fillRect(t.ox, t.oy, spec.w * t.ppm, spec.h * t.ppm);

  // Furniture, back to front.
  for (const p of spec.props) drawProp(ctx, p, t);

  // Exit mat with an outward arrow.
  const e = spec.exit;
  const ex = t.sx(e.x);
  const ey = t.sy(e.y);
  const ew = e.w * t.ppm;
  const eh = e.h * t.ppm;
  ctx.fillStyle = MAT;
  ctx.fillRect(ex, ey, ew, eh);
  ctx.strokeStyle = MAT_EDGE;
  ctx.lineWidth = 2;
  ctx.strokeRect(ex, ey, ew, eh);
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.round(eh * 0.42)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EXIT ▼', ex + ew / 2, ey + eh / 2);

  // The player.
  const u = Math.max(1.4, Math.min(2.6, t.ppm * 0.16));
  drawTrainer(ctx, t.sx(ppos.x), t.sy(ppos.y), facing, frame, u, false);

  // Title.
  ctx.fillStyle = 'rgba(255,253,247,0.95)';
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`Inside · ${label}`, W / 2, 18);
}
