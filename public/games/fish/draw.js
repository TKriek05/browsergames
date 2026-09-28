// Hapvis drawing: an underwater world in world coordinates (the camera is a
// canvas transform): water getting darker with depth, light rays, a sandy
// bottom with rocks and swaying seaweed, plankton and the fish themselves.
import { FISH } from '../../../shared/games/fish.js';
import { createRng } from '../../../shared/rng.js';

const W = FISH.WIDTH;
const H = FISH.HEIGHT;

export function makeDecor(seed) {
  const rng = createRng(seed ^ 0x5eed);
  const weeds = Array.from({ length: 34 }, () => ({ x: rng() * W, h: 30 + rng() * 70, phase: rng() * 6, color: rng() < 0.5 ? '#2f7d4a' : '#3d9457' }));
  const rocks = Array.from({ length: 16 }, () => ({ x: rng() * W, r: 10 + rng() * 26, color: rng() < 0.5 ? '#50606e' : '#5f6f7a' }));
  const rays = Array.from({ length: 6 }, (_, i) => ({ x: (i + 0.5) * (W / 6) + (rng() - 0.5) * 80, w: 40 + rng() * 60 }));
  return { weeds, rocks, rays };
}

export function drawWater(ctx, decor, time) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2c8fbf');
  g.addColorStop(0.55, '#16618f');
  g.addColorStop(1, '#0b3656');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Light from the surface.
  ctx.fillStyle = 'rgba(255, 255, 240, 0.06)';
  for (const r of decor.rays) {
    const sway = Math.sin(time * 0.4 + r.x) * 30;
    ctx.beginPath();
    ctx.moveTo(r.x - r.w / 2 + sway, 0);
    ctx.lineTo(r.x + r.w / 2 + sway, 0);
    ctx.lineTo(r.x + r.w * 1.8 + sway * 2, H * 0.8);
    ctx.lineTo(r.x + r.w * 0.6 + sway * 2, H * 0.8);
    ctx.closePath();
    ctx.fill();
  }
  // The surface line.
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(0, 0, W, 3);
}

export function drawBottom(ctx, decor, time) {
  ctx.fillStyle = '#c9b27d';
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 20) ctx.lineTo(x, H - 18 - Math.sin(x * 0.02) * 6);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
  for (const r of decor.rocks) {
    ctx.fillStyle = r.color;
    ctx.beginPath();
    ctx.ellipse(r.x, H - 14, r.r * 1.3, r.r, 0, Math.PI, 0);
    ctx.fill();
  }
  ctx.lineCap = 'round';
  for (const w of decor.weeds) {
    ctx.strokeStyle = w.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(w.x, H - 12);
    const segs = 6;
    for (let i = 1; i <= segs; i++) {
      const k = i / segs;
      ctx.lineTo(w.x + Math.sin(time * 1.4 + w.phase + k * 2.5) * 9 * k, H - 12 - w.h * k);
    }
    ctx.stroke();
  }
}

export function drawPlankton(ctx, spots, food, time, view) {
  for (let i = 0; i < spots.xs.length; i++) {
    if (!food[i]) continue;
    const x = spots.xs[i] + Math.sin(time * 1.3 + i) * 2.5;
    const y = spots.ys[i] + Math.cos(time * 1.1 + i * 0.7) * 2.5;
    if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
    ctx.fillStyle = i % 3 === 0 ? '#ffb3c7' : i % 3 === 1 ? '#a8e67f' : '#ffe08a';
    ctx.beginPath();
    ctx.arc(x, y, i % 3 === 0 ? 2.8 : 2.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// A fish at (x, y), radius r, facing (fx, fy). ring: outline hint (who eats whom).
export function drawFish(ctx, x, y, r, fx, fy, color, time, ring = null) {
  const a = Math.atan2(fy, fx);
  const flip = Math.abs(a) > Math.PI / 2 ? -1 : 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.scale(1, flip);
  const wag = Math.sin(time * 9 + x * 0.05) * 0.25;
  // Tail.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-r * 0.9, 0);
  ctx.lineTo(-r * 1.75, -r * (0.7 + wag));
  ctx.lineTo(-r * 1.55, 0);
  ctx.lineTo(-r * 1.75, r * (0.7 - wag));
  ctx.closePath();
  ctx.fill();
  // Dorsal fin.
  ctx.beginPath();
  ctx.moveTo(-r * 0.4, -r * 0.7);
  ctx.quadraticCurveTo(-r * 0.1, -r * 1.35, r * 0.35, -r * 0.72);
  ctx.closePath();
  ctx.fill();
  // Body.
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.25, r * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
  if (ring) {
    ctx.lineWidth = Math.max(1.5, r * 0.12);
    ctx.strokeStyle = ring;
    ctx.stroke();
  }
  // Stripes and belly.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (const sx of [-0.55, -0.1]) ctx.fillRect(r * sx, -r, r * 0.18, r * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.ellipse(r * 0.1, r * 0.45, r * 0.95, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Eye and mouth.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(r * 0.62, -r * 0.18, r * 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#10141c';
  ctx.beginPath();
  ctx.arc(r * 0.68, -r * 0.18, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath();
  ctx.arc(r * 1.1, r * 0.12, r * 0.2, Math.PI * 0.6, Math.PI * 1.1);
  ctx.stroke();
  ctx.restore();
}
