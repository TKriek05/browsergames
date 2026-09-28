// Vier op een rij: discs sit BEHIND a panel with holes, so a new disc
// visibly drops through the board and bounces into place.
import { createBoardModule } from '../board/kit.js';
import { THEME, glow, clearBoard, roundRect, disc, circle, easeOutBounce, lerp } from '../board/draw.js';
import { COLS, ROWS } from '../../../shared/rules/connect4.js';

const W = 700;
const H = 640;
const CELL = 90;
const X0 = (W - COLS * CELL) / 2;
const Y0 = 84;
const R = CELL * 0.38;

const cx = (col) => X0 + col * CELL + CELL / 2;
const cy = (row) => Y0 + row * CELL + CELL / 2;

function drawPanel(ctx) {
  // Blue panel with round holes (even-odd fill leaves the holes open).
  ctx.beginPath();
  ctx.rect(X0 - 14, Y0 - 14, COLS * CELL + 28, ROWS * CELL + 28);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      ctx.moveTo(cx(c) + R + 4, cy(r));
      ctx.arc(cx(c), cy(r), R + 4, 0, Math.PI * 2);
    }
  }
  ctx.fillStyle = '#1d2fa0';
  ctx.fill('evenodd');
  glow(ctx, THEME.cyan, 16, () => {
    roundRect(ctx, X0 - 14, Y0 - 14, COLS * CELL + 28, ROWS * CELL + 28, 18);
    ctx.strokeStyle = THEME.cyan;
    ctx.lineWidth = 3;
    ctx.stroke();
  });
}

export const { meta, createGame } = createBoardModule({
  id: 'connect4',
  width: W,
  height: H,

  seatLabel: (seat, f) => f.colorNameOf(seat),
  seatIcon: () => '●',
  cursor: { cols: COLS, rows: 1, target: (col) => col },

  pick(x, y) {
    const col = Math.floor((x - X0) / CELL);
    return col >= 0 && col < COLS && y < Y0 + ROWS * CELL + 14 ? col : null;
  },

  onPick(col, api, f) {
    if (f.myTurn && f.legal.some((m) => m.col === col)) api.move({ col });
  },

  describe: (last, f) => `${f.nameOf(last.seat)} liet een schijf vallen in kolom ${last.info.col + 1}.`,
  animMs: (last) => 380 + last.info.row * 60,
  sound: () => 'hit',

  draw(ctx, f) {
    clearBoard(ctx, W, H);
    const board = f.view.board;
    const last = f.last?.info;
    const animating = last && f.anim < 1;

    // Discs (behind the panel)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const seat = board[r * COLS + c];
        if (seat === -1) continue;
        let y = cy(r);
        if (animating && last.row === r && last.col === c) y = lerp(Y0 - CELL * 0.7, cy(r), easeOutBounce(f.anim));
        disc(ctx, cx(c), y, R, f.colorOf(seat));
      }
    }
    drawPanel(ctx);

    // Column hover / keyboard cursor: a disc waiting above the board.
    const col = f.cursor ? f.cursor.col : f.hover;
    if (col !== null && col !== undefined && f.myTurn && !f.snap.result) {
      const ok = f.legal.some((m) => m.col === col);
      ctx.save();
      ctx.globalAlpha = ok ? 0.9 : 0.3;
      disc(ctx, cx(col), Y0 - CELL * 0.5, R * 0.9, f.colorOf(f.you));
      ctx.restore();
      if (f.cursor) {
        roundRect(ctx, X0 + col * CELL + 4, Y0 - 10, CELL - 8, ROWS * CELL + 20, 14);
        ctx.strokeStyle = THEME.yellow;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }

    // Winning four: pulsing rings.
    if (f.view.line && !animating) {
      const pulse = f.reduced ? 1 : 0.6 + 0.4 * Math.sin(f.time * 6);
      glow(ctx, THEME.yellow, 20, () => {
        ctx.strokeStyle = THEME.yellow;
        ctx.lineWidth = 6;
        ctx.globalAlpha = pulse;
        for (const i of f.view.line) {
          circle(ctx, cx(i % COLS), cy(Math.floor(i / COLS)), R + 2);
          ctx.stroke();
        }
      });
    }
  },
});
