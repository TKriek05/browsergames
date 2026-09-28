// Ganzenbord: 63 squares in a spiral (9×7 grid, filled from the outside in),
// own drawings for the goose and the special squares. Pawns hop square by square.
import { createBoardModule } from '../board/kit.js';
import { h } from '../../js/core/ui.js';
import { roundRect, circle, clamp01, lerp, woodTable, dropShadow } from '../board/draw.js';

const INK = '#4a2e18'; // sepia ink on parchment
import { GEESE, SPECIAL, FINISH } from '../../../shared/rules/goose.js';

const W = 920;
const H = 760;
const COLS = 9;
const ROWS = 7;
const CELL = 90;
const X0 = (W - COLS * CELL) / 2;
const Y0 = 24;
const START = { x: X0 + 60, y: Y0 + ROWS * CELL + 58 };

// Spiral order: bottom row left→right, up the right side, … ending in the middle.
const SPIRAL = (() => {
  const cells = [];
  let top = 0, bottom = ROWS - 1, left = 0, right = COLS - 1;
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) cells.push([c, bottom]);
    bottom--;
    for (let r = bottom; r >= top; r--) cells.push([right, r]);
    right--;
    if (top <= bottom) { for (let c = right; c >= left; c--) cells.push([c, top]); top++; }
    if (left <= right) { for (let r = top; r <= bottom; r++) cells.push([left, r]); left++; }
  }
  return cells;
})();

const cellXY = (sq) => {
  if (sq <= 0) return { x: START.x, y: START.y };
  const [c, r] = SPIRAL[sq - 1];
  return { x: X0 + c * CELL + CELL / 2, y: Y0 + r * CELL + CELL / 2 };
};

// Up to 6 pawns share a square: small offsets.
const OFFSETS = [[-18, -14], [18, -14], [-18, 14], [18, 14], [0, -26], [0, 26]];
const pawnXY = (sq, seat) => {
  const p = cellXY(sq);
  const [dx, dy] = OFFSETS[seat % 6];
  return sq <= 0 ? { x: p.x + seat * 34, y: p.y } : { x: p.x + dx, y: p.y + dy };
};

