// Kladderkoning: paint as much of the canvas as you can in your colour.
// Shared values, the maps, movement (deterministic: only + - * / and
// Math.sqrt, float32 via Math.fround, so the owner can predict it) and the
// cell helpers. Painting, dash hits and power-ups are decided by the server.

export const KL = {
  DT: 1 / 30,
  COLS: 60,
  ROWS: 40,
  CELL: 8, // world = 480 × 320
  RADIUS: 6,
  SPEED: 72,
  ACCEL: 520,
  DASH_SPEED: 190, // added on top of the normal speed
  DASH_S: 0.22,
  DASH_COOLDOWN_S: 2.2,
  STUN_S: 1.1, // after being splashed by a dash
  STUN_DRAG: 3, // per second while stunned
  TURBO: 1.4, // speed factor with the turbo power-up
  BRUSH: 11, // paint radius
  WIDE_BRUSH: 20,
  SPLASH_R: 24, // a dash hit splashes this much of your paint around the victim
  BOMB_R: 44,
};
export const KL_W = KL.COLS * KL.CELL;
export const KL_H = KL.ROWS * KL.CELL;
export const KL_CELLS = KL.COLS * KL.ROWS;

export const KL_FLAG = { BOT: 1, CONNECTED: 2, WIDE: 4, DASH: 8, STUN: 16 };

// Power-ups (setting 'powerups'); id = index = wire value.
export const KL_POWER = { WIDE: 0, TURBO: 1, BOMB: 2 };
export const KL_POWERS = [
  { id: 'wide', name: 'Brede roller', tip: 'Je verft een veel bredere baan', color: '#ff8a1e', seconds: 8 },
  { id: 'turbo', name: 'Turbo', tip: 'Je rolt een stuk sneller', color: '#2bd4a4', seconds: 6 },
  { id: 'bomb', name: 'Verfbom', tip: 'Een grote plens verf om je heen', color: '#ff5ab4', seconds: 0 },
];
export const KL_POWER_RULES = { MAX: 2, EVERY_S: [5, 8], FIRST_S: 4, LIFE_S: 14, RADIUS: 8 };

// --- Maps: obstacles as cell rectangles [col, row, cols, rows] ------------------------
// Mirrored left/right and top/bottom, so every spawn has the same chances.
function mirror4(list) {
  const out = [];
  for (const [c, r, w, h] of list) {
    out.push([c, r, w, h], [KL.COLS - c - w, r, w, h], [c, KL.ROWS - r - h, w, h], [KL.COLS - c - w, KL.ROWS - r - h, w, h]);
  }
  return out;
}

export const KL_MAPS = {
  atelier: {
    name: 'Atelier',
    blocks: [
      [28, 17, 4, 6, 'crate'],
      ...mirror4([[13, 8, 3, 3], [22, 5, 2, 2], [8, 16, 2, 3]]).map((b) => [...b, 'pot']),
    ],
  },
  open: {
    name: 'Leeg doek',
    blocks: [],
  },
  doolhof: {
    name: 'Doolhof',
    blocks: [
      [27, 14, 6, 2, 'crate'], [27, 24, 6, 2, 'crate'],
      ...mirror4([[10, 7, 10, 2], [10, 9, 2, 5], [22, 12, 2, 6], [4, 18, 7, 2]]).map((b) => [...b, 'crate']),
    ],
  },
};
export const KL_MAP_IDS = Object.keys(KL_MAPS);

// Spawns (world units): corners first, then the middle of the long sides.
export const KL_SPAWNS = [
  { x: 24, y: 24 }, { x: KL_W - 24, y: KL_H - 24 }, { x: KL_W - 24, y: 24 }, { x: 24, y: KL_H - 24 },
  { x: KL_W / 2, y: 16 }, { x: KL_W / 2, y: KL_H - 16 },
];

// Walls in world units ({ x, y, w, h }: centre and size) for the movement.
export function mapWalls(map) {
  return map.blocks.map(([c, r, w, h, kind]) => ({ x: (c + w / 2) * KL.CELL, y: (r + h / 2) * KL.CELL, w: w * KL.CELL, h: h * KL.CELL, kind }));
}

// 1 = a block stands on this cell (can not be painted).
export function blockedCells(map) {
  const b = new Uint8Array(KL_CELLS);
  for (const [c, r, w, h] of map.blocks) {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) b[y * KL.COLS + x] = 1;
  }
  return b;
}

