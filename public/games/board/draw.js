// Drawing helpers for the (non-pixel) board games.
import { PLAYER_COLORS } from '../../../shared/constants.js';

export const colorHex = (index) => PLAYER_COLORS[index % PLAYER_COLORS.length].hex;

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

// --- Table surfaces: every board game sits on something that fits it ----------------
const WOODS = {
  oak: ['#b07a46', '#a4703f', '#8e5f34'], // light table
  walnut: ['#6a4428', '#5e3c23', '#4a2e1a'], // dark table
  maple: ['#e2c08a', '#d8b47c', '#c49a60'], // light chessboard squares
};

// Wooden planks with a little grain. tone: 'oak' | 'walnut' | 'maple'.
export function woodTable(ctx, x, y, w, h, tone = 'oak', plank = 64) {
  const [a, b, grain] = WOODS[tone] ?? WOODS.oak;
  for (let py = 0, i = 0; py < h; py += plank, i++) {
    ctx.fillStyle = i % 2 ? a : b;
    ctx.fillRect(x, y + py, w, Math.min(plank, h - py));
    ctx.strokeStyle = grain;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 3; k++) {
      const gy = y + py + ((k + 1) * plank) / 4 + ((i * 7 + k * 5) % 6) - 3;
      ctx.beginPath();
      ctx.moveTo(x, gy);
      for (let gx = 0; gx <= w; gx += w / 6) ctx.lineTo(x + gx, gy + Math.sin(gx * 0.02 + i + k) * 2.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = grain;
    ctx.fillRect(x, y + py, w, 1.5);
  }
}

// One square of a wooden board (chess, checkers): light maple or dark walnut.
export function woodSquare(ctx, x, y, size, light, seed = 0) {
  ctx.fillStyle = light ? '#e6c690' : '#8a5a34';
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = light ? '#d4ae74' : '#744826';
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  for (let k = 0; k < 3; k++) {
    const gy = y + ((seed * 13 + k * 23) % Math.floor(size - 6)) + 3;
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.quadraticCurveTo(x + size / 2, gy + ((seed + k) % 2 ? 3 : -3), x + size, gy);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// A wooden frame around a square board of `size` at (x, y), `border` wide.
export function boardFrame(ctx, x, y, size, border) {
  dropShadow(ctx, x - border, y - border, size + border * 2, size + border * 2, 8);
  woodTable(ctx, x - border, y - border, size + border * 2, size + border * 2, 'walnut', 26);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 3;
  ctx.strokeRect(x - 1.5, y - 1.5, size + 3, size + 3);
}

// Felt (card and board tables): a flat colour with a soft vignette.
export function feltTable(ctx, x, y, w, h, color = '#1f6a45') {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  const g = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.2, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(255,255,255,0.06)');
  g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

// A soft drop shadow under a board or sheet.
export function dropShadow(ctx, x, y, w, h, r = 16) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill();
  ctx.restore();
}

// A glossy disc (connect four, reversi, checkers, ludo pawns seen from above).
export function disc(ctx, x, y, r, color, { rim = 'rgba(0,0,0,0.35)', shine = 0.35 } = {}) {
  circle(ctx, x, y, r);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.strokeStyle = rim;
  ctx.stroke();
  if (shine > 0) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${shine})`);
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    circle(ctx, x, y, r);
    ctx.fillStyle = g;
    ctx.fill();
  }
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const easeOutCubic = (t) => 1 - (1 - clamp01(t)) ** 3;
export const easeInOut = (t) => {
  t = clamp01(t);
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
};
// Bouncy landing, used for dropping discs.
export function easeOutBounce(t) {
  t = clamp01(t);
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}
