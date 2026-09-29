// Kladderkoning drawing: a painter's studio seen from above. A wooden floor
// with paint tubes and drips, the big canvas taped down in the middle, the
// paint as soft blobs (one circle per cell, so the edges look like real
// paint), paint pots and crates, the painters with their rollers and the
// power-up bubbles. World (x, y) → screen via the arena transform T.
import { KL, KL_W, KL_H, KL_CELLS, KL_POWER, KL_POWERS, KL_POWER_RULES as PR } from '../../../shared/games/kladder.js';
import { createRng } from '../../../shared/rng.js';
import { drawText } from '../../js/core/hudtext.js';

const TAU = Math.PI * 2;
const POT_PAINT = ['#ff5a5a', '#3ec5ff', '#ffd23e', '#5dd46a', '#c77dff', '#ff9a3e'];

// Where the arena sits in the 480 × 270 view.
export const T = { x: 10, y: 16, k: 250 / KL_H };
export const toScreen = (x, y, out) => {
  out.x = T.x + x * T.k;
  out.y = T.y + y * T.k;
  return out;
};

// --- Static background: floor, canvas, decoration ------------------------------------------
export function drawStudio(ctx, W, H) {
  const rnd = createRng(77);
  // Floor planks.
  for (let y = 0; y < H; y += 18) {
    ctx.fillStyle = (y / 18) % 2 ? '#b98a55' : '#b0824f';
    ctx.fillRect(0, y, W, 18);
    ctx.fillStyle = 'rgba(70, 40, 15, 0.25)';
    ctx.fillRect(0, y, W, 1);
    for (let x = ((y / 18) % 3) * 40; x < W; x += 120) ctx.fillRect(x, y, 1, 18);
  }
  // Old paint drips on the floor (not under the scoreboard).
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = POT_PAINT[i % POT_PAINT.length];
    ctx.globalAlpha = 0.55;
    const x = rnd() * W;
    const y = rnd() * H;
    if (x > T.x + KL_W * T.k && y < H - 70) continue;
    ctx.beginPath();
    ctx.arc(x, y, 1 + rnd() * 3, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // The canvas: a shadow, the paper, a little grain.
  const x0 = T.x;
  const y0 = T.y;
  const w = KL_W * T.k;
  const h = KL_H * T.k;
  ctx.fillStyle = 'rgba(40, 20, 5, 0.35)';
  ctx.fillRect(x0 + 3, y0 + 4, w, h);
  ctx.fillStyle = '#fbf8ef';
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = 'rgba(120, 100, 70, 0.06)';
  for (let i = 0; i < 500; i++) ctx.fillRect(x0 + rnd() * w, y0 + rnd() * h, 1, 1);
  // Masking tape on the corners.
  ctx.fillStyle = 'rgba(232, 214, 160, 0.92)';
  for (const [cx, cy, a] of [[x0, y0, -0.7], [x0 + w, y0, 0.7], [x0, y0 + h, 0.7], [x0 + w, y0 + h, -0.7]]) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.fillRect(-12, -4, 24, 8);
    ctx.restore();
  }
  // A palette and brushes lying next to the canvas.
  const px = x0 + w + 44;
  const py = H - 30;
  ctx.fillStyle = '#d8b07a';
  ctx.beginPath();
  ctx.ellipse(px, py, 30, 20, -0.3, 0, TAU);
  ctx.fill();
  POT_PAINT.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(px - 18 + i * 7, py - 6 + Math.sin(i) * 6, 3.2, 0, TAU);
    ctx.fill();
  });
  ctx.fillStyle = '#b98a55';
  ctx.beginPath();
  ctx.arc(px + 14, py + 6, 5, 0, TAU);
  ctx.fill();
}

