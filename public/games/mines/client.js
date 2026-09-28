// Mijnenveger, samen: everybody clicks at the same time. Left click / Enter
// reveals, right click / long press / F places a flag in your colour.
import { createBoardModule } from '../board/kit.js';
import { roundRect } from '../board/draw.js';

const W = 760;
const H = 480;
// A grass field you dig into: classic number colours on the soil.
const NUM_COLORS = ['', '#1976d2', '#2e7d32', '#d32f2f', '#7b1fa2', '#e65100', '#00838f', '#37474f', '#757575'];
const L = { cols: 16, rows: 12, size: 30, x0: 0, y0: 0 };

function fit(v) {
  L.cols = v.cols;
  L.rows = v.rows;
  L.size = Math.floor(Math.min((W - 40) / v.cols, (H - 56) / v.rows));
  L.x0 = Math.floor((W - L.size * v.cols) / 2);
  L.y0 = Math.floor((H - L.size * v.rows) / 2) + 10;
}

function drawMine(ctx, x, y, s, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, s * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, s * 0.08);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(a) * s * 0.38, y - Math.sin(a) * s * 0.38);
    ctx.lineTo(x + Math.cos(a) * s * 0.38, y + Math.sin(a) * s * 0.38);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillRect(x - s * 0.1, y - s * 0.1, s * 0.07, s * 0.07);
}

function drawFlag(ctx, x, y, s, color) {
  ctx.fillStyle = '#3a2a1c';
  ctx.fillRect(x - s * 0.04, y - s * 0.3, s * 0.08, s * 0.58);
  ctx.fillRect(x - s * 0.18, y + s * 0.24, s * 0.36, s * 0.07);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.04, y - s * 0.3);
  ctx.lineTo(x + s * 0.32, y - s * 0.16);
  ctx.lineTo(x + s * 0.04, y - s * 0.02);
  ctx.closePath();
  ctx.fill();
}

const cellAt = (x, y) => {
  const col = Math.floor((x - L.x0) / L.size);
  const row = Math.floor((y - L.y0) / L.size);
  return col >= 0 && row >= 0 && col < L.cols && row < L.rows ? row * L.cols + col : null;
};

export const { meta, createGame } = createBoardModule({
  id: 'mines',
  width: W,
  height: H,

  seatLabel: (seat, f) => `${f.view.scores[seat] ?? 0} vakjes${f.view.hits[seat] ? ` · ${f.view.hits[seat]}× boem` : ''}`,
  turnText: () => 'Iedereen tegelijk: klik om te vegen, rechtsklik (of lang drukken / F) voor een vlag.',

  cursor: {
    get cols() { return L.cols; },
    get rows() { return L.rows; },
    target: (col, row) => row * L.cols + col,
  },

  pick: (x, y) => cellAt(x, y),

  onPick(c, api, f) {
    if (f.spectator || f.snap.result) return;
    if (f.view.cells[c] === null && f.view.flags[c] === -1) api.move({ t: 'r', c });
  },

  onAltPick(c, api, f) {
    if (f.spectator || f.snap.result) return;
    if (f.view.cells[c] === null) api.move({ t: 'f', c });
  },

  onKey(key, api, f) {
    if ((key === 'f' || key === 'F') && f.cursor) {
      const c = f.cursor.row * L.cols + f.cursor.col;
      if (f.view.cells[c] === null && !f.spectator) api.move({ t: 'f', c });
      return true;
    }
    return false;
  },

  describe(last, f) {
    if (last.info.t === 'f') return `${f.nameOf(last.seat)} ${last.info.on ? 'plaatst' : 'haalt'} een vlag.`;
    if (last.info.boom) return `Boem! ${f.nameOf(last.seat)} raakte een mijn.`;
    return `${f.nameOf(last.seat)} veegde ${last.info.n} ${last.info.n === 1 ? 'vakje' : 'vakjes'}.`;
  },
  animMs: (last) => (last.info.boom ? 500 : 180),
  sound: (last) => (last.info.boom ? 'explode' : last.info.t === 'f' ? 'react' : last.info.n > 8 ? 'coin' : 'click'),

  draw(ctx, f) {
    const v = f.view;
    fit(v);
    ctx.fillStyle = '#4a7a34';
    ctx.fillRect(0, 0, W, H);
    const s = L.size;
    // Top bar: lives + mines left
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(`Levens: ${'♥'.repeat(Math.max(0, v.lives))}${'♡'.repeat(Math.max(0, v.livesMax - v.lives))}`, 20, 20);
    ctx.textAlign = 'right';
    const flagsUsed = v.flags.filter((x) => x !== -1).length;
    ctx.fillText(`Mijnen: ${Math.max(0, v.mineCount - flagsUsed - v.exploded.length)}   Nog veilig: ${v.safeLeft}`, W - 20, 20);

    const boomC = f.last?.info?.boom ? f.last.info.c : -1;
    const shake = boomC >= 0 && f.anim < 1 && !f.reduced ? (1 - f.anim) * 6 : 0;
    ctx.save();
    if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    for (let c = 0; c < v.cells.length; c++) {
      const x = L.x0 + (c % L.cols) * s;
      const y = L.y0 + Math.floor(c / L.cols) * s;
      const cell = v.cells[c];
      if (cell === null || cell === 'm') {
        // Raised tile
        ctx.fillStyle = (c + Math.floor(c / L.cols)) % 2 ? '#8cc152' : '#81b84a';
        ctx.fillRect(x, y, s, s);
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(x, y, s, 2);
        if (cell === 'm') drawMine(ctx, x + s / 2, y + s / 2, s, '#2a2a2a');
        if (v.flags[c] !== -1) drawFlag(ctx, x + s / 2, y + s / 2, s, f.colorOf(v.flags[c]));
      } else {
        const who = v.revealed[c];
        ctx.fillStyle = cell === 'M' ? '#d8604a' : (c + Math.floor(c / L.cols)) % 2 ? '#e5c29f' : '#d7b899';
        ctx.fillRect(x, y, s, s);
        // A thin line in the colour of who revealed it.
        ctx.fillStyle = f.colorOf(who);
        ctx.globalAlpha = 0.35;
        ctx.fillRect(x + 1, y + s - 3, s - 2, 2);
        ctx.globalAlpha = 1;
        if (cell === 'M') drawMine(ctx, x + s / 2, y + s / 2, s, '#1a1a1a');
        else if (cell > 0) {
          ctx.fillStyle = NUM_COLORS[cell];
          ctx.font = `700 ${Math.round(s * 0.62)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(String(cell), x + s / 2, y + s / 2 + 1);
        }
      }
    }
    // Hover / keyboard cursor
    const target = f.cursor ? f.cursor.row * L.cols + f.cursor.col : f.hover;
    if (target !== null && target !== undefined) {
      const x = L.x0 + (target % L.cols) * s;
      const y = L.y0 + Math.floor(target / L.cols) * s;
      roundRect(ctx, x, y, s, s, 4);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.restore();
  },
});
