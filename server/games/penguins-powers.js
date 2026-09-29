// Pinguïnbotsen power-ups on the server: every few seconds something lands
// on the ice (at most PG_POWER_RULES.MAX at once); slide over it to take it.
// Items near the edge sink when the floe melts under them.
import { PG, PG_POWER, PG_POWERS, PG_POWER_RULES as PR } from '../../shared/games/penguins.js';

const TOTAL_WEIGHT = PG_POWERS.reduce((a, p) => a + p.weight, 0);
const f = Math.fround;

export class PenguinPowers {
  constructor(game, enabled) {
    this.game = game;
    this.enabled = enabled;
    this.list = []; // { id, type, x, y, age }
    this.nextId = 1;
    this.timer = 0;
    this.reset();
  }

  // New round: an empty floe, the first item after a few seconds.
  reset() {
    this.list.length = 0;
    this.timer = 2 + this.game.rng() * 1.5;
  }

  static clear(e) {
    e.heavy = 0;
    e.punch = 0;
  }

  tick(dt) {
    for (const e of this.game.ents) {
      if (e.heavy > 0) e.heavy = Math.max(0, e.heavy - dt);
      if (e.punch > 0) e.punch = Math.max(0, e.punch - dt);
    }
    if (!this.enabled) return;
    const radius = this.game.radius;
    this.timer -= dt;
    if (this.timer <= 0) {
      const [lo, hi] = PR.EVERY_S;
      this.timer = lo + this.game.rng() * (hi - lo);
      if (this.list.length < PR.MAX && radius > 30) this.spawn();
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      if (p.age > PR.LIFE_S || Math.hypot(p.x, p.y) > radius - 3) {
        this.list.splice(i, 1);
        continue;
      }
      const reach = PG.RADIUS + PR.RADIUS;
      for (const e of this.game.ents) {
        if (!e.alive || (e.s.x - p.x) ** 2 + (e.s.y - p.y) ** 2 > reach * reach) continue;
        this.apply(e, p.type);
        this.game.room.emit('power', { s: e.player.slot, type: p.type, x: Math.round(p.x), y: Math.round(p.y) });
        this.list.splice(i, 1);
        break;
      }
    }
  }

  // Somewhere on the ice, away from the penguins.
  spawn(type = this.roll()) {
    const rng = this.game.rng;
    const r = Math.max(10, this.game.radius - 22);
    let best = null;
    let bestD = -1;
    for (let k = 0; k < 8; k++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * r;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      let near = Infinity;
      for (const e of this.game.ents) if (e.alive) near = Math.min(near, Math.hypot(e.s.x - x, e.s.y - y));
      if (near > bestD) { bestD = near; best = { x, y }; }
    }
    const p = { id: this.nextId, type, x: best.x, y: best.y, age: 0 };
    this.nextId = (this.nextId % 255) + 1;
    this.list.push(p);
    return p;
  }

  roll() {
    let r = this.game.rng() * TOTAL_WEIGHT;
    for (let i = 0; i < PG_POWERS.length; i++) {
      r -= PG_POWERS[i].weight;
      if (r <= 0) return i;
    }
    return 0;
  }

  apply(e, type) {
    const seconds = PG_POWERS[type].seconds;
    switch (type) {
      case PG_POWER.TURBO: e.s.boost = f(seconds); break;
      case PG_POWER.GRIP: e.s.grip = f(seconds); break;
      case PG_POWER.HEAVY: e.heavy = seconds; break;
      case PG_POWER.PUNCH: e.punch = seconds; break;
      case PG_POWER.SHOCK: this.shock(e); break;
      default: break;
    }
  }

  // Everyone close by flies away from e (heavy ones less far).
  shock(e) {
    const game = this.game;
    for (const o of game.ents) {
      if (o === e || !o.alive) continue;
      const dx = o.s.x - e.s.x;
      const dy = o.s.y - e.s.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > PR.SHOCK_RANGE) continue;
      const k = (PR.SHOCK_SPEED * (1 - (d / PR.SHOCK_RANGE) * 0.5)) / (o.heavy > 0 ? PR.HEAVY_MASS : 1);
      o.s.vx = f(o.s.vx + (dx / d) * k);
      o.s.vy = f(o.s.vy + (dy / d) * k);
      o.s.stun = f(Math.max(o.s.stun, PG.STUN_S));
      o.s.dash = 0;
      o.hit = { by: e, t: game.roundTime };
    }
    game.room.emit('shock', { s: e.player.slot, x: Math.round(e.s.x), y: Math.round(e.s.y) });
  }

  // Snapshot part: u8 m × [u8 id, u8 type, i16 x*10, i16 y*10, u8 age (quarter seconds)]
  write(w) {
    w.u8(this.list.length);
    for (const p of this.list) w.u8(p.id).u8(p.type).i16(Math.round(p.x * 10)).i16(Math.round(p.y * 10)).u8(Math.min(255, Math.floor(p.age * 4)));
  }
}
