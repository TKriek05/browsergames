// Spetterveld power-ups on the server: every field has four pads. A pad gets
// a random power-up a few seconds into the match and again a while after it
// was taken. Walk over it to take it. Sprint is part of the shared runner
// state (predicted); the rest are server timers on the entity.
import { PB_PHYS } from '../../shared/physics/paintball.js';
import { PB_RULES, PB_POWER, PB_POWERS, PB_POWER_RULES as PR } from '../../shared/games/paintball.js';

export const PAD_EMPTY = 255;

export class PaintPowers {
  constructor(game, enabled) {
    this.game = game;
    this.enabled = enabled;
    this.pads = game.arena.pads.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0, type: PAD_EMPTY, timer: PR.FIRST_S }));
  }

  static clear(e) {
    e.rapid = 0;
    e.spread = 0;
    e.camo = 0;
    e.armor = 0;
    e.s.boost = 0;
  }

  tick(dt) {
    for (const e of this.game.ents) {
      if (e.rapid > 0) e.rapid = Math.max(0, e.rapid - dt);
      if (e.spread > 0) e.spread = Math.max(0, e.spread - dt);
      if (e.camo > 0) e.camo = Math.max(0, e.camo - dt);
    }
    if (!this.enabled) return;
    const reach = PB_PHYS.RADIUS + PR.PAD_R;
    for (const pad of this.pads) {
      if (pad.type === PAD_EMPTY) {
        pad.timer -= dt;
        if (pad.timer <= 0) pad.type = Math.floor(this.game.rng() * PB_POWERS.length);
        continue;
      }
      for (const e of this.game.ents) {
        if (!e.alive || (e.s.x - pad.x) ** 2 + (e.s.y - pad.y) ** 2 > reach * reach || Math.abs(e.s.z - pad.z) > PR.PAD_UP) continue;
        this.apply(e, pad.type);
        this.game.room.emit('power', { s: e.player.slot, type: pad.type, pad: this.pads.indexOf(pad) });
        pad.type = PAD_EMPTY;
        const [lo, hi] = PR.RESPAWN_S;
        pad.timer = lo + this.game.rng() * (hi - lo);
        break;
      }
    }
  }

  apply(e, type) {
    const seconds = PB_POWERS[type].seconds;
    switch (type) {
      case PB_POWER.RAPID:
        e.rapid = seconds;
        e.reload = 0;
        e.ammo = PB_RULES.HOPPER;
        break;
      case PB_POWER.SPREAD: e.spread = seconds; break;
      case PB_POWER.ARMOR: e.armor = PR.ARMOR; break;
      case PB_POWER.SPRINT: e.s.boost = Math.fround(seconds); break;
      case PB_POWER.CAMO: e.camo = seconds; break;
      default: break;
    }
  }

  // Snapshot part: u8 n × u8 type (PAD_EMPTY = nothing on the pad)
  write(w) {
    w.u8(this.pads.length);
    for (const pad of this.pads) w.u8(pad.type);
  }
}
