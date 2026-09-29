// Raak de Roos HUD (2D on top of the 3D view): end, distance and wind, the
// scoreboard, the sight pin, the bow at the bottom right, arrows left.
import { drawText, measureText, roundRect } from '../../js/core/hudtext.js';
import { ARC } from '../../../shared/games/archery.js';

const SHADOW = '#1a1a24';
const PANEL = 'rgba(20, 30, 20, 0.55)';

export function createArcheryHud(view) {
  const { ctx } = view;
  const W = view.width;
  const H = view.height;

  return {
    info(snap, left) {
      ctx.fillStyle = PANEL;
      roundRect(ctx, 6, 6, 118, snap.moving ? 46 : 36, 6);
      ctx.fill();
      drawText(ctx, `RONDE ${snap.end}/${snap.ends}`, 12, 10, { color: '#ffe14d', scale: 0.9, shadow: SHADOW });
      drawText(ctx, `${snap.distance} m`, 118, 10, { color: '#ffffff', scale: 0.9, align: 'right', shadow: SHADOW });
      // Wind: an arrow as long as it is strong.
      const w = snap.wind;
      const len = Math.min(1, Math.abs(w) / 8) * 36;
      const cy = 29;
      ctx.strokeStyle = '#bfe6ff';
      ctx.fillStyle = '#bfe6ff';
      ctx.lineWidth = 2;
      if (w) {
        const x0 = 40 - (w > 0 ? len / 2 : -len / 2);
        const x1 = 40 + (w > 0 ? len / 2 : -len / 2);
        ctx.beginPath();
        ctx.moveTo(x0, cy);
        ctx.lineTo(x1, cy);
        ctx.stroke();
        const d = w > 0 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(x1 + d * 3, cy);
        ctx.lineTo(x1 - d * 2, cy - 3.5);
        ctx.lineTo(x1 - d * 2, cy + 3.5);
        ctx.closePath();
        ctx.fill();
      }
      drawText(ctx, w ? `${Math.abs(w).toFixed(1).replace('.', ',')} m/s` : 'geen wind', 118, cy - 5, { color: '#ffffff', scale: 0.8, align: 'right', shadow: SHADOW });
      if (snap.moving) drawText(ctx, 'bewegend doel', 12, 39, { color: '#ffb36b', scale: 0.8, shadow: SHADOW });
      if (snap.phase === 'shoot') drawText(ctx, String(Math.ceil(left)), W / 2, 6, { color: left < 10 ? '#ff6b5a' : '#ffffff', scale: 1.4, align: 'center', shadow: SHADOW });
    },

    // rows: { name, color, total, arrows, me }; big = the end is being scored.
    scores(rows, big) {
      const sorted = [...rows].sort((a, b) => b.total - a.total);
      const x1 = W - 6;
      const rowH = big ? 15 : 11;
      const w = big ? 190 : 130;
      ctx.fillStyle = PANEL;
      roundRect(ctx, x1 - w, 6, w, 8 + sorted.length * rowH, 6);
      ctx.fill();
      sorted.forEach((r, i) => {
        const y = 10 + i * rowH;
        ctx.fillStyle = r.color;
        ctx.fillRect(x1 - w + 6, y + 2, 5, 5);
        drawText(ctx, r.name.slice(0, 9), x1 - w + 15, y, { color: r.me ? '#ffe14d' : '#ffffff', scale: big ? 1 : 0.8, shadow: SHADOW });
        drawText(ctx, String(r.total), x1 - 6, y, { color: '#ffffff', scale: big ? 1 : 0.8, align: 'right', shadow: SHADOW });
        // This end's arrows.
        for (let k = 0; k < ARC.ARROWS; k++) {
          const s = r.arrows[k];
          const bx = x1 - (big ? 96 : 66) + k * (big ? 18 : 12);
          ctx.fillStyle = s === undefined ? 'rgba(255,255,255,0.12)' : s.s >= 9 ? '#ffd23e' : s.s >= 7 ? '#e4453a' : s.s >= 5 ? '#2a8fd8' : s.s > 0 ? '#3a3a40' : '#6b6f78';
          roundRect(ctx, bx, y + 0.5, big ? 16 : 11, big ? 11 : 8, 2);
          ctx.fill();
          if (s !== undefined) drawText(ctx, s.s ? (s.x ? 'X' : String(s.s)) : '–', bx + (big ? 8 : 5.5), y + (big ? 1.5 : 0.5), { color: s.s >= 9 ? '#1a1a24' : '#ffffff', scale: big ? 0.8 : 0.6, align: 'center' });
        }
      });
    },

    // The sight pin; draw 0 … 1 closes the ring.
    pin(x, y, draw, color, ready) {
      ctx.save();
      ctx.globalAlpha = ready ? 1 : 0.45;
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      if (draw > 0) {
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = draw >= 1 ? '#7df0a0' : '#ffe14d';
        ctx.beginPath();
        ctx.arc(x, y, 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * draw);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },

    // The bow in the corner: the string comes back as you draw.
    bow(draw, drawing, tired) {
      const x = W - 38;
      const y = H - 40;
      const pull = drawing ? draw * 14 : 0;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#6b4424';
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(x + 4, y - 30);
      ctx.quadraticCurveTo(x + 18 - pull * 0.3, y, x + 4, y + 30);
      ctx.stroke();
      ctx.strokeStyle = tired ? '#ff9a7a' : '#f4f4f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 4, y - 30);
      ctx.lineTo(x + 2 - pull, y);
      ctx.lineTo(x + 4, y + 30);
      ctx.stroke();
      if (drawing) {
        ctx.strokeStyle = '#c49a62';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x + 2 - pull, y);
        ctx.lineTo(x + 30, y);
        ctx.stroke();
      }
      ctx.restore();
      if (tired) drawText(ctx, 'LOSLATEN!', x, y + 34, { color: '#ff9a7a', scale: 0.8, align: 'center', shadow: SHADOW });
    },

    quiver(n) {
      for (let i = 0; i < ARC.ARROWS; i++) {
        const x = 12 + i * 9;
        ctx.globalAlpha = i < n ? 1 : 0.25;
        ctx.fillStyle = '#c49a62';
        ctx.fillRect(x, H - 30, 2, 20);
        ctx.fillStyle = '#e4453a';
        ctx.fillRect(x - 1.5, H - 30, 5, 5);
        ctx.fillStyle = '#9aa3ad';
        ctx.fillRect(x - 0.5, H - 12, 3, 3);
      }
      ctx.globalAlpha = 1;
    },

    center(text, sub) {
      if (text) drawText(ctx, text, W / 2, H / 2 - 36, { color: '#ffe14d', scale: 2.2, align: 'center', shadow: SHADOW });
      if (sub) drawText(ctx, sub, W / 2, H / 2 - 10, { color: '#ffffff', align: 'center', shadow: SHADOW });
    },

    hint(text) {
      const w = measureText(text, 0.85, ctx) + 16;
      ctx.fillStyle = 'rgba(15,18,24,0.6)';
      roundRect(ctx, W / 2 - w / 2, H - 24, w, 14, 7);
      ctx.fill();
      drawText(ctx, text, W / 2, H - 21, { color: '#ffffff', scale: 0.85, align: 'center' });
    },
  };
}
