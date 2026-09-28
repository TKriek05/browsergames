// Turbo Kart GP HUD on the 2D canvas above the 3D view: place, lap, time,
// item slot (with a short roulette), minimap, speed, start lights, banners
// and the Grand Prix standings. Plus a top-down view when WebGL is missing.
import { drawText } from '../../js/core/pixelfont.js';
import { createLayer } from '../../js/core/canvas.js';
import { ITEM, ITEMS } from '../../../shared/games/kartrace.js';

const SHADOW = '#0b0b1e';
const MAP_W = 92;
const MAP_H = 62;

export function createKartHud(view) {
  const { ctx, width: W, height: H } = view;
  let map = null; // { canvas, track, sx(x), sy(y) }

  function buildMap(track) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < track.count; i++) {
      minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]);
      minY = Math.min(minY, track.py[i]); maxY = Math.max(maxY, track.py[i]);
    }
    const scale = Math.min((MAP_W - 8) / (maxX - minX), (MAP_H - 8) / (maxY - minY));
    const ox = (MAP_W - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = (MAP_H - (maxY - minY) * scale) / 2 - minY * scale;
    const { canvas, ctx: c } = createLayer(MAP_W, MAP_H);
    c.fillStyle = 'rgba(28, 52, 30, 0.8)';
    c.fillRect(0, 0, MAP_W, MAP_H);
    c.lineJoin = 'round';
    for (const [width, color] of [[5, '#1c1c24'], [3, '#c8c8d0']]) {
      c.strokeStyle = color;
      c.lineWidth = width;
      c.beginPath();
      for (let i = 0; i <= track.count; i++) {
        const k = i % track.count;
        const x = track.px[k] * scale + ox;
        const y = track.py[k] * scale + oy;
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
      c.stroke();
    }
    c.fillStyle = '#ffffff';
    c.fillRect(Math.round(track.px[0] * scale + ox) - 1, Math.round(track.py[0] * scale + oy) - 1, 3, 3);
    map = { canvas, track, sx: (x) => x * scale + ox, sy: (y) => y * scale + oy };
  }

  return {
    clear() {
      ctx.clearRect(0, 0, W, H);
    },

    setTrack(track) {
      if (map?.track !== track) buildMap(track);
    },

    place(place, total) {
      const w = drawText(ctx, `${place}E`, 6, 6, { color: place === 1 ? '#ffe14d' : '#ffffff', scale: 4, shadow: '#c81d25' });
      drawText(ctx, `/${total}`, 8 + w, 25, { color: '#a3a8d6', shadow: SHADOW });
    },

    lap(lap, laps) {
      drawText(ctx, `RONDE ${Math.max(1, Math.min(lap, laps))}/${laps}`, 6, 38, { color: '#ffffff', shadow: SHADOW });
    },

    time(seconds) {
      const m = Math.floor(seconds / 60);
      const s = seconds - m * 60;
      drawText(ctx, `${m}:${s.toFixed(1).padStart(4, '0').replace('.', ',')}`, W - 6, 6, { color: '#ffffff', scale: 2, align: 'right', shadow: SHADOW });
    },

    // item: ITEM.*; roll: 0..1 while the roulette spins.
    item(item, roll) {
      const x = W / 2 - 13;
      const y = 5;
      ctx.fillStyle = 'rgba(20,20,28,0.65)';
      ctx.fillRect(x, y, 26, 26);
      ctx.strokeStyle = '#f4f4f4';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, 25, 25);
      const shown = roll > 0 ? 1 + (Math.floor(performance.now() / 70) % 4) : item;
      if (shown) icon(ctx, shown, x + 13, y + 13);
    },

    speed(kmh) {
      drawText(ctx, `${Math.round(kmh)}`, W - 30, H - 20, { color: '#ffffff', scale: 2, align: 'right', shadow: SHADOW });
      drawText(ctx, 'KM/U', W - 6, H - 13, { color: '#a3a8d6', align: 'right', shadow: SHADOW });
    },

    minimap(dots) {
      if (!map) return;
      const x0 = 5;
      const y0 = H - MAP_H - 5;
      ctx.drawImage(map.canvas, x0, y0);
      for (const d of dots) {
        const x = Math.round(x0 + map.sx(d.x));
        const y = Math.round(y0 + map.sy(d.y));
        ctx.fillStyle = SHADOW;
        ctx.fillRect(x - 2, y - 2, d.me ? 5 : 4, d.me ? 5 : 4);
        ctx.fillStyle = d.color;
        ctx.fillRect(x - 1, y - 1, d.me ? 3 : 2, d.me ? 3 : 2);
      }
    },

    // Start lights: three red lamps, then green.
    lights(left) {
      const lit = Math.min(3, Math.max(0, 4 - Math.ceil(left)));
      const go = left <= 1;
      const x0 = W / 2 - 33;
      ctx.fillStyle = 'rgba(11,11,30,0.85)';
      ctx.fillRect(x0 - 4, 44, 74, 26);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = go ? '#5dff8a' : i < lit ? '#ff4d6d' : '#2a2a4a';
        ctx.fillRect(x0 + i * 24, 48, 18, 18);
      }
      if (go) drawText(ctx, 'GO!', W / 2, 80, { color: '#5dff8a', scale: 4, align: 'center', shadow: SHADOW });
    },

    banner(text, sub = '', color = '#ffe14d') {
      drawText(ctx, text, W / 2, H / 2 - 30, { color, scale: 3, align: 'center', shadow: SHADOW });
      if (sub) drawText(ctx, sub, W / 2, H / 2 - 4, { color: '#ffffff', align: 'center', shadow: SHADOW });
    },

    label(x, y, text, color) {
      drawText(ctx, text, Math.round(x), Math.round(y), { color, align: 'center', shadow: SHADOW });
    },

    // Grand Prix standings between races.
    standings(rows, title) {
      const w = 220;
      const x = (W - w) / 2;
      const y = 50;
      ctx.fillStyle = 'rgba(11,11,30,0.85)';
      ctx.fillRect(x, y, w, 24 + rows.length * 13);
      drawText(ctx, title, W / 2, y + 6, { color: '#ffe14d', align: 'center' });
      rows.forEach((r, i) => {
        const ry = y + 22 + i * 13;
        ctx.fillStyle = r.color;
        ctx.fillRect(x + 8, ry, 6, 7);
        drawText(ctx, `${i + 1}. ${r.name.slice(0, 12)}`, x + 20, ry, { color: r.me ? '#ffe14d' : '#ffffff' });
        drawText(ctx, `${r.points} PT`, x + w - 8, ry, { color: '#ffffff', align: 'right' });
      });
    },
  };
}

