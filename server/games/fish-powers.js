// Hapvis power-ups on the server: bubbles appear every few seconds (at most
// FISH_POWER_RULES.MAX at once), drift slowly and pop after a while. Touch one
// to get its effect. Turbo lives in the shared fish state (predicted); spikes,
// magnet and double points are server-side timers on the entity.
import { FISH, FISH_POWER, FISH_POWERS, FISH_POWER_RULES as PR, fishRadius } from '../../shared/games/fish.js';

const MARGIN = 60;
const TOTAL_WEIGHT = FISH_POWERS.reduce((a, p) => a + p.weight, 0);

export class FishPowers {
  constructor(game, enabled) {
    this.game = game;
    this.enabled = enabled;
    this.list = []; // { id, type, x, y, vx, vy, age }
    this.nextId = 1;
    this.timer = 2 + game.rng() * 2;
  }

  // Timers on a fresh (or respawned) fish.
  static reset(e) {
    e.spikes = 0;
    e.magnet = 0;
    e.double = 0;
    e.stung = 0;
  }

  tick(dt) {
    for (const e of this.game.ents) {
      if (e.spikes > 0) e.spikes = Math.max(0, e.spikes - dt);
      if (e.magnet > 0) e.magnet = Math.max(0, e.magnet - dt);
      if (e.double > 0) e.double = Math.max(0, e.double - dt);
      if (e.stung > 0) e.stung = Math.max(0, e.stung - dt);
    }
    if (!this.enabled) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      const [lo, hi] = PR.EVERY_S;
      this.timer = lo + this.game.rng() * (hi - lo);
      if (this.list.length < PR.MAX) this.spawn();
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      p.x = Math.max(MARGIN, Math.min(FISH.WIDTH - MARGIN, p.x + p.vx * dt));
      p.y = Math.max(MARGIN, Math.min(FISH.HEIGHT - MARGIN, p.y + p.vy * dt));
      if (p.age > PR.LIFE_S) {
        this.list.splice(i, 1);
        continue;
      }
      for (const e of this.game.ents) {
        if (!e.alive) continue;
        const reach = fishRadius(e.s.mass) + PR.RADIUS;
        if ((e.s.x - p.x) ** 2 + (e.s.y - p.y) ** 2 > reach * reach) continue;
        this.apply(e, p.type);
        this.game.room.emit('power', { s: e.player.slot, type: p.type, x: Math.round(p.x), y: Math.round(p.y) });
        this.list.splice(i, 1);
        break;
      }
    }
  }

  // A new bubble somewhere away from the fish, drifting slowly.
  spawn(type = this.roll()) {
    const rng = this.game.rng;
    let best = null;
    let bestD = -1;
    for (let k = 0; k < 8; k++) {
      const x = MARGIN + rng() * (FISH.WIDTH - MARGIN * 2);
      const y = MARGIN + rng() * (FISH.HEIGHT - MARGIN * 2);
      let d = Infinity;
      for (const e of this.game.ents) if (e.alive) d = Math.min(d, Math.hypot(e.s.x - x, e.s.y - y));
      if (d > bestD) { bestD = d; best = { x, y }; }
    }
    const a = rng() * Math.PI * 2;
    const p = { id: this.nextId, type, x: best.x, y: best.y, vx: Math.cos(a) * 8, vy: Math.sin(a) * 8, age: 0 };
    this.nextId = (this.nextId % 255) + 1;
    this.list.push(p);
    return p;
  }

  roll() {
    let r = this.game.rng() * TOTAL_WEIGHT;
    for (let i = 0; i < FISH_POWERS.length; i++) {
      r -= FISH_POWERS[i].weight;
      if (r <= 0) return i;
    }
    return 0;
  }

  apply(e, type) {
    const seconds = FISH_POWERS[type].seconds;
    switch (type) {
      case FISH_POWER.TURBO:
        e.s.boost = Math.fround(seconds);
        break;
      case FISH_POWER.SPIKES:
        e.spikes = seconds;
        break;
      case FISH_POWER.MAGNET:
        e.magnet = seconds;
        break;
      case FISH_POWER.DOUBLE:
        e.double = seconds;
        break;
      case FISH_POWER.GROW:
        e.s.mass = Math.fround(e.s.mass + PR.GROW);
        this.game.award(e, PR.GROW);
        e.best = Math.max(e.best, e.s.mass);
        break;
      default:
        break;
    }
  }

  // A fish bites a spiky one: it loses some mass and bounces back.
  sting(a, b) {
    if (a.stung > 0) return;
    a.stung = 1;
    a.s.mass = Math.fround(Math.max(FISH.START_MASS, a.s.mass * (1 - PR.SPIKE_LOSS)));
    const dx = a.s.x - b.s.x;
    const dy = a.s.y - b.s.y;
    const d = Math.hypot(dx, dy) || 1;
    a.s.vx = Math.fround((dx / d) * PR.SPIKE_PUSH);
    a.s.vy = Math.fround((dy / d) * PR.SPIKE_PUSH);
    a.s.dash = 0;
    this.game.room.emit('spiked', { s: a.player.slot, v: b.player.slot, x: Math.round(b.s.x), y: Math.round(b.s.y) });
  }

  // Snapshot part: u8 n × [u8 id, u8 type, u16 x, u16 y, u8 age (quarter seconds)]
  write(w) {
    w.u8(this.list.length);
    for (const p of this.list) w.u8(p.id).u8(p.type).u16(Math.round(p.x)).u16(Math.round(p.y)).u8(Math.min(255, Math.floor(p.age * 4)));
  }
}
