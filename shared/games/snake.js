// Slangenstrijd: grid and encoding shared by server and client.
export const SNAKE_GRID = { cols: 52, rows: 28, cell: 6, x0: 4, y0: 10 };
export const SNAKE_TICKS_PER_MOVE = 3; // 30 Hz sim → 10 moves per second
export const SNAKE_START_LEN = 4;
export const SNAKE_GROW = 2;

// Directions: 0 right, 1 down, 2 left, 3 up.
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const opposite = (d) => (d + 2) % 4;

// Direction wanted by a stick/keys input, or -1.
export function dirFromAxes(ax, ay) {
  if (Math.abs(ax) < 0.5 && Math.abs(ay) < 0.5) return -1;
  if (Math.abs(ax) >= Math.abs(ay)) return ax > 0 ? 0 : 2;
  return ay > 0 ? 1 : 3;
}

// Body as a head cell + the direction from each segment to the next one
// (towards the tail), 2 bits each, 4 per byte.
export function packBody(cells) {
  const dirs = [];
  for (let i = 1; i < cells.length; i++) {
    const dx = cells[i][0] - cells[i - 1][0];
    const dy = cells[i][1] - cells[i - 1][1];
    dirs.push(dx === 1 ? 0 : dy === 1 ? 1 : dx === -1 ? 2 : 3);
  }
  const bytes = new Uint8Array(Math.ceil(dirs.length / 4));
  dirs.forEach((d, i) => { bytes[i >> 2] |= d << ((i & 3) * 2); });
  return bytes;
}

export function unpackBody(hx, hy, len, bytes) {
  const cells = [[hx, hy]];
  for (let i = 1; i < len; i++) {
    const d = (bytes[(i - 1) >> 2] >> (((i - 1) & 3) * 2)) & 3;
    const [px, py] = cells[i - 1];
    cells.push([px + DIRS[d][0], py + DIRS[d][1]]);
  }
  return cells;
}
