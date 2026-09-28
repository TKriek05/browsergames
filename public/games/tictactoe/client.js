// Boter-kaas-en-eieren: a pencil grid on notebook paper, marks drawn in
// ink (they draw themselves), the winning line in highlighter.
import { createBoardModule } from '../board/kit.js';
import { roundRect, easeOutCubic, clamp01, woodTable, dropShadow } from '../board/draw.js';

const SIZE = 600;
const PAD = 60;
const CELL = (SIZE - PAD * 2) / 3;
const CELL_NAMES = ['linksboven', 'bovenin het midden', 'rechtsboven', 'links in het midden', 'in het midden', 'rechts in het midden', 'linksonder', 'onderin het midden', 'rechtsonder'];

const center = (c) => ({ x: PAD + (c % 3) * CELL + CELL / 2, y: PAD + Math.floor(c / 3) * CELL + CELL / 2 });

function drawMark(ctx, seat, c, color, progress, alpha = 1) {
  const { x, y } = center(c);
  const r = CELL * 0.3;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';
  if (seat === 0) {
    // X: two strokes, the second starts halfway.
    const p1 = clamp01(progress * 2);
    const p2 = clamp01(progress * 2 - 1);
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x - r + 2 * r * p1, y - r + 2 * r * p1);
    if (p2 > 0) {
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x + r - 2 * r * p2, y - r + 2 * r * p2);
    }
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
  }
  ctx.restore();
}

export const { meta, createGame } = createBoardModule({
  id: 'tictactoe',
  width: SIZE,
  height: SIZE,

  seatLabel: (seat) => (seat === 0 ? 'Kruisje (X)' : 'Rondje (O)'),
  seatIcon: (seat) => (seat === 0 ? '✕' : '○'),

  cursor: { cols: 3, rows: 3, target: (col, row) => row * 3 + col },

  pick(x, y) {
    const col = Math.floor((x - PAD) / CELL);
    const row = Math.floor((y - PAD) / CELL);
    return col >= 0 && col < 3 && row >= 0 && row < 3 ? row * 3 + col : null;
  },

  onPick(cell, api, f) {
    if (f.myTurn && f.legal.some((m) => m.c === cell)) api.move({ c: cell });
  },

  initLocal: () => ({ lineAt: 0 }),
  // Remember when the winning line appeared, so it can draw itself once.
  onChange(local, f) {
    local.lineAt = f.view.line ? f.time + 0.3 : 0;
  },

  describe: (last, f) => `${f.nameOf(last.seat)} zette ${last.seat === 0 ? 'een kruisje' : 'een rondje'} ${CELL_NAMES[last.info.c]}.`,
  animMs: () => 320,
  sound: () => 'click',

  draw(ctx, f) {
    // A sheet of lined paper on a desk.
    woodTable(ctx, 0, 0, SIZE, SIZE, 'oak');
    dropShadow(ctx, 22, 22, SIZE - 44, SIZE - 44, 4);
    ctx.fillStyle = '#fbf7ea';
    ctx.fillRect(22, 22, SIZE - 44, SIZE - 44);
    ctx.fillStyle = 'rgba(80, 130, 200, 0.28)';
    for (let y = 70; y < SIZE - 30; y += 28) ctx.fillRect(22, y, SIZE - 44, 1.5);
    ctx.fillStyle = 'rgba(220, 60, 60, 0.45)';
    ctx.fillRect(74, 22, 2, SIZE - 44);

    // Pencil grid, a little wobbly like drawn by hand.
    ctx.strokeStyle = '#3a3a44';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      const at = PAD + i * CELL;
      ctx.moveTo(at - 3, PAD + 10);
      ctx.quadraticCurveTo(at + 5, SIZE / 2, at + 1, SIZE - PAD - 10);
      ctx.moveTo(PAD + 10, at + 2);
      ctx.quadraticCurveTo(SIZE / 2, at - 5, SIZE - PAD - 10, at);
    }
    ctx.stroke();

    const board = f.view.board;
    const lastC = f.last?.info?.c;
    for (let c = 0; c < 9; c++) {
      if (board[c] === -1) continue;
      const progress = c === lastC ? easeOutCubic(f.anim) : 1;
      drawMark(ctx, board[c], c, f.colorOf(board[c]), progress);
    }

    // Hover ghost / keyboard cursor
    const target = f.cursor ? f.cursor.row * 3 + f.cursor.col : f.hover;
    if (target !== null && target !== undefined) {
      const col = target % 3;
      const row = Math.floor(target / 3);
      if (f.myTurn && board[target] === -1) drawMark(ctx, f.you, target, f.colorOf(f.you), 1, 0.25);
      if (f.cursor) {
        roundRect(ctx, PAD + col * CELL + 8, PAD + row * CELL + 8, CELL - 16, CELL - 16, 16);
        ctx.setLineDash([10, 8]);
        ctx.strokeStyle = '#5a5a66';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Winning line
    const line = f.view.line;
    if (line && f.time >= f.local.lineAt) {
      const a = center(line[0]);
      const b = center(line[2]);
      const t = f.reduced ? 1 : easeOutCubic(clamp01((f.time - f.local.lineAt) * 3));
      // Highlighter stroke
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#ffe14d';
      ctx.lineWidth = 34;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      ctx.stroke();
      ctx.restore();
    }
  },
});
