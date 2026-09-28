// Spetterveld HUD on the 2D canvas above the 3D view: crosshair + hit marker,
// health, the hopper, timer, scoreboard, kill feed, paint splashes when you
// get hit, name tags. Plus a top-down view when WebGL is missing.
import { drawText, measureText, roundRect } from '../../js/core/hudtext.js';
import { PB_FIELD } from '../../../shared/maps/paintball-arenas.js';
import { PB_RULES } from '../../../shared/games/paintball.js';

const SHADOW = '#101418';

export function createPaintHud(view) {
  const { ctx, width: W, height: H } = view;
  const splashes = []; // { x, y, r, color, born, blobs }

  function blob(x, y, r, color, alpha, seed) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < 7; k++) {
      const a = seed + k * 0.9;
      const d = r * (0.9 + ((k * 37) % 5) / 10);
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.18 + ((k * 13) % 4) / 20), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  return {
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
      splashes.push({ x: W * (0.2 + Math.random() * 0.6), y: H * (0.2 + Math.random() * 0.6), r: 16 + Math.random() * 14, color, born: performance.now(), seed: Math.random() * 6 });
      if (splashes.length > 6) splashes.shift();
    },

    splashes() {
      const now = performance.now();
      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i];
        const age = (now - s.born) / 1000;
        if (age > 1.6) {
          splashes.splice(i, 1);
          continue;
        }
        blob(s.x, s.y + age * 10, s.r, s.color, 0.75 * (1 - age / 1.6), s.seed);
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

    // Hopper: one dot per ball, or a reload bar.
    ammo(n, reload, color) {
      const x0 = W - 10;
      const y = H - 14;
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
  const s = Math.min(W / PB_FIELD.width, H / PB_FIELD.height);
  const ox = (W - PB_FIELD.width * s) / 2;
  const oy = (H - PB_FIELD.height * s) / 2;
  return {
    begin() {
      ctx.fillStyle = '#4f8a3a';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#5fae45';
      ctx.fillRect(ox, oy, PB_FIELD.width * s, PB_FIELD.height * s);
      ctx.fillStyle = '#d98a2b';
      for (const o of arena.obstacles) {
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
