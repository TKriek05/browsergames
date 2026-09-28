// Boemstad: arena, items and player movement shared by server and client.
// Movement is deterministic (+ - * /, Math.abs/floor, float32) so your own
// walker can be predicted.
export const BOMB_COLS = 15;
export const BOMB_ROWS = 13;
export const BTILE = 16;
export const BOMB_WORLD = { width: BOMB_COLS * BTILE, height: BOMB_ROWS * BTILE };
export const BT = { FLOOR: 0, WALL: 1, BLOCK: 2 };
export const ITEM = { BOMB: 0, RANGE: 1, SPEED: 2 };
export const ITEM_COLORS = ['#ff4d6d', '#ff9a3e', '#3ef0ff'];
export const HALF = 6.5; // half size of a player's hitbox
export const BASE_SPEED = 52;
export const SPEED_STEP = 9;
export const MAX_SPEED_LV = 4;
const SLIDE = 8.5; // this close to a lane you slide around a corner

// Spawn tiles; the tiles next to them stay free of blocks.
export const SPAWNS = [[1, 1], [13, 11], [13, 1], [1, 11], [7, 1], [7, 11]];

const f = Math.fround;
export const tileIndex = (tx, ty) => ty * BOMB_COLS + tx;
export const tileAt = (v) => Math.floor(v / BTILE);
export const centre = (t) => t * BTILE + BTILE / 2;

export function isFixedWall(tx, ty) {
  return tx === 0 || ty === 0 || tx === BOMB_COLS - 1 || ty === BOMB_ROWS - 1 || (tx % 2 === 0 && ty % 2 === 0);
}

// A fresh arena: walls, pillars and random blocks (density 0..1).
export function buildArena(rng, density = 0.72) {
  const tiles = new Uint8Array(BOMB_COLS * BOMB_ROWS);
  const free = new Set();
  for (const [x, y] of SPAWNS) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) free.add(tileIndex(x + dx, y + dy));
  for (let y = 0; y < BOMB_ROWS; y++) {
    for (let x = 0; x < BOMB_COLS; x++) {
      const i = tileIndex(x, y);
      if (isFixedWall(x, y)) tiles[i] = BT.WALL;
      else if (!free.has(i) && rng() < density) tiles[i] = BT.BLOCK;
    }
  }
  return tiles;
}

// Would a player box at (x, y) overlap a solid tile? Bomb tiles are solid,
// except the ones in `passBombs` (the bomb you are still standing on).
function blocked(x, y, tiles, bombs, passBombs) {
  const x0 = tileAt(x - HALF);
  const x1 = tileAt(x + HALF - 0.001);
  const y0 = tileAt(y - HALF);
  const y1 = tileAt(y + HALF - 0.001);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= BOMB_COLS || ty >= BOMB_ROWS) return true;
      const i = tileIndex(tx, ty);
      if (tiles[i] !== BT.FLOOR) return true;
      if (bombs[i] && !passBombs.includes(i)) return true;
    }
  }
  return false;
}

// Tiles a player box currently overlaps (to walk off a freshly placed bomb).
export function overlapped(x, y) {
  const out = [];
  for (let ty = tileAt(y - HALF); ty <= tileAt(y + HALF - 0.001); ty++) {
    for (let tx = tileAt(x - HALF); tx <= tileAt(x + HALF - 0.001); tx++) out.push(tileIndex(tx, ty));
  }
  return out;
}

// s: { x, y, dir, speed }. bombs: Uint8Array per tile (1 = bomb).
// One axis at a time (the stronger one); when blocked but close to a lane,
// slide around the corner like the classics.
export function stepWalker(s, ax, ay, dt, tiles, bombs) {
  let dx = 0;
  let dy = 0;
  const mx = ax < 0 ? -ax : ax;
  const my = ay < 0 ? -ay : ay;
  if (mx > 0.4 || my > 0.4) {
    if (mx >= my) dx = ax > 0 ? 1 : -1;
    else dy = ay > 0 ? 1 : -1;
  }
  if (!dx && !dy) return;
  s.dir = dx > 0 ? 0 : dy > 0 ? 1 : dx < 0 ? 2 : 3;
  const pass = overlapped(s.x, s.y);
  const step = (BASE_SPEED + SPEED_STEP * s.speed) * dt;
  if (dx) {
    const lane = centre(tileAt(s.y));
    const off = s.y - lane;
    if (!blocked(s.x + dx * step, s.y, tiles, bombs, pass)) {
      s.x += dx * step;
      if (off !== 0) s.y -= (off > 0 ? 1 : -1) * Math.min(off < 0 ? -off : off, step * 0.5);
    } else if ((off < 0 ? -off : off) < SLIDE && !blocked(s.x + dx * step, lane, tiles, bombs, pass)) {
      s.y -= (off > 0 ? 1 : -1) * Math.min(off < 0 ? -off : off, step);
    }
  } else {
    const lane = centre(tileAt(s.x));
    const off = s.x - lane;
    if (!blocked(s.x, s.y + dy * step, tiles, bombs, pass)) {
      s.y += dy * step;
      if (off !== 0) s.x -= (off > 0 ? 1 : -1) * Math.min(off < 0 ? -off : off, step * 0.5);
    } else if ((off < 0 ? -off : off) < SLIDE && !blocked(lane, s.y + dy * step, tiles, bombs, pass)) {
      s.x -= (off > 0 ? 1 : -1) * Math.min(off < 0 ? -off : off, step);
    }
  }
  s.x = f(s.x);
  s.y = f(s.y);
}

// Order in which the walls close in during sudden death (outer ring first).
export function spiralOrder() {
  const order = [];
  let x0 = 1, y0 = 1, x1 = BOMB_COLS - 2, y1 = BOMB_ROWS - 2;
  while (x0 <= x1 && y0 <= y1) {
    for (let x = x0; x <= x1; x++) order.push([x, y0]);
    for (let y = y0 + 1; y <= y1; y++) order.push([x1, y]);
    if (y1 > y0) for (let x = x1 - 1; x >= x0; x--) order.push([x, y1]);
    if (x1 > x0) for (let y = y1 - 1; y > y0; y--) order.push([x0, y]);
    x0++; y0++; x1--; y1--;
  }
  return order.filter(([x, y]) => !isFixedWall(x, y));
}
