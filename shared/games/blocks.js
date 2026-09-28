// Blokval: falling-block rules shared by server (authority) and client
// (plays your own board locally). Pure functions, boards are Uint8Arrays
// (0 = empty, 1-7 = piece colour, 8 = garbage).
import { createRng } from '../rng.js';

export const COLS = 10;
export const ROWS = 22; // the top 2 rows are hidden spawn space
export const HIDDEN = 2;
export const GARBAGE_CELL = 8;

// Seven pieces, rotation states as [x, y] cells (SRS layout in a 4×4 box).
const BASE = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  O: [[1, 0], [2, 0], [1, 1], [2, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};
export const PIECE_NAMES = Object.keys(BASE);
const SIZE = { I: 4, O: 4, T: 3, S: 3, Z: 3, J: 3, L: 3 };

// Rotate clockwise inside the piece's box: (x, y) → (n-1-y, x).
export const SHAPES = PIECE_NAMES.map((name) => {
  const n = SIZE[name];
  const states = [BASE[name]];
  for (let r = 1; r < 4; r++) {
    states.push(states[r - 1].map(([x, y]) => (name === 'O' ? [x, y] : [n - 1 - y, x])));
  }
  return states;
});

const KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0], [0, 1]];

// Garbage lines sent for 0-4 cleared lines, plus a small combo bonus.
export const ATTACK = [0, 0, 1, 2, 4];
export const comboBonus = (combo) => (combo >= 6 ? 3 : combo >= 4 ? 2 : combo >= 2 ? 1 : 0);

export const gravityInterval = (level) => Math.max(0.05, 0.8 * 0.85 ** (level - 1));

// The piece sequence: 7-bags from a shared seed (everyone gets the same order).
export function createSequence(seed) {
  const rng = createRng(seed);
  const seq = [];
  return (i) => {
    while (seq.length <= i) {
      const bag = [0, 1, 2, 3, 4, 5, 6];
      for (let k = bag.length - 1; k > 0; k--) {
        const j = Math.floor(rng() * (k + 1));
        [bag[k], bag[j]] = [bag[j], bag[k]];
      }
      seq.push(...bag);
    }
    return seq[i];
  };
}

export const emptyBoard = () => new Uint8Array(COLS * ROWS);
export const spawn = (k) => ({ k, r: 0, x: k === 0 ? 3 : 3, y: 0 });

export function fits(board, k, r, x, y) {
  for (const [cx, cy] of SHAPES[k][r & 3]) {
    const bx = x + cx;
    const by = y + cy;
    if (bx < 0 || bx >= COLS || by >= ROWS) return false;
    if (by >= 0 && board[by * COLS + bx]) return false;
  }
  return true;
}

export const resting = (board, k, r, x, y) => fits(board, k, r, x, y) && !fits(board, k, r, x, y + 1);

export function dropY(board, k, r, x, y) {
  while (fits(board, k, r, x, y + 1)) y++;
  return y;
}

// Rotation with simple wall kicks. Returns { r, x, y } or null.
export function tryRotate(board, k, r, x, y, dir) {
  const nr = (r + dir + 4) & 3;
  for (const [dx, dy] of KICKS) if (fits(board, k, nr, x + dx, y + dy)) return { r: nr, x: x + dx, y: y + dy };
  return null;
}

// Lock a piece: returns { board, lines } (new board, full rows removed).
export function place(board, k, r, x, y) {
  const b = board.slice();
  for (const [cx, cy] of SHAPES[k][r & 3]) {
    const by = y + cy;
    if (by >= 0) b[by * COLS + x + cx] = k + 1;
  }
  let lines = 0;
  for (let row = ROWS - 1; row >= 0; row--) {
    let full = true;
    for (let c = 0; c < COLS; c++) if (!b[row * COLS + c]) { full = false; break; }
    if (!full) continue;
    b.copyWithin(COLS, 0, row * COLS);
    b.fill(0, 0, COLS);
    lines++;
    row++; // check the same row again (it now holds the row above)
  }
  return { board: b, lines };
}

// Push `lines` garbage rows (one hole at `hole`) in from the bottom.
// overflow = blocks were pushed out of the top: that player is out.
export function addGarbage(board, lines, hole) {
  let overflow = false;
  for (let i = 0; i < lines * COLS; i++) if (board[i]) overflow = true;
  const b = new Uint8Array(COLS * ROWS);
  b.set(board.subarray(lines * COLS), 0);
  for (let row = ROWS - lines; row < ROWS; row++) {
    for (let c = 0; c < COLS; c++) b[row * COLS + c] = c === hole ? 0 : GARBAGE_CELL;
  }
  return { board: b, overflow };
}

export const encodeBoard = (board) => Array.from(board, (v) => v.toString(16)).join('');
export function decodeBoard(str) {
  const b = new Uint8Array(COLS * ROWS);
  for (let i = 0; i < b.length && i < str.length; i++) b[i] = parseInt(str[i], 16) || 0;
  return b;
}
