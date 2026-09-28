// Onthoud 'm: a grid of cards that flip in 3D-ish (horizontal squeeze),
// pairs get the finder's colour, the last mismatch stays visible until the
// next flip.
import { createBoardModule } from '../board/kit.js';
import { THEME, clearBoard, roundRect, easeOutCubic, clamp01 } from '../board/draw.js';
import { SYMBOLS, blitSymbol } from './symbols.js';

const W = 720;
const H = 540;
const GAP = 12;
const layout = { cols: 6, rows: 4, cw: 100, ch: 120, x0: 0, y0: 0 };

function fit(view) {
  layout.cols = view.cols;
  layout.rows = view.rows;
  const maxW = (W - 60 - (view.cols - 1) * GAP) / view.cols;
  const maxH = (H - 60 - (view.rows - 1) * GAP) / view.rows;
  layout.ch = Math.min(maxH, maxW * 1.25);
  layout.cw = layout.ch / 1.25;
  layout.x0 = (W - (layout.cw * view.cols + GAP * (view.cols - 1))) / 2;
  layout.y0 = (H - (layout.ch * view.rows + GAP * (view.rows - 1))) / 2;
}

const cardRect = (c) => {
  const col = c % layout.cols;
  const row = Math.floor(c / layout.cols);
  return { x: layout.x0 + col * (layout.cw + GAP), y: layout.y0 + row * (layout.ch + GAP) };
};

function drawBack(ctx, x, y, w, h, t) {
  roundRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = '#2a1f5e';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(199,125,255,0.35)';
  ctx.lineWidth = 2;
  for (let k = -h; k < w + h; k += 14) {
    ctx.beginPath();
    ctx.moveTo(x + k, y);
    ctx.lineTo(x + k - h, y + h);
    ctx.stroke();
  }
  ctx.restore();
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 10);
  ctx.strokeStyle = THEME.pink;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.7 + Math.sin(t * 2 + x * 0.02) * 0.1;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawFace(ctx, x, y, w, h, sym, rim) {
  roundRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = '#10102a';
  ctx.fill();
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 10);
  ctx.strokeStyle = rim;
  ctx.lineWidth = rim === THEME.line ? 2 : 4;
  ctx.stroke();
  blitSymbol(ctx, sym, x + w / 2, y + h / 2, Math.min(w, h) * 0.62);
}

export const { meta, createGame } = createBoardModule({
  id: 'memory',
  width: W,
  height: H,

  seatLabel: (seat, f) => `${f.view.scores[seat] ?? 0} ${f.view.scores[seat] === 1 ? 'paar' : 'paren'}`,

  cursor: {
    get cols() { return layout.cols; },
    get rows() { return layout.rows; },
    target: (col, row) => row * layout.cols + col,
  },

  pick(x, y) {
    for (let c = 0; c < layout.cols * layout.rows; c++) {
      const r = cardRect(c);
      if (x >= r.x && x <= r.x + layout.cw && y >= r.y && y <= r.y + layout.ch) return c;
    }
    return null;
  },

  onPick(c, api, f) {
    if (f.myTurn && f.legal.some((m) => m.c === c)) api.move({ c });
  },

  // Cards that were visible before this move and are hidden now flip back.
  initLocal: () => ({ hideFrom: [], hideAt: 0 }),
  onChange(local, f) {
    const now = f.view.cards;
    const before = f.prev.cards;
    local.hideFrom = before ? before.map((s, c) => (s !== null && now[c] === null ? c : -1)).filter((c) => c >= 0) : [];
    local.hideAt = f.time;
  },

  describe(last, f) {
    const sym = SYMBOLS[last.info.sym]?.name ?? 'kaart';
    const tail = last.info.match === true ? ' Een paar!' : last.info.match === false ? ' Geen paar.' : '';
    return `${f.nameOf(last.seat)} draait een ${sym} om.${tail}`;
  },
  animMs: () => 260,
  sound: (last) => (last.info.match === true ? 'coin' : last.info.match === false ? 'error' : 'click'),
  turnText: (f) => (f.view.open.length === 1 ? 'Kies de tweede kaart!' : 'Jouw beurt: draai een kaart om.'),

  draw(ctx, f) {
    const v = f.view;
    fit(v);
    clearBoard(ctx, W, H);
    const lastC = f.last?.info?.c;
    const hideT = f.reduced ? 1 : clamp01((f.time - f.local.hideAt) / 0.25);
    for (let c = 0; c < v.cards.length; c++) {
      const { x, y } = cardRect(c);
      const w = layout.cw;
      const h = layout.ch;
      const sym = v.cards[c];
      // Flip: squeeze horizontally to 0 and open up again.
      let squeeze = 1;
      let showFace = sym !== null;
      if (c === lastC && f.anim < 1 && sym !== null) {
        const t = easeOutCubic(f.anim);
        squeeze = Math.abs(t * 2 - 1);
        showFace = t > 0.5;
      } else if (sym === null && f.local.hideFrom.includes(c) && hideT < 1) {
        squeeze = Math.abs(hideT * 2 - 1);
        showFace = hideT < 0.5;
      }
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.scale(Math.max(0.02, squeeze), 1);
      ctx.translate(-(x + w / 2), -(y + h / 2));
      const faceSym = sym ?? f.prev.cards?.[c] ?? null;
      if (showFace && faceSym !== null) {
        const owner = v.owner[c];
        const rim = owner >= 0 ? f.colorOf(owner) : v.shown.includes(c) ? THEME.red : THEME.cyan;
        if (owner >= 0) ctx.globalAlpha = 0.8;
        drawFace(ctx, x, y, w, h, faceSym, rim);
        ctx.globalAlpha = 1;
      } else {
        drawBack(ctx, x, y, w, h, f.time);
      }
      ctx.restore();

      const hovered = f.cursor ? f.cursor.row * layout.cols + f.cursor.col === c : f.hover === c;
      if (hovered && f.myTurn && v.owner[c] === -1 && sym === null) {
        roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 12);
        ctx.strokeStyle = THEME.yellow;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
  },
});
