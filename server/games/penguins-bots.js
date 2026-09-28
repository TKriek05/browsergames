// Pinguïnbotsen bots: stay away from the edge, sneak around to the side of a
// victim that faces the middle and dash into them, so they fly outwards.
// Easy bots steer sloppily and dash at random moments.
import { PG } from '../../shared/games/penguins.js';

const LEVELS = {
  easy: { think: 0.5, margin: 20, err: 0.6, dashAlign: 0.55, dashRange: 46, careless: 0.25, lookAhead: 0.15 },
  normal: { think: 0.3, margin: 28, err: 0.3, dashAlign: 0.8, dashRange: 40, careless: 0.08, lookAhead: 0.35 },
  hard: { think: 0.16, margin: 32, err: 0.1, dashAlign: 0.85, dashRange: 38, careless: 0, lookAhead: 0.55 },
};

export function createPenguinBot() {
  return { think: 0, target: null, err: 0, out: { ax: 0, ay: 0, a: 0 } };
}

export function stepPenguinBot(e, game, dt, rng) {
  const cfg = LEVELS[e.player.botLevel] ?? LEVELS.normal;
  const b = e.bot;
  const out = b.out;
  const s = e.s;
  out.a = 0;
  b.think -= dt;
  if (b.think <= 0) {
    b.think = cfg.think * (0.7 + rng() * 0.6);
    b.err = (rng() - 0.5) * 2 * cfg.err;
    let best = null;
    let bestD = Infinity;
    for (const o of game.ents) {
      if (o === e || !o.alive) continue;
      // Prefer victims close to the edge and close to us.
      const d = Math.hypot(o.s.x - s.x, o.s.y - s.y) - Math.hypot(o.s.x, o.s.y) * 0.6;
      if (d < bestD) { bestD = d; best = o; }
    }
    b.target = best;
    if (rng() < cfg.careless && s.cool <= 0) out.a = 1; // a random dash now and then
  }

  const R = game.radius;
  const dist = Math.hypot(s.x, s.y) || 1;
  // Where we slide to in a moment (ice!): recover before it is too late.
  const ahead = cfg.lookAhead;
  const px = s.x + s.vx * ahead;
  const py = s.y + s.vy * ahead;
  let mx;
  let my;
  if (dist > R - cfg.margin || Math.hypot(px, py) > R - cfg.margin * 0.6) {
    // Too close to the water: back to the middle (and brake the outward speed).
    mx = -s.x / dist - s.vx * 0.012;
    my = -s.y / dist - s.vy * 0.012;
  } else if (b.target) {
    const t = b.target.s;
    const td = Math.hypot(t.x, t.y) || 1;
    // Get between the middle and the victim, then charge outwards through them.
    const gx = t.x - (t.x / td) * 18;
    const gy = t.y - (t.y / td) * 18;
    const toX = t.x - s.x;
    const toY = t.y - s.y;
    const toD = Math.hypot(toX, toY) || 1;
    const align = (toX * t.x + toY * t.y) / (toD * td); // 1 = pushing straight outwards
    if (align > 0.3 || toD < 24) {
      mx = toX / toD;
      my = toY / toD;
    } else {
      mx = gx - s.x;
      my = gy - s.y;
    }
    // Only dash when it is (nearly) sure to hit, or when a miss does not send us into the sea.
    const miss = Math.hypot(s.x + (toX / toD) * 80, s.y + (toY / toD) * 80);
    const safe = toD < 22 || miss < R - 12 || cfg.careless > 0.2;
    if (toD < cfg.dashRange && align > cfg.dashAlign && s.cool <= 0 && safe) out.a = 1;
    // Anticipate: lean against our own sliding speed.
    mx -= s.vx * 0.006;
    my -= s.vy * 0.006;
  } else {
    mx = -s.x;
    my = -s.y;
  }
  // Steering error.
  const c = Math.cos(b.err);
  const sn = Math.sin(b.err);
  const rx = mx * c - my * sn;
  const ry = mx * sn + my * c;
  const l = Math.hypot(rx, ry) || 1;
  out.ax = rx / l;
  out.ay = ry / l;
  // The dash goes where we face: make sure we face the stick direction.
  if (out.a && Math.hypot(s.vx, s.vy) > PG.MAX_SPEED * 0.9) out.a = 0; // already flying
  return out;
}
