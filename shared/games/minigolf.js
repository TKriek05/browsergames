// Minigolf: the nine holes and the ball physics. The server simulates;
// the client uses the same course data to build the 3D scene.
export const BALL_R = 2.5;
export const CUP_R = 4;
export const MAX_POWER = 270; // units/s at full power
export const MAX_STROKES = 8;
export const GIVE_UP_SCORE = MAX_STROKES + 1; // not holed (stroke limit or time up)
export const BALL_STATE = { REST: 0, ROLLING: 1, SUNK: 2, OUT: 3 };
export const FRICTION = 62; // deceleration on the green (units/s²)
const SAND_FACTOR = 4;
const WALL_BOUNCE = 0.72;
const BUMPER_BOUNCE = 1.25;
const SINK_SPEED = 95; // faster than this and the ball skips over the cup
const STOP_SPEED = 3;

const rect = (x, y, w, h) => ({ x, y, w, h });

export const HOLES = [
  { name: 'Rechtdoor', par: 2, tee: [65, 80], cup: [212, 80], outline: [[40, 55], [240, 55], [240, 105], [40, 105]] },
  { name: 'Het hoekje', par: 3, tee: [55, 90], cup: [215, 42], outline: [[30, 110], [30, 70], [190, 70], [190, 20], [240, 20], [240, 110]] },
  {
    name: 'Bumperbaan', par: 3, tee: [50, 80], cup: [228, 80], outline: [[30, 40], [250, 40], [250, 120], [30, 120]],
    bumpers: [{ x: 110, y: 64, r: 8 }, { x: 110, y: 96, r: 8 }, { x: 150, y: 80, r: 10 }, { x: 192, y: 60, r: 7 }, { x: 192, y: 100, r: 7 }],
  },
  {
    name: 'Zandbak', par: 3, tee: [60, 100], cup: [220, 80], outline: [[40, 40], [240, 40], [240, 120], [40, 120]],
    blocks: [rect(95, 40, 10, 48)],
    sand: [rect(170, 40, 70, 24), rect(170, 96, 70, 24), rect(122, 64, 28, 32)],
  },
  {
    name: 'Water overs', par: 3, tee: [55, 80], cup: [220, 70], outline: [[30, 40], [250, 40], [250, 120], [30, 120]],
    water: [rect(110, 40, 45, 50), rect(110, 110, 45, 10)],
  },
  {
    name: 'De heuvel', par: 3, tee: [50, 95], cup: [225, 95], outline: [[30, 45], [250, 45], [250, 115], [30, 115]],
    slopes: [{ ...rect(90, 45, 100, 70), gx: 0, gy: -70 }],
  },
  {
    name: 'Zigzag', par: 4, tee: [40, 45], cup: [238, 115], outline: [[20, 20], [140, 20], [140, 90], [260, 90], [260, 140], [100, 140], [100, 70], [20, 70]],
    bumpers: [{ x: 180, y: 115, r: 6 }],
  },
  {
    name: 'Het eiland', par: 3, tee: [50, 80], cup: [190, 80], outline: [[30, 30], [250, 30], [250, 130], [30, 130]],
    sand: [rect(165, 55, 50, 10), rect(165, 95, 50, 10), rect(165, 65, 10, 30), rect(205, 65, 10, 30)],
    water: [rect(100, 30, 30, 40), rect(100, 90, 30, 40)],
  },
  {
    name: 'Neon finale', par: 4, tee: [45, 110], cup: [240, 55], outline: [[20, 30], [260, 30], [260, 130], [20, 130]],
    blocks: [rect(80, 30, 12, 60), rect(140, 70, 12, 60), rect(200, 30, 12, 60)],
    bumpers: [{ x: 112, y: 105, r: 7 }, { x: 170, y: 55, r: 7 }, { x: 232, y: 105, r: 7 }],
  },
].map((h) => ({ bumpers: [], blocks: [], sand: [], water: [], slopes: [], ...h }));

// Which holes a game of 3, 6 or 9 holes plays.
const HOLE_SETS = { 3: [0, 4, 8], 6: [0, 2, 3, 4, 6, 8], 9: [0, 1, 2, 3, 4, 5, 6, 7, 8] };
export const holeSet = (n) => (HOLE_SETS[n] ?? HOLE_SETS[9]).slice();

