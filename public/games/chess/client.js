// Schaken: select a piece to see where it may go, click the target square.
// Promotion choice appears in the side panel. The board turns for black.
import { createBoardModule } from '../board/kit.js';
import { h } from '../../js/core/ui.js';
import { THEME, glow, clearBoard, roundRect, circle, clamp01, easeInOut, lerp } from '../board/draw.js';
import { Position, sqName, sqFromName, WHITE } from '../../../shared/chess/position.js';
import { drawPiece } from './pieces.js';

const W = 760;
const CELL = 84;
const X0 = (W - CELL * 8) / 2;
const Y0 = X0;
const LIGHT = '#3a3a6e';
const DARK = '#23234a';
const PROMO = [['q', 'Dame'], ['r', 'Toren'], ['b', 'Loper'], ['n', 'Paard']];

// 0x88 square → screen centre (board flipped for black).
function pos(sq, flip) {
  let file = sq & 7;
  let rank = sq >> 4;
  if (flip) { file = 7 - file; rank = 7 - rank; }
  return { x: X0 + file * CELL + CELL / 2, y: Y0 + (7 - rank) * CELL + CELL / 2 };
}

// Parse a FEN once and reuse it while it does not change.
const cache = new Map();
function parse(fen) {
  let p = cache.get(fen);
  if (!p) {
    p = new Position(fen);
    if (cache.size > 8) cache.delete(cache.keys().next().value);
    cache.set(fen, p);
  }
  return p;
}

const reset = (local) => { local.sel = null; local.promo = null; };

