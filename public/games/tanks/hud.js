// Tank Tumult HUD on the transparent 2D canvas above the 3D view, plus a
// simple top-down renderer for devices without WebGL.
import { drawText, roundRect, heart } from '../../js/core/hudtext.js';
import { TANK_TILE, TANK_COLS, TANK_ROWS, TANK_WORLD, TILE } from '../../../shared/maps/tank-arenas.js';
import { TANK_RULES, POWERUPS } from '../../../shared/games/tanks.js';
import { TANK_PHYS } from '../../../shared/physics/tanks.js';
import { tankTheme } from './theme.js';

const SHADOW = '#14140f';

export function createTankHud(view) {
  const { ctx, width: W, height: H } = view;

  return {
    clear() {
      ctx.clearRect(0, 0, W, H);
    },

    // Name + health pips above a tank (screen position from the 3D projection).
    label(x, y, name, color, hp, me) {
      const px = Math.round(x);
      const py = Math.round(y);
      drawText(ctx, me ? 'JIJ' : name.slice(0, 10), px, py - 12, { color: me ? '#ffffff' : color, align: 'center', shadow: SHADOW });
      // Health bar
      const bw = 20;
      roundRect(ctx, px - bw / 2 - 1, py - 3.5, bw + 2, 4, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fill();
      roundRect(ctx, px - bw / 2, py - 2.5, (bw * hp) / TANK_RULES.HP, 2, 1);
      ctx.fillStyle = hp === 1 ? '#e63946' : '#4cc36a';
      ctx.fill();
    },

    scoreboard(players, rounds) {
      let y = 4;
      for (const p of players) {
        ctx.fillStyle = 'rgba(20,20,26,0.55)';
        roundRect(ctx, W - 96, y - 2, 94, 11, 3);
        ctx.fill();
        ctx.fillStyle = p.color;
        roundRect(ctx, W - 93, y, 6, 7, 1.5);
        ctx.fill();
        drawText(ctx, p.name.slice(0, 9), W - 85, y, { color: p.alive ? '#ffffff' : '#8a8fb8' });
        drawText(ctx, String(rounds ? p.wins : p.kills), W - 6, y, { color: p.me ? '#ffe14d' : '#ffffff', align: 'right' });
        y += 12;
      }
    },

    timer(text) {
      drawText(ctx, text, W / 2, 4, { color: '#ffffff', scale: 2, align: 'center', shadow: SHADOW });
    },

    status({ hp, powers }) {
      for (let i = 0; i < TANK_RULES.HP; i++) {
        heart(ctx, 11 + i * 13, H - 10, 11);
        ctx.fillStyle = i < hp ? '#e63946' : 'rgba(40,40,48,0.7)';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.stroke();
      }
      let x = 50;
      for (const p of powers) {
        const w = drawText(ctx, p.name.toUpperCase(), x, H - 13, { color: p.color, shadow: SHADOW });
        ctx.fillStyle = p.color;
        ctx.fillRect(x, H - 3.5, w * Math.min(1, p.left / p.max), 1.2);
        x += w + 10;
      }
    },

    center(text, sub = '', color = '#ffe14d') {
      drawText(ctx, text, W / 2, H / 2 - 24, { color, scale: 3, align: 'center', shadow: SHADOW });
      if (sub) drawText(ctx, sub, W / 2, H / 2 + 4, { color: '#ffffff', align: 'center', shadow: SHADOW });
    },

    crosshair(x, y, color) {
      ctx.save();
      ctx.lineCap = 'round';
      for (const [w, c] of [[2.6, 'rgba(0,0,0,0.6)'], [1.2, color]]) {
        ctx.lineWidth = w;
        ctx.strokeStyle = c;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.moveTo(x - 7, y); ctx.lineTo(x - 5, y);
        ctx.moveTo(x + 5, y); ctx.lineTo(x + 7, y);
        ctx.moveTo(x, y - 7); ctx.lineTo(x, y - 5);
        ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 7);
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}

// Top-down fallback (no WebGL): same state, drawn flat on the HUD canvas.
export function createFallback2D(view, arena) {
  const { ctx, width: W, height: H } = view;
  const th = tankTheme(arena.key);
  const scale = Math.min(W / TANK_WORLD.width, H / TANK_WORLD.height);
  const ox = (W - TANK_WORLD.width * scale) / 2;
  const oy = (H - TANK_WORLD.height * scale) / 2;
  const sx = (x) => ox + x * scale;
  const sy = (y) => oy + y * scale;

  return {
    scale,
    toScreen(x, y, out) {
      out.x = sx(x);
      out.y = sy(y);
      return out;
    },
    toWorld(px, py, out) {
      out.x = (px - ox) / scale;
      out.y = (py - oy) / scale;
      return out;
    },
    begin(tiles) {
      ctx.fillStyle = th.outside;
      ctx.fillRect(0, 0, W, H);
      const T = TANK_TILE * scale;
      for (let ty = 0; ty < TANK_ROWS; ty++) {
        for (let tx = 0; tx < TANK_COLS; tx++) {
          const t = tiles[ty * TANK_COLS + tx];
          ctx.fillStyle = t === TILE.WALL ? th.wall : t === TILE.CRATE ? '#b8742a' : th.floor[(tx + ty) % 2];
          ctx.fillRect(Math.floor(sx(tx * TANK_TILE)), Math.floor(sy(ty * TANK_TILE)), Math.ceil(T), Math.ceil(T));
        }
      }
    },
    tank(x, y, dx, dy, aim, color, alive) {
      const r = TANK_PHYS.RADIUS * scale;
      ctx.save();
      ctx.translate(sx(x), sy(y));
      ctx.rotate(Math.atan2(dy, dx));
      ctx.fillStyle = alive ? color : '#3a3440';
      ctx.fillRect(-r, -r * 0.8, r * 2, r * 1.6);
      ctx.restore();
      if (!alive) return;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx(x), sy(y));
      ctx.lineTo(sx(x + Math.cos(aim) * 10), sy(y + Math.sin(aim) * 10));
      ctx.stroke();
    },
    bullet(x, y, color) {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(sx(x)) - 1, Math.round(sy(y)) - 1, 3, 3);
    },
    pickup(x, y, type) {
      ctx.fillStyle = POWERUPS[type].color;
      ctx.fillRect(Math.round(sx(x)) - 3, Math.round(sy(y)) - 3, 7, 7);
    },
  };
}
