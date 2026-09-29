// Dammen voor 4 on a wooden cross-shaped board. Every player sees their own
// arm at the bottom. Pieces in the players' colours; select a piece, click
// where it should go (for a long capture also the squares in between).
import { createBoardModule } from '../board/kit.js';
import { roundRect, disc, circle, easeInOut, lerp, woodTable, woodSquare, dropShadow, clamp01 } from '../board/draw.js';
import { SIZE, ARM, EMPTY, idx, onBoard, pieceArm, isKing, rcOf } from '../../../shared/rules/checkers4.js';

const W = 800;
const CELL = 54;
const X0 = (W - CELL * SIZE) / 2;
const Y0 = X0;
const R = CELL * 0.38;
const L = SIZE - 1;

// Board (r, c) → view (vr, vc) so that `arm` sits at the bottom, and back.
function toView(r, c, arm) {
  return arm === 1 ? [L - c, r] : arm === 2 ? [L - r, L - c] : arm === 3 ? [c, L - r] : [r, c];
}
function fromView(vr, vc, arm) {
  return arm === 1 ? [vc, L - vr] : arm === 2 ? [L - vr, L - vc] : arm === 3 ? [L - vc, vr] : [vr, vc];
}

const myArm = (f) => (f.you >= 0 ? f.view.arms[f.you] ?? 0 : 0);
const seatOfArm = (f, arm) => f.view.arms.indexOf(arm);