function drawGoose(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  // Outline first (sepia), then the white goose on top.
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.ellipse(-2, 6, 14.5, 10.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(6, 2);
  ctx.quadraticCurveTo(14, -6, 9, -16);
  ctx.lineWidth = 8;
  ctx.stroke();
  circle(ctx, 9, -17, 6);
  ctx.fill();
  ctx.fillStyle = '#fbf8f0';
  ctx.beginPath();
  ctx.ellipse(-2, 6, 13, 9, 0, 0, Math.PI * 2); // body
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(6, 2);
  ctx.quadraticCurveTo(14, -6, 9, -16); // neck
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#fbf8f0';
  ctx.stroke();
  circle(ctx, 9, -17, 4.5); // head
  ctx.fill();
  ctx.fillStyle = '#ff9a3e';
  ctx.beginPath(); // beak
  ctx.moveTo(12, -18);
  ctx.lineTo(19, -16);
  ctx.lineTo(12, -14);
  ctx.fill();
  ctx.fillStyle = '#10102a';
  circle(ctx, 10, -18, 1.2);
  ctx.fill();
  ctx.restore();
}

function drawSpecial(ctx, sq, x, y) {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 3;
  switch (sq) {
    case 6: // bridge
      ctx.beginPath();
      ctx.arc(x, y + 14, 20, Math.PI, 0);
      ctx.stroke();
      ctx.fillRect(x - 24, y + 12, 48, 4);
      break;
    case 19: // inn: a little house
      ctx.beginPath();
      ctx.moveTo(x - 16, y);
      ctx.lineTo(x, y - 14);
      ctx.lineTo(x + 16, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - 12, y, 24, 16);
      ctx.fillStyle = '#f1e3c0';
      ctx.fillRect(x - 4, y + 5, 8, 11);
      break;
    case 31: // well
      ctx.beginPath();
      ctx.ellipse(x, y + 8, 16, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 16, y + 8); ctx.lineTo(x - 16, y - 10); ctx.lineTo(x + 16, y - 10); ctx.lineTo(x + 16, y + 8);
      ctx.stroke();
      break;
    case 42: // maze
      ctx.beginPath();
      for (let i = 0; i < 4; i++) ctx.rect(x - 18 + i * 5, y - 12 + i * 5, 36 - i * 10, 28 - i * 10);
      ctx.stroke();
      break;
    case 52: // prison bars
      for (let i = -2; i <= 2; i++) ctx.fillRect(x + i * 8 - 1.5, y - 14, 3, 30);
      ctx.fillRect(x - 20, y - 16, 40, 3);
      break;
    case 58: // death: a simple skull
      circle(ctx, x, y, 14);
      ctx.fill();
      ctx.fillRect(x - 8, y + 8, 16, 9);
      ctx.fillStyle = '#e8c8b8';
      circle(ctx, x - 5, y - 1, 3.5); ctx.fill();
      circle(ctx, x + 5, y - 1, 3.5); ctx.fill();
      break;
    default:
  }
  ctx.restore();
}

const SQUARE_COLOR = (sq) => {
  if (sq === FINISH) return '#e8c04a';
  if (GEESE.includes(sq)) return '#b8cf9a';
  if (SPECIAL[sq]) return sq === 58 ? '#c9786a' : '#dcae6a';
  return sq % 2 ? '#f1e3c0' : '#eadab2';
};

export const { meta, createGame } = createBoardModule({
  id: 'goose',
  width: W,
  height: H,

  seatLabel: (seat, f) => `${f.colorNameOf(seat)} · vak ${f.view.pos[seat]}`,
  seatIcon: () => '●',
  pick: () => null,
  onPick() {},

  onKey(key, api, f) {
    if (f.myTurn && (key === ' ' || key === 'Enter')) {
      api.move({ type: 'roll' });
      return true;
    }
    return false;
  },

  describe(last, f) {
    const i = last.info;
    const [a, b] = i.dice;
    let t = `${f.nameOf(last.seat)} gooide ${a} + ${b} en staat op ${f.view.pos[last.seat]}.`;
    if (i.events.length) t += ` ${i.events.join('. ')}.`;
    if (i.skipped.length) t += ` ${i.skipped.map((s) => f.nameOf(s)).join(', ')} slaat een beurt over.`;
    return t;
  },
  animMs: (last) => 250 + Math.min(20, last.info.steps.length) * 110,
  sound: (last) => (last.info.events.some((e) => e.startsWith('Dood')) ? 'lose' : last.info.events.length ? 'coin' : 'react'),
  turnText: () => 'Jouw beurt: gooi de dobbelstenen!',

  panel(el, f, api) {
    const dice = f.last?.info?.dice;
    const rolling = f.anim < 1 ? 'is-rolling' : '';
    const row = h('div', { class: 'dice-row' },
      h('div', { class: `die ${rolling}`, 'aria-hidden': 'true' }, dice ? String(dice[0]) : '–'),
      h('div', { class: `die ${rolling}`, 'aria-hidden': 'true' }, dice ? String(dice[1]) : '–'));
    if (f.myTurn) row.append(h('button', { class: 'btn btn--primary', type: 'button', 'data-key': 'roll', onclick: () => api.move({ type: 'roll' }) }, 'Gooi!'));
    el.append(row);
  },

  draw(ctx, f) {
    const v = f.view;
    // An old printed board on a walnut table.
    woodTable(ctx, 0, 0, W, H, 'walnut');
    dropShadow(ctx, X0 - 14, Y0 - 14, COLS * CELL + 28, ROWS * CELL + 28, 8);
    roundRect(ctx, X0 - 14, Y0 - 14, COLS * CELL + 28, ROWS * CELL + 28, 8);
    ctx.fillStyle = '#8a3a2a';
    ctx.fill();
    ctx.strokeStyle = '#e8c04a';
    ctx.lineWidth = 2;
    roundRect(ctx, X0 - 8, Y0 - 8, COLS * CELL + 16, ROWS * CELL + 16, 6);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let sq = 1; sq <= FINISH; sq++) {
      const p = cellXY(sq);
      roundRect(ctx, p.x - CELL / 2 + 3, p.y - CELL / 2 + 3, CELL - 6, CELL - 6, 6);
      ctx.fillStyle = SQUARE_COLOR(sq);
      ctx.fill();
      ctx.strokeStyle = 'rgba(74, 46, 24, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (GEESE.includes(sq)) drawGoose(ctx, p.x, p.y + 6, 1.2);
      else if (SPECIAL[sq]) drawSpecial(ctx, sq, p.x, p.y + 4);
      else if (sq === FINISH) {
        ctx.fillStyle = INK;
        ctx.font = '800 30px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('★', p.x, p.y - 12);
        ctx.textAlign = 'left';
      }
      ctx.fillStyle = INK;
      ctx.font = '700 14px Georgia, serif';
      ctx.fillText(String(sq), p.x - CELL / 2 + 10, p.y - CELL / 2 + 8);
    }
    // Start area
    roundRect(ctx, START.x - 46, START.y - 30, 250, 60, 14);
    ctx.fillStyle = '#f1e3c0';
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = '800 13px Georgia, serif';
    ctx.fillText('START', START.x - 38, START.y - 24);

    const last = f.last;
    const animating = last && f.anim < 1;
    v.pos.forEach((pos, seat) => {
      let p = pawnXY(pos, seat);
      if (animating && seat === last.seat) {
        // Hop through the visited squares.
        const steps = [f.prev.pos[seat], ...last.info.steps];
        const t = f.anim * (steps.length - 1);
        const i = Math.min(steps.length - 2, Math.floor(t));
        const k = clamp01(t - i);
        const a = pawnXY(steps[i], seat);
        const b = pawnXY(steps[i + 1], seat);
        p = { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) - Math.sin(k * Math.PI) * 18 };
      }
      circle(ctx, p.x, p.y + 3, 13);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fill();
      circle(ctx, p.x, p.y, 13);
      ctx.fillStyle = f.colorOf(seat);
      ctx.fill();
      ctx.lineWidth = seat === f.you ? 4 : 2;
      ctx.strokeStyle = seat === f.you ? '#ffffff' : 'rgba(0,0,0,0.5)';
      ctx.stroke();
      if (v.stuck[seat] || v.skip[seat]) {
        ctx.fillStyle = '#ffe14d';
        ctx.font = '800 14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(v.stuck[seat] ? '⏳' : 'z', p.x, p.y - 30);
        ctx.textAlign = 'left';
      }
    });
  },
});
