// Pooled 3D particles (sparks, smoke, confetti), drawn as additive points
// by the renderer. Fixed-size pool: no allocations while playing.
import { rgb } from './mesh.js';

export function createParticles3D(max = 400, { reducedMotion = false } = {}) {
  const pool = Array.from({ length: max }, () => ({
    alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, r: 1, g: 1, b: 1, size: 1, gravity: 0, drag: 0.96,
  }));
  const data = new Float32Array(max * 8);
  let cursor = 0;
  let count = 0;

  const ps = {
    spawn(x, y, z, vx, vy, vz, life, color, size = 1, gravity = 0, drag = 0.96) {
      for (let n = 0; n < max; n++) {
        const p = pool[cursor];
        cursor = (cursor + 1) % max;
        if (p.alive && n < max - 1) continue;
        const c = typeof color === 'string' ? rgb(color) : color;
        Object.assign(p, { alive: true, x, y, z, vx, vy, vz, life, max: life, size, gravity, drag });
        p.r = c[0]; p.g = c[1]; p.b = c[2];
        return;
      }
    },

    burst(x, y, z, color, n = 20, { speed = 30, life = 0.6, size = 1.5, gravity = -20, up = 0.5 } = {}) {
      if (reducedMotion) n = Math.min(n, 8);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = (Math.random() - 0.2) * up * Math.PI;
        const v = speed * (0.4 + Math.random() * 0.8);
        ps.spawn(x, y, z, Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v + speed * up * 0.3, Math.sin(a) * Math.cos(e) * v,
          life * (0.6 + Math.random() * 0.7), color, size * (0.7 + Math.random() * 0.6), gravity);
      }
    },

    update(dt) {
      count = 0;
      for (const p of pool) {
        if (!p.alive) continue;
        p.life -= dt;
        if (p.life <= 0) { p.alive = false; continue; }
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vx *= p.drag; p.vy *= p.drag; p.vz *= p.drag;
        if (p.y < 0.05 && p.gravity < 0) { p.y = 0.05; p.vy *= -0.3; }
        const o = count * 8;
        data[o] = p.x; data[o + 1] = p.y; data[o + 2] = p.z;
        data[o + 3] = p.r; data[o + 4] = p.g; data[o + 5] = p.b;
        data[o + 6] = Math.min(1, (p.life / p.max) * 1.6);
        data[o + 7] = p.size;
        count++;
      }
    },

    // additive: glowing sparks/fire; false: dust, smoke, splashes (normal blending).
    draw(renderer, scale = 1, additive = false) {
      renderer.points(data, count, scale, additive);
    },

    clear() {
      for (const p of pool) p.alive = false;
      count = 0;
    },
  };
  return ps;
}
