// Boter-kaas-en-eieren (tic-tac-toe). Pure rules module.
//
// ─── Rules module interface (all board games) ─────────────────────────────────
//   id, undo (bool)
//   setup({ seats, settings, rng }) → state        plain JSON-safe data
//   toMove(state) → [seat, …]                      who may move now ([] = finished)
//   legalMoves(state, seat) → [move, …] | null     null = not enumerable, use isLegal
//   isLegal?(state, seat, move) → bool              optional override
//   apply(state, seat, move, rng) → { state, info } never mutates the input state;
//                                                   `info` is PUBLIC (shown to everyone)
//   result(state) → null | { winners: [seat], draw, reason, ranking? }
//   view(state, seat) → what `seat` may see (-1 = spectator)
// ────────────────────────────────────────────────────────────────────────────────

export const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function winner(board) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] !== -1 && board[a] === board[b] && board[a] === board[c]) return { seat: board[a], line };
  }
  return null;
}

export default {
  id: 'tictactoe',
  undo: true,

  setup() {
    return { board: new Array(9).fill(-1), turn: 0, line: null, over: null };
  },

  toMove(state) {
    return state.over ? [] : [state.turn];
  },

  legalMoves(state, seat) {
    if (state.over || seat !== state.turn) return [];
    const moves = [];
    for (let c = 0; c < 9; c++) if (state.board[c] === -1) moves.push({ c });
    return moves;
  },

  apply(state, seat, move) {
    const board = state.board.slice();
    board[move.c] = seat;
    const win = winner(board);
    let over = null;
    if (win) over = { winners: [seat], draw: false, reason: 'Drie op een rij' };
    else if (!board.includes(-1)) over = { winners: [], draw: true, reason: 'Het bord is vol' };
    return {
      state: { board, turn: 1 - seat, line: win ? win.line : null, over },
      info: { c: move.c },
    };
  },

  result(state) {
    return state.over;
  },

  view(state) {
    return state;
  },
};
