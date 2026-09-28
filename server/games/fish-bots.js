// Hapvis bots: flee from fish that can eat them, chase fish they can eat,
// otherwise graze on the nearest plankton. Better bots see further, react
// faster, lead their prey and use the dash at the right moment.
import { FISH, fishRadius, canEat } from '../../shared/games/fish.js';

const LEVELS = {
  easy: { think: 0.5, sight: 150, lead: 0, dash: 0.1, fear: 0.8 },
  normal: { think: 0.28, sight: 230, lead: 0.5, dash: 0.5, fear: 1 },
  hard: { think: 0.15, sight: 320, lead: 1, dash: 0.9, fear: 1.2 },
};

export function createFishBot() {
  return { think: 0, tx: 0, ty: 0, dash: false, out: { ax: 0, ay: 0, a: 0 } };
}

export function stepFishBot(e, game, dt, rng) {
  const cfg = LEVELS[e.player.botLevel] ?? LEVELS.normal;
  const b = e.bot;
  const out = b.out;
  const s = e.s;
  out.a = 0;
  b.think -= dt;
  if (b.think <= 0) {
    b.think = cfg.think * (0.8 + rng() * 0.4);
    b.dash = false;
    let fx = 0;
    let fy = 0;
    let danger = false;
    let prey = null;
    let preyD = Infinity;
    for (const o of game.ents) {
      if (o === e || !o.alive) continue;
      const dx = o.s.x - s.x;
      const dy = o.s.y - s.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > cfg.sight) continue;
      if (canEat(o.s, s)) {
        // Flee: the closer, the stronger.
        const w = (cfg.fear * (cfg.sight - d)) / cfg.sight;
        fx -= (dx / d) * w;
        fy -= (dy / d) * w;
        danger = true;
        if (d < fishRadius(o.s.mass) + 40 && rng() < cfg.dash) b.dash = true;
      } else if (canEat(s, o.s) && d < preyD) {
        prey = o;
        preyD = d;
      }
    }
    if (danger) {
      // Stay away from the walls while fleeing.
      fx += (FISH.WIDTH / 2 - s.x) / FISH.WIDTH;
      fy += (FISH.HEIGHT / 2 - s.y) / FISH.HEIGHT;
      b.tx = s.x + fx * 100;
      b.ty = s.y + fy * 100;
    } else if (prey) {
      const t = (preyD / 120) * cfg.lead;
      b.tx = prey.s.x + prey.s.vx * t;
      b.ty = prey.s.y + prey.s.vy * t;
      if (preyD < fishRadius(s.mass) + 50 && rng() < cfg.dash) b.dash = true;
    } else {
      // Nearest plankton (with a little randomness for the weaker bots).
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < FISH.PLANKTON; i++) {
        if (!game.food[i]) continue;
        const d = Math.hypot(game.spots.xs[i] - s.x, game.spots.ys[i] - s.y) * (1 + rng() * (1 - cfg.lead) * 0.6);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) {
        b.tx = game.spots.xs[best];
        b.ty = game.spots.ys[best];
      } else {
        b.tx = FISH.WIDTH / 2;
        b.ty = FISH.HEIGHT / 2;
      }
    }
  }
  const dx = b.tx - s.x;
  const dy = b.ty - s.y;
  const d = Math.hypot(dx, dy);
  out.ax = d > 2 ? dx / d : 0;
  out.ay = d > 2 ? dy / d : 0;
  if (b.dash && s.cool <= 0) {
    out.a = 1;
    b.dash = false;
  }
  return out;
}
