// Dammen (10×10): select a piece, click where it should go; the piece walks
// its capture path and the captured pieces vanish at the end.
import { createBoardModule } from '../board/kit.js';
import { THEME, glow, clearBoard, roundRect, disc, circle, clamp01, easeInOut, lerp } from '../board/draw.js';
import { rc, sqAt, owner, isKing, EMPTY } from '../../../shared/rules/checkers.js';

const W = 800;
const CELL = 72;
const X0 = (W - CELL * 10) / 2;
const Y0 = X0;
const R = CELL * 0.38;
const COLORS = [
  { fill: '#f2f3ff', rim: '#9aa0c8', ring: '#c9cdf0' },
  { fill: '#1b1b28', rim: '#000', ring: '#3a3a55' },
];

// Screen position of a square; the board is turned around for black.
function pos(sq, flip) {
  let [r, c] = rc(sq);
  if (flip) { r = 9 - r; c = 9 - c; }
  return { x: X0 + c * CELL + CELL / 2, y: Y0 + r * CELL + CELL / 2, r, c };
}

function drawPiece(ctx, x, y, piece, alpha = 1) {
  const col = COLORS[owner(piece)];
  ctx.save();
  ctx.globalAlpha = alpha;
  disc(ctx, x, y, R, col.fill, { rim: col.rim, shine: owner(piece) === 0 ? 0.45 : 0.2 });
  circle(ctx, x, y, R * 0.62);
  ctx.strokeStyle = col.ring;
  ctx.lineWidth = 3;
  ctx.stroke();
  if (isKing(piece)) {
    // Crown
    const s = R * 0.55;
    ctx.beginPath();
    ctx.moveTo(x - s, y + s * 0.45);
    ctx.lineTo(x - s, y - s * 0.35);
    ctx.lineTo(x - s * 0.5, y + s * 0.05);
    ctx.lineTo(x, y - s * 0.6);
    ctx.lineTo(x + s * 0.5, y + s * 0.05);
    ctx.lineTo(x + s, y - s * 0.35);
    ctx.lineTo(x + s, y + s * 0.45);
    ctx.closePath();
    ctx.fillStyle = THEME.yellow;
    ctx.fill();
  }
  ctx.restore();
}

const notation = (m) => m.path.map((s) => s + 1).join(m.caps.length ? 'x' : '-');

// Moves still possible after the squares clicked so far.
function candidates(f) {
  const { sel, route } = f.local;
  return f.legal.filter((m) => m.path[0] === sel && route.every((s, i) => m.path[i + 1] === s));
}

