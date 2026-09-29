// Kladderkoning bots: pick a spot with a lot of paint that is not theirs
// (other colours count a bit more than blank canvas) and not too far away,
// roll there, grab power-ups on the way and dash into anyone right in front
// of them. Better bots look at more spots, think faster and dash smarter.
import { KL } from '../../shared/games/kladder.js';

const LEVELS = {
  easy: { think: 0.7, samples: 5, err: 0.45, dash: 0.25, greed: 70, near: 0.35 },
  normal: { think: 0.4, samples: 10, err: 0.2, dash: 0.6, greed: 110, near: 0.6 },
  hard: { think: 0.22, samples: 16, err: 0.06, dash: 0.9, greed: 150, near: 0.8 },
};
const LOOK = 3; // cells around a spot that count for its score

export function createKladderBot() {
  return { think: 0, tx: 0, ty: 0, err: 0, out: { ax: 0, ay: 0, a: 0 } };
}

// How much paint there is to win around cell (col, row).
function spotValue(game, col, row, mine) {
  let v = 0;
  for (let y = Math.max(0, row - LOOK); y <= Math.min(KL.ROWS - 1, row + LOOK); y++) {
    for (let x = Math.max(0, col - LOOK); x <= Math.min(KL.COLS - 1, col + LOOK); x++) {
      const i = y * KL.COLS + x;
      if (game.blocked[i]) continue;
      const o = game.grid[i];
      if (o !== mine) v += o === 0 ? 1 : 1.3;
    }
  }
  return v;
}

// A straight line between two points that does not cross a block.
function clear(game, x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.ceil(d / (KL.CELL * 0.75));
  for (let k = 1; k < steps; k++) {
    const x = x0 + ((x1 - x0) * k) / steps;
    const y = y0 + ((y1 - y0) * k) / steps;
    const c = Math.floor(x / KL.CELL);
    const r = Math.floor(y / KL.CELL);
    if (c < 0 || r < 0 || c >= KL.COLS || r >= KL.ROWS || game.blocked[r * KL.COLS + c]) return false;
  }
  return true;
}

export function stepKladderBot(e, game, dt, rng) {
  const cfg = LEVELS[e.player.botLevel] ?? LEVELS.normal;
  const b = e.bot;
  const out = b.out;
  const s = e.s;
  out.a = 0;
  b.think -= dt;
  const reached = Math.hypot(b.tx - s.x, b.ty - s.y) < KL.CELL * 1.5;
  if (b.think <= 0 || reached) {
    b.think = cfg.think * (0.7 + rng() * 0.6);
    b.err = (rng() - 0.5) * 2 * cfg.err;
    const mine = game.owner(e);
    let best = null;
    let bestScore = -1;
    // A power-up close by?
    for (const p of game.powers) {
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      if (d < cfg.greed && clear(game, s.x, s.y, p.x, p.y)) {
        const score = 1000 - d;
        if (score > bestScore) { bestScore = score; best = { x: p.x, y: p.y }; }
      }
    }
    if (!best) {
      for (let k = 0; k < cfg.samples; k++) {
        // Half of the spots close by, half anywhere.
        let col;
        let row;
        if (rng() < cfg.near) {
          col = Math.floor(s.x / KL.CELL + (rng() - 0.5) * 16);
          row = Math.floor(s.y / KL.CELL + (rng() - 0.5) * 16);
        } else {
          col = Math.floor(rng() * KL.COLS);
          row = Math.floor(rng() * KL.ROWS);
        }
        col = Math.max(1, Math.min(KL.COLS - 2, col));
        row = Math.max(1, Math.min(KL.ROWS - 2, row));
        if (game.blocked[row * KL.COLS + col]) continue;
        const x = (col + 0.5) * KL.CELL;
        const y = (row + 0.5) * KL.CELL;
        if (!clear(game, s.x, s.y, x, y)) continue;
        const d = Math.hypot(x - s.x, y - s.y);
        const score = spotValue(game, col, row, mine) / (1 + d / 90);
        if (score > bestScore) { bestScore = score; best = { x, y }; }
      }
    }
    if (best) {
      b.tx = best.x;
      b.ty = best.y;
    } else if (reached || b.think <= 0) {
      b.tx = KL.CELL * (2 + rng() * (KL.COLS - 4));
      b.ty = KL.CELL * (2 + rng() * (KL.ROWS - 4));
    }
    // Dash into someone right in front of us.
    if (s.cool <= 0 && s.stun <= 0) {
      for (const o of game.ents) {
        if (o === e || o.s.stun > 0) continue;
        const dx = o.s.x - s.x;
        const dy = o.s.y - s.y;
        const d = Math.hypot(dx, dy);
        if (d < 40 && d > 1 && (dx * s.fx + dy * s.fy) / d > 0.85 && rng() < cfg.dash) {
          b.tx = o.s.x + o.s.vx * 0.15;
          b.ty = o.s.y + o.s.vy * 0.15;
          out.a = 1;
          break;
        }
      }
    }
  }
  const dx = b.tx - s.x;
  const dy = b.ty - s.y;
  const d = Math.hypot(dx, dy) || 1;
  const c = Math.cos(b.err);
  const sn = Math.sin(b.err);
  out.ax = (dx * c - dy * sn) / d;
  out.ay = (dx * sn + dy * c) / d;
  return out;
}

