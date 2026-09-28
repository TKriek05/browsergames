// Knalkanon bots: pick a victim, then search angle × power with the real
// shell flight (wind included) for the shot that lands closest, avoiding
// shots that would hurt themselves. The level decides how much the final
// aim wobbles and how clever the weapon choice is.
import { WEAPONS, flyShell, muzzle } from '../../shared/games/artillery.js';

const ERROR = {
  easy: { angle: 5, power: 6 },
  normal: { angle: 2.5, power: 3.5 },
  hard: { angle: 0.8, power: 1.2 },
};

function gauss(rng) {
  return (rng() + rng() + rng() - 1.5) / 1.5; // roughly -1 … 1, peaked around 0
}

export function planShot(game, c, level, rng) {
  const others = [...game.cannons.values()].filter((o) => o.alive && o !== c);
  if (!others.length) return { angle: c.angle, power: c.power, weapon: 0 };
  // Victim: easy = random, normal = nearest, hard = the weakest in reach.
  let target;
  if (level === 'easy') target = others[Math.floor(rng() * others.length)];
  else if (level === 'hard') target = others.reduce((a, b) => (b.hp - Math.abs(b.x - c.x) * 0.05 < a.hp - Math.abs(a.x - c.x) * 0.05 ? b : a));
  else target = others.reduce((a, b) => (Math.abs(b.x - c.x) < Math.abs(a.x - c.x) ? b : a));

  const targets = [...game.cannons.values()].filter((o) => o.alive).map((o) => ({ id: o.player.id, x: o.x, y: o.y }));
  const right = target.x > c.x;
  let best = { angle: right ? 50 : 130, power: 60, miss: Infinity };
  const lo = right ? 18 : 92;
  const hi = right ? 88 : 162;
  for (let angle = lo; angle <= hi; angle += 5) {
    const start = muzzle(c.x, c.y, angle);
    // Binary search the power along the ground distance.
    let pLo = 12;
    let pHi = 100;
    for (let k = 0; k < 9; k++) {
      const power = (pLo + pHi) / 2;
      const res = flyShell(game.terrain, start.x, start.y, angle, power, game.wind, targets, c.player.id);
      const miss = res.hit === target.player.id ? 0 : Math.hypot(res.x - target.x, res.y - target.y);
      const selfHurt = Math.hypot(res.x - c.x, res.y - c.y) < WEAPONS[0].radius + 12;
      if (!selfHurt && miss < best.miss) best = { angle, power, miss };
      // Landed short (towards us) → more power; long → less.
      const short = right ? res.x < target.x : res.x > target.x;
      if (res.out && res.y > 0) pHi = power; // flew off the far side
      else if (short) pLo = power;
      else pHi = power;
    }
  }
  const err = ERROR[level] ?? ERROR.normal;
  const angle = Math.max(0, Math.min(180, best.angle + gauss(rng) * err.angle));
  const power = Math.max(8, Math.min(100, best.power + gauss(rng) * err.power));
  // Weapons: the big one to finish off or for a sure hit, three shells against a group.
  let weapon = 0;
  if (level !== 'easy') {
    const group = others.filter((o) => Math.abs(o.x - target.x) < 45).length > 1;
    if (c.ammo[2] > 0 && group) weapon = 2;
    else if (c.ammo[1] > 0 && (target.hp <= WEAPONS[1].damage || (level === 'hard' && best.miss < 12))) weapon = 1;
  }
  return { angle: Math.round(angle * 10) / 10, power: Math.round(power * 10) / 10, weapon };
}

