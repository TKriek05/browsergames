// Dammen voor 4: draughts for 2-4 players on a cross-shaped board (14 × 14
// with the 3 × 3 corners cut off). Every player has an arm of 3 rows with 12
// men and plays towards the opposite arm; turns go around clockwise.
//  - capturing is mandatory (any opponent), forwards and backwards for men,
//    and you must take the sequence that captures the most pieces
//  - kings fly (any distance, also when capturing); captured pieces leave
//    only after the whole sequence and cannot be jumped twice
//  - a man becomes a king when its move ends on the far edge of the opposite arm
//  - who can not move is out (their pieces leave the board); the last one wins
//  - 30 rounds without a capture or a man moving: the most material wins
// With 2 players the arms face each other; with 3 the fourth arm stays empty.
// Pure rules module (interface: see shared/rules/tictactoe.js).

export const SIZE = 14;
export const ARM = 3; // depth of an arm (and of the cut corners)
export const CELLS = SIZE * SIZE;
export const EMPTY = 0;
const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
// Per arm (0 = bottom, 1 = left, 2 = top, 3 = right): the directions a man steps in.
const FORWARD = [[0, 1], [1, 3], [2, 3], [0, 2]];
const QUIET_ROUNDS = 30;
const MAX_PLIES = 900;
export const MAN_VALUE = 1;
export const KING_VALUE = 3;

// Pieces: arm * 2 + 1 = man, arm * 2 + 2 = king (1 … 8).
export const pieceArm = (p) => (p ? (p - 1) >> 1 : -1);
export const isKing = (p) => p > 0 && p % 2 === 0;
export const manOf = (arm) => arm * 2 + 1;
export const kingOf = (arm) => arm * 2 + 2;

export function onBoard(r, c) {
  if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return false;
  const edgeR = r < ARM || r >= SIZE - ARM;
  const edgeC = c < ARM || c >= SIZE - ARM;
  return !(edgeR && edgeC) && (r + c) % 2 === 1;
}
export const idx = (r, c) => r * SIZE + c;
export const rcOf = (i) => [Math.floor(i / SIZE), i % SIZE];
export const SQUARES = Array.from({ length: CELLS }, (_, i) => i).filter((i) => onBoard(...rcOf(i)));

// The far edge where a man of `arm` promotes.
export function promotes(arm, i) {
  const [r, c] = rcOf(i);
  return arm === 0 ? r === 0 : arm === 1 ? c === SIZE - 1 : arm === 2 ? r === SIZE - 1 : c === 0;
}

// Which arm a square belongs to (-1 = the middle).
export function armOfSquare(i) {
  const [r, c] = rcOf(i);
  if (r >= SIZE - ARM) return 0;
  if (c < ARM) return 1;
  if (r < ARM) return 2;
  if (c >= SIZE - ARM) return 3;
  return -1;
}

// RAYS[i][d] = squares along direction d from i, nearest first.
const RAYS = Array.from({ length: CELLS }, (_, i) => {
  if (!onBoard(...rcOf(i))) return null;
  return DIRS.map(([dr, dc]) => {
    const out = [];
    let [r, c] = rcOf(i);
    for (;;) {
      r += dr;
      c += dc;
      if (!onBoard(r, c)) break;
      out.push(idx(r, c));
    }
    return out;
  });
});

// Arms in play for 2, 3 or 4 players (seat → arm).
export function armsFor(seats) {
  return seats === 2 ? [0, 2] : seats === 3 ? [0, 1, 2] : [0, 1, 2, 3];
}

export function initialBoard(arms) {
  const board = new Array(CELLS).fill(EMPTY);
  for (const i of SQUARES) {
    const a = armOfSquare(i);
    if (a >= 0 && arms.includes(a)) board[i] = manOf(a);
  }
  return board;
}

