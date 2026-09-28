// Reusable 2D effects for canvas games: pooled particles, floating texts
// ("+100") and screen shake. No allocations per frame; respects reduced motion
// (no shake, fewer particles).
import { textSprite } from './pixelfont.js';

const MAX_TEXTS = 24;
const SPRITE_CACHE = 64;

export function createFx({ max = 240, reducedMotion = false } = {}) {
  const parts = Array.from({ length: max }, () => ({
    alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, color: '#fff', size: 1, gravity: 0, drag: 0.92,
  }));
  const texts = Array.from({ length: MAX_TEXTS }, () => ({ alive: false, x: 0, y: 0, life: 0, max: 1, sprite: null }));
  const sprites = new Map();
  let shake = 0;
  let cursor = 0;

  function sprite(text, color, scale) {
    const key = `${text}|${color}|${scale}`;
    let s = sprites.get(key);
    if (!s) {
      if (sprites.size >= SPRITE_CACHE) sprites.delete(sprites.keys().next().value);
      s = textSprite(text, { color, scale, shadow: '#0b0b1e' });
      sprites.set(key, s);
    }
    return s;
  }

  const fx = {
    reducedMotion,

    spawn(x, y, vx, vy, life, color, size = 1, gravity = 0, drag = 0.92) {
      // Round-robin over the pool: when full, the oldest slot gets reused.
      for (let n = 0; n < max; n++) {
        const p = parts[cursor];
        cursor = (cursor + 1) % max;
        if (p.alive && n < max - 1) continue;
        p.alive = true;
        p.x = x; p.y = y; p.vx = vx; p.vy = vy;
        p.life = life; p.max = life; p.color = color; p.size = size; p.gravity = gravity; p.drag = drag;
        return;
      }
    },

    burst(x, y, color, count = 16, { speed = 60, life = 0.5, size = 1, gravity = 0, drag = 0.92 } = {}) {
      if (reducedMotion) count = Math.min(count, 6);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
        const v = speed * (0.4 + Math.random() * 0.8);
        fx.spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, life * (0.6 + Math.random() * 0.6), color, size, gravity, drag);
      }
    },

    text(str, x, y, color = '#fff', scale = 1, life = 0.9) {
      for (const t of texts) {
        if (t.alive) continue;
        t.alive = true;
        t.x = x; t.y = y; t.life = life; t.max = life;
        t.sprite = sprite(str, color, scale);
        return;
      }
    },

    shake(amount) {
      if (!reducedMotion) shake = Math.max(shake, amount);
    },

    // Offset to apply to the whole scene this frame.
    shakeX() { return shake > 0 ? Math.round((Math.random() - 0.5) * shake) : 0; },
    shakeY() { return shake > 0 ? Math.round((Math.random() - 0.5) * shake) : 0; },

    update(dt) {
      shake = Math.max(0, shake - dt * 20);
      for (const p of parts) {
        if (!p.alive) continue;
        p.life -= dt;
        if (p.life <= 0) { p.alive = false; continue; }
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= p.drag;
        p.vy *= p.drag;
      }
      for (const t of texts) {
        if (!t.alive) continue;
        t.life -= dt;
        if (t.life <= 0) { t.alive = false; continue; }
        t.y -= dt * 18;
      }
    },

    drawParticles(ctx) {
      for (const p of parts) {
        if (!p.alive) continue;
        ctx.globalAlpha = Math.max(0, Math.min(1, (p.life / p.max) * 1.5));
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), p.size, p.size);
      }
      ctx.globalAlpha = 1;
    },

    drawTexts(ctx) {
      for (const t of texts) {
        if (!t.alive) continue;
        ctx.globalAlpha = Math.min(1, (t.life / t.max) * 2);
        ctx.drawImage(t.sprite, Math.round(t.x - t.sprite.width / 2), Math.round(t.y - t.sprite.height / 2));
      }
      ctx.globalAlpha = 1;
    },

    clear() {
      for (const p of parts) p.alive = false;
      for (const t of texts) t.alive = false;
      shake = 0;
    },
  };
  return fx;
}
