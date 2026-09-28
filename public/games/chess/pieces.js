// Our own chess piece silhouettes as SVG paths in a 100×100 box (no fonts,
// no images). Drawn with Path2D so they stay sharp at any size.
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } from '../../../shared/chess/position.js';

const BASE = 'M22 92 Q22 84 30 83 L70 83 Q78 84 78 92 Z ';
const ring = (cx, cy, r) => `M${cx + r} ${cy} A${r} ${r} 0 1 1 ${cx - r} ${cy} A${r} ${r} 0 1 1 ${cx + r} ${cy} Z `;

const SHAPES = {
  [PAWN]: BASE + 'M34 83 Q38 66 44 58 L56 58 Q62 66 66 83 Z M36 59 Q36 52 50 52 Q64 52 64 59 Z ' + ring(50, 38, 13),
  [ROOK]: BASE + 'M32 83 L35 44 L65 44 L68 83 Z M28 45 L28 20 L37 20 L37 28 L45 28 L45 20 L55 20 L55 28 L63 28 L63 20 L72 20 L72 45 Z',
  [KNIGHT]: BASE + 'M30 83 Q30 66 40 58 Q30 57 26 49 Q23 41 33 33 L44 21 L47 10 L55 20 Q71 26 75 46 Q77 58 70 67 L70 83 Z',
  [BISHOP]: BASE + 'M36 83 Q40 64 44 55 L56 55 Q60 64 64 83 Z M50 17 Q67 30 62 46 Q58 55 50 55 Q42 55 38 46 Q33 30 50 17 Z ' + ring(50, 12, 5),
  [QUEEN]: BASE + 'M32 83 Q38 62 38 50 L62 50 Q62 62 68 83 Z M28 51 L20 24 L36 38 L42 16 L50 36 L58 16 L64 38 L80 24 L72 51 Z '
    + ring(20, 22, 4) + ring(42, 14, 4) + ring(58, 14, 4) + ring(80, 22, 4),
  [KING]: BASE + 'M32 83 Q38 62 38 50 L62 50 Q62 62 68 83 Z M28 51 Q23 30 38 30 Q46 30 50 39 Q54 30 62 30 Q77 30 72 51 Z '
    + 'M46 5 L54 5 L54 13 L61 13 L61 20 L54 20 L54 30 L46 30 L46 20 L39 20 L39 13 L46 13 Z',
};

// Small details drawn in the outline colour.
const DETAILS = {
  [KNIGHT]: 'M44 30 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M36 50 L46 46',
  [BISHOP]: 'M54 26 L45 40',
  [QUEEN]: 'M38 56 L62 56',
  [KING]: 'M38 56 L62 56',
};

let paths = null;
function getPaths() {
  if (!paths) {
    paths = {};
    for (const [t, d] of Object.entries(SHAPES)) paths[t] = { body: new Path2D(d), detail: DETAILS[t] ? new Path2D(DETAILS[t]) : null };
  }
  return paths;
}

const STYLE = {
  white: { fill: '#f5f6ff', shade: '#c7cbef', line: '#23233a' },
  black: { fill: '#23233a', shade: '#121220', line: '#c4c8ee' },
};

// piece: signed piece code (+ white, - black)
export function drawPiece(ctx, piece, x, y, size, alpha = 1) {
  const t = Math.abs(piece);
  const p = getPaths()[t];
  if (!p) return;
  const s = piece > 0 ? STYLE.white : STYLE.black;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 100, size / 100);
  const g = ctx.createLinearGradient(20, 0, 80, 0);
  g.addColorStop(0, s.fill);
  g.addColorStop(1, s.shade);
  ctx.fillStyle = g;
  ctx.fill(p.body);
  ctx.lineWidth = 3.2;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.line;
  ctx.stroke(p.body);
  if (p.detail) {
    ctx.lineWidth = 3;
    ctx.stroke(p.detail);
    if (t === KNIGHT) {
      ctx.fillStyle = s.line;
      ctx.fill(p.detail);
    }
  }
  ctx.restore();
}