export const { meta, createGame } = createBoardModule({
  id: 'chess',
  width: W,
  height: W,

  seatLabel: (seat) => (seat === 0 ? 'Wit' : 'Zwart'),
  seatIcon: (seat) => (seat === 0 ? '○' : '●'),
  initLocal: () => ({ sel: null, promo: null }),
  onChange: reset,
  onReset: reset,
  onCancel: reset,

  cursor: {
    cols: 8,
    rows: 8,
    target: (col, row, f) => (f.you === 1 ? row * 16 + (7 - col) : (7 - row) * 16 + col),
  },

  pick(x, y, f) {
    let file = Math.floor((x - X0) / CELL);
    let rank = 7 - Math.floor((y - Y0) / CELL);
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    if (f.you === 1) { file = 7 - file; rank = 7 - rank; }
    return rank * 16 + file;
  },

  onPick(sq, api, f) {
    if (!f.myTurn) return;
    const local = f.local;
    const name = sqName(sq);
    const from = local.sel === null ? null : sqName(local.sel);
    const targets = from ? f.legal.filter((m) => m.from === from && m.to === name) : [];
    if (targets.length === 1) {
      api.move(targets[0]);
      reset(local);
    } else if (targets.length > 1) {
      local.promo = { from, to: name }; // several promotion pieces: ask in the panel
      api.refresh();
    } else {
      local.sel = f.legal.some((m) => m.from === name) && local.sel !== sq ? sq : null;
      local.promo = null;
      api.refresh();
    }
  },

  describe: (last, f) => `${f.nameOf(last.seat)} speelde ${last.info.san}.${last.info.check && !f.snap.result ? ' Schaak!' : ''}`,
  animMs: () => 260,
  sound: (last) => (last.info.check ? 'countdown' : last.info.capture ? 'hit' : 'click'),
  turnText: (f) => (f.view.check ? 'Jouw beurt – je staat schaak!' : 'Jouw beurt!'),

  panel(el, f, api) {
    if (f.local.promo) {
      const row = h('div', { class: 'promo', role: 'group', 'aria-label': 'Promoveer naar' },
        ...PROMO.map(([p, label]) => h('button', {
          class: 'btn', type: 'button', 'data-key': `promo-${p}`,
          onclick: () => {
            api.move({ ...f.local.promo, promo: p });
            reset(f.local);
            api.refresh();
          },
        }, label)));
      el.append(h('p', { class: 'bp__ask' }, 'Promoveer je pion naar:'), row);
      queueMicrotask(() => row.querySelector('button')?.focus());
    }
    const moves = f.view.moves;
    if (moves.length) {
      const list = h('ol', { class: 'movelist', 'aria-label': 'Gespeelde zetten' });
      const start = Math.max(0, moves.length - 16) & ~1;
      for (let i = start; i < moves.length; i += 2) {
        list.append(h('li', { value: String(i / 2 + 1) }, moves[i], moves[i + 1] ? `  ${moves[i + 1]}` : ''));
      }
      el.append(list);
    }
  },

  draw(ctx, f) {
    const flip = f.you === 1;
    const board = parse(f.view.fen);
    const prevBoard = parse(f.prev.fen);
    clearBoard(ctx, W, W);
    roundRect(ctx, X0 - 14, Y0 - 14, CELL * 8 + 28, CELL * 8 + 28, 16);
    ctx.fillStyle = '#15153a';
    ctx.fill();
    glow(ctx, THEME.pink, 12, () => {
      ctx.strokeStyle = THEME.pink;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? LIGHT : DARK;
        ctx.fillRect(X0 + c * CELL, Y0 + r * CELL, CELL, CELL);
      }
    }

    const last = f.last?.info;
    const tint = (sq, color) => {
      const p = pos(sq, flip);
      ctx.fillStyle = color;
      ctx.fillRect(p.x - CELL / 2, p.y - CELL / 2, CELL, CELL);
    };
    if (last) {
      tint(sqFromName(last.from), 'rgba(255,225,77,0.22)');
      tint(sqFromName(last.to), 'rgba(255,225,77,0.32)');
    }
    // King in check
    if (f.view.check) {
      const k = pos(board.kings[board.side], flip);
      const g = ctx.createRadialGradient(k.x, k.y, 4, k.x, k.y, CELL * 0.6);
      g.addColorStop(0, 'rgba(255,92,122,0.9)');
      g.addColorStop(1, 'rgba(255,92,122,0)');
      ctx.fillStyle = g;
      ctx.fillRect(k.x - CELL / 2, k.y - CELL / 2, CELL, CELL);
    }
    if (f.local.sel !== null) tint(f.local.sel, 'rgba(62,240,255,0.3)');

    // Pieces (during the animation: the old board, with the mover sliding)
    const animating = last && f.anim < 1;
    const src = animating ? prevBoard : board;
    const fromSq = animating ? sqFromName(last.from) : -1;
    const toSq = animating ? sqFromName(last.to) : -1;
    let rookFrom = -1;
    let rookTo = -1;
    if (animating && last.castle) {
      rookFrom = last.castle === 'K' ? fromSq + 3 : fromSq - 4;
      rookTo = last.castle === 'K' ? fromSq + 1 : fromSq - 1;
    }
    const epSq = animating && last.ep ? toSq + (prevBoard.side === WHITE ? -16 : 16) : -1;
    const size = CELL * 0.9;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const piece = src.board[sq];
      if (!piece || sq === fromSq || sq === rookFrom) continue;
      const p = pos(sq, flip);
      const fading = animating && (sq === toSq || sq === epSq);
      drawPiece(ctx, piece, p.x, p.y + 2, size, fading ? 1 - clamp01(f.anim * 1.5) : 1);
    }
    if (animating) {
      const k = easeInOut(f.anim);
      const slide = (a, b, piece) => {
        const pa = pos(a, flip);
        const pb = pos(b, flip);
        drawPiece(ctx, piece, lerp(pa.x, pb.x, k), lerp(pa.y, pb.y, k) + 2, size);
      };
      if (rookFrom >= 0) slide(rookFrom, rookTo, prevBoard.board[rookFrom]);
      slide(fromSq, toSq, prevBoard.board[fromSq]);
    }

    // Legal targets of the selected piece
    if (f.local.sel !== null && f.myTurn && !animating) {
      const from = sqName(f.local.sel);
      for (const m of f.legal) {
        if (m.from !== from) continue;
        const sq = sqFromName(m.to);
        const p = pos(sq, flip);
        if (board.board[sq]) {
          circle(ctx, p.x, p.y, CELL * 0.44);
          ctx.strokeStyle = 'rgba(93,255,138,0.85)';
          ctx.lineWidth = 5;
          ctx.stroke();
        } else {
          circle(ctx, p.x, p.y, 11);
          ctx.fillStyle = 'rgba(93,255,138,0.75)';
          ctx.fill();
        }
      }
    }
    // Hover on a movable piece
    if (f.hover !== null && f.hover !== undefined && f.myTurn && f.local.sel === null) {
      if (f.legal.some((m) => m.from === sqName(f.hover))) {
        const p = pos(f.hover, flip);
        roundRect(ctx, p.x - CELL / 2 + 3, p.y - CELL / 2 + 3, CELL - 6, CELL - 6, 8);
        ctx.strokeStyle = 'rgba(62,240,255,0.7)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
    if (f.cursor) {
      roundRect(ctx, X0 + f.cursor.col * CELL + 3, Y0 + f.cursor.row * CELL + 3, CELL - 6, CELL - 6, 8);
      ctx.strokeStyle = THEME.yellow;
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    // Coordinates
    ctx.fillStyle = THEME.muted;
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 8; i++) {
      const file = flip ? 7 - i : i;
      const rank = flip ? i + 1 : 8 - i;
      ctx.fillText('abcdefgh'[file], X0 + i * CELL + CELL / 2, Y0 + 8 * CELL + 26);
      ctx.fillText(String(rank), X0 - 26, Y0 + i * CELL + CELL / 2);
    }
  },
});
