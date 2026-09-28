// Ruimtegolf: layout shared by server and client.
import { stepPaddle } from '../physics/paddle.js';

export const INV = {
  width: 320,
  height: 180,
  top: 12,
  shipY: 164,
  shipSpeed: 115,
  cols: 10,
  rows: 5,
  dx: 18, // alien spacing
  dy: 13,
  alienW: 11,
  alienH: 8,
  bunkers: 4,
  bunkerCols: 12, // cells of 2×2 px
  bunkerRows: 8,
  bunkerY: 136,
  landY: 150, // aliens this low: invasion, game over
};

export const ALIEN_POINTS = [30, 20, 20, 10, 10]; // per row, top to bottom
export const alienType = (row) => (row === 0 ? 0 : row < 3 ? 1 : 2);

export const bunkerX = (i) => Math.round(((i + 1) * INV.width) / (INV.bunkers + 1) - INV.bunkerCols);

// Classic bunker silhouette (1 = solid cell).
export function bunkerShape() {
  const cells = new Uint8Array(INV.bunkerCols * INV.bunkerRows);
  for (let r = 0; r < INV.bunkerRows; r++) {
    for (let c = 0; c < INV.bunkerCols; c++) {
      const top = r === 0 && (c < 2 || c > 9);
      const arch = r >= 5 && c >= 4 && c <= 7;
      cells[r * INV.bunkerCols + c] = top || arch ? 0 : 1;
    }
  }
  return cells;
}

// Ship movement (shared with prediction): s = { p } = x centre.
export function stepShip(s, ax, dt) {
  stepPaddle(s, ax, dt, 8, INV.width - 8, INV.shipSpeed);
}
