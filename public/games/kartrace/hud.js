// Turbo Kart GP HUD on the 2D canvas above the 3D view: place, lap, time,
// item slot (with a short roulette), minimap, speed, start lights, banners
// and the Grand Prix standings. Plus a top-down view when WebGL is missing.
import { drawText, roundRect } from '../../js/core/hudtext.js';
import { ITEM, ITEMS } from '../../../shared/games/kartrace.js';

const SHADOW = '#0b0b1e';
const MAP_W = 92;
const MAP_H = 62;

export function createKartHud(view) {
  const { ctx, width: W, height: H } = view;
  let map = null; // { canvas, track, sx(x), sy(y) }

  // Minimap as a vector path (sharp at any screen size).
  function buildMap(track) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < track.count; i++) {
      minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]);
      minY = Math.min(minY, track.py[i]); maxY = Math.max(maxY, track.py[i]);
    }
    const scale = Math.min((MAP_W - 10) / (maxX - minX), (MAP_H - 10) / (maxY - minY));
    const ox = (MAP_W - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = (MAP_H - (maxY - minY) * scale) / 2 - minY * scale;
    const path = new Path2D();
    for (let i = 0; i <= track.count; i++) {
      const k = i % track.count;
      if (i) path.lineTo(track.px[k] * scale + ox, track.py[k] * scale + oy);
      else path.moveTo(track.px[k] * scale + ox, track.py[k] * scale + oy);
    }
    map = { path, track, sx: (x) => x * scale + ox, sy: (y) => y * scale + oy, start: [track.px[0] * scale + ox, track.py[0] * scale + oy] };
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

    // A white flash over the whole screen (lightning), k = 1 → 0.
    flash(k) {
      ctx.fillStyle = `rgba(255, 252, 220, ${Math.max(0, Math.min(1, k)) * 0.7})`;
      ctx.fillRect(0, 0, W, H);
    },

    // item: ITEM.*; roll: 0..1 while the roulette spins.
    item(item, roll) {
      const x = W / 2 - 13;
      const y = 5;
      ctx.fillStyle = 'rgba(20,20,28,0.6)';
      roundRect(ctx, x, y, 26, 26, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      const shown = roll > 0 ? ROULETTE[Math.floor(performance.now() / 70) % ROULETTE.length] : item;
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
      ctx.save();
      ctx.translate(x0, y0);
      ctx.fillStyle = 'rgba(20, 30, 22, 0.55)';
      roundRect(ctx, 0, 0, MAP_W, MAP_H, 5);
      ctx.fill();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.lineWidth = 5;
      ctx.stroke(map.path);
      ctx.strokeStyle = '#d8d8de';
      ctx.lineWidth = 3;
      ctx.stroke(map.path);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(map.start[0] - 1.5, map.start[1] - 1.5, 3, 3);
      for (const d of dots) {
        const r = d.me ? 3 : 2.3;
        ctx.beginPath();
        ctx.arc(map.sx(d.x), map.sy(d.y), r, 0, Math.PI * 2);
        ctx.fillStyle = d.color;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = d.me ? '#ffffff' : 'rgba(0,0,0,0.6)';
        ctx.stroke();
      }
      ctx.restore();
    },

    // Start lights: three red lamps, then green.
    lights(left) {
      const lit = Math.min(3, Math.max(0, 4 - Math.ceil(left)));
      const go = left <= 1;
      const x0 = W / 2 - 33;
      ctx.fillStyle = 'rgba(20,20,26,0.9)';
      roundRect(ctx, x0 - 5, 43, 76, 28, 6);
      ctx.fill();
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(x0 + 9 + i * 24, 57, 9, 0, Math.PI * 2);
        ctx.fillStyle = go ? '#3ad26a' : i < lit ? '#ff3b30' : '#3a3a44';
        ctx.fill();
      }
      if (go) drawText(ctx, 'GO!', W / 2, 80, { color: '#3ad26a', scale: 4, align: 'center', shadow: SHADOW });
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
      ctx.fillStyle = 'rgba(20,20,26,0.88)';
      roundRect(ctx, x, y, w, 24 + rows.length * 13, 8);
      ctx.fill();
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

const ROULETTE = [ITEM.TURBO, ITEM.ORB, ITEM.OIL, ITEM.SHIELD, ITEM.ROCKET, ITEM.BOMB, ITEM.LIGHTNING, ITEM.STAR];

function star(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.45 : r;
    if (k) ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    else ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function icon(ctx, item, cx, cy) {
  const color = ITEMS[item]?.color ?? '#ffffff';
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (item) {
    case ITEM.TURBO: // double chevron
    case ITEM.TURBO2:
    case ITEM.TURBO3:
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (const dx of [-4, 2]) {
        ctx.moveTo(cx + dx - 2, cy - 5);
        ctx.lineTo(cx + dx + 3, cy);
        ctx.lineTo(cx + dx - 2, cy + 5);
      }
      ctx.stroke();
      if (item !== ITEM.TURBO) {
        // How many are left, in a little badge.
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx + 7, cy + 7, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1c1c24';
        ctx.font = 'bold 7px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item === ITEM.TURBO3 ? '3' : '2', cx + 7, cy + 7.5);
      }
      break;
    case ITEM.ROCKET: // a rocket pointing up and right
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(3, -3);
      ctx.lineTo(-5, -3);
      ctx.lineTo(-5, 3);
      ctx.lineTo(3, 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f4f4f4';
      ctx.fillRect(-7, -5, 3, 3);
      ctx.fillRect(-7, 2, 3, 3);
      ctx.fillStyle = '#ffb020';
      ctx.fillRect(-9, -1.5, 3, 3);
      ctx.restore();
      break;
    case ITEM.LIGHTNING:
      ctx.beginPath();
      ctx.moveTo(cx + 2, cy - 8);
      ctx.lineTo(cx - 5, cy + 1);
      ctx.lineTo(cx - 0.5, cy + 1);
      ctx.lineTo(cx - 2, cy + 8);
      ctx.lineTo(cx + 5, cy - 1.5);
      ctx.lineTo(cx + 0.5, cy - 1.5);
      ctx.closePath();
      ctx.fill();
      break;
    case ITEM.BOMB:
      ctx.beginPath();
      ctx.arc(cx - 1, cy + 1.5, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.arc(cx - 3, cy - 0.5, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c8a070';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx + 3, cy - 3);
      ctx.quadraticCurveTo(cx + 5, cy - 7, cx + 7, cy - 6);
      ctx.stroke();
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath();
      ctx.arc(cx + 7, cy - 6.5, 1.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case ITEM.STAR:
      star(ctx, cx, cy + 0.5, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    case ITEM.ORB: {
      const g = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, 7);
      g.addColorStop(0, '#ffd0b8');
      g.addColorStop(1, color);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff4e0';
      ctx.fillRect(cx - 7, cy - 0.8, 14, 1.6);
      break;
    }
    case ITEM.OIL:
      ctx.beginPath();
      ctx.moveTo(cx, cy - 7);
      ctx.bezierCurveTo(cx + 6, cy - 1, cx + 6, cy + 6, cx, cy + 6);
      ctx.bezierCurveTo(cx - 6, cy + 6, cx - 6, cy - 1, cx, cy - 7);
      ctx.fill();
      break;
    case ITEM.SHIELD:
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy - 6);
      ctx.lineTo(cx + 6, cy - 6);
      ctx.lineTo(cx + 6, cy);
      ctx.quadraticCurveTo(cx + 5, cy + 5, cx, cy + 7);
      ctx.quadraticCurveTo(cx - 5, cy + 5, cx - 6, cy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4);
      ctx.moveTo(cx - 3, cy - 1); ctx.lineTo(cx + 3, cy - 1);
      ctx.stroke();
      break;
    default:
      break;
  }
  ctx.restore();
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
