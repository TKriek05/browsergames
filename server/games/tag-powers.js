// Neon Tikkertje power-ups on the server: orbs appear on free spots, the
// right role picks them up and the effect starts at once. Timers live on the
// runners (boost/slow are part of the shared physics, shield/reach only
// matter here). Definitions: shared/games/tag-powers.js.
import { POWERS, POWER, POWER_TUNING as PT, canTake } from '../../shared/games/tag-powers.js';
import { TAG_PHYS } from '../../shared/physics/tag.js';
import { TAG_FIELD } from '../../shared/maps/tag-arenas.js';

const SPOT_STEP = 20;
const EDGE = 14;
const WALL_MARGIN = 10;
const PLAYER_MARGIN = 24; // a new orb never appears right under somebody
const ORB_SPACING = 30;
const WARP_CHOICES = 3; // warp to one of the few spots furthest from the tagger

// Free spots on a grid: away from the walls and the edge of the field.
export function orbSpots(walls) {
  const out = [];
  for (let y = EDGE; y <= TAG_FIELD.height - EDGE; y += SPOT_STEP) {
    for (let x = EDGE; x <= TAG_FIELD.width - EDGE; x += SPOT_STEP) {
      const blocked = walls.some((w) => x > w.x - WALL_MARGIN && x < w.x + w.w + WALL_MARGIN && y > w.y - WALL_MARGIN && y < w.y + w.h + WALL_MARGIN);
      if (!blocked) out.push({ x, y });
    }
  }
  return out;
}

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export class TagPowers {
  constructor(game, enabled, rng = Math.random) {
    this.game = game;
    this.enabled = enabled;
    this.rng = rng;
    this.spots = orbSpots(game.walls);
    this.orbs = []; // { id, power, x, y, life }
    this.nextId = 1;
    this.spawnIn = PT.FIRST_SPAWN_S;
  }

  // Once per PLAY tick, after everybody moved.
  tick(dt, it) {
    for (const r of this.game.runners) {
      if (r.shield > 0) r.shield = Math.max(0, r.shield - dt);
      if (r.reach > 0) r.reach = Math.max(0, r.reach - dt);
    }
    if (!this.enabled) return;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      this.orbs[i].life -= dt;
      if (this.orbs[i].life <= 0) this.orbs.splice(i, 1);
    }
    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      this.spawnIn = PT.SPAWN_EVERY_S;
      if (this.orbs.length < PT.MAX_ORBS) this.spawn();
    }
    const reach = TAG_PHYS.RADIUS + PT.ORB_RADIUS;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const orb = this.orbs[i];
      const power = POWERS[orb.power];
      const taker = this.game.runners.find((r) => r.stun <= 0 && canTake(power, r === it) && dist2(r, orb) <= reach * reach);
      if (!taker) continue;
      this.orbs.splice(i, 1);
      this.apply(taker, power, it);
    }
  }

  spawn(power = this.pickPower()) {
    const busy = (s) => this.game.runners.some((r) => dist2(r, s) < PLAYER_MARGIN ** 2) || this.orbs.some((o) => dist2(o, s) < ORB_SPACING ** 2);
    const free = this.spots.filter((s) => !busy(s));
    if (!free.length) return null;
    const s = free[Math.floor(this.rng() * free.length)];
    const orb = { id: this.nextId, power, x: s.x, y: s.y, life: PT.ORB_LIFE_S };
    this.nextId = (this.nextId % 255) + 1;
    this.orbs.push(orb);
    return orb;
  }

  // Weighted random, but the tagger and the runners always have something to go for.
  pickPower() {
    const has = (role) => this.orbs.some((o) => POWERS[o.power].role === role || POWERS[o.power].role === 'any');
    let pool = POWERS;
    if (!has('run')) pool = POWERS.filter((p) => p.role !== 'it');
    else if (!has('it')) pool = POWERS.filter((p) => p.role !== 'run');
    let x = this.rng() * pool.reduce((sum, p) => sum + p.weight, 0);
    for (const p of pool) {
      x -= p.weight;
      if (x < 0) return p.id;
    }
    return pool[pool.length - 1].id;
  }

  apply(r, power, it) {
    const room = this.game.room;
    switch (power.id) {
      case POWER.TURBO:
        r.boost = PT.TURBO_S;
        break;
      case POWER.REACH:
        r.reach = PT.REACH_S;
        break;
      case POWER.SHIELD:
        r.shield = PT.SHIELD_S;
        break;
      case POWER.FREEZE:
        for (const o of this.game.runners) {
          if (o === r || dist2(o, r) > PT.FREEZE_RADIUS ** 2) continue;
          o.slow = PT.FREEZE_S;
          o.boost = 0; // a freeze wave also ends a turbo
        }
        break;
      case POWER.WARP: {
        const x0 = Math.round(r.x);
        const y0 = Math.round(r.y);
        const spot = this.safestSpot(it && it !== r ? it : null);
        r.x = spot.x;
        r.y = spot.y;
        r.vx = 0;
        r.vy = 0;
        room.emit('warp', { id: r.player.id, x0, y0, x: spot.x, y: spot.y });
        break;
      }
      default:
        break;
    }
    room.emit('power', { id: r.player.id, p: power.id, x: Math.round(r.x), y: Math.round(r.y) });
  }

  // One of the spots furthest from the tagger, not right next to another runner.
  safestSpot(it) {
    const options = this.spots.filter((s) => !this.game.runners.some((o) => dist2(o, s) < PLAYER_MARGIN ** 2));
    const list = (options.length ? options : this.spots).map((s) => ({ s, d: it ? dist2(it, s) : this.rng() }));
    list.sort((a, b) => b.d - a.d);
    return list[Math.floor(this.rng() * Math.min(WARP_CHOICES, list.length))].s;
  }

  // Closest orb this runner may take: { orb, d } or null (for the bots).
  nearestFor(r, isIt) {
    let best = null;
    for (const orb of this.orbs) {
      if (!canTake(POWERS[orb.power], isIt)) continue;
      const d = Math.sqrt(dist2(r, orb));
      if (!best || d < best.d) best = { orb, d };
    }
    return best;
  }

  // Snapshot part: u8 count, count × [u8 id, u8 power, u16 x, u16 y, u8 life (0.1 s)]
  write(w) {
    w.u8(this.orbs.length);
    for (const o of this.orbs) w.u8(o.id).u8(o.power).u16(o.x).u16(o.y).u8(Math.min(255, Math.ceil(o.life * 10)));
  }
}