// --- Paint layer (redrawn when the grid changed) -----------------------------------------
// colors[owner] = hex (owner = slot + 1).
export function drawPaint(ctx, grid, colors, dark) {
  const C = KL.CELL * T.k;
  const r = C * 0.74;
  for (const [pass, rad] of [[dark, r + C * 0.1], [colors, r]]) {
    for (let owner = 1; owner < pass.length; owner++) {
      if (!pass[owner]) continue;
      ctx.fillStyle = pass[owner];
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < KL_CELLS; i++) {
        if (grid[i] !== owner) continue;
        const cx = T.x + ((i % KL.COLS) + 0.5) * C;
        const cy = T.y + (Math.floor(i / KL.COLS) + 0.5) * C;
        ctx.moveTo(cx + rad, cy);
        ctx.arc(cx, cy, rad, 0, TAU);
        any = true;
      }
      if (any) ctx.fill();
    }
  }
}

// --- Blocks: paint pots and crates ------------------------------------------------------------
export function drawBlocks(ctx, walls) {
  walls.forEach((o, i) => {
    const x = T.x + (o.x - o.w / 2) * T.k;
    const y = T.y + (o.y - o.h / 2) * T.k;
    const w = o.w * T.k;
    const h = o.h * T.k;
    ctx.fillStyle = 'rgba(40, 20, 5, 0.3)';
    if (o.kind === 'pot') {
      const r = Math.min(w, h) / 2;
      const cx = x + w / 2;
      const cy = y + h / 2;
      ctx.beginPath();
      ctx.arc(cx + 2, cy + 3, r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#9aa3ad';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#6f7880';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.84, 0, TAU);
      ctx.fill();
      ctx.fillStyle = POT_PAINT[i % POT_PAINT.length];
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.76, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.3, cy - r * 0.3, r * 0.25, r * 0.12, -0.7, 0, TAU);
      ctx.fill();
      // A brush sticking out.
      ctx.strokeStyle = '#8a5a2b';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + r * 1.1, cy - r * 0.9);
      ctx.stroke();
    } else {
      ctx.fillRect(x + 2, y + 3, w, h);
      ctx.fillStyle = '#a8743f';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#8f6233';
      const along = w >= h;
      for (let t = 3; t < (along ? h : w); t += 5) {
        if (along) ctx.fillRect(x, y + t, w, 1);
        else ctx.fillRect(x + t, y, 1, h);
      }
      ctx.strokeStyle = '#6e4a24';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x + 0.6, y + 0.6, w - 1.2, h - 1.2);
    }
  });
}

// --- Painters -------------------------------------------------------------------------------
// A round painter at screen (sx, sy) facing (fx, fy) pushing a roller.
export function drawPainter(ctx, sx, sy, fx, fy, color, dark, { wide, dash, stun, time, me }) {
  const k = T.k;
  const r = KL.RADIUS * k;
  const brush = (wide ? KL.WIDE_BRUSH : KL.BRUSH) * k;
  const px = -fy;
  const py = fx;
  // Shadow.
  ctx.fillStyle = 'rgba(40, 20, 5, 0.25)';
  ctx.beginPath();
  ctx.ellipse(sx + 1.5, sy + 2, r * 1.1, r * 0.9, 0, 0, TAU);
  ctx.fill();
  // Handle and roller.
  const rx = sx + fx * r * 1.6;
  const ry = sy + fy * r * 1.6;
  ctx.strokeStyle = '#555a62';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(sx + fx * r * 0.6, sy + fy * r * 0.6);
  ctx.lineTo(rx, ry);
  ctx.stroke();
  ctx.lineCap = 'round';
  ctx.lineWidth = 4.2;
  ctx.strokeStyle = dark;
  ctx.beginPath();
  ctx.moveTo(rx - px * brush * 0.8, ry - py * brush * 0.8);
  ctx.lineTo(rx + px * brush * 0.8, ry + py * brush * 0.8);
  ctx.stroke();
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = color;
  ctx.stroke();
  // Body with a wobble when stunned.
  const wob = stun ? Math.sin(time * 20) * 1.2 : 0;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(sx + wob, sy, r, 0, TAU);
  ctx.fill();
  ctx.lineWidth = me ? 1.6 : 1;
  ctx.strokeStyle = me ? '#ffffff' : dark;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(sx + wob - r * 0.3, sy - r * 0.35, r * 0.35, r * 0.2, -0.6, 0, TAU);
  ctx.fill();
  // Eyes looking where it goes (crosses when stunned).
  for (const side of [-1, 1]) {
    const ex = sx + wob + fx * r * 0.35 + px * side * r * 0.38;
    const ey = sy + fy * r * 0.35 + py * side * r * 0.38;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#1a1a22';
    if (stun) {
      ctx.fillRect(ex - r * 0.2, ey - 0.4, r * 0.4, 0.8);
      ctx.fillRect(ex - 0.4, ey - r * 0.2, 0.8, r * 0.4);
    } else {
      ctx.beginPath();
      ctx.arc(ex + fx * r * 0.12, ey + fy * r * 0.12, r * 0.15, 0, TAU);
      ctx.fill();
    }
  }
  if (dash) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    for (const o of [-0.6, 0, 0.6]) {
      ctx.beginPath();
      ctx.moveTo(sx - fx * r * 1.4 + px * o * r, sy - fy * r * 1.4 + py * o * r);
      ctx.lineTo(sx - fx * r * 2.8 + px * o * r, sy - fy * r * 2.8 + py * o * r);
      ctx.stroke();
    }
  }
  if (stun) {
    ctx.fillStyle = '#ffe14d';
    for (let i = 0; i < 3; i++) {
      const a = time * 6 + (i * TAU) / 3;
      ctx.beginPath();
      ctx.arc(sx + Math.cos(a) * r * 1.1, sy - r * 1.2 + Math.sin(a) * r * 0.4, 1.3, 0, TAU);
      ctx.fill();
    }
  }
}

