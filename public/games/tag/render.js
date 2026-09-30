// Drawing for Neon Tikkertje on a 320×180 pixel canvas. Static layers are
// pre-rendered once; sprites are cached per colour; particles are pooled.
import { createLayer } from '../../js/core/canvas.js';
import { drawText, textSprite } from '../../js/core/pixelfont.js';
import { TAG_PHYS } from '../../../shared/physics/tag.js';
import { POWER_TUNING } from '../../../shared/games/tag-powers.js';

const BG = '#0b0b1e';
const GRID = '#15153a';
const WALL_FILL = '#1b1b48';
const WALL_EDGE = '#3ef0ff';
const MAX_PARTICLES = 160;
const ROLE_RIM = { it: '#ff4d6d', run: '#3ef0ff', any: '#ffe14d' };
const WAVE_S = 0.45;
// 7×7 pixel icons per power (index = POWER id): turbo, long reach, freeze, shield, warp.
const ICONS = [
  ['....##.', '...##..', '..##...', '.#####.', '...##..', '..##...', '.##....'],
  ['.......', '.#...#.', '##...##', '#######', '##...##', '.#...#.', '.......'],
  ['...#...', '.#.#.#.', '..###..', '#######', '..###..', '.#.#.#.', '...#...'],
  ['#######', '#.###.#', '#.###.#', '#.###.#', '.#.#.#.', '..#.#..', '...#...'],
  ['...#...', '..#.#..', '.#...#.', '#..#..#', '.#...#.', '..#.#..', '...#...'],
];

