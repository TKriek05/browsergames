// Dammen: international draughts on 10×10 with the Dutch/FMJD rules.
//  - squares 1-50 (stored as 0-49); white (seat 0) starts on 31-50 and moves first
//  - capturing is mandatory, forwards AND backwards for men
//  - you must take the sequence that captures the MOST pieces
//  - kings fly: any distance, and capture from a distance
//  - captured pieces leave the board only after the whole sequence and cannot
//    be jumped twice ("Turkse slag")
//  - a man only promotes when its move ENDS on the far row
//  - draw: threefold repetition, or 25 moves each with only king moves
// Pure rules module (interface: see shared/rules/tictactoe.js).

export const EMPTY = 0;
export const WM = 1; // white man
export const WK = 2; // white king
export const BM = 3; // black man
export const BK = 4; // black king
export const N = 50;
const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const KING_ONLY_PLIES = 50;

export const owner = (p) => (p === WM || p === WK ? 0 : p === BM || p === BK ? 1 : -1);
export const isKing = (p) => p === WK || p === BK;

// Square index (0-49) ↔ row/col on the 10×10 board (row 0 = black's side).
export function rc(sq) {
  const r = Math.floor(sq / 5);
  const i = sq % 5;
  return [r, r % 2 === 0 ? 2 * i + 1 : 2 * i];
}
export function sqAt(r, c) {
  if (r < 0 || r > 9 || c < 0 || c > 9 || (r + c) % 2 !== 1) return -1;
  return r * 5 + (r % 2 === 0 ? (c - 1) / 2 : c / 2);
}

// RAYS[sq][d] = squares along direction d, nearest first.
const RAYS = Array.from({ length: N }, (_, sq) =>
  DIRS.map(([dr, dc]) => {
    const out = [];
    let [r, c] = rc(sq);
    for (;;) {
      r += dr;
      c += dc;
      const s = sqAt(r, c);
      if (s < 0) break;
      out.push(s);
    }
    return out;
  }),
);
const FORWARD = [[0, 1], [2, 3]]; // direction indices a man may step: white up, black down

// --- Move generation --------------------------------------------------------------------
// A move: { path: [from, …landings], caps: [captured squares] }

function captureSequences(board, from) {
  const piece = board[from];
  const me = owner(piece);
  const king = isKing(piece);
  const results = [];

  // Depth-first over all capture chains. Captured pieces stay on the board
  // (they block and cannot be jumped again); the moving piece's start square
  // counts as empty because it has left it.
  const walk = (sq, path, caps) => {
    let extended = false;
    for (let d = 0; d < 4; d++) {
      const ray = RAYS[sq][d];
      let k = 0;
      if (king) while (k < ray.length && (board[ray[k]] === EMPTY || ray[k] === from)) k++;
      if (k >= ray.length) continue;
      const victim = ray[k];
      if (owner(board[victim]) !== 1 - me || caps.includes(victim)) continue;
      // Landing squares behind the victim: exactly one for a man, any free one for a king.
      for (let j = k + 1; j < ray.length; j++) {
        const land = ray[j];
        if (board[land] !== EMPTY && land !== from) break;
        extended = true;
        walk(land, [...path, land], [...caps, victim]);
        if (!king) break;
      }
    }
    if (!extended && caps.length) results.push({ path, caps });
  };
  walk(from, [from], []);
  return results;
}

export function generateMoves(board, seat) {
  let captures = [];
  for (let sq = 0; sq < N; sq++) if (owner(board[sq]) === seat) captures.push(...captureSequences(board, sq));
  if (captures.length) {
    const max = Math.max(...captures.map((m) => m.caps.length));
    captures = captures.filter((m) => m.caps.length === max);
    // Same start, end and captured pieces = the same move.
    const seen = new Set();
    return captures.filter((m) => {
      const key = `${m.path[0]}-${m.path[m.path.length - 1]}-${[...m.caps].sort((a, b) => a - b).join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((m) => ({ path: m.path, caps: [...m.caps].sort((a, b) => a - b) }));
  }
  const moves = [];
  for (let sq = 0; sq < N; sq++) {
    const p = board[sq];
    if (owner(p) !== seat) continue;
    const dirs = isKing(p) ? [0, 1, 2, 3] : FORWARD[seat];
    for (const d of dirs) {
      for (const to of RAYS[sq][d]) {
        if (board[to] !== EMPTY) break;
        moves.push({ path: [sq, to], caps: [] });
        if (!isKing(p)) break;
      }
    }
  }
  return moves;
}

const posKey = (board, turn) => `${turn}:${board.join('')}`;

export function initialBoard() {
  const board = new Array(N).fill(EMPTY);
  for (let i = 0; i < 20; i++) board[i] = BM;
  for (let i = 30; i < 50; i++) board[i] = WM;
  return board;
}

export default {
  id: 'checkers',
  undo: true,

  setup() {
    const board = initialBoard();
    return { board, turn: 0, kingPlies: 0, seen: { [posKey(board, 0)]: 1 }, over: null };
  },

  toMove: (state) => (state.over ? [] : [state.turn]),

  legalMoves(state, seat) {
    if (state.over || seat !== state.turn) return [];
    return generateMoves(state.board, seat);
  },

  apply(state, seat, move) {
    const board = state.board.slice();
    const from = move.path[0];
    const to = move.path[move.path.length - 1];
    let piece = board[from];
    const wasKing = isKing(piece);
    board[from] = EMPTY;
    for (const c of move.caps) board[c] = EMPTY;
    // Promotion only when the move ends on the far row.
    const [row] = rc(to);
    let promoted = false;
    if (piece === WM && row === 0) { piece = WK; promoted = true; }
    if (piece === BM && row === 9) { piece = BK; promoted = true; }
    board[to] = piece;

    const turn = 1 - seat;
    const kingPlies = wasKing && !move.caps.length ? state.kingPlies + 1 : 0;
    // Repetition only matters while no captures / man moves happen: reset then.
    const seen = kingPlies ? { ...state.seen } : {};
    const key = posKey(board, turn);
    seen[key] = (seen[key] ?? 0) + 1;

    let over = null;
    if (!generateMoves(board, turn).length) {
      over = { winners: [seat], draw: false, reason: board.some((p) => owner(p) === turn) ? 'De tegenstander kan niet meer zetten' : 'Alle stukken geslagen' };
    } else if (seen[key] >= 3) over = { winners: [], draw: true, reason: 'Drie keer dezelfde stelling' };
    else if (kingPlies >= KING_ONLY_PLIES) over = { winners: [], draw: true, reason: '25 zetten alleen met dammen' };

    return {
      state: { board, turn, kingPlies, seen, over },
      info: { path: move.path, caps: move.caps, promoted, piece },
    };
  },

  result: (state) => state.over,
  // `seen` is bookkeeping only; keep snapshots small.
  view: (state) => ({ board: state.board, turn: state.turn, kingPlies: state.kingPlies }),
};
