// Reversi: dark felt board, discs flip over in a wave, dots show your moves.
import { createBoardModule } from '../board/kit.js';
import { h } from '../../js/core/ui.js';
import { roundRect, disc, circle, clamp01, easeOutCubic, woodTable, feltTable, dropShadow } from '../board/draw.js';
import { SIZE } from '../../../shared/rules/reversi.js';

const W = 720;
const CELL = 80;
const X0 = (W - SIZE * CELL) / 2;
const Y0 = X0;
const R = CELL * 0.38;
const DISC = ['#16161f', '#f2f3ff'];
const RIM = ['#000', '#9aa0c8'];
const FILES = 'abcdefgh';

const name = (sq) => `${FILES[sq % 8]}${8 - Math.floor(sq / 8)}`;
const cx = (sq) => X0 + (sq % 8) * CELL + CELL / 2;
const cy = (sq) => Y0 + Math.floor(sq / 8) * CELL + CELL / 2;

function drawDisc(ctx, sq, seat, scaleX = 1, scale = 1) {
  ctx.save();
  ctx.translate(cx(sq), cy(sq));
  ctx.scale(Math.max(0.04, scaleX) * scale, scale);
  disc(ctx, 0, 0, R, DISC[seat], { rim: RIM[seat], shine: seat === 0 ? 0.25 : 0.5 });
  ctx.restore();
}

export const { meta, createGame } = createBoardModule({
  id: 'reversi',
  width: W,
  height: W,

  seatLabel: (seat) => (seat === 0 ? 'Zwart' : 'Wit'),
  seatIcon: (seat) => (seat === 0 ? '●' : '○'),
  cursor: { cols: 8, rows: 8, target: (col, row) => row * 8 + col },

  pick(x, y) {
    const col = Math.floor((x - X0) / CELL);
    const row = Math.floor((y - Y0) / CELL);
    return col >= 0 && col < 8 && row >= 0 && row < 8 ? row * 8 + col : null;
  },

  onPick(sq, api, f) {
    if (f.myTurn && f.legal.some((m) => m.sq === sq)) api.move({ sq });
  },

  describe(last, f) {
    const flips = last.info.flips.length;
    let text = `${f.nameOf(last.seat)} speelde ${name(last.info.sq)} en draaide ${flips} ${flips === 1 ? 'steen' : 'stenen'} om.`;
    if (last.info.passed !== null) text += ` ${f.nameOf(last.info.passed)} kan niet zetten en moet passen.`;
    return text;
  },
  animMs: (last) => 300 + last.info.flips.length * 45,
  sound: () => 'click',

  panel(el, f) {
    const [b, w] = f.view.count;
    el.append(h('p', { class: 'bp__score-line' }, `● Zwart ${b}  –  ${w} Wit ○`));
  },

  draw(ctx, f) {
    // Green felt board in a dark wooden frame, on a walnut table.
    woodTable(ctx, 0, 0, W, W, 'walnut');
    const B = SIZE * CELL;
    dropShadow(ctx, X0 - 44, Y0 - 44, B + 88, B + 88, 10);
    woodTable(ctx, X0 - 44, Y0 - 44, B + 88, B + 88, 'oak', 30);
    ctx.fillStyle = 'rgba(40, 20, 8, 0.35)';
    ctx.fillRect(X0 - 44, Y0 - 44, B + 88, B + 88);
    feltTable(ctx, X0, Y0, B, B, '#1d7a4c');
    ctx.strokeStyle = '#0d3a22';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 1; i < SIZE; i++) {
      ctx.moveTo(X0 + i * CELL, Y0);
      ctx.lineTo(X0 + i * CELL, Y0 + SIZE * CELL);
      ctx.moveTo(X0, Y0 + i * CELL);
      ctx.lineTo(X0 + SIZE * CELL, Y0 + i * CELL);
    }
    ctx.stroke();
    for (const [x, y] of [[2, 2], [6, 2], [2, 6], [6, 6]]) {
      circle(ctx, X0 + x * CELL, Y0 + y * CELL, 5);
      ctx.fillStyle = '#0d3a22';
      ctx.fill();
    }

    const board = f.view.board;
    const prev = f.prev.board;
    const last = f.last?.info;
    const flipping = last && f.anim < 1 ? new Map(last.flips.map((sq, i) => [sq, i])) : null;
    for (let sq = 0; sq < 64; sq++) {
      const seat = board[sq];
      if (seat === -1) continue;
      if (flipping && sq === last.sq) {
        const t = easeOutCubic(clamp01(f.anim * 3));
        drawDisc(ctx, sq, seat, 1, 0.4 + 0.6 * t);
      } else if (flipping && flipping.has(sq)) {
        // Staggered flip: shrink horizontally, swap colour, grow again.
        const n = last.flips.length;
        const t = clamp01((f.anim - (flipping.get(sq) / Math.max(1, n)) * 0.4) / 0.6);
        const shown = t < 0.5 ? prev[sq] : seat;
        drawDisc(ctx, sq, shown === -1 ? seat : shown, Math.abs(Math.cos(t * Math.PI)));
      } else drawDisc(ctx, sq, seat);
    }

    // Legal move dots for the player to move.
    if (f.myTurn && !flipping) {
      ctx.fillStyle = f.you === 0 ? 'rgba(10,10,20,0.55)' : 'rgba(255,255,255,0.45)';
      for (const m of f.legal) {
        circle(ctx, cx(m.sq), cy(m.sq), 9);
        ctx.fill();
      }
    }
    const target = f.cursor ? f.cursor.row * 8 + f.cursor.col : f.hover;
    if (target !== null && target !== undefined) {
      const legal = f.myTurn && f.legal.some((m) => m.sq === target);
      if (legal && !f.cursor) {
        ctx.save();
        ctx.globalAlpha = 0.45;
        drawDisc(ctx, target, f.you);
        ctx.restore();
      }
      if (f.cursor) {
        roundRect(ctx, X0 + (target % 8) * CELL + 4, Y0 + Math.floor(target / 8) * CELL + 4, CELL - 8, CELL - 8, 10);
        ctx.strokeStyle = '#ffe14d';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    }
    // Mark the last placed disc.
    if (last && !flipping) {
      circle(ctx, cx(last.sq), cy(last.sq), 5);
      ctx.fillStyle = '#e63946';
      ctx.fill();
    }

    // Coordinates
    ctx.fillStyle = '#f4e4c8';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 8; i++) {
      ctx.fillText(FILES[i], X0 + i * CELL + CELL / 2, Y0 + SIZE * CELL + 24);
      ctx.fillText(String(8 - i), X0 - 24, Y0 + i * CELL + CELL / 2);
    }
  },
});
