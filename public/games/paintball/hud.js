// Spetterveld HUD on the 2D canvas above the 3D view: crosshair + hit marker,
// health, the hopper, timer, scoreboard, kill feed, paint splashes when you
// get hit, name tags. Plus a top-down view when WebGL is missing.
import { drawText, measureText, roundRect } from '../../js/core/hudtext.js';
import { PB_RULES } from '../../../shared/games/paintball.js';
import { PB_PHYS } from '../../../shared/physics/paintball.js';

const SHADOW = '#101418';
const SPLASH_S = 2.2;

export function createPaintHud(view) {
  const { ctx, width: W, height: H } = view;
  const splashes = []; // { x, y, r, color, born, seed, drips }

  // Your goggles got hit: an irregular splat with droplets and drips that
  // run down while it fades. Same seed → same shape every frame.
  function splat(s, age) {
    let seed = s.seed;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const fade = Math.max(0, 1 - age / SPLASH_S);
    ctx.save();
    ctx.globalAlpha = 0.88 * Math.min(1, fade * 1.6);
    ctx.fillStyle = s.color;
    ctx.beginPath();
    const n = 16;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      const rr = s.r * (0.8 + rnd() * 0.3) * (rnd() < 0.25 ? 1.3 : 1);
      const px = s.x + Math.cos(a) * rr;
      const py = s.y + Math.sin(a) * rr;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < 5; i++) {
      const a = rnd() * Math.PI * 2;
      const d = s.r * (1.2 + rnd() * 0.8);
      ctx.beginPath();
      ctx.arc(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, s.r * (0.08 + rnd() * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
    // Drips: grow downwards over time.
    for (const d of s.drips) {
      const len = Math.min(d.len, age * d.speed);
      const x = s.x + d.u * s.r;
      ctx.fillRect(x - d.w / 2, s.y, d.w, s.r * 0.5 + len);
      ctx.beginPath();
      ctx.arc(x, s.y + s.r * 0.5 + len, d.w * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
    // Wet shine.
    ctx.globalAlpha *= 0.35;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(s.x - s.r * 0.3, s.y - s.r * 0.35, s.r * 0.28, s.r * 0.14, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return {
    ctx,

    clear() {
      ctx.clearRect(0, 0, W, H);
    },

    crosshair(hitAge, color) {
      const cx = W / 2;
      const cy = H / 2;
      ctx.save();
      ctx.lineCap = 'round';
      for (const [w, c] of [[2.6, 'rgba(0,0,0,0.55)'], [1.2, '#ffffff']]) {
        ctx.lineWidth = w;
        ctx.strokeStyle = c;
        ctx.beginPath();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          ctx.moveTo(cx + dx * 3, cy + dy * 3);
          ctx.lineTo(cx + dx * 7, cy + dy * 7);
        }
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, 1.1, 0, Math.PI * 2);
      ctx.fill();
      if (hitAge < 0.25) {
        // Hit marker: a short yellow X.
        ctx.globalAlpha = 1 - hitAge / 0.25;
        ctx.strokeStyle = '#ffe14d';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          ctx.moveTo(cx + dx * 5, cy + dy * 5);
          ctx.lineTo(cx + dx * 10, cy + dy * 10);
        }
        ctx.stroke();
      }
      ctx.restore();
    },

    // You got hit: a splash of the shooter's paint on the "goggles".
    splash(color) {
      const drips = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => ({
        u: (Math.random() - 0.5) * 1.2, w: 2 + Math.random() * 2.5, len: 14 + Math.random() * 30, speed: 12 + Math.random() * 16,
      }));
      splashes.push({ x: W * (0.15 + Math.random() * 0.7), y: H * (0.15 + Math.random() * 0.55), r: 16 + Math.random() * 16, color, born: performance.now(), seed: 1 + Math.floor(Math.random() * 1e6), drips });
      if (splashes.length > 6) splashes.shift();
    },

    splashes() {
      const now = performance.now();
      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i];
        const age = (now - s.born) / 1000;
        if (age > SPLASH_S) {
          splashes.splice(i, 1);
          continue;
        }
        splat(s, age);
      }
    },

    health(hp) {
      for (let i = 0; i < PB_RULES.HP; i++) {
        const x = 12 + i * 14;
        const y = H - 14;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = i < hp ? '#ff5c7a' : 'rgba(20,20,26,0.55)';
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.stroke();
      }
    },

    // Hopper: one dot per ball, or a reload bar (rapid fire: no hopper needed).
    // Crouching / lying down: a word next to the health dots.
    stance(st) {
      if (!st) return;
      drawText(ctx, st === 1 ? 'GEBUKT' : 'LIGGEND', 12 + PB_RULES.HP * 14 + 2, H - 19, { color: '#ffffff', shadow: SHADOW });
    },

    ammo(n, reload, color, rapid = false) {
      const x0 = W - 10;
      const y = H - 14;
      if (rapid) {
        drawText(ctx, 'SNELVUUR', x0, y - 5, { color: '#ff8a1e', align: 'right', shadow: SHADOW });
        return;
      }
      if (reload > 0) {
        const k = 1 - reload / PB_RULES.RELOAD_S;
        ctx.fillStyle = 'rgba(20,20,26,0.6)';
        roundRect(ctx, x0 - 70, y - 4, 70, 8, 4);
        ctx.fill();
        ctx.fillStyle = color;
        roundRect(ctx, x0 - 70, y - 4, 70 * Math.max(0.05, k), 8, 4);
        ctx.fill();
        drawText(ctx, 'HERLADEN', x0 - 35, y - 17, { color: '#ffffff', align: 'center', shadow: SHADOW });
        return;
      }
      for (let i = 0; i < PB_RULES.HOPPER; i++) {
        const x = x0 - i * 7;
        ctx.beginPath();
        ctx.arc(x - 3, y, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = i < n ? color : 'rgba(20,20,26,0.5)';
        ctx.fill();
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.stroke();
      }
      if (n === 0) drawText(ctx, 'R = HERLADEN', x0, y - 17, { color: '#ffe14d', align: 'right', shadow: SHADOW });
    },

    timer(text) {
      drawText(ctx, text, W / 2, 5, { color: '#ffffff', scale: 1.6, align: 'center', shadow: SHADOW });
    },

    scoreboard(rows) {
      const x = W - 6;
      rows.forEach((r, i) => {
        const y = 6 + i * 11;
        const text = `${r.name.slice(0, 11)}  ${r.kills}`;
        drawText(ctx, text, x, y, { color: r.me ? '#ffe14d' : '#ffffff', align: 'right', shadow: SHADOW });
        ctx.fillStyle = r.color;
        ctx.fillRect(x - measureText(text, 1, ctx) - 8, y + 1.5, 5, 5);
      });
    },

    feed(items) {
      items.forEach((it, i) => {
        const y = 6 + i * 11;
        let x = 6;
        x += drawText(ctx, it.by, x, y, { color: it.byColor, shadow: SHADOW }) + 4;
        x += drawText(ctx, 'spetterde', x, y, { color: '#d8d8e0', shadow: SHADOW }) + 4;
        drawText(ctx, it.victim, x, y, { color: it.victimColor, shadow: SHADOW });
      });
    },

    label(x, y, text, color) {
      drawText(ctx, text, Math.round(x), Math.round(y), { color, align: 'center', shadow: SHADOW });
    },

    center(text, sub = '', color = '#ffffff') {
      if (text) drawText(ctx, text, W / 2, H / 2 - 34, { color, scale: 2.6, align: 'center', shadow: SHADOW });
      if (sub) drawText(ctx, sub, W / 2, H / 2 - 8, { color: '#ffffff', align: 'center', shadow: SHADOW });
    },

    hint(text) {
      const w = measureText(text, 1, ctx) + 20;
      ctx.fillStyle = 'rgba(15,18,24,0.62)';
      roundRect(ctx, W / 2 - w / 2, H - 44, w, 16, 8);
      ctx.fill();
      drawText(ctx, text, W / 2, H - 40, { color: '#ffffff', align: 'center' });
    },
  };
}

// Top-down fallback when WebGL is not available.
export function createFallback2D(view, arena) {
  const { ctx, width: W, height: H } = view;
  const s = Math.min(W / arena.width, H / arena.height);
  const ox = (W - arena.width * s) / 2;
  const oy = (H - arena.height * s) / 2;
  return {
    begin() {
      ctx.fillStyle = '#4f8a3a';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#5fae45';
      ctx.fillRect(ox, oy, arena.width * s, arena.height * s);
      ctx.fillStyle = '#d98a2b';
      for (const o of arena.solids) {
        if (o.z0 > PB_PHYS.EYE) continue; // floors and roofs: seen from above they would hide everything
        ctx.beginPath();
        if (o.t === 'can') ctx.arc(ox + o.x * s, oy + o.y * s, o.r * s, 0, Math.PI * 2);
        else ctx.rect(ox + (o.x - o.w / 2) * s, oy + (o.y - o.h / 2) * s, o.w * s, o.h * s);
        ctx.fill();
      }
    },
    player(x, y, yaw, color, me) {
      const px = ox + x * s;
      const py = oy + y * s;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(yaw) * 10, py + Math.sin(yaw) * 10);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, me ? 4 : 3.2, 0, Math.PI * 2);
      ctx.fill();
    },
    shot(x0, y0, x1, y1, color) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(ox + x0 * s, oy + y0 * s);
      ctx.lineTo(ox + x1 * s, oy + y1 * s);
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
  };
}
