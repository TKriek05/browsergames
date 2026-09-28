// Drawing helpers for the (non-pixel) board games.
import { PLAYER_COLORS } from '../../../shared/constants.js';

export const THEME = {
  bg: '#0b0b1e',
  board: '#151532',
  board2: '#1c1c40',
  line: '#2c2c5e',
  text: '#eef0ff',
  muted: '#a6abd8',
  cyan: '#3ef0ff',
  pink: '#ff3ea5',
  yellow: '#ffe14d',
  green: '#5dff8a',
  red: '#ff5c7a',
};

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

// Run `fn` with a neon glow (shadowBlur), then reset.
export function glow(ctx, color, blur, fn) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  fn();
  ctx.restore();
}

export function clearBoard(ctx, width, height) {
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, width, height);
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
