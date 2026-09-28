// Tank Tumult bots: breadth-first pathfinding over the tile grid, aiming
// with lead, reaction time, dodging incoming bullets and shooting crates
// that block the way. They steer with the same stick input as humans.
import { TANK_TILE, TANK_COLS, TANK_ROWS, TILE } from '../../shared/maps/tank-arenas.js';
import { TANK_RULES as R, POWERUP } from '../../shared/games/tanks.js';
import { lineOfSight } from '../../shared/physics/tanks.js';

export { lineOfSight };

const LEVELS = {
  easy: { think: 0.7, aimError: 0.22, reaction: 0.7, dodge: 0, lead: 0, keepDist: 64, fireRange: 150 },
  normal: { think: 0.4, aimError: 0.1, reaction: 0.35, dodge: 0.45, lead: 0.6, keepDist: 80, fireRange: 230 },
  hard: { think: 0.22, aimError: 0.035, reaction: 0.15, dodge: 0.95, lead: 1, keepDist: 96, fireRange: 330 },
};

const N = TANK_COLS * TANK_ROWS;
const prev = new Int16Array(N);
const queue = new Int16Array(N);

export function createTankBot() {
  return {
    think: 0, path: [], target: null, seen: 0, jitter: 0,
    dodgeT: 0, dodgeX: 0, dodgeY: 0, strafe: 1, strafeT: 0,
    out: { ax: 0, ay: 0, aim: 0, fire: false },
  };
}

const tileOf = (x, y) => Math.floor(y / TANK_TILE) * TANK_COLS + Math.floor(x / TANK_TILE);
const centerX = (i) => (i % TANK_COLS + 0.5) * TANK_TILE;
const centerY = (i) => (Math.floor(i / TANK_COLS) + 0.5) * TANK_TILE;

// Shortest 4-way path from tile `from` to `to`; crates count as passable
// (the bot shoots them). Returns tile indices without the start.
export function findPath(tiles, from, to) {
  if (from === to) return [];
  prev.fill(-1);
  let head = 0;
  let tail = 0;
  queue[tail++] = from;
  prev[from] = from;
  while (head < tail) {
    const cur = queue[head++];
    if (cur === to) break;
    const cx = cur % TANK_COLS;
    const cy = (cur - cx) / TANK_COLS;
    for (let k = 0; k < 4; k++) {
      const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= TANK_COLS || ny >= TANK_ROWS) continue;
      const ni = ny * TANK_COLS + nx;
      if (prev[ni] !== -1 || tiles[ni] === TILE.WALL) continue;
      prev[ni] = cur;
      queue[tail++] = ni;
    }
  }
  if (prev[to] === -1) return [];
  const path = [];
  for (let i = to; i !== from; i = prev[i]) path.push(i);
  return path.reverse();
}

