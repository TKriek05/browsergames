// Boter-kaas-en-eieren: neon grid, marks draw themselves, glowing win line.
import { createBoardModule } from '../board/kit.js';
import { THEME, glow, clearBoard, roundRect, easeOutCubic, clamp01 } from '../board/draw.js';

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
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = alpha < 1 ? 0 : 18;
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
    clearBoard(ctx, SIZE, SIZE);
    roundRect(ctx, 20, 20, SIZE - 40, SIZE - 40, 28);
    ctx.fillStyle = THEME.board;
    ctx.fill();

    // Grid
    glow(ctx, THEME.cyan, 14, () => {
      ctx.strokeStyle = THEME.cyan;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 1; i < 3; i++) {
        ctx.moveTo(PAD + i * CELL, PAD + 10);
        ctx.lineTo(PAD + i * CELL, SIZE - PAD - 10);
        ctx.moveTo(PAD + 10, PAD + i * CELL);
        ctx.lineTo(SIZE - PAD - 10, PAD + i * CELL);
      }
      ctx.stroke();
    });

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
        ctx.strokeStyle = THEME.yellow;
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    }

    // Winning line
    const line = f.view.line;
    if (line && f.time >= f.local.lineAt) {
      const a = center(line[0]);
      const b = center(line[2]);
      const t = f.reduced ? 1 : easeOutCubic(clamp01((f.time - f.local.lineAt) * 3));
      glow(ctx, THEME.yellow, 24, () => {
        ctx.strokeStyle = THEME.yellow;
        ctx.lineWidth = 12;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        ctx.stroke();
      });
    }
  },
});
