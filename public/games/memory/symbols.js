// 18 own vector symbols for Onthoud 'm, drawn with canvas paths (no images,
// no emoji fonts, so they look the same everywhere).
export const SYMBOLS = [
  { name: 'ster', color: '#e8a818' },
  { name: 'hart', color: '#d62839' },
  { name: 'maan', color: '#5a7ac8' },
  { name: 'zon', color: '#f08a1e' },
  { name: 'bloem', color: '#d8489a' },
  { name: 'wolk', color: '#7aa8d8' },
  { name: 'bliksem', color: '#e8b010' },
  { name: 'muzieknoot', color: '#7a4ab8' },
  { name: 'diamant', color: '#1e9ac8' },
  { name: 'huis', color: '#c8583a' },
  { name: 'boom', color: '#3a8a3e' },
  { name: 'vis', color: '#2a6ad0' },
  { name: 'sleutel', color: '#b8862a' },
  { name: 'druppel', color: '#3a98e0' },
  { name: 'spookje', color: '#8a7ac0' },
  { name: 'raket', color: '#c83a4a' },
  { name: 'kroon', color: '#d89a18' },
  { name: 'paddenstoel', color: '#d83030' },
];

// Draw symbol `i` centred at (x, y) within a square of size s.
export function drawSymbol(ctx, i, x, y, s) {
  const r = s / 2;
  const { color } = SYMBOLS[i];
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.08;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const P = (...pts) => {
    ctx.beginPath();
    pts.forEach(([px, py], k) => (k ? ctx.lineTo(px * r, py * r) : ctx.moveTo(px * r, py * r)));
    ctx.closePath();
  };
  const C = (cx, cy, rad) => {
    ctx.beginPath();
    ctx.arc(cx * r, cy * r, rad * r, 0, Math.PI * 2);
  };
  switch (i) {
    case 0: { // star
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const rad = k % 2 ? 0.4 : 0.9;
        ctx.lineTo(Math.cos(a) * rad * r, Math.sin(a) * rad * r);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 1: // heart
      ctx.beginPath();
      ctx.moveTo(0, 0.75 * r);
      ctx.bezierCurveTo(-1.1 * r, 0, -0.6 * r, -0.95 * r, 0, -0.35 * r);
      ctx.bezierCurveTo(0.6 * r, -0.95 * r, 1.1 * r, 0, 0, 0.75 * r);
      ctx.fill();
      break;
    case 2: // moon
      C(0, 0, 0.75);
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      C(0.35, -0.2, 0.62);
      ctx.fill();
      break;
    case 3: // sun
      C(0, 0, 0.42);
      ctx.fill();
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 0.6 * r, Math.sin(a) * 0.6 * r);
        ctx.lineTo(Math.cos(a) * 0.88 * r, Math.sin(a) * 0.88 * r);
        ctx.stroke();
      }
      break;
    case 4: // flower
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
        C(Math.cos(a) * 0.45, Math.sin(a) * 0.45, 0.32);
        ctx.fill();
      }
      ctx.fillStyle = '#ffe14d';
      C(0, 0, 0.25);
      ctx.fill();
      break;
    case 5: // cloud
      for (const [cx, cy, rad] of [[-0.4, 0.1, 0.35], [0, -0.15, 0.45], [0.42, 0.1, 0.33]]) {
        C(cx, cy, rad);
        ctx.fill();
      }
      ctx.fillRect(-0.72 * r, 0.1 * r, 1.45 * r, 0.33 * r);
      break;
    case 6: // lightning
      P([0.15, -0.9], [-0.5, 0.1], [-0.05, 0.1], [-0.2, 0.9], [0.5, -0.15], [0.05, -0.15]);
      ctx.fill();
      break;
    case 7: // note
      C(-0.3, 0.5, 0.26);
      ctx.fill();
      ctx.fillRect(-0.1 * r, -0.75 * r, 0.14 * r, 1.25 * r);
      P([-0.05, -0.75], [0.55, -0.55], [0.55, -0.3], [-0.05, -0.5]);
      ctx.fill();
      break;
    case 8: // diamond
      P([0, -0.85], [0.7, -0.15], [0, 0.85], [-0.7, -0.15]);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      P([0, -0.85], [0.3, -0.15], [0, 0.85], [-0.3, -0.15]);
      ctx.fill();
      break;
    case 9: // house
      P([0, -0.8], [0.8, -0.05], [-0.8, -0.05]);
      ctx.fill();
      ctx.fillRect(-0.55 * r, -0.1 * r, 1.1 * r, 0.85 * r);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillRect(-0.15 * r, 0.3 * r, 0.3 * r, 0.45 * r);
      break;
    case 10: // tree
      P([0, -0.9], [0.65, 0.3], [-0.65, 0.3]);
      ctx.fill();
      ctx.fillStyle = '#b07a3a';
      ctx.fillRect(-0.12 * r, 0.3 * r, 0.24 * r, 0.55 * r);
      break;
    case 11: // fish
      ctx.beginPath();
      ctx.ellipse(-0.1 * r, 0, 0.55 * r, 0.35 * r, 0, 0, Math.PI * 2);
      ctx.fill();
      P([0.35, 0], [0.85, -0.4], [0.85, 0.4]);
      ctx.fill();
      ctx.fillStyle = '#0b0b1e';
      C(-0.35, -0.08, 0.07);
      ctx.fill();
      break;
    case 12: // key
      C(-0.45, 0, 0.3);
      ctx.fill();
      ctx.fillRect(-0.2 * r, -0.08 * r, 1 * r, 0.16 * r);
      ctx.fillRect(0.5 * r, 0, 0.12 * r, 0.3 * r);
      ctx.fillRect(0.7 * r, 0, 0.12 * r, 0.22 * r);
      ctx.globalCompositeOperation = 'destination-out';
      C(-0.45, 0, 0.12);
      ctx.fill();
      break;
    case 13: // drop
      ctx.beginPath();
      ctx.moveTo(0, -0.85 * r);
      ctx.bezierCurveTo(0.65 * r, 0, 0.6 * r, 0.75 * r, 0, 0.75 * r);
      ctx.bezierCurveTo(-0.6 * r, 0.75 * r, -0.65 * r, 0, 0, -0.85 * r);
      ctx.fill();
      break;
    case 14: // ghost
      ctx.beginPath();
      ctx.arc(0, -0.2 * r, 0.55 * r, Math.PI, 0);
      ctx.lineTo(0.55 * r, 0.7 * r);
      for (let k = 0; k < 4; k++) ctx.lineTo((0.55 - (k + 0.5) * 0.275) * r, (k % 2 ? 0.7 : 0.5) * r);
      ctx.lineTo(-0.55 * r, 0.7 * r);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0b0b1e';
      C(-0.2, -0.2, 0.1);
      ctx.fill();
      C(0.2, -0.2, 0.1);
      ctx.fill();
      break;
    case 15: // rocket
      ctx.beginPath();
      ctx.moveTo(0, -0.9 * r);
      ctx.quadraticCurveTo(0.45 * r, -0.4 * r, 0.3 * r, 0.45 * r);
      ctx.lineTo(-0.3 * r, 0.45 * r);
      ctx.quadraticCurveTo(-0.45 * r, -0.4 * r, 0, -0.9 * r);
      ctx.fill();
      P([0.3, 0.1], [0.6, 0.6], [0.25, 0.45]);
      ctx.fill();
      P([-0.3, 0.1], [-0.6, 0.6], [-0.25, 0.45]);
      ctx.fill();
      ctx.fillStyle = '#ffd23e';
      P([-0.15, 0.5], [0.15, 0.5], [0, 0.9]);
      ctx.fill();
      break;
    case 16: // crown
      P([-0.75, 0.5], [-0.75, -0.35], [-0.35, 0.05], [0, -0.6], [0.35, 0.05], [0.75, -0.35], [0.75, 0.5]);
      ctx.fill();
      break;
    case 17: // mushroom
      ctx.beginPath();
      ctx.arc(0, 0.05 * r, 0.75 * r, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f4ecd8';
      ctx.fillRect(-0.22 * r, 0.05 * r, 0.44 * r, 0.7 * r);
      C(-0.35, -0.3, 0.13);
      ctx.fill();
      C(0.3, -0.4, 0.1);
      ctx.fill();
      break;
    default:
      break;
  }
  ctx.restore();
}

// Cached offscreen sprites: the holes (moon, house, key) are drawn once
// instead of every frame.
const cache = new Map();
export function symbolSprite(i, s) {
  const size = Math.max(8, Math.round(s));
  const key = `${i}:${size}`;
  let c = cache.get(key);
  if (!c) {
    // Rendered at twice the size: the board canvas is scaled for high-DPI screens.
    c = document.createElement('canvas');
    c.width = c.height = Math.ceil(size * 3);
    drawSymbol(c.getContext('2d'), i, c.width / 2, c.height / 2, size * 2);
    cache.set(key, c);
  }
  return c;
}

// Draw a cached symbol centred at (x, y) with size s (logical units).
export function blitSymbol(ctx, i, x, y, s) {
  const sprite = symbolSprite(i, s);
  const w = s * 1.5;
  ctx.drawImage(sprite, x - w / 2, y - w / 2, w, w);
}