// Calls fn(index) for every cell whose centre lies within r of (x, y).
export function forCellsInDisc(x, y, r, fn) {
  const C = KL.CELL;
  const c0 = Math.max(0, Math.floor((x - r) / C));
  const c1 = Math.min(KL.COLS - 1, Math.floor((x + r) / C));
  const r0 = Math.max(0, Math.floor((y - r) / C));
  const r1 = Math.min(KL.ROWS - 1, Math.floor((y + r) / C));
  const rr = r * r;
  for (let row = r0; row <= r1; row++) {
    const dy = (row + 0.5) * C - y;
    for (let col = c0; col <= c1; col++) {
      const dx = (col + 0.5) * C - x;
      if (dx * dx + dy * dy <= rr) fn(row * KL.COLS + col);
    }
  }
}

// --- Movement ------------------------------------------------------------------------------
const f = Math.fround;

export function createPainter(x = 0, y = 0) {
  return { x, y, vx: 0, vy: 0, fx: 1, fy: 0, dash: 0, cool: 0, prevA: 0, boost: 0, stun: 0 };
}

// One tick. ax/ay: stick (quantized), a: dash button (edge-triggered).
export function stepPainter(s, ax, ay, a, dt, walls) {
  const P = KL;
  if (s.cool > 0) s.cool = f(s.cool - dt > 0 ? s.cool - dt : 0);
  if (s.dash > 0) s.dash = f(s.dash - dt > 0 ? s.dash - dt : 0);
  if (s.boost > 0) s.boost = f(s.boost - dt > 0 ? s.boost - dt : 0);
  if (s.stun > 0) {
    // Splashed: sliding out, no control.
    s.stun = f(s.stun - dt > 0 ? s.stun - dt : 0);
    const drag = 1 - P.STUN_DRAG * dt;
    s.vx = f(s.vx * drag);
    s.vy = f(s.vy * drag);
    s.prevA = a ? 1 : 0;
  } else {
    const mag = Math.sqrt(ax * ax + ay * ay);
    let wx = 0;
    let wy = 0;
    if (mag > 0.15) {
      const k = mag > 1 ? 1 / mag : 1;
      wx = ax * k;
      wy = ay * k;
      s.fx = f(ax / mag);
      s.fy = f(ay / mag);
    }
    if (a && !s.prevA && s.cool <= 0) {
      s.dash = f(P.DASH_S);
      s.cool = f(P.DASH_COOLDOWN_S);
    }
    s.prevA = a ? 1 : 0;
    const speed = s.boost > 0 ? P.SPEED * P.TURBO : P.SPEED;
    if (s.dash > 0) {
      s.vx = f(s.fx * (speed + P.DASH_SPEED));
      s.vy = f(s.fy * (speed + P.DASH_SPEED));
    } else {
      let dvx = wx * speed - s.vx;
      let dvy = wy * speed - s.vy;
      const len = Math.sqrt(dvx * dvx + dvy * dvy);
      const max = P.ACCEL * dt;
      if (len > max) {
        dvx = (dvx / len) * max;
        dvy = (dvy / len) * max;
      }
      s.vx = f(s.vx + dvx);
      s.vy = f(s.vy + dvy);
    }
  }
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  collideWalls(s, walls, P.RADIUS);
  s.x = f(s.x);
  s.y = f(s.y);
}

// Push a circle out of the walls (boxes) and keep it on the canvas.
export function collideWalls(s, walls, r) {
  for (let i = 0; i < walls.length; i++) {
    const o = walls[i];
    const x0 = o.x - o.w / 2;
    const x1 = o.x + o.w / 2;
    const y0 = o.y - o.h / 2;
    const y1 = o.y + o.h / 2;
    if (s.x + r <= x0 || s.x - r >= x1 || s.y + r <= y0 || s.y - r >= y1) continue;
    const cx = s.x < x0 ? x0 : s.x > x1 ? x1 : s.x;
    const cy = s.y < y0 ? y0 : s.y > y1 ? y1 : s.y;
    const dx = s.x - cx;
    const dy = s.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      s.x = cx + (dx / d) * r;
      s.y = cy + (dy / d) * r;
    } else {
      const left = s.x - x0;
      const right = x1 - s.x;
      const top = s.y - y0;
      const bottom = y1 - s.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) s.x = x0 - r;
      else if (m === right) s.x = x1 + r;
      else if (m === top) s.y = y0 - r;
      else s.y = y1 + r;
    }
  }
  if (s.x < r) s.x = r;
  if (s.x > KL_W - r) s.x = KL_W - r;
  if (s.y < r) s.y = r;
  if (s.y > KL_H - r) s.y = KL_H - r;
}