// --- Move generation ------------------------------------------------------------------------
// A move: { path: [from, …landings], caps: [captured squares] }
function captureSequences(board, from) {
  const piece = board[from];
  const me = pieceArm(piece);
  const king = isKing(piece);
  const results = [];
  const walk = (sq, path, caps) => {
    let extended = false;
    for (let d = 0; d < 4; d++) {
      const ray = RAYS[sq][d];
      let k = 0;
      if (king) while (k < ray.length && (board[ray[k]] === EMPTY || ray[k] === from)) k++;
      if (k >= ray.length) continue;
      const victim = ray[k];
      const va = pieceArm(board[victim]);
      if (va < 0 || va === me || caps.includes(victim)) continue;
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

export function generateMoves(board, arm) {
  let captures = [];
  for (const sq of SQUARES) if (pieceArm(board[sq]) === arm) captures.push(...captureSequences(board, sq));
  if (captures.length) {
    const max = Math.max(...captures.map((m) => m.caps.length));
    captures = captures.filter((m) => m.caps.length === max);
    const seen = new Set();
    return captures.filter((m) => {
      const key = `${m.path[0]}-${m.path[m.path.length - 1]}-${[...m.caps].sort((a, b) => a - b).join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((m) => ({ path: m.path, caps: [...m.caps].sort((a, b) => a - b) }));
  }
  const moves = [];
  for (const sq of SQUARES) {
    const p = board[sq];
    if (pieceArm(p) !== arm) continue;
    const dirs = isKing(p) ? [0, 1, 2, 3] : FORWARD[arm];
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

// Play a move on a board copy (no bookkeeping): for bots and apply().
export function playMove(board, move) {
  const b = board.slice();
  const from = move.path[0];
  const to = move.path[move.path.length - 1];
  let p = b[from];
  b[from] = EMPTY;
  for (const c of move.caps) b[c] = EMPTY;
  const arm = pieceArm(p);
  let promoted = false;
  if (!isKing(p) && promotes(arm, to)) {
    p = kingOf(arm);
    promoted = true;
  }
  b[to] = p;
  return { board: b, promoted };
}

export function material(board, arm) {
  let m = 0;
  for (const sq of SQUARES) if (pieceArm(board[sq]) === arm) m += isKing(board[sq]) ? KING_VALUE : MAN_VALUE;
  return m;
}

// --- Turn order and the end --------------------------------------------------------------------
// The next seat that is still in, after `seat`. Seats that can not move drop
// out on the way (their pieces leave). Returns { turn, board, out }.
function advance(state, board, seat) {
  const out = state.out.slice();
  let b = board;
  const n = state.arms.length;
  for (let k = 1; k <= n; k++) {
    const s = (seat + k) % n;
    if (out.includes(s)) continue;
    if (generateMoves(b, state.arms[s]).length) return { turn: s, board: b, out };
    // Can not move: out of the game.
    out.push(s);
    b = b.map((p) => (pieceArm(p) === state.arms[s] ? EMPTY : p));
  }
  return { turn: -1, board: b, out };
}

function finish(state) {
  const n = state.arms.length;
  const alive = Array.from({ length: n }, (_, s) => s).filter((s) => !state.out.includes(s));
  if (alive.length > 1 && state.quiet < QUIET_ROUNDS * alive.length && state.plies < MAX_PLIES) return null;
  // Alive players by material, then those who went out (last out first).
  const byMaterial = alive.sort((a, b) => material(state.board, state.arms[b]) - material(state.board, state.arms[a]));
  const ranking = [...byMaterial, ...state.out.slice().reverse()];
  const best = material(state.board, state.arms[ranking[0]]);
  const tied = alive.filter((s) => material(state.board, state.arms[s]) === best);
  if (alive.length === 1) return { winners: [alive[0]], draw: false, reason: 'Als enige over', ranking };
  if (tied.length > 1) return { winners: tied, draw: true, reason: 'Gelijk materiaal na lang schuiven', ranking };
  return { winners: [ranking[0]], draw: false, reason: 'Meeste stukken na lang schuiven', ranking };
}

export default {
  id: 'checkers4',
  undo: true,
  rankingScore: true,

  setup({ seats }) {
    const arms = armsFor(Math.max(2, Math.min(4, seats)));
    return { board: initialBoard(arms), arms, turn: 0, out: [], quiet: 0, plies: 0, over: null };
  },

  toMove: (state) => (state.over ? [] : [state.turn]),

  legalMoves(state, seat) {
    if (state.over || seat !== state.turn) return [];
    return generateMoves(state.board, state.arms[seat]);
  },

  apply(state, seat, move) {
    const moved = state.board[move.path[0]];
    const { board, promoted } = playMove(state.board, move);
    const quiet = move.caps.length || !isKing(moved) ? 0 : state.quiet + 1;
    const victims = [...new Set(move.caps.map((c) => pieceArm(state.board[c])))];
    const next = advance(state, board, seat);
    const s = { board: next.board, arms: state.arms, turn: next.turn, out: next.out, quiet, plies: state.plies + 1, over: null };
    const newlyOut = next.out.filter((x) => !state.out.includes(x));
    s.over = finish(s);
    if (s.over) s.turn = -1;
    return { state: s, info: { path: move.path, caps: move.caps, promoted, piece: moved, victims, out: newlyOut } };
  },

  result: (state) => state.over,
  view: (state) => ({ board: state.board, arms: state.arms, turn: state.turn, out: state.out, quiet: state.quiet }),
};