export function stepTankBot(t, game, dt, rng) {
  const cfg = LEVELS[t.player.botLevel] ?? LEVELS.normal;
  const b = t.bot;
  const out = b.out;
  const s = t.s;
  out.fire = false;
  b.think -= dt;
  b.strafeT -= dt;
  b.dodgeT -= dt;

  if (b.think <= 0) {
    b.think = cfg.think * (0.8 + rng() * 0.4);
    b.jitter = (rng() - 0.5) * 2 * cfg.aimError;
    b.target = pickTarget(t, game);
    const goal = b.target ? tileOf(b.target.x, b.target.y) : tileOf(TANK_COLS * TANK_TILE / 2, TANK_ROWS * TANK_TILE / 2);
    b.path = findPath(game.tiles, tileOf(s.x, s.y), goal);
    if (cfg.dodge > 0 && rng() < cfg.dodge) planDodge(t, game, b);
  }

  // --- Movement ---
  let ax = 0;
  let ay = 0;
  const enemy = b.target?.tank ?? null;
  const seesEnemy = enemy && lineOfSight(game.tiles, s.x, s.y, enemy.s.x, enemy.s.y);
  const dist = enemy ? Math.hypot(enemy.s.x - s.x, enemy.s.y - s.y) : Infinity;
  let crate = -1;
  if (b.dodgeT > 0) {
    ax = b.dodgeX;
    ay = b.dodgeY;
  } else if (seesEnemy && dist < cfg.keepDist) {
    // Circle around the enemy at a safe distance.
    if (b.strafeT <= 0 || Math.abs(s.v) < 5) {
      b.strafe = -b.strafe;
      b.strafeT = 1 + rng() * 1.5;
    }
    const nx = (enemy.s.x - s.x) / dist;
    const ny = (enemy.s.y - s.y) / dist;
    ax = -ny * b.strafe - nx * 0.3;
    ay = nx * b.strafe - ny * 0.3;
  } else if (b.path.length) {
    let next = b.path[0];
    if (Math.hypot(centerX(next) - s.x, centerY(next) - s.y) < 5 && b.path.length > 1) {
      b.path.shift();
      next = b.path[0];
    }
    if (game.tiles[next] === TILE.CRATE) crate = next;
    else {
      ax = centerX(next) - s.x;
      ay = centerY(next) - s.y;
    }
  }
  const len = Math.hypot(ax, ay);
  out.ax = len > 0 ? ax / len : 0;
  out.ay = len > 0 ? ay / len : 0;

  // --- Aim + fire ---
  if (crate >= 0) {
    out.aim = Math.atan2(centerY(crate) - s.y, centerX(crate) - s.x);
    out.fire = t.cooldown <= 0;
    return out;
  }
  if (seesEnemy) {
    b.seen += dt;
    const flight = (dist / R.BULLET_SPEED) * cfg.lead;
    const tx = enemy.s.x + enemy.s.dx * enemy.s.v * flight;
    const ty = enemy.s.y + enemy.s.dy * enemy.s.v * flight;
    out.aim = Math.atan2(ty - s.y, tx - s.x) + b.jitter;
    out.fire = b.seen >= cfg.reaction && dist < cfg.fireRange && t.cooldown <= 0;
  } else {
    b.seen = 0;
    // Point the turret where we are going.
    if (len > 0) out.aim = Math.atan2(ay, ax);
  }
  return out;
}

// Nearest living enemy, or a power-up when hurt / when one is close.
function pickTarget(t, game) {
  const s = t.s;
  let best = null;
  let bestD = Infinity;
  for (const o of game.tanks) {
    if (o === t || !o.alive) continue;
    const d = Math.hypot(o.s.x - s.x, o.s.y - s.y);
    if (d < bestD) { bestD = d; best = { x: o.s.x, y: o.s.y, tank: o }; }
  }
  for (const p of game.pickups) {
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    const wanted = (t.hp < R.HP && p.type === POWERUP.REPAIR) || d < 60;
    if (wanted && d < bestD * 1.5) return { x: p.x, y: p.y, tank: null };
  }
  return best;
}

// A bullet will pass close by soon: step sideways, away from its line.
function planDodge(t, game, b) {
  const s = t.s;
  for (const bl of game.bullets) {
    if (bl.owner === t) continue;
    const rx = s.x - bl.x;
    const ry = s.y - bl.y;
    const v2 = bl.vx * bl.vx + bl.vy * bl.vy;
    const tc = (rx * bl.vx + ry * bl.vy) / v2;
    if (tc <= 0 || tc > 0.7) continue;
    const mx = rx - bl.vx * tc;
    const my = ry - bl.vy * tc;
    if (Math.hypot(mx, my) > 14) continue;
    const v = Math.sqrt(v2);
    let px = -bl.vy / v;
    let py = bl.vx / v;
    if (px * mx + py * my < 0) { px = -px; py = -py; }
    b.dodgeX = px;
    b.dodgeY = py;
    b.dodgeT = 0.35;
    return;
  }
}
