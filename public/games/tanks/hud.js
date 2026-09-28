// Tank Tumult HUD on the transparent 2D canvas above the 3D view, plus a
// simple top-down renderer for devices without WebGL.
import { drawText } from '../../js/core/pixelfont.js';
import { TANK_TILE, TANK_COLS, TANK_ROWS, TANK_WORLD, TILE } from '../../../shared/maps/tank-arenas.js';
import { TANK_RULES, POWERUPS } from '../../../shared/games/tanks.js';
import { TANK_PHYS } from '../../../shared/physics/tanks.js';

const SHADOW = '#0b0b1e';

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
      for (let i = 0; i < TANK_RULES.HP; i++) {
        ctx.fillStyle = SHADOW;
        ctx.fillRect(px - 8 + i * 6, py - 3, 5, 3);
        ctx.fillStyle = i < hp ? (hp === 1 ? '#ff4d6d' : '#5dff8a') : '#2a2a5c';
        ctx.fillRect(px - 7 + i * 6, py - 2, 3, 1);
      }
    },

    scoreboard(players, rounds) {
      let y = 4;
      for (const p of players) {
        ctx.fillStyle = 'rgba(11,11,30,0.6)';
        ctx.fillRect(W - 96, y - 2, 94, 11);
        ctx.fillStyle = p.color;
        ctx.fillRect(W - 93, y, 5, 5 + 2);
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
        const x = 6 + i * 13;
        ctx.fillStyle = SHADOW;
        ctx.fillRect(x - 1, H - 15, 12, 11);
        ctx.fillStyle = i < hp ? '#ff4d6d' : '#2a2a5c';
        // A tiny pixel heart
        ctx.fillRect(x + 1, H - 14, 3, 2);
        ctx.fillRect(x + 6, H - 14, 3, 2);
        ctx.fillRect(x, H - 12, 10, 3);
        ctx.fillRect(x + 1, H - 9, 8, 2);
        ctx.fillRect(x + 3, H - 7, 4, 1);
      }
      let x = 50;
      for (const p of powers) {
        const w = drawText(ctx, p.name.toUpperCase(), x, H - 13, { color: p.color, shadow: SHADOW });
        ctx.fillStyle = p.color;
        ctx.fillRect(x, H - 4, Math.round(w * Math.min(1, p.left / p.max)), 1);
        x += w + 10;
      }
    },

    center(text, sub = '', color = '#ffe14d') {
      drawText(ctx, text, W / 2, H / 2 - 24, { color, scale: 3, align: 'center', shadow: SHADOW });
      if (sub) drawText(ctx, sub, W / 2, H / 2 + 4, { color: '#ffffff', align: 'center', shadow: SHADOW });
    },

    crosshair(x, y, color) {
      const px = Math.round(x);
      const py = Math.round(y);
      ctx.fillStyle = SHADOW;
      ctx.fillRect(px - 5, py - 1, 11, 3);
      ctx.fillRect(px - 1, py - 5, 3, 11);
      ctx.fillStyle = color;
      ctx.fillRect(px - 4, py, 3, 1);
      ctx.fillRect(px + 2, py, 3, 1);
      ctx.fillRect(px, py - 4, 1, 3);
      ctx.fillRect(px, py + 2, 1, 3);
    },
  };
}

// Top-down fallback (no WebGL): same state, drawn flat on the HUD canvas.
export function createFallback2D(view, arena) {
  const { ctx, width: W, height: H } = view;
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
      ctx.fillStyle = '#0b0620';
      ctx.fillRect(0, 0, W, H);
      const T = TANK_TILE * scale;
      for (let ty = 0; ty < TANK_ROWS; ty++) {
        for (let tx = 0; tx < TANK_COLS; tx++) {
          const t = tiles[ty * TANK_COLS + tx];
          ctx.fillStyle = t === TILE.WALL ? '#3a3486' : t === TILE.CRATE ? '#b8742a' : (tx + ty) % 2 ? '#1b1a44' : '#1f1e4c';
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
