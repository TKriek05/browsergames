// Vier op een rij (connect four), 7 columns × 6 rows. Pure rules module
// (interface: see shared/rules/tictactoe.js). Index = row * 7 + col, row 0 = top.
export const COLS = 7;
export const ROWS = 6;
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

// The four-in-a-row through (row, col) for `seat`, or null.
export function lineThrough(board, row, col, seat) {
  for (const [dc, dr] of DIRS) {
    const cells = [row * COLS + col];
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === seat) {
        cells.push(r * COLS + c);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (cells.length >= 4) return cells.sort((a, b) => a - b);
  }
  return null;
}

export default {
  id: 'connect4',
  undo: true,

  setup() {
    return { board: new Array(COLS * ROWS).fill(-1), heights: new Array(COLS).fill(0), turn: 0, line: null, over: null };
  },

  toMove(state) {
    return state.over ? [] : [state.turn];
  },

  legalMoves(state, seat) {
    if (state.over || seat !== state.turn) return [];
    const moves = [];
    for (let col = 0; col < COLS; col++) if (state.heights[col] < ROWS) moves.push({ col });
    return moves;
  },

  apply(state, seat, { col }) {
    const board = state.board.slice();
    const heights = state.heights.slice();
    const row = ROWS - 1 - heights[col];
    board[row * COLS + col] = seat;
    heights[col]++;
    const line = lineThrough(board, row, col, seat);
    let over = null;
    if (line) over = { winners: [seat], draw: false, reason: 'Vier op een rij' };
    else if (heights.every((h) => h === ROWS)) over = { winners: [], draw: true, reason: 'Het bord is vol' };
    return { state: { board, heights, turn: 1 - seat, line, over }, info: { col, row } };
  },

  result: (state) => state.over,
  view: (state) => state,
};