export function createRenderer(view, { walls, reducedMotion }) {
  const { ctx, width, height } = view;
  const background = drawBackground(width, height, walls);
  const sprites = new Map();
  const particles = Array.from({ length: MAX_PARTICLES }, () => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, color: '#fff' }));
  const discs = new Map();
  const waves = []; // freeze waves: { x, y, color, t }
  let shake = 0;
  let time = 0;

  // Round orb background with a rim in the role colour.
  function orbDisc(rim) {
    let s = discs.get(rim);
    if (s) return s;
    const size = 13;
    const { canvas, ctx: c } = createLayer(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2);
        if (d > 6.3) continue;
        c.fillStyle = d > 5.2 ? rim : '#101030';
        c.fillRect(x, y, 1, 1);
      }
    }
    discs.set(rim, canvas);
    return canvas;
  }

  function icon(rows, x, y, color) {
    ctx.fillStyle = color;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) if (rows[r][c] === '#') ctx.fillRect(x + c, y + r, 1, 1);
    }
  }

  function ring(x, y, radius, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x + 0.5, y + 0.5, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function runnerSprite(color) {
    let s = sprites.get(color);
    if (s) return s;
    const size = TAG_PHYS.RADIUS * 2 + 2;
    const { canvas, ctx: c } = createLayer(size, size);
    const r = TAG_PHYS.RADIUS + 0.5;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x + 0.5 - size / 2;
        const dy = y + 0.5 - size / 2;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > r) continue;
        c.fillStyle = d > r - 1.2 ? '#0b0b1e' : color;
        c.fillRect(x, y, 1, 1);
      }
    }
    // Shine + shade for a bit of volume.
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.fillRect(3, 2, 2, 1);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(3, size - 3, size - 6, 1);
    sprites.set(color, canvas);
    return canvas;
  }

  function spawn(x, y, vx, vy, life, color) {
    for (const p of particles) {
      if (p.alive) continue;
      p.alive = true;
      p.x = x; p.y = y; p.vx = vx; p.vy = vy;
      p.life = life; p.max = life; p.color = color;
      return;
    }
  }

  const labels = []; // this frame's name labels, placed after all runners (no overlaps)

  return {
    begin() {
      labels.length = 0;
      ctx.save();
      if (shake > 0 && !reducedMotion) {
        ctx.translate(Math.round((Math.random() - 0.5) * shake), Math.round((Math.random() - 0.5) * shake));
      }
      ctx.drawImage(background, 0, 0);
    },

    end() {
      ctx.restore();
    },

    update(dt) {
      time += dt;
      shake = Math.max(0, shake - dt * 18);
      for (const p of particles) {
        if (!p.alive) continue;
        p.life -= dt;
        if (p.life <= 0) { p.alive = false; continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.92;
        p.vy *= 0.92;
      }
    },

    burst(x, y, color, count = 24) {
      if (reducedMotion) count = Math.min(count, 8);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
        const speed = 40 + Math.random() * 70;
        spawn(x, y, Math.cos(a) * speed, Math.sin(a) * speed, 0.4 + Math.random() * 0.4, color);
      }
    },

    trail(x, y, color) {
      if (reducedMotion || Math.random() > 0.5) return;
      spawn(x + (Math.random() - 0.5) * 6, y + (Math.random() - 0.5) * 6, 0, 0, 0.35, color);
    },

    shake(amount) {
      shake = Math.max(shake, amount);
    },

    wave(x, y, color) {
      waves.push({ x, y, color, t: time });
    },

    // A power-up orb; dimmed when you cannot take it (wrong role).
    drawOrb(orb, power, usable) {
      if (orb.life < 2 && Math.floor(time * 8) % 2 === 0) return; // about to vanish
      const bob = reducedMotion ? 0 : Math.round(Math.sin(time * 4 + orb.id));
      const px = orb.x;
      const py = orb.y + bob;
      ctx.globalAlpha = usable ? 1 : 0.35;
      const disc = orbDisc(ROLE_RIM[power.role]);
      ctx.drawImage(disc, px - 6, py - 6);
      icon(ICONS[power.id], px - 3, py - 3, power.color);
      if (power.role === 'it') {
        // A tiny crown: only for the tagger.
        ctx.fillStyle = '#ffe14d';
        ctx.fillRect(px - 2, py - 8, 5, 1);
        ctx.fillRect(px - 2, py - 9, 1, 1);
        ctx.fillRect(px, py - 9, 1, 1);
        ctx.fillRect(px + 2, py - 9, 1, 1);
      }
      ctx.globalAlpha = 1;
    },

    drawParticles() {
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i];
        const k = (time - w.t) / WAVE_S;
        if (k >= 1) {
          waves.splice(i, 1);
          continue;
        }
        ring(w.x, w.y, 4 + k * (POWER_TUNING.FREEZE_RADIUS - 4), w.color, 1 - k);
      }
      for (const p of particles) {
        if (!p.alive) continue;
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      }
      ctx.globalAlpha = 1;
    },

    drawRunner(x, y, vx, vy, color, { it, stunned, immune, me, name, connected, boost, slow, shield, reach }) {
      const px = Math.round(x);
      const py = Math.round(y);
      const sprite = runnerSprite(color);
      const half = sprite.width >> 1;
      const blink = immune && Math.floor(time * 12) % 2 === 0;

      if (reach) ring(px, py, TAG_PHYS.RADIUS * 2 + POWER_TUNING.REACH_BONUS, '#ff4d6d', 0.55 + 0.25 * Math.sin(time * 12));
      if (boost && !reducedMotion && Math.random() < 0.7) spawn(px - vx * 0.04, py - vy * 0.04, -vx * 0.3, -vy * 0.3, 0.3, '#ffe14d');

      if (it) {
        // Pulsing danger ring around the tagger.
        const ring = 8 + (reducedMotion ? 0 : Math.round(Math.sin(time * 10)));
        ctx.strokeStyle = Math.floor(time * 6) % 2 ? '#ff4d6d' : '#ffe14d';
        ctx.lineWidth = 1;
        ctx.strokeRect(px - ring + 0.5, py - ring + 0.5, ring * 2 - 1, ring * 2 - 1);
      }
      ctx.globalAlpha = blink ? 0.35 : connected ? 1 : 0.45;
      ctx.drawImage(sprite, px - half, py - half);

      // Eyes look where the runner is heading.
      const len = Math.hypot(vx, vy);
      const ex = len > 5 ? Math.round((vx / len) * 1.5) : 0;
      const ey = len > 5 ? Math.round((vy / len) * 1.5) : 0;
      ctx.fillStyle = '#fff';
      ctx.fillRect(px - 3 + ex, py - 2 + ey, 2, 2);
      ctx.fillRect(px + 1 + ex, py - 2 + ey, 2, 2);
      ctx.fillStyle = '#0b0b1e';
      ctx.fillRect(px - 2 + ex + Math.sign(ex), py - 1 + ey, 1, 1);
      ctx.fillRect(px + 2 + ex + Math.sign(ex), py - 1 + ey, 1, 1);
      ctx.globalAlpha = 1;

      if (it) {
        // Little crown
        ctx.fillStyle = '#ffe14d';
        ctx.fillRect(px - 3, py - 9, 7, 2);
        ctx.fillRect(px - 3, py - 11, 1, 2);
        ctx.fillRect(px, py - 11, 1, 2);
        ctx.fillRect(px + 3, py - 11, 1, 2);
      }
      if (shield) ring(px, py, 8, '#5dff9a', 0.6 + 0.3 * Math.sin(time * 9));
      if (slow) {
        // Ice crystals drifting around a frozen runner.
        ctx.fillStyle = '#bfefff';
        for (let k = 0; k < 3; k++) {
          const a = time * 2 + (k * Math.PI * 2) / 3;
          ctx.fillRect(Math.round(px + Math.cos(a) * 7), Math.round(py + Math.sin(a) * 7), 1, 1);
        }
      }
      if (stunned) {
        const a = time * 8;
        ctx.fillStyle = '#ffe14d';
        ctx.fillRect(Math.round(px + Math.cos(a) * 6), Math.round(py - 8 + Math.sin(a) * 2), 1, 1);
        ctx.fillRect(Math.round(px + Math.cos(a + Math.PI) * 6), Math.round(py - 8 + Math.sin(a + Math.PI) * 2), 1, 1);
      }

      labels.push({ tag: textSprite(me ? 'JIJ' : name, { color: me ? '#ffffff' : color, shadow: '#0b0b1e' }), px, py, it, me });
    },

    // Name labels below the runners (above them near the bottom edge or when
    // that spot is taken), kept inside the field; a label that fits nowhere
    // waits until the runners are apart again. Yours goes first.
    drawLabels() {
      labels.sort((a, b) => b.me - a.me);
      const placed = [];
      const free = (x, y, w, h) => y >= 12 && y + h <= height - 1
        && !placed.some((p) => x < p.x + p.w + 2 && x + w + 2 > p.x && y < p.y + p.h && y + h > p.y);
      for (const l of labels) {
        const { tag, px, py } = l;
        const x = Math.min(width - tag.width - 1, Math.max(1, Math.round(px - tag.width / 2)));
        const below = py + 8;
        const above = py - (l.it ? 21 : 16);
        const y = free(x, below, tag.width, tag.height) ? below : free(x, above, tag.width, tag.height) ? above : -1;
        if (y < 0) continue;
        placed.push({ x, y, w: tag.width, h: tag.height });
        ctx.drawImage(tag, x, y);
      }
    },

    drawHud({ timeText, itName, itColor, phase, countdown, spectator, banner }) {
      if (banner) {
        drawText(ctx, banner.text, width / 2, 24, { color: banner.color, scale: 2, align: 'center', shadow: '#0b0b1e' });
        drawText(ctx, banner.sub, width / 2, 40, { color: '#ffffff', align: 'center', shadow: '#0b0b1e' });
      }
      if (timeText) drawText(ctx, timeText, width / 2, 4, { color: '#fff', scale: 2, align: 'center', shadow: '#0b0b1e' });
      if (itName) {
        const w = drawText(ctx, 'TIKKER: ', 4, 5, { color: '#a3a8d6', shadow: '#0b0b1e' });
        drawText(ctx, itName, 4 + w + 6, 5, { color: itColor, shadow: '#0b0b1e' });
      }
      if (spectator) drawText(ctx, 'JE KIJKT MEE', width - 4, 5, { color: '#ffe14d', align: 'right', shadow: '#0b0b1e' });
      if (phase === 0 && countdown > 0) {
        const n = Math.ceil(countdown);
        const pulse = reducedMotion ? 0 : (countdown % 1) * 2;
        drawText(ctx, String(n), width / 2, height / 2 - 20 - pulse * 2, { color: '#ffe14d', scale: 6 + Math.round(pulse), align: 'center', shadow: '#ff3ea5' });
        drawText(ctx, 'ONTWIJK DE TIKKER!', width / 2, height / 2 + 30, { color: '#fff', align: 'center', shadow: '#0b0b1e' });
      }
      if (phase === 2) drawText(ctx, 'TIJD!', width / 2, height / 2 - 14, { color: '#ffe14d', scale: 4, align: 'center', shadow: '#ff3ea5' });
    },
  };
}

function drawBackground(width, height, walls) {
  const { canvas, ctx } = createLayer(width, height);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = GRID;
  for (let x = 0; x < width; x += 16) ctx.fillRect(x, 0, 1, height);
  for (let y = 0; y < height; y += 16) ctx.fillRect(0, y, width, 1);
  // Neon border
  ctx.fillStyle = '#ff3ea5';
  ctx.fillRect(0, 0, width, 1);
  ctx.fillRect(0, height - 1, width, 1);
  ctx.fillRect(0, 0, 1, height);
  ctx.fillRect(width - 1, 0, 1, height);
  for (const w of walls) {
    ctx.fillStyle = WALL_FILL;
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.fillStyle = WALL_EDGE;
    ctx.fillRect(w.x, w.y, w.w, 1);
    ctx.fillRect(w.x, w.y + w.h - 1, w.w, 1);
    ctx.fillRect(w.x, w.y, 1, w.h);
    ctx.fillRect(w.x + w.w - 1, w.y, 1, w.h);
    ctx.fillStyle = 'rgba(62,240,255,0.25)';
    ctx.fillRect(w.x + 1, w.y + 1, w.w - 2, 1);
  }
  return canvas;
}
