// Stenenbreker: field and levels shared by server and client.
import { stepPaddle } from '../physics/paddle.js';

export const BF = {
  width: 320,
  height: 180,
  top: 12, // HUD strip above the playfield
  cols: 14,
  rows: 8,
  brickW: 20,
  brickH: 7,
  gap: 2,
  x0: 6,
  y0: 22,
  paddleY: 168,
  paddleW: 32,
  wideW: 50,
  paddleH: 4,
  ballR: 2,
};

// Levels: one character per brick. . empty, 1 normal, 2 tough (two hits),
// # steel (cannot be broken).
export const LEVELS = [
  [
    '..............',
    '11111111111111',
    '11111111111111',
    '22222222222222',
    '11111111111111',
    '11111111111111',
    '..............',
    '..............',
  ],
  [
    '2............2',
    '22..111111..22',
    '.22.1.22.1.22.',
    '..221.22.122..',
    '...21111112...',
    '....#1111#....',
    '.....1111.....',
    '..............',
  ],
  [
    '#1111122111111',
    '1#11112211111#',
    '11#111221111#1',
    '222#122221#222',
    '1111#1221#1111',
    '11111#11#11111',
    '..............',
    '1111111111111.',
  ],
];

export const BRICK = { EMPTY: 0, NORMAL: 1, TOUGH: 2, STEEL: 9 };
export const brickX = (col) => BF.x0 + col * (BF.brickW + BF.gap);
export const brickY = (row) => BF.y0 + row * (BF.brickH + BF.gap);

// Paddle step shared with client prediction: s = { p, wide } (wide = seconds left).
export function stepBreakoutPaddle(s, ax, dt) {
  s.wide = Math.fround(s.wide - dt > 0 ? s.wide - dt : 0);
  const half = (s.wide > 0 ? BF.wideW : BF.paddleW) / 2;
  stepPaddle(s, ax, dt, half, BF.width - half);
}

// Power-up capsules
export const CAPS = [
  { key: 'wide', label: 'W', color: '#5ab4e8' },
  { key: 'multi', label: 'M', color: '#e8709a' },
  { key: 'slow', label: 'S', color: '#7ac86a' },
  { key: 'life', label: '+', color: '#f0c040' },
];

export function parseLevel(index) {
  const rows = LEVELS[index % LEVELS.length];
  const bricks = new Uint8Array(BF.cols * BF.rows);
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      bricks[r * BF.cols + c] = ch === '1' ? BRICK.NORMAL : ch === '2' ? BRICK.TOUGH : ch === '#' ? BRICK.STEEL : BRICK.EMPTY;
    });
  });
  return bricks;
}
