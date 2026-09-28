// Bots for Kwek Kwek Knal: move a cursor towards a duck like a human hand
// would (limited speed, reaction time, a shaky aim) and pull the trigger
// when close enough. Bots shoot at the present, so no rewind is needed.
import { DUCK_FIELD, DUCK_STATE, DUCK_TYPES } from '../../shared/games/duckshoot.js';

// notice: seconds before a bot "sees" a freshly spawned duck.
const LEVELS = {
  easy: { speed: 150, react: 0.55, jitter: 5, tolerance: 5, lead: 0, decoyChance: 0.25, notice: 1.1 },
  normal: { speed: 240, react: 0.32, jitter: 3, tolerance: 3, lead: 0.08, decoyChance: 0.08, notice: 0.7 },
  hard: { speed: 400, react: 0.16, jitter: 1.2, tolerance: 2, lead: 0.12, decoyChance: 0, notice: 0.4 },
};
const VISIBLE_BELOW = DUCK_FIELD.grassY - 6;

export function createDuckBot() {
  return { target: 0, wait: 0.5, jx: 0, jy: 0 };
}

// Returns { x, y } when the bot fires this tick, else null.
export function stepDuckBot(s, ducks, dt, rng) {
  const cfg = LEVELS[s.player.botLevel] ?? LEVELS.normal;
  const b = s.bot;
  b.wait -= dt;

  let target = null;
  for (const d of ducks) if (d.id === b.target) target = d;
  if (!target || (target.state !== DUCK_STATE.FLY && target.state !== DUCK_STATE.ESCAPE)) {
    target = null;
    b.target = 0;
    if (b.wait > 0) return null;
    // Pick the flying duck closest to the cursor (a human's natural choice).
    let best = Infinity;
    for (const d of ducks) {
      if (d.state !== DUCK_STATE.FLY && d.state !== DUCK_STATE.ESCAPE) continue;
      if (d.age < cfg.notice || d.y > VISIBLE_BELOW) continue;
      if (DUCK_TYPES[d.type].points < 0 && rng() >= cfg.decoyChance) continue;
      const dist = Math.hypot(d.x - s.cx, d.y - s.cy);
      if (dist < best) { best = dist; target = d; }
    }
    if (!target) return null;
    b.target = target.id;
    b.wait = cfg.react * (0.7 + rng() * 0.6);
    b.jx = (rng() - 0.5) * 2 * cfg.jitter;
    b.jy = (rng() - 0.5) * 2 * cfg.jitter;
    return null;
  }

  // Move the cursor towards where the duck will be a moment from now.
  const aimX = target.x + target.vx * cfg.lead + b.jx;
  const aimY = target.y + target.vy * cfg.lead + b.jy;
  const dx = aimX - s.cx;
  const dy = aimY - s.cy;
  const dist = Math.hypot(dx, dy);
  const step = cfg.speed * dt;
  if (dist > step) {
    s.cx += (dx / dist) * step;
    s.cy += (dy / dist) * step;
  } else {
    s.cx = aimX;
    s.cy = aimY;
  }

  if (b.wait > 0 || s.cooldown > 0 || s.reload > 0 || s.ammo <= 0 || target.y > VISIBLE_BELOW) return null;
  const off = Math.hypot(target.x - s.cx, target.y - s.cy);
  if (off > DUCK_TYPES[target.type].radius + cfg.tolerance) return null;
  b.wait = cfg.react * 0.6;
  b.jx = (rng() - 0.5) * 2 * cfg.jitter;
  b.jy = (rng() - 0.5) * 2 * cfg.jitter;
  return { x: s.cx, y: s.cy };
}