function icon(ctx, item, cx, cy) {
  const color = ITEMS[item]?.color ?? '#ffffff';
  ctx.fillStyle = color;
  switch (item) {
    case ITEM.TURBO: // double chevron
      for (let k = 0; k < 2; k++) {
        for (let i = 0; i < 5; i++) {
          ctx.fillRect(cx - 7 + k * 6 + i, cy - 5 + i, 2, 1);
          ctx.fillRect(cx - 7 + k * 6 + i, cy + 5 - i, 2, 1);
        }
      }
      break;
    case ITEM.ORB:
      for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) if (x * x + y * y <= 36) ctx.fillRect(cx + x, cy + y, 1, 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 3, cy - 3, 2, 2);
      break;
    case ITEM.OIL:
      for (let y = -6; y <= 6; y++) {
        const w = y < 0 ? Math.round((y + 7) / 2) : Math.round(Math.sqrt(36 - y * y));
        ctx.fillRect(cx - w, cy + y, w * 2 + 1, 1);
      }
      break;
    case ITEM.SHIELD:
      for (let y = -6; y <= 6; y++) {
        const w = y < 2 ? 6 : 6 - (y - 1) * 1.2;
        ctx.fillRect(cx - Math.round(w), cy + y, Math.round(w) * 2 + 1, 1);
      }
      ctx.fillStyle = '#0b0b1e';
      ctx.fillRect(cx, cy - 4, 1, 8);
      ctx.fillRect(cx - 3, cy - 1, 7, 1);
      break;
    default:
      break;
  }
}

// Top-down fallback when WebGL is not available: follows your kart.
export function createFallback2D(view) {
  const { ctx, width: W, height: H } = view;
  const scale = 0.5;
  return {
    draw(track, focus, karts, objects) {
      ctx.fillStyle = '#5fae48';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2 - focus.x * scale, H / 2 - focus.y * scale);
      ctx.scale(scale, scale);
      ctx.lineJoin = 'round';
      for (const [width, color] of [[track.width + 14, '#e63946'], [track.width, '#5b5c64']]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let i = 0; i <= track.count; i++) {
          const k = i % track.count;
          if (i) ctx.lineTo(track.px[k], track.py[k]);
          else ctx.moveTo(track.px[k], track.py[k]);
        }
        ctx.stroke();
      }
      for (const o of objects) {
        ctx.fillStyle = ITEMS[o.type]?.color ?? '#ffffff';
        ctx.fillRect(o.x - 6, o.y - 6, 12, 12);
      }
      for (const k of karts) {
        ctx.save();
        ctx.translate(k.x, k.y);
        ctx.rotate(Math.atan2(k.hy, k.hx));
        ctx.fillStyle = k.color;
        ctx.fillRect(-8, -5, 16, 10);
        ctx.restore();
      }
      ctx.restore();
    },
  };
}