function pos(sq, arm) {
  const [r, c] = rcOf(sq);
  const [vr, vc] = toView(r, c, arm);
  return { x: X0 + vc * CELL + CELL / 2, y: Y0 + vr * CELL + CELL / 2 };
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round(v * k).toString(16).padStart(2, '0');
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

function drawPiece(ctx, x, y, piece, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  disc(ctx, x, y, R, color, { rim: shade(color, 0.55), shine: 0.35 });
  circle(ctx, x, y, R * 0.62);
  ctx.strokeStyle = shade(color, 0.75);
  ctx.lineWidth = 3;
  ctx.stroke();
  if (isKing(piece)) {
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
    ctx.fillStyle = '#f2c230';
    ctx.fill();
    ctx.strokeStyle = '#8a6a10';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

const coord = (sq) => {
  const [r, c] = rcOf(sq);
  return `${String.fromCharCode(97 + c)}${SIZE - r}`;
};
const notation = (m) => m.path.map(coord).join(m.caps.length ? 'x' : '-');

function candidates(f) {
  const { sel, route } = f.local;
  return f.legal.filter((m) => m.path[0] === sel && route.every((s, i) => m.path[i + 1] === s));
}

const reset = (local) => { local.sel = null; local.route = []; };

export const { meta, createGame } = createBoardModule({
  id: 'checkers4',
  width: W,
  height: W,

  seatLabel: (seat, f) => ['Onder', 'Links', 'Boven', 'Rechts'][f?.view?.arms?.[seat] ?? seat] ?? '',
  seatIcon: () => '●',
  initLocal: () => ({ sel: null, route: [] }),
  onChange: reset,
  onReset: reset,
  onCancel: reset,

  cursor: {
    cols: SIZE,
    rows: SIZE,
    target: (col, row, f) => {
      const [r, c] = fromView(row, col, myArm(f));
      return onBoard(r, c) ? idx(r, c) : null;
    },
  },

  pick(x, y, f) {
    const vc = Math.floor((x - X0) / CELL);
    const vr = Math.floor((y - Y0) / CELL);
    const [r, c] = fromView(vr, vc, myArm(f));
    return onBoard(r, c) ? idx(r, c) : null;
  },

  onPick(sq, api, f) {
    if (!f.myTurn || sq === null) return;
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
      reset(local);
      return;
    }
    const next = cand.filter((m) => m.path[local.route.length + 1] === sq);
    if (next.length) {
      local.route.push(sq);
      const done = next.filter((m) => m.path.length === local.route.length + 1);
      if (next.length === 1 && done.length === 1) {
        api.move(done[0]);
        reset(local);
      }
      return;
    }
    reset(local);
  },

  describe(last, f) {
    const n = last.info.caps.length;
    let text = `${f.nameOf(last.seat)} speelde ${notation(last.info)}`;
    if (n) {
      const who = last.info.victims.map((a) => f.nameOf(seatOfArm(f, a))).join(' en ');
      text += ` en sloeg ${n} ${n === 1 ? 'stuk' : 'stukken'} van ${who}`;
    }
    if (last.info.promoted) text += ' en kreeg een dam';
    for (const s of last.info.out ?? []) text += `. ${f.nameOf(s)} kan niet meer en is af`;
    return `${text}.`;
  },
  animMs: (last) => 200 * (last.info.path.length - 1) + 120,
  sound: (last) => (last.info.caps.length ? 'hit' : 'click'),
  turnText: (f) => (f.legal[0]?.caps.length ? `Jouw beurt: slaan is verplicht (${f.legal[0].caps.length}).` : 'Jouw beurt!'),

  draw(ctx, f) {
    const arm = myArm(f);
    woodTable(ctx, 0, 0, W, W, 'oak');
    // A walnut frame around the cross: two overlapping bars.
    const inner = (SIZE - 2 * ARM) * CELL;
    const B = 12;
    const bars = [[X0 + ARM * CELL - B, Y0 - B, inner + 2 * B, SIZE * CELL + 2 * B], [X0 - B, Y0 + ARM * CELL - B, SIZE * CELL + 2 * B, inner + 2 * B]];
    for (const [x, y, w, h] of bars) dropShadow(ctx, x, y, w, h, 8);
    for (const [x, y, w, h] of bars) woodTable(ctx, x, y, w, h, 'walnut', 26);
    for (let vr = 0; vr < SIZE; vr++) {
      for (let vc = 0; vc < SIZE; vc++) {
        const [r, c] = fromView(vr, vc, arm);
        const cornerR = r < ARM || r >= SIZE - ARM;
        const cornerC = c < ARM || c >= SIZE - ARM;
        if (cornerR && cornerC) continue;
        woodSquare(ctx, X0 + vc * CELL, Y0 + vr * CELL, CELL, (r + c) % 2 === 0, r * SIZE + c);
      }
    }
    // A band in each player's colour along the outer edge of their arm.
    f.view.arms.forEach((a, seat) => {
      // The arm's outer edge in view coordinates: 'bottom' for your own arm.
      const [vr, vc] = toView(a === 0 ? L : a === 2 ? 0 : SIZE / 2, a === 1 ? 0 : a === 3 ? L : SIZE / 2, arm);
      ctx.fillStyle = f.colorOf(seat);
      ctx.globalAlpha = f.view.out.includes(seat) ? 0.25 : 0.9;
      const len = inner;
      const t = 6;
      if (vr === L) ctx.fillRect(X0 + ARM * CELL, Y0 + SIZE * CELL + 3, len, t);
      else if (vr === 0) ctx.fillRect(X0 + ARM * CELL, Y0 - 3 - t, len, t);
      else if (vc === 0) ctx.fillRect(X0 - 3 - t, Y0 + ARM * CELL, t, len);
      else ctx.fillRect(X0 + SIZE * CELL + 3, Y0 + ARM * CELL, t, len);
      ctx.globalAlpha = 1;
    });

    const last = f.last?.info;
    const animating = last && f.anim < 1;
    const board = animating ? f.prev.board : f.view.board;
    const moving = animating ? last.path[0] : -1;
    const colorOfPiece = (p) => f.colorOf(seatOfArm(f, pieceArm(p)));

    for (let i = 0; i < board.length; i++) {
      const piece = board[i];
      if (piece === EMPTY || i === moving) continue;
      const p = pos(i, arm);
      const fading = animating && last.caps.includes(i);
      drawPiece(ctx, p.x, p.y, piece, colorOfPiece(piece), fading ? 1 - clamp01((f.anim - 0.6) / 0.4) : 1);
    }

    if (animating) {
      const segs = last.path.length - 1;
      const t = f.anim * segs;
      const i = Math.min(segs - 1, Math.floor(t));
      const a = pos(last.path[i], arm);
      const b = pos(last.path[i + 1], arm);
      const k = easeInOut(t - i);
      const hop = last.caps.length ? Math.sin(k * Math.PI) * 12 : 0;
      const piece = f.prev.board[last.path[0]];
      drawPiece(ctx, lerp(a.x, b.x, k), lerp(a.y, b.y, k) - hop, piece, colorOfPiece(piece));
      return;
    }

    if (last) {
      ctx.strokeStyle = 'rgba(255, 210, 62, 0.6)';
      ctx.lineWidth = 4;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      last.path.forEach((s, i) => {
        const p = pos(s, arm);
        if (i) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (f.myTurn) {
      const { sel } = f.local;
      if (sel === null) {
        const pulse = f.reduced ? 1 : 0.55 + 0.45 * Math.sin(f.time * 5);
        ctx.strokeStyle = `rgba(93,255,138,${pulse})`;
        ctx.lineWidth = 3;
        for (const s of new Set(f.legal.map((m) => m.path[0]))) {
          const p = pos(s, arm);
          circle(ctx, p.x, p.y, R + 4);
          ctx.stroke();
        }
      } else {
        const p = pos(sel, arm);
        circle(ctx, p.x, p.y, R + 4);
        ctx.strokeStyle = '#ffd23e';
        ctx.lineWidth = 4;
        ctx.stroke();
        const cand = candidates(f);
        const step = f.local.route.length + 1;
        for (const s of f.local.route) {
          const q = pos(s, arm);
          circle(ctx, q.x, q.y, 7);
          ctx.fillStyle = '#ffd23e';
          ctx.fill();
        }
        for (const m of cand) {
          const q = pos(m.path[step], arm);
          circle(ctx, q.x, q.y, 10);
          ctx.fillStyle = 'rgba(93,255,138,0.8)';
          ctx.fill();
        }
        const preview = cand.find((m) => m.path[m.path.length - 1] === f.hover || m.path[step] === f.hover);
        if (preview) {
          ctx.strokeStyle = '#e63946';
          ctx.lineWidth = 4;
          for (const c of preview.caps) {
            const q = pos(c, arm);
            ctx.beginPath();
            ctx.moveTo(q.x - 12, q.y - 12);
            ctx.lineTo(q.x + 12, q.y + 12);
            ctx.moveTo(q.x + 12, q.y - 12);
            ctx.lineTo(q.x - 12, q.y + 12);
            ctx.stroke();
          }
        }
      }
    }
    if (f.cursor) {
      roundRect(ctx, X0 + f.cursor.col * CELL + 3, Y0 + f.cursor.row * CELL + 3, CELL - 6, CELL - 6, 7);
      ctx.strokeStyle = '#ffd23e';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  },
});
