// Tank movement for Tank Tumult. Runs on the server (authoritative) and on
// the client (prediction), so it is deterministic: only + - * / and
// Math.sqrt, no trigonometry at runtime (the turn step is a literal), and
// every stored value goes through Math.fround (float32, like the snapshot).
//
// Controls are "arcade": push the stick where you want to go. The hull turns
// towards it and drives once it is roughly aligned; pull the stick backwards
// and the tank reverses instead of making a U-turn.
import { TANK_TILE, TANK_COLS, TANK_ROWS, TILE } from '../maps/tank-arenas.js';

export const TANK_PHYS = {
  DT: 1 / 30,
  RADIUS: 6.5,
  MAX_SPEED: 66,
  REVERSE_SPEED: 42,
  BOOST: 1.4, // speed factor with the speed power-up
  ACCEL: 240,
  // Turn step per tick: 0.105 rad (≈ 3.15 rad/s). Literals, not Math.cos(),
  // because trigonometry may differ in the last bit between JS engines.
  TURN_COS: 0.9944925627484974,
  TURN_SIN: 0.10480716882888248,
  REVERSE_DOT: -0.35, // stick this far behind the hull: drive backwards
};

const f = Math.fround;

export function createTankState(x = 0, y = 0) {
  return { x, y, dx: 1, dy: 0, v: 0, boost: 0 };
}

// s: { x, y, dx, dy, v, boost }. ax/ay: stick -1..1 (already quantized).
// tiles: Uint8Array of TILE.* (crates count as solid).
export function stepTank(s, ax, ay, dt, tiles) {
  const P = TANK_PHYS;
  const mag = Math.sqrt(ax * ax + ay * ay);
  let target = 0;
  if (mag > 0.2) {
    let tx = ax / mag;
    let ty = ay / mag;
    let dir = 1;
    if (s.dx * tx + s.dy * ty < P.REVERSE_DOT) {
      tx = -tx;
      ty = -ty;
      dir = -1;
    }
    turnToward(s, tx, ty);
    const dot = s.dx * tx + s.dy * ty;
    const align = dot > 0.3 ? (dot - 0.3) / 0.7 : 0;
    const top = (dir > 0 ? P.MAX_SPEED : P.REVERSE_SPEED) * (s.boost > 0 ? P.BOOST : 1);
    target = dir * top * (mag > 1 ? 1 : mag) * align;
  }
  const dv = P.ACCEL * dt;
  let v = s.v;
  if (v < target) v = v + dv > target ? target : v + dv;
  else v = v - dv < target ? target : v - dv;
  s.v = f(v);
  if (s.boost > 0) s.boost = f(s.boost - dt > 0 ? s.boost - dt : 0);

  s.x += s.dx * s.v * dt;
  s.y += s.dy * s.v * dt;
  collideTiles(s, tiles, P.RADIUS);
  s.x = f(s.x);
  s.y = f(s.y);
}

// Rotate the unit heading (dx, dy) towards (tx, ty) by at most one turn step.
function turnToward(s, tx, ty) {
  const { TURN_COS: C, TURN_SIN: S } = TANK_PHYS;
  const dot = s.dx * tx + s.dy * ty;
  let nx;
  let ny;
  if (dot >= C) {
    nx = tx;
    ny = ty;
  } else if (s.dx * ty - s.dy * tx >= 0) {
    nx = s.dx * C - s.dy * S;
    ny = s.dx * S + s.dy * C;
  } else {
    nx = s.dx * C + s.dy * S;
    ny = -s.dx * S + s.dy * C;
  }
  const len = Math.sqrt(nx * nx + ny * ny);
  s.dx = f(nx / len);
  s.dy = f(ny / len);
}

export function isSolid(tiles, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= TANK_COLS || ty >= TANK_ROWS) return true;
  return tiles[ty * TANK_COLS + tx] !== TILE.FLOOR;
}

// Push a circle out of every solid tile it overlaps (tiles around it only).
export function collideTiles(s, tiles, r) {
  const T = TANK_TILE;
  const x0 = Math.floor((s.x - r) / T);
  const x1 = Math.floor((s.x + r) / T);
  const y0 = Math.floor((s.y - r) / T);
  const y1 = Math.floor((s.y + r) / T);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!isSolid(tiles, tx, ty)) continue;
      const rx = tx * T;
      const ry = ty * T;
      const cx = s.x < rx ? rx : s.x > rx + T ? rx + T : s.x;
      const cy = s.y < ry ? ry : s.y > ry + T ? ry + T : s.y;
      const ddx = s.x - cx;
      const ddy = s.y - cy;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        s.x += (ddx / d) * (r - d);
        s.y += (ddy / d) * (r - d);
      } else {
        // Centre inside the tile: leave along the shortest axis.
        const left = s.x - rx, right = rx + T - s.x, top = s.y - ry, bottom = ry + T - s.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) s.x = rx - r;
        else if (m === right) s.x = rx + T + r;
        else if (m === top) s.y = ry - r;
        else s.y = ry + T + r;
      }
    }
  }
}

// Clear straight line (no walls or crates) between two points? Used by the
// bots on the server and by auto-aim on the client (not by the physics).
export function lineOfSight(tiles, x0, y0, x1, y1) {
  const dist = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
  const steps = Math.ceil(dist / 4);
  for (let i = 1; i < steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const y = y0 + ((y1 - y0) * i) / steps;
    if (isSolid(tiles, Math.floor(x / TANK_TILE), Math.floor(y / TANK_TILE))) return false;
  }
  return true;
}
