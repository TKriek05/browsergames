// Slangenstrijd bots: breadth-first search to the nearest apple, a flood
// fill to avoid dead ends, and (hard) staying away from other heads.
import { SNAKE_GRID as G, DIRS, opposite } from '../../shared/games/snake.js';

const LEVELS = {
  easy: { random: 0.2, flood: false, heads: false },
  normal: { random: 0.03, flood: true, heads: false },
  hard: { random: 0, flood: true, heads: true },
};

const N = G.cols * G.rows;
const seen = new Int32Array(N);
const queue = new Int32Array(N);
const firstDir = new Int8Array(N);
let stamp = 1;

const free = (occ, x, y) => x >= 0 && y >= 0 && x < G.cols && y < G.rows && occ[y * G.cols + x] === -1;

// Cells reachable from (x, y), capped at `limit`.
function floodSize(occ, x, y, limit) {
  stamp++;
  let head = 0;
  let tail = 0;
  queue[tail++] = y * G.cols + x;
  seen[y * G.cols + x] = stamp;
  while (head < tail && tail < limit) {
    const cur = queue[head++];
    const cx = cur % G.cols;
    const cy = (cur - cx) / G.cols;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!free(occ, nx, ny)) continue;
      const k = ny * G.cols + nx;
      if (seen[k] === stamp) continue;
      seen[k] = stamp;
      queue[tail++] = k;
    }
  }
  return tail;
}

// First direction on the shortest path to any apple, or -1.
function towardsFood(occ, food, hx, hy, dir) {
  if (!food.length) return -1;
  const isFood = new Set(food.map(([x, y]) => y * G.cols + x));
  stamp++;
  let head = 0;
  let tail = 0;
  const start = hy * G.cols + hx;
  seen[start] = stamp;
  for (let d = 0; d < 4; d++) {
    if (d === opposite(dir)) continue;
    const nx = hx + DIRS[d][0];
    const ny = hy + DIRS[d][1];
    if (!free(occ, nx, ny)) continue;
    const k = ny * G.cols + nx;
    seen[k] = stamp;
    firstDir[k] = d;
    queue[tail++] = k;
  }
  while (head < tail) {
    const cur = queue[head++];
    if (isFood.has(cur)) return firstDir[cur];
    const cx = cur % G.cols;
    const cy = (cur - cx) / G.cols;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!free(occ, nx, ny)) continue;
      const k = ny * G.cols + nx;
      if (seen[k] === stamp) continue;
      seen[k] = stamp;
      firstDir[k] = firstDir[cur];
      queue[tail++] = k;
    }
  }
  return -1;
}

export function botDirection(e, game) {
  const cfg = LEVELS[e.player.botLevel] ?? LEVELS.normal;
  const occ = game.occ;
  const [hx, hy] = e.cells[0];
  const options = [];
  for (let d = 0; d < 4; d++) {
    if (d === opposite(e.dir)) continue;
    const nx = hx + DIRS[d][0];
    const ny = hy + DIRS[d][1];
    if (free(occ, nx, ny)) options.push(d);
  }
  if (!options.length) return e.dir;
  if (game.rng() < cfg.random) return options[Math.floor(game.rng() * options.length)];

  const len = e.cells.length + e.grow;
  const score = new Map();
  for (const d of options) {
    const nx = hx + DIRS[d][0];
    const ny = hy + DIRS[d][1];
    let s = 0;
    if (cfg.flood) {
      const room = floodSize(occ, nx, ny, len * 2 + 20);
      if (room < len + 2) s -= 1000 - room;
    }
    if (cfg.heads) {
      for (const o of game.ents) {
        if (o === e || !o.alive) continue;
        const [ox, oy] = o.cells[0];
        if (Math.abs(ox - nx) + Math.abs(oy - ny) === 1) s -= 300;
      }
    }
    score.set(d, s);
  }
  const want = towardsFood(occ, game.food, hx, hy, e.dir);
  let best = options[0];
  let bestS = -Infinity;
  for (const d of options) {
    const s = score.get(d) + (d === want ? 50 : 0) + (d === e.dir ? 1 : 0);
    if (s > bestS) { bestS = s; best = d; }
  }
  return best;
}
