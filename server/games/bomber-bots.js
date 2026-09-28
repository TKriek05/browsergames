// Boemstad bots: a danger map of all blasts to come, flee when standing in
// one, only place a bomb when there is a way out, and otherwise go for
// power-ups, blocks and players (breadth-first search over the tiles).
import { BOMB_COLS, BOMB_ROWS, BT, BTILE, BASE_SPEED, SPEED_STEP, tileIndex, tileAt, centre } from '../../shared/games/bomber.js';

const LEVELS = {
  easy: { think: 0.6, careless: 0.25, hunt: 0.2 },
  normal: { think: 0.3, careless: 0.03, hunt: 0.5 },
  hard: { think: 0.12, careless: 0, hunt: 0.9 },
};
const N = BOMB_COLS * BOMB_ROWS;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Seconds until each tile burns (Infinity = safe). extra: a hypothetical bomb.
function dangerMap(game, extra = null) {
  const danger = new Float32Array(N).fill(Infinity);
  for (let i = 0; i < N; i++) if (game.flames[i] > 0) danger[i] = 0;
  const bombs = extra ? [...game.bombs, extra] : game.bombs;
  for (const b of bombs) {
    const mark = (x, y) => {
      const i = tileIndex(x, y);
      danger[i] = Math.min(danger[i], Math.max(0, b.fuse));
    };
    mark(b.x, b.y);
    for (const [dx, dy] of DIRS) {
      for (let k = 1; k <= b.range; k++) {
        const x = b.x + dx * k;
        const y = b.y + dy * k;
        const t = game.tiles[tileIndex(x, y)];
        if (t === BT.WALL) break;
        mark(x, y);
        if (t === BT.BLOCK) break;
      }
    }
  }
  return danger;
}

// BFS from `from`; goal(i) decides the target. Returns the path (tile indices, without start).
function search(game, from, goal, danger, maxSteps = N) {
  const prev = new Int16Array(N).fill(-1);
  const queue = [from];
  prev[from] = from;
  for (let h = 0; h < queue.length && h < maxSteps; h++) {
    const cur = queue[h];
    if (cur !== from && goal(cur)) {
      const path = [];
      for (let i = cur; i !== from; i = prev[i]) path.push(i);
      return path.reverse();
    }
    const cx = cur % BOMB_COLS;
    const cy = (cur - cx) / BOMB_COLS;
    for (const [dx, dy] of DIRS) {
      const ni = tileIndex(cx + dx, cy + dy);
      if (prev[ni] !== -1 || game.tiles[ni] !== BT.FLOOR || game.bombAt[ni]) continue;
      if (danger && danger[ni] < 0.4) continue; // never walk into fire that is about to happen
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  return null;
}

export function bomberBot(e, game, dt) {
  const cfg = LEVELS[e.player.botLevel] ?? LEVELS.normal;
  const b = e.bot;
  b.out = b.out ?? { ax: 0, ay: 0, bomb: false };
  const out = b.out;
  out.bomb = false;
  b.think = (b.think ?? 0) - dt;
  const me = tileIndex(tileAt(e.s.x), tileAt(e.s.y));
  const danger = dangerMap(game);

  if (danger[me] < Infinity) {
    // In a blast line: run to the nearest safe tile.
    b.path = search(game, me, (i) => danger[i] === Infinity, null) ?? b.path;
    b.think = cfg.think;
  } else if (b.think <= 0) {
    b.think = cfg.think * (0.8 + game.rng() * 0.4);
    b.path = plan(e, game, me, danger, cfg, out);
  }
  followPath(e, b, out);
  return out;
}

function plan(e, game, me, danger, cfg, out) {
  const mx = me % BOMB_COLS;
  const my = (me - mx) / BOMB_COLS;
  let mine = 0;
  for (const bomb of game.bombs) if (bomb.owner === e) mine++;
  const enemies = game.ents.filter((o) => o !== e && o.alive);

  // Worth a bomb here? A block next to us, or an enemy in the blast line.
  if (mine < e.bombsMax) {
    let worth = DIRS.some(([dx, dy]) => game.tiles[tileIndex(mx + dx, my + dy)] === BT.BLOCK);
    for (const o of enemies) {
      const ox = tileAt(o.s.x);
      const oy = tileAt(o.s.y);
      if ((ox === mx && Math.abs(oy - my) <= e.range) || (oy === my && Math.abs(ox - mx) <= e.range)) worth = worth || game.rng() < cfg.hunt + 0.3;
    }
    if (worth) {
      const bomb = { x: mx, y: my, fuse: 2.4, range: e.range };
      const after = dangerMap(game, bomb);
      const speed = BASE_SPEED + SPEED_STEP * e.s.speed;
      const escape = search(game, me, (i) => after[i] === Infinity, danger);
      const inTime = escape && (escape.length * BTILE) / speed < bomb.fuse - 0.5;
      if (inTime || game.rng() < cfg.careless) {
        out.bomb = true;
        return escape ?? [];
      }
    }
  }
  // Otherwise: power-ups first, then blocks, then (sometimes) players.
  const item = search(game, me, (i) => game.items[i] >= 0, danger, 60);
  if (item) return item;
  if (game.rng() < cfg.hunt && enemies.length) {
    const targets = new Set(enemies.map((o) => tileIndex(tileAt(o.s.x), tileAt(o.s.y))));
    const hunt = search(game, me, (i) => targets.has(i), danger);
    if (hunt) return hunt.slice(0, Math.max(1, hunt.length - 2));
  }
  const nearBlock = (i) => {
    const x = i % BOMB_COLS;
    const y = (i - x) / BOMB_COLS;
    return DIRS.some(([dx, dy]) => game.tiles[tileIndex(x + dx, y + dy)] === BT.BLOCK);
  };
  return search(game, me, nearBlock, danger) ?? [];
}

// Walk to the next tile centre on the path: first line up with the lane,
// then move along it (otherwise the walker gets stuck on pillar corners).
function followPath(e, b, out) {
  out.ax = 0;
  out.ay = 0;
  const path = b.path;
  if (!path || !path.length) return;
  const next = path[0];
  const tx = next % BOMB_COLS;
  const ty = (next - tx) / BOMB_COLS;
  const dx = centre(tx) - e.s.x;
  const dy = centre(ty) - e.s.y;
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) {
    path.shift();
    return;
  }
  const horizontal = tx !== tileAt(e.s.x);
  if (horizontal) {
    if (Math.abs(dy) > 1.5) out.ay = Math.sign(dy);
    else out.ax = Math.sign(dx);
  } else if (Math.abs(dx) > 1.5) out.ax = Math.sign(dx);
  else out.ay = Math.sign(dy);
}
