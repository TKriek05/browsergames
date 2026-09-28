// Reversi on 8×8. Seat 0 = zwart (starts), seat 1 = wit. A player without a
// legal move passes automatically; when nobody can move the most discs win.
// Pure rules module (interface: see shared/rules/tictactoe.js).
export const SIZE = 8;
const DIRS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

// Squares that would be flipped by `seat` playing on `sq` (empty array = illegal).
export function flipsFor(board, seat, sq) {
  if (board[sq] !== -1) return [];
  const flips = [];
  const x0 = sq % SIZE;
  const y0 = Math.floor(sq / SIZE);
  for (const [dx, dy] of DIRS) {
    const line = [];
    let x = x0 + dx;
    let y = y0 + dy;
    while (x >= 0 && x < SIZE && y >= 0 && y < SIZE) {
      const v = board[y * SIZE + x];
      if (v === -1) break;
      if (v === seat) {
        if (line.length) flips.push(...line);
        break;
      }
      line.push(y * SIZE + x);
      x += dx;
      y += dy;
    }
  }
  return flips;
}

export function movesFor(board, seat) {
  const moves = [];
  for (let sq = 0; sq < SIZE * SIZE; sq++) if (board[sq] === -1 && flipsFor(board, seat, sq).length) moves.push(sq);
  return moves;
}

export function count(board) {
  let a = 0;
  let b = 0;
  for (const v of board) {
    if (v === 0) a++;
    else if (v === 1) b++;
  }
  return [a, b];
}

function finish(board) {
  const [a, b] = count(board);
  if (a === b) return { winners: [], draw: true, reason: `${a} tegen ${b}` };
  return { winners: [a > b ? 0 : 1], draw: false, reason: `${Math.max(a, b)} tegen ${Math.min(a, b)} stenen` };
}

export default {
  id: 'reversi',
  undo: true,

  setup() {
    const board = new Array(SIZE * SIZE).fill(-1);
    // Standard start: white on d4/e5, black on d5/e4 (row 0 = rank 8).
    board[27] = 0; // d5
    board[36] = 0; // e4
    board[28] = 1; // e5
    board[35] = 1; // d4
    return { board, turn: 0, over: null };
  },

  toMove: (state) => (state.over ? [] : [state.turn]),

  legalMoves(state, seat) {
    if (state.over || seat !== state.turn) return [];
    return movesFor(state.board, seat).map((sq) => ({ sq }));
  },

  apply(state, seat, { sq }) {
    const board = state.board.slice();
    const flips = flipsFor(board, seat, sq);
    board[sq] = seat;
    for (const f of flips) board[f] = seat;
    const other = 1 - seat;
    let turn = other;
    let passed = null;
    let over = null;
    if (!movesFor(board, other).length) {
      if (movesFor(board, seat).length) {
        turn = seat; // the other player has to pass
        passed = other;
      } else over = finish(board);
    }
    return { state: { board, turn, over }, info: { sq, flips, passed } };
  },

  result: (state) => state.over,
  view: (state) => ({ ...state, count: count(state.board) }),
};