export const { meta, createGame } = createBoardModule({
  id: 'checkers',
  width: W,
  height: W,

  seatLabel: (seat) => (seat === 0 ? 'Wit' : 'Zwart'),
  seatIcon: (seat) => (seat === 0 ? '○' : '●'),
  initLocal: () => ({ sel: null, route: [] }),
  onChange: (local) => { local.sel = null; local.route = []; },
  onReset: (local) => { local.sel = null; local.route = []; },
  onCancel: (local) => { local.sel = null; local.route = []; },

  cursor: {
    cols: 10,
    rows: 10,
    target: (col, row, f) => (f.you === 1 ? sqAt(9 - row, 9 - col) : sqAt(row, col)),
  },

  pick(x, y, f) {
    let c = Math.floor((x - X0) / CELL);
    let r = Math.floor((y - Y0) / CELL);
    if (f.you === 1) { r = 9 - r; c = 9 - c; }
    const sq = sqAt(r, c);
    return sq >= 0 ? sq : null;
  },

  onPick(sq, api, f) {
    if (!f.myTurn || sq < 0) return;
    const local = f.local;
    const startsMove = (s) => f.legal.some((m) => m.path[0] === s);
    if (local.sel === null || sq === local.sel || (startsMove(sq) && local.route.length === 0)) {
      local.route = [];
      local.sel = sq === local.sel ? null : startsMove(sq) ? sq : null;
      return;
    }
    const cand = candidates(f);
    const finals = cand.filter((m) => m.path[m.path.length - 1] === sq && m.path.length > local.route.length + 1);
    if (finals.length === 1) {
      api.move(finals[0]);
      local.sel = null;
      local.route = [];
      return;
    }
    const next = cand.filter((m) => m.path[local.route.length + 1] === sq);
    if (next.length) {
      local.route.push(sq);
      const done = next.filter((m) => m.path.length === local.route.length + 1);
      if (next.length === 1 && done.length === 1) {
        api.move(done[0]);
        local.sel = null;
        local.route = [];
      }
      return;
    }
    local.sel = null;
    local.route = [];
  },

  describe(last, f) {
    const n = last.info.caps.length;
    let text = `${f.nameOf(last.seat)} speelde ${notation(last.info)}`;
    if (n) text += ` en sloeg ${n} ${n === 1 ? 'stuk' : 'stukken'}`;
    if (last.info.promoted) text += ' en kreeg een dam';
    return `${text}.`;
  },
  animMs: (last) => 220 * (last.info.path.length - 1) + 120,
  sound: (last) => (last.info.caps.length ? 'hit' : 'click'),
  turnText: (f) => (f.legal[0]?.caps.length ? `Jouw beurt: slaan is verplicht (${f.legal[0].caps.length}).` : 'Jouw beurt!'),

  draw(ctx, f) {
    const flip = f.you === 1;
    clearBoard(ctx, W, W);
    roundRect(ctx, X0 - 16, Y0 - 16, CELL * 10 + 32, CELL * 10 + 32, 18);
    ctx.fillStyle = '#26264a';
    ctx.fill();
    glow(ctx, THEME.cyan, 12, () => {
      ctx.strokeStyle = THEME.cyan;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    // Squares + numbers
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        const dark = (r + c) % 2 === 1;
        ctx.fillStyle = dark ? '#121230' : '#34345f';
        ctx.fillRect(X0 + c * CELL, Y0 + r * CELL, CELL, CELL);
      }
    }
    for (let sq = 0; sq < 50; sq++) {
      const p = pos(sq, flip);
      ctx.fillStyle = 'rgba(166,171,216,0.45)';
      ctx.fillText(String(sq + 1), p.x - CELL / 2 + 4, p.y - CELL / 2 + 3);
    }

    const last = f.last?.info;
    const animating = last && f.anim < 1;
    const board = animating ? f.prev.board : f.view.board;
    const moving = animating ? last.path[0] : -1;

    for (let sq = 0; sq < 50; sq++) {
      const piece = board[sq];
      if (piece === EMPTY || sq === moving) continue;
      const p = pos(sq, flip);
      const fading = animating && last.caps.includes(sq);
      drawPiece(ctx, p.x, p.y, piece, fading ? 1 - clamp01((f.anim - 0.6) / 0.4) : 1);
    }

    if (animating) {
      // Walk along the path, one segment at a time.
      const segs = last.path.length - 1;
      const t = f.anim * segs;
      const i = Math.min(segs - 1, Math.floor(t));
      const a = pos(last.path[i], flip);
      const b = pos(last.path[i + 1], flip);
      const k = easeInOut(t - i);
      const hop = last.caps.length ? Math.sin(k * Math.PI) * 14 : 0;
      drawPiece(ctx, lerp(a.x, b.x, k), lerp(a.y, b.y, k) - hop, f.prev.board[last.path[0]]);
      return;
    }

    // Last move trail
    if (last) {
      ctx.strokeStyle = 'rgba(255,62,165,0.55)';
      ctx.lineWidth = 4;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      last.path.forEach((s, i) => {
        const p = pos(s, flip);
        if (i) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (f.myTurn) {
      const { sel } = f.local;
      if (sel === null) {
        // Which pieces can move?
        const pulse = f.reduced ? 1 : 0.55 + 0.45 * Math.sin(f.time * 5);
        ctx.strokeStyle = `rgba(93,255,138,${pulse})`;
        ctx.lineWidth = 3;
        for (const s of new Set(f.legal.map((m) => m.path[0]))) {
          const p = pos(s, flip);
          circle(ctx, p.x, p.y, R + 5);
          ctx.stroke();
        }
      } else {
        const p = pos(sel, flip);
        glow(ctx, THEME.yellow, 14, () => {
          circle(ctx, p.x, p.y, R + 5);
          ctx.strokeStyle = THEME.yellow;
          ctx.lineWidth = 4;
          ctx.stroke();
        });
        const cand = candidates(f);
        const step = f.local.route.length + 1;
        for (const s of f.local.route) {
          const q = pos(s, flip);
          circle(ctx, q.x, q.y, 8);
          ctx.fillStyle = THEME.yellow;
          ctx.fill();
        }
        for (const m of cand) {
          const q = pos(m.path[step], flip);
          circle(ctx, q.x, q.y, 11);
          ctx.fillStyle = 'rgba(93,255,138,0.8)';
          ctx.fill();
        }
        // Preview which pieces the hovered move would capture.
        const target = f.hover;
        const preview = cand.find((m) => m.path[m.path.length - 1] === target || m.path[step] === target);
        if (preview) {
          ctx.strokeStyle = THEME.red;
          ctx.lineWidth = 5;
          for (const c of preview.caps) {
            const q = pos(c, flip);
            ctx.beginPath();
            ctx.moveTo(q.x - 14, q.y - 14);
            ctx.lineTo(q.x + 14, q.y + 14);
            ctx.moveTo(q.x + 14, q.y - 14);
            ctx.lineTo(q.x - 14, q.y + 14);
            ctx.stroke();
          }
        }
      }
    }
    if (f.cursor) {
      roundRect(ctx, X0 + f.cursor.col * CELL + 3, Y0 + f.cursor.row * CELL + 3, CELL - 6, CELL - 6, 8);
      ctx.strokeStyle = THEME.yellow;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  },
});
