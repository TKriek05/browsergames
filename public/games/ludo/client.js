// Erger je niet!: classic cross-shaped board in the players' colours. Roll
// with the button (or space), then click a ringed pawn (or press 1-4).
import { createBoardModule } from '../board/kit.js';
import { h } from '../../js/core/ui.js';
import { roundRect, circle, clamp01, lerp, woodTable, dropShadow } from '../board/draw.js';
import { TRACK, abs } from '../../../shared/rules/ludo.js';

const W = 770;
const CELL = 70;
const R = CELL * 0.36;

// The 40 track cells (col, row) on an 11×11 grid, clockwise from quadrant 0's start.
const TRACK_CELLS = [
  [0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [4, 3], [4, 2], [4, 1], [4, 0], [5, 0],
  [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [10, 5],
  [10, 6], [9, 6], [8, 6], [7, 6], [6, 6], [6, 7], [6, 8], [6, 9], [6, 10], [5, 10],
  [4, 10], [4, 9], [4, 8], [4, 7], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 5],
];
const LANES = [
  [[1, 5], [2, 5], [3, 5], [4, 5]],
  [[5, 1], [5, 2], [5, 3], [5, 4]],
  [[9, 5], [8, 5], [7, 5], [6, 5]],
  [[5, 9], [5, 8], [5, 7], [5, 6]],
];
const BASES = [
  [[0.5, 0.5], [1.5, 0.5], [0.5, 1.5], [1.5, 1.5]],
  [[8.5, 0.5], [9.5, 0.5], [8.5, 1.5], [9.5, 1.5]],
  [[8.5, 8.5], [9.5, 8.5], [8.5, 9.5], [9.5, 9.5]],
  [[0.5, 8.5], [1.5, 8.5], [0.5, 9.5], [1.5, 9.5]],
];

const px = (col) => col * CELL + CELL / 2;

// Screen position of a pawn (relative position `pos`) of a player in quadrant `quad`.
function pawnXY(quad, pos, pawn) {
  if (pos < 0) {
    const [c, r] = BASES[quad][pawn];
    return { x: px(c), y: px(r) };
  }
  const [c, r] = pos >= TRACK ? LANES[quad][pos - TRACK] : TRACK_CELLS[abs(quad, pos)];
  return { x: px(c), y: px(r) };
}

function drawPawn(ctx, x, y, color, { ring = false, pulse = 1, alpha = 1 } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (ring) {
    circle(ctx, x, y, R + 6);
    ctx.strokeStyle = `rgba(40,30,20,${pulse})`;
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  // Pawn seen from above-ish: base + head.
  circle(ctx, x, y + 4, R * 0.95);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  circle(ctx, x, y, R * 0.9);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.stroke();
  circle(ctx, x, y - 3, R * 0.45);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();
  ctx.restore();
}

// Cells a pawn visits while moving from → to (for the hop animation).
function route(quad, from, to, pawn) {
  if (from < 0) return [pawnXY(quad, -1, pawn), pawnXY(quad, 0, pawn)];
  const out = [];
  for (let p = from; p <= to; p++) out.push(pawnXY(quad, p, pawn));
  return out;
}

const seatOfQuad = (view, quad) => view.quad.indexOf(quad);

export const { meta, createGame } = createBoardModule({
  id: 'ludo',
  width: W,
  height: W,

  seatLabel: (seat, f) => f.colorNameOf(seat),
  seatIcon: () => '●',

  pick(x, y, f) {
    if (!f.myTurn || f.view.phase !== 'move') return null;
    // Nearest movable pawn under the pointer.
    for (const m of f.legal) {
      const p = pawnXY(f.view.quad[f.you], f.view.pawns[f.you][m.pawn], m.pawn);
      if ((p.x - x) ** 2 + (p.y - y) ** 2 < (R + 8) ** 2) return m.pawn;
    }
    return null;
  },

  onPick(pawn, api, f) {
    if (f.legal.some((m) => m.pawn === pawn)) api.move({ type: 'move', pawn });
  },

  onKey(key, api, f) {
    if (!f.myTurn) return false;
    if ((key === ' ' || key === 'Enter') && f.view.phase === 'roll') {
      api.move({ type: 'roll' });
      return true;
    }
    const n = Number(key) - 1;
    if (n >= 0 && n < 4 && f.legal.some((m) => m.pawn === n)) {
      api.move({ type: 'move', pawn: n });
      return true;
    }
    return false;
  },

  describe(last, f) {
    const who = f.nameOf(last.seat);
    const i = last.info;
    if (i.roll !== undefined) {
      let t = `${who} gooide ${i.roll}.`;
      if (i.pass) t += i.again ? ' Nog een keer!' : ' Geen zet mogelijk.';
      return t;
    }
    let t = `${who} zette pion ${i.pawn + 1} ${i.from < 0 ? 'op het bord' : `${i.die} vooruit`}`;
    if (i.captured) t += ` en sloeg ${f.nameOf(i.captured.seat)} terug naar huis!`;
    return `${t}.${i.again ? ' Nog een keer gooien.' : ''}`;
  },
  animMs: (last) => (last.info.roll !== undefined ? 0 : last.info.from < 0 ? 350 : 110 * last.info.die + 100),
  sound: (last) => (last.info.roll !== undefined ? 'react' : last.info.captured ? 'tag' : 'click'),
  turnText: (f) => (f.view.phase === 'roll' ? 'Jouw beurt: gooi de dobbelsteen!' : 'Kies een pion.'),

  panel(el, f, api) {
    const v = f.view;
    const lastRoll = f.last?.info?.roll ?? f.last?.info?.die ?? null;
    const die = h('div', { class: `die ${f.last?.info?.roll !== undefined && f.anim < 1 ? 'is-rolling' : ''}`, 'aria-label': lastRoll ? `Laatste worp: ${lastRoll}` : 'Nog niet gegooid' }, lastRoll ? String(lastRoll) : '–');
    const row = h('div', { class: 'dice-row' }, die);
    if (f.myTurn && v.phase === 'roll') {
      row.append(h('button', { class: 'btn btn--primary', type: 'button', 'data-key': 'roll', onclick: () => api.move({ type: 'roll' }) }, v.tries ? `Nog eens (${v.tries + 1}/3)` : 'Gooi!'));
    }
    el.append(row);
    if (f.myTurn && v.phase === 'move') {
      el.append(h('div', { class: 'promo', role: 'group', 'aria-label': 'Kies een pion' },
        ...f.legal.map((m) => h('button', { class: 'btn', type: 'button', 'data-key': `pawn-${m.pawn}`, onclick: () => api.move(m) },
          `Pion ${m.pawn + 1}${v.pawns[f.you][m.pawn] < 0 ? ' (eruit)' : ''}`))));
    }
  },

  draw(ctx, f) {
    const v = f.view;
    // A classic cardboard board on the table.
    woodTable(ctx, 0, 0, W, W, 'oak');
    dropShadow(ctx, 4, 4, W - 8, W - 8, 10);
    roundRect(ctx, 4, 4, W - 8, W - 8, 10);
    ctx.fillStyle = '#f3e3b5';
    ctx.fill();
    ctx.strokeStyle = '#8a6a3a';
    ctx.lineWidth = 3;
    ctx.stroke();

    const quadColor = (q) => {
      const seat = seatOfQuad(v, q);
      return seat >= 0 ? f.colorOf(seat) : '#b8a888';
    };
    // Bases
    BASES.forEach((cells, q) => {
      const [c0, r0] = cells[0];
      const pad = R + 12;
      roundRect(ctx, px(c0) - pad, px(r0) - pad, CELL + pad * 2, CELL + pad * 2, 18);
      ctx.fillStyle = quadColor(q);
      ctx.globalAlpha = 0.45;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#3a2a1c';
      ctx.lineWidth = 2;
      ctx.stroke();
      for (const [c, r] of cells) {
        circle(ctx, px(c), px(r), R);
        ctx.fillStyle = '#fbf4e0';
        ctx.fill();
        ctx.strokeStyle = '#3a2a1c';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
    // Track + start squares
    TRACK_CELLS.forEach(([c, r], i) => {
      const start = i % 10 === 0;
      circle(ctx, px(c), px(r), R + 2);
      ctx.fillStyle = start ? quadColor(i / 10) : '#fbf4e0';
      ctx.fill();
      ctx.strokeStyle = '#3a2a1c';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    // Home lanes
    LANES.forEach((cells, q) => {
      for (const [c, r] of cells) {
        circle(ctx, px(c), px(r), R + 2);
        ctx.fillStyle = quadColor(q);
        ctx.globalAlpha = 0.75;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#3a2a1c';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
    // Centre star
    // Centre: four coloured triangles
    for (let q = 0; q < 4; q++) {
      const a = (q / 4) * Math.PI * 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(px(5), px(5));
      ctx.arc(px(5), px(5), R * 1.2, a - Math.PI / 4 - Math.PI / 2, a - Math.PI / 4);
      ctx.closePath();
      ctx.fillStyle = quadColor(q);
      ctx.fill();
    }

    // Pawns
    const last = f.last?.info;
    const animating = last && last.pawn !== undefined && f.anim < 1;
    const pulse = f.reduced ? 1 : 0.55 + 0.45 * Math.sin(f.time * 6);
    const movable = new Set(f.myTurn && v.phase === 'move' ? f.legal.map((m) => m.pawn) : []);
    v.pawns.forEach((pawns, seat) => {
      pawns.forEach((pos, pawn) => {
        const moving = animating && seat === f.last.seat && pawn === last.pawn;
        const captured = animating && last.captured && last.captured.seat === seat && last.captured.pawn === pawn;
        if (moving) return;
        let p = pawnXY(v.quad[seat], pos, pawn);
        if (captured) {
          // Still on the board until the attacker arrives, then flies home.
          const from = pawnXY(v.quad[seat], f.prev.pawns[seat][pawn], pawn);
          const t = clamp01((f.anim - 0.8) / 0.2);
          p = { x: lerp(from.x, p.x, t), y: lerp(from.y, p.y, t) };
        }
        drawPawn(ctx, p.x, p.y, f.colorOf(seat), { ring: seat === f.you && movable.has(pawn), pulse });
      });
    });
    if (animating) {
      const seat = f.last.seat;
      const pts = route(v.quad[seat], last.from, last.to, last.pawn);
      const t = f.anim * (pts.length - 1);
      const i = Math.min(pts.length - 2, Math.floor(t));
      const k = t - i;
      const hop = Math.sin(k * Math.PI) * 14;
      drawPawn(ctx, lerp(pts[i].x, pts[i + 1].x, k), lerp(pts[i].y, pts[i + 1].y, k) - hop, f.colorOf(seat));
    }
    // Hover
    if (f.hover !== null && f.hover !== undefined && movable.has(f.hover)) {
      const p = pawnXY(v.quad[f.you], v.pawns[f.you][f.hover], f.hover);
      circle(ctx, p.x, p.y, R + 10);
      ctx.strokeStyle = '#3a2a1c';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  },
});
