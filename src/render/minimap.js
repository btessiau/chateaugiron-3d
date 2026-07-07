// Renders a north-up minimap into a 2D canvas. A static basemap of the whole
// town is drawn once; each frame a circular window centred on the player is
// blitted, with a heading arrow in the middle. Pure maths live in
// src/lib/minimap.js; this file only draws.

import { headingArrowAngle } from '../lib/minimap.js';

const PX_PER_M = 0.9; // basemap resolution
const METRES_ACROSS = 240; // how much of the town the minimap window shows

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = canvas.width;
    this.base = null;
    this.minX = 0;
    this.maxZ = 0;
  }

  // Draw every footprint, road, and water body once to an offscreen canvas.
  build(features, proj) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const shapes = [];
    for (const f of features) {
      const pts = f.g.map((g) => proj.project(g[0], g[1]));
      for (const [x, z] of pts) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      shapes.push({ k: f.k, highway: f.t && f.t.highway, pts });
    }
    this.minX = minX;
    this.maxZ = maxZ;
    const w = Math.max(1, Math.ceil((maxX - minX) * PX_PER_M));
    const h = Math.max(1, Math.ceil((maxZ - minZ) * PX_PER_M));
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const c = off.getContext('2d');
    c.fillStyle = '#20262e';
    c.fillRect(0, 0, w, h);

    const toPx = (x, z) => [(x - minX) * PX_PER_M, (maxZ - z) * PX_PER_M];
    const poly = (pts, fill) => {
      c.beginPath();
      pts.forEach(([x, z], i) => {
        const [px, py] = toPx(x, z);
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      });
      c.closePath();
      c.fillStyle = fill;
      c.fill();
    };

    for (const s of shapes) if (s.k === 'green') poly(s.pts, '#2f4a30');
    for (const s of shapes) if (s.k === 'water') poly(s.pts, '#22506e');
    c.strokeStyle = '#3a4048';
    c.lineWidth = 1.4;
    for (const s of shapes) {
      if (s.k !== 'road') continue;
      c.beginPath();
      s.pts.forEach(([x, z], i) => {
        const [px, py] = toPx(x, z);
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      });
      c.stroke();
    }
    for (const s of shapes) if (s.k === 'building') poly(s.pts, '#c7bfae');

    this.base = off;
    return this;
  }

  draw(playerX, playerZ, yaw) {
    const ctx = this.ctx;
    const size = this.size;
    ctx.clearRect(0, 0, size, size);
    if (!this.base) return;
    const bx = (playerX - this.minX) * PX_PER_M;
    const by = (this.maxZ - playerZ) * PX_PER_M;
    const src = METRES_ACROSS * PX_PER_M;

    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(this.base, bx - src / 2, by - src / 2, src, src, 0, 0, size, size);
    ctx.restore();

    // Heading arrow at the centre.
    const a = headingArrowAngle(yaw);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-5, 5);
    ctx.lineTo(-5, -5);
    ctx.closePath();
    ctx.fillStyle = '#ffd24a';
    ctx.strokeStyle = '#1a1200';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Circle frame.
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(150,180,220,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
