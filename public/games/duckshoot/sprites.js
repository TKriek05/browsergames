// Procedural pixel art for Kwek Kwek Knal: ducks (4 types × wing frames),
// the frog mascot and cloud puffs. Everything is drawn once into small
// offscreen canvases (own designs, no image files).
import { createLayer } from '../../js/core/canvas.js';

const OUTLINE = '#1a1030';

export const DUCK_PALETTES = [
  { body: '#8a5a2b', belly: '#c89a62', head: '#2fa84f', wing: '#5e3a1a', ring: true }, // wild
  { body: '#3e7bff', belly: '#9cc2ff', head: '#1c3a8a', wing: '#274fb8', ring: false }, // blue
  { body: '#ffd23e', belly: '#fff2a8', head: '#ffb000', wing: '#e0a100', ring: false }, // gold
  { body: '#ffe14d', belly: '#fff3a0', head: '#ffe14d', wing: '#ffe14d', ring: false }, // rubber
];

// Wing poses: 0 up, 1 middle, 2 down, 3 = hit (spread), 4 = falling.
const WINGS = [
  [[7, 8], [3, 1], [10, 3]],
  [[5, 8], [0, 7], [10, 7]],
  [[6, 9], [4, 15], [10, 11]],
  [[7, 8], [1, 2], [13, 2]],
  [[5, 8], [0, 7], [10, 7]],
];

const inEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
function inTriangle(px, py, [a, b, c]) {
  const d = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const p = [px, py];
  const d1 = d(p, a, b);
  const d2 = d(p, b, c);
  const d3 = d(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

// Paint a 16×16 grid of colour names, then add a dark outline around it.
function paint(size, colorAt) {
  const grid = [];
  for (let y = 0; y < size; y++) {
    grid.push([]);
    for (let x = 0; x < size; x++) grid[y].push(colorAt(x + 0.5, y + 0.5));
  }
  const { canvas, ctx } = createLayer(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c = grid[y][x];
      if (!c) {
        const near = (grid[y - 1]?.[x]) || (grid[y + 1]?.[x]) || grid[y][x - 1] || grid[y][x + 1];
        if (!near) continue;
        c = OUTLINE;
      }
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

function duckFrame(pal, pose, rubber) {
  const dead = pose === 4;
  return paint(16, (x, y) => {
    if (dead) y = 16 - y; // falling ducks tumble upside down
    // Head + beak
    if (inEllipse(x, y, 11.5, 5.5, 2.6, 2.4)) {
      if (Math.floor(x) === 12 && Math.floor(y) === 4) return dead ? '#ffffff' : '#10101a';
      return pal.head;
    }
    if (x >= 13.5 && x < 16 && y >= 5 && y < 7) return '#ff9a3e';
    if (pal.ring && inEllipse(x, y, 10.5, 8, 2.2, 1) && y > 7.2) return '#f4f4f4';
    // Wing on top of the body (not for the rubber duck)
    if (!rubber && inTriangle(x, y, WINGS[pose])) return pal.wing;
    // Body + tail
    if (inEllipse(x, y, 7, 9.5, 5.2, 3.2)) return y > 10.3 ? pal.belly : pal.body;
    if (inTriangle(x, y, [[1, 6.5], [3.5, 8.5], [2.5, 10.5]])) return pal.body;
    return null;
  });
}

// sprites[type][pose] facing right, plus mirrored copies facing left.
export function createDuckSprites() {
  const right = DUCK_PALETTES.map((pal, type) => [0, 1, 2, 3, 4].map((pose) => duckFrame(pal, pose, type === 3)));
  const left = right.map((frames) => frames.map((f) => {
    const { canvas, ctx } = createLayer(f.width, f.height);
    ctx.translate(f.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(f, 0, 0);
    return canvas;
  }));
  return { right, left };
}

// Koos the frog, the round-end mascot. mood: 'happy' | 'laugh'
export function createFrog(mood) {
  return paint(16, (x, y) => {
    const eyeL = inEllipse(x, y, 4.5, 4, 2.3, 2.3);
    const eyeR = inEllipse(x, y, 11.5, 4, 2.3, 2.3);
    if (eyeL || eyeR) {
      const cx = eyeL ? 4.5 : 11.5;
      if (mood === 'laugh') return Math.abs(y - 4.5) < 0.6 && Math.abs(x - cx) < 1.6 ? '#10101a' : '#5dff8a';
      return inEllipse(x, y, cx + 0.5, 4.3, 0.9, 1.1) ? '#10101a' : '#ffffff';
    }
    if (inEllipse(x, y, 8, 10.5, 7.3, 5)) {
      const mouth = mood === 'laugh' ? inEllipse(x, y, 8, 10.5, 4, 2) && y > 10 : Math.abs(y - 10.5) < 0.5 && Math.abs(x - 8) < 3.5;
      if (mouth) return mood === 'laugh' ? '#ff4d6d' : '#1b6b35';
      return y > 12.5 ? '#b9f5c8' : '#3fcf6b';
    }
    return null;
  });
}

export function createCloud(w, h) {
  const { canvas, ctx } = createLayer(w, h);
  const puffs = [[0.25, 0.65, 0.22], [0.45, 0.45, 0.3], [0.7, 0.6, 0.25], [0.55, 0.72, 0.22]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let inside = false;
      let top = false;
      for (const [px, py, r] of puffs) {
        const d = Math.hypot((x + 0.5) / w - px, ((y + 0.5) / h - py) * (h / w) * 2.2);
        if (d <= r) inside = true;
        if (d <= r && (y + 0.5) / h < py) top = true;
      }
      if (!inside || y > h * 0.85) continue;
      ctx.fillStyle = top ? '#ffffff' : '#dfe9ff';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}