// All wall segments of a hole (the outline plus the block rectangles),
// flattened for the hot loop: [ax, ay, ex, ey, 1/len²] per segment.
export function wallSegments(hole) {
  const list = [];
  const o = hole.outline;
  for (let i = 0; i < o.length; i++) list.push([o[i], o[(i + 1) % o.length]]);
  for (const b of hole.blocks) {
    const p = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
    for (let i = 0; i < 4; i++) list.push([p[i], p[(i + 1) % 4]]);
  }
  const segs = new Float64Array(list.length * 5);
  list.forEach(([[ax, ay], [bx, by]], i) => {
    const ex = bx - ax;
    const ey = by - ay;
    segs.set([ax, ay, ex, ey, 1 / (ex * ex + ey * ey)], i * 5);
  });
  return segs;
}

export const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export function inPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const onCourse = (hole, x, y) => inPolygon(hole.outline, x, y) && !inAny(hole.blocks, x, y);

function inAny(rects, x, y) {
  for (let i = 0; i < rects.length; i++) if (inRect(rects[i], x, y)) return true;
  return false;
}

// Advance a ball { x, y, vx, vy } by dt. Returns an event or null:
// 'sink' | 'water' | 'bumper' | 'wall' | 'stop'. Server-only (not predicted),
// but kept allocation-free because the bots simulate hundreds of shots.
export function stepBall(ball, hole, segs, dt) {
  let event = null;
  if (ball.vx === 0 && ball.vy === 0) return null;
  let decel = FRICTION * (inAny(hole.sand, ball.x, ball.y) ? SAND_FACTOR : 1) * dt;
  for (let i = 0; i < hole.slopes.length; i++) {
    const s = hole.slopes[i];
    if (!inRect(s, ball.x, ball.y)) continue;
    ball.vx += s.gx * dt;
    ball.vy += s.gy * dt;
    decel *= 0.6;
  }
  const sp = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  const keep = sp > decel ? (sp - decel) / sp : 0;
  ball.vx *= keep;
  ball.vy *= keep;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Walls (circle vs segment)
  for (let i = 0; i < segs.length; i += 5) {
    const ax = segs[i];
    const ay = segs[i + 1];
    const ex = segs[i + 2];
    const ey = segs[i + 3];
    let t = ((ball.x - ax) * ex + (ball.y - ay) * ey) * segs[i + 4];
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + ex * t;
    const py = ay + ey * t;
    const dx = ball.x - px;
    const dy = ball.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 >= BALL_R * BALL_R || d2 === 0) continue;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    ball.x = px + nx * BALL_R;
    ball.y = py + ny * BALL_R;
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      ball.vx -= (1 + WALL_BOUNCE) * vn * nx;
      ball.vy -= (1 + WALL_BOUNCE) * vn * ny;
      event = 'wall';
    }
  }
  // Bumpers
  for (let i = 0; i < hole.bumpers.length; i++) {
    const b = hole.bumpers[i];
    const dx = ball.x - b.x;
    const dy = ball.y - b.y;
    const reach = b.r + BALL_R;
    const d2 = dx * dx + dy * dy;
    if (d2 >= reach * reach) continue;
    const d = Math.sqrt(d2) || 1;
    const nx = dx / d;
    const ny = dy / d;
    ball.x = b.x + nx * reach;
    ball.y = b.y + ny * reach;
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      ball.vx -= (1 + BUMPER_BOUNCE) * vn * nx;
      ball.vy -= (1 + BUMPER_BOUNCE) * vn * ny;
      event = 'bumper';
    }
  }
  if (inAny(hole.water, ball.x, ball.y)) return 'water';
  const cdx = ball.x - hole.cup[0];
  const cdy = ball.y - hole.cup[1];
  const v2 = ball.vx * ball.vx + ball.vy * ball.vy;
  if (cdx * cdx + cdy * cdy < CUP_R * CUP_R && v2 < SINK_SPEED * SINK_SPEED) return 'sink';
  if (!onCourse(hole, ball.x, ball.y)) return 'water'; // squeezed out somehow: treat as out of bounds
  if (v2 < STOP_SPEED * STOP_SPEED) {
    ball.vx = 0;
    ball.vy = 0;
    return 'stop';
  }
  return event;
}

// Simulate a whole shot (used by bots). Returns { x, y, sunk, water }.
export function simulateShot(hole, segs, x, y, angle, power, maxSteps = 900) {
  const ball = { x, y, vx: Math.cos(angle) * power * MAX_POWER, vy: Math.sin(angle) * power * MAX_POWER };
  const dt = 1 / 120;
  for (let i = 0; i < maxSteps; i++) {
    const ev = stepBall(ball, hole, segs, dt);
    if (ev === 'sink') return { x: hole.cup[0], y: hole.cup[1], sunk: true, water: false };
    if (ev === 'water') return { x, y, sunk: false, water: true };
    if (ev === 'stop') break;
  }
  return { x: ball.x, y: ball.y, sunk: false, water: false };
}