// --- Power-ups ----------------------------------------------------------------------------------
export function powerIcon(ctx, type, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = KL_POWERS[type].color;
  ctx.strokeStyle = KL_POWERS[type].color;
  ctx.lineCap = 'round';
  if (type === KL_POWER.WIDE) {
    ctx.fillRect(-s, -s * 0.35, s * 2, s * 0.7);
    ctx.fillStyle = '#555a62';
    ctx.fillRect(-s * 0.1, s * 0.35, s * 0.2, s * 0.7);
  } else if (type === KL_POWER.TURBO) {
    ctx.beginPath();
    ctx.moveTo(s * 0.25, -s);
    ctx.lineTo(-s * 0.55, s * 0.15);
    ctx.lineTo(-s * 0.02, s * 0.15);
    ctx.lineTo(-s * 0.3, s);
    ctx.lineTo(s * 0.6, -s * 0.2);
    ctx.lineTo(s * 0.05, -s * 0.2);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(0, s * 0.15, s * 0.75, 0, TAU);
    ctx.fill();
    ctx.lineWidth = s * 0.25;
    ctx.strokeStyle = '#555a62';
    ctx.beginPath();
    ctx.moveTo(s * 0.3, -s * 0.45);
    ctx.lineTo(s * 0.7, -s * 0.95);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawPower(ctx, p, time) {
  if (PR.LIFE_S - p.age < 3 && Math.sin(time * 16) < -0.3) return;
  const sx = T.x + p.x * T.k;
  const sy = T.y + p.y * T.k + Math.sin(time * 2.5 + p.id) * 1.2;
  const r = PR.RADIUS * T.k * 0.95;
  ctx.fillStyle = 'rgba(40, 20, 5, 0.2)';
  ctx.beginPath();
  ctx.arc(sx + 1.5, sy + 2.5, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, TAU);
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = KL_POWERS[p.type].color;
  ctx.stroke();
  powerIcon(ctx, p.type, sx, sy, r * 0.62);
}

// HUD icons with seconds left.
export function drawPowerHud(ctx, timers, x, y, shadow) {
  for (const [type, t] of timers) {
    if (!(t > 0)) continue;
    ctx.fillStyle = 'rgba(40, 25, 10, 0.55)';
    ctx.beginPath();
    ctx.arc(x + 7, y + 7, 8, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = KL_POWERS[type].color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x + 7, y + 7, 8, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, t / KL_POWERS[type].seconds));
    ctx.stroke();
    powerIcon(ctx, type, x + 7, y + 7, 4.6);
    drawText(ctx, String(Math.ceil(t)), x + 18, y + 2, { color: '#ffffff', scale: 0.85, shadow });
    x += 32;
  }
}
