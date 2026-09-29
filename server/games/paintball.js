// Spetterveld (server side): first-person paintball. Movement uses the shared
// deterministic physics (predicted by the owner's client); shots are instant
// rays judged with lag compensation against what the shooter saw.
// Optional power-ups on four pads per field: paintball-powers.js.
import { ArcadeGame } from './arcade.js';
import { ARCADE_PHASE } from '../../shared/games/arcade.js';
import { PB_ARENAS, PB_FIELD } from '../../shared/maps/paintball-arenas.js';
import { PB_PHYS, createRunner, stepRunner, collide, raycast, rayCircle } from '../../shared/physics/paintball.js';
import { PB_RULES as R, PB_FLAG, PB_POWER_RULES as PR, yawToI16, wrapAngle } from '../../shared/games/paintball.js';
import { BTN } from '../../shared/messages.js';
import { LagHistory } from '../lagcomp.js';
import { createPaintBot, stepPaintBot } from './paintball-bots.js';
import { PaintPowers } from './paintball-powers.js';

const COUNTDOWN_S = 3;
const END_HOLD_S = 4;
const LATE_JOIN_S = 1;
const round1 = (v) => Math.round(v * 10) / 10;
const ds = (t) => Math.min(255, Math.ceil(Math.max(0, t) * 10));

class PaintballGame extends ArcadeGame {
  constructor(room, settings) {
    super(room, settings, { countdown: COUNTDOWN_S, endHold: END_HOLD_S });
    this.arena = PB_ARENAS[settings.arena] ?? PB_ARENAS.haven;
    this.obstacles = this.arena.obstacles;
    this.duration = settings.duration ?? 180;
    this.endsAt = this.phaseEnd + this.duration;
    this.history = new LagHistory({ frames: 16, capacity: 8 });
    this.pos = { x: 0, y: 0 };
    this.ray = { nx: 0, ny: 0, obstacle: -1 };
    this.powers = new PaintPowers(this, settings.powerups !== false);
    this.addPlayers();
    this.ents.forEach((e, i) => this._place(e, this.arena.spawns[i % this.arena.spawns.length]));
    this._record();
    this.ready = true;
  }

  createEntity() {
    return {
      s: createRunner(), yaw: 0, hp: R.HP, alive: true, respawn: 0, shield: R.SHIELD_S,
      ammo: R.HOPPER, reload: 0, cooldown: 0, calm: 0,
      kills: 0, deaths: 0, hits: 0, shots: 0,
      rapid: 0, spread: 0, camo: 0, armor: 0,
      bot: createPaintBot(),
    };
  }

  onJoin(player) {
    super.onJoin(player);
    const e = this.ent(player.id);
    if (!this.ready || !e) return; // the constructor places the first players
    if (this.phase === ARCADE_PHASE.COUNTDOWN) this._respawn(e);
    else {
      // Late joiners drop in a moment later.
      e.alive = false;
      e.respawn = LATE_JOIN_S;
    }
  }

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------
  _place(e, spawn) {
    const s = e.s;
    s.x = Math.fround(spawn.x);
    s.y = Math.fround(spawn.y);
    s.vx = 0;
    s.vy = 0;
    e.yaw = Math.atan2(PB_FIELD.height / 2 - spawn.y, PB_FIELD.width / 2 - spawn.x);
    e.hp = R.HP;
    e.alive = true;
    e.respawn = 0;
    e.shield = R.SHIELD_S;
    e.ammo = R.HOPPER;
    e.reload = 0;
    e.cooldown = 0.3;
    e.calm = 0;
    PaintPowers.clear(e);
  }

  // The spawn farthest from every living opponent.
  _respawn(e) {
    let best = this.arena.spawns[0];
    let bestD = -1;
    for (const sp of this.arena.spawns) {
      let d = Infinity;
      for (const o of this.ents) {
        if (o !== e && o.alive) d = Math.min(d, Math.hypot(o.s.x - sp.x, o.s.y - sp.y));
      }
      if (d > bestD) {
        bestD = d;
        best = sp;
      }
    }
    this._place(e, best);
    this.room.emit('spawn', { s: e.player.slot });
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------
  step(dt) {
    if (this.time >= this.endsAt) {
      this.finish();
      return;
    }
    for (const e of this.ents) this._stepEnt(e, dt);
    this._separate();
    this.powers.tick(dt);
    this._record();
  }

  _stepEnt(e, dt) {
    if (e.cooldown > 0) e.cooldown = Math.max(0, e.cooldown - dt);
    if (e.shield > 0) e.shield = Math.max(0, e.shield - dt);
    if (e.reload > 0) {
      e.reload -= dt;
      if (e.reload <= 0) {
        e.reload = 0;
        e.ammo = R.HOPPER;
      }
    }
    if (!e.alive) {
      if (!e.player.isBot) this.eachInput(e, () => {});
      e.respawn -= dt;
      if (e.respawn <= 0) this._respawn(e);
      return;
    }
    // A hit point back after a while without being hit.
    e.calm += dt;
    if (e.hp < R.HP && e.calm >= R.REGEN_S) {
      e.hp++;
      e.calm = 0;
    }
    if (e.player.isBot) {
      const b = stepPaintBot(e, this, dt, this.rng);
      stepRunner(e.s, b.ax, b.ay, dt, this.obstacles);
      e.yaw = b.yaw;
      if (b.reload) this._startReload(e);
      if (b.fire) this.shoot(e, e.yaw, this.room.now(), null);
      return;
    }
    this.eachInput(e, (input) => {
      stepRunner(e.s, input.ax, input.ay, dt, this.obstacles);
      e.yaw = input.aim;
      if (input.buttons & BTN.B) this._startReload(e);
    });
  }

  // Players push each other apart (server only; the owner's prediction corrects).
  _separate() {
    const min = PB_PHYS.RADIUS * 2;
    for (let i = 0; i < this.ents.length; i++) {
      const a = this.ents[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.ents.length; j++) {
        const b = this.ents[j];
        if (!b.alive) continue;
        const dx = b.s.x - a.s.x;
        const dy = b.s.y - a.s.y;
        const d = Math.hypot(dx, dy);
        if (d >= min || d < 1e-6) continue;
        const push = (min - d) / 2;
        a.s.x -= (dx / d) * push;
        a.s.y -= (dy / d) * push;
        b.s.x += (dx / d) * push;
        b.s.y += (dy / d) * push;
        collide(a.s, this.obstacles, PB_PHYS.RADIUS);
        collide(b.s, this.obstacles, PB_PHYS.RADIUS);
        a.s.x = Math.fround(a.s.x);
        a.s.y = Math.fround(a.s.y);
        b.s.x = Math.fround(b.s.x);
        b.s.y = Math.fround(b.s.y);
      }
    }
  }

  _record() {
    this.history.begin(this.room.now());
    for (const e of this.ents) if (e.alive) this.history.add(e.player.slot, e.s.x, e.s.y);
  }

  // ---------------------------------------------------------------------------
  // Shooting
  // ---------------------------------------------------------------------------
  // JSON actions: { a: view angle, t: view time, x, y: muzzle as the client saw it } or { r: 1 } = reload.
  onAction(player, data) {
    const e = this.ent(player.id);
    if (!e || !data || typeof data !== 'object') return;
    if (data.r === 1) return this._startReload(e);
    const { a, t, x, y } = data;
    if (![a, t].every(Number.isFinite)) return;
    const from = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    this.shoot(e, wrapAngle(a), this.history.clampTime(t, this.room.now()), from);
  }

  _startReload(e) {
    if (!e.alive || e.reload > 0 || e.ammo >= R.HOPPER) return;
    e.reload = R.RELOAD_S;
    this.room.emit('reload', { s: e.player.slot });
  }

  // One trigger pull: an instant ray from the muzzle (three with the spread
  // power-up). Opponents are rewound to `time` (what the shooter saw).
  // Returns the (first) victim or null.
  shoot(e, yaw, time, from) {
    if (!this.playing || !e.alive || e.cooldown > 0 || e.reload > 0 || e.ammo <= 0) return null;
    const rapid = e.rapid > 0;
    e.cooldown = rapid ? PR.RAPID_COOLDOWN_S : R.COOLDOWN_S;
    if (!rapid) e.ammo--;
    e.shots++;
    e.shield = 0; // firing ends spawn protection
    if (e.ammo === 0) this._startReload(e);

    // Trust the client's muzzle position a little (it is a few ticks ahead of ours).
    let x0 = e.s.x;
    let y0 = e.s.y;
    if (from && Math.hypot(from.x - x0, from.y - y0) <= R.MAX_SHOT_OFFSET && this._free(from.x, from.y)) {
      x0 = from.x;
      y0 = from.y;
    }
    if (!(e.spread > 0)) return this._ball(e, x0, y0, yaw, time);
    let first = null;
    for (const off of [0, -PR.SPREAD_RAD, PR.SPREAD_RAD]) first = this._ball(e, x0, y0, yaw + off, time) ?? first;
    return first;
  }

  _ball(e, x0, y0, yaw, time) {
    const dx = Math.cos(yaw);
    const dy = Math.sin(yaw);
    let best = raycast(this.obstacles, x0, y0, dx, dy, R.RANGE, this.ray);
    let victim = null;
    for (const o of this.ents) {
      if (o === e || !o.alive) continue;
      const p = this.history.positionAt(o.player.slot, time, this.pos) ? this.pos : o.s;
      const d = rayCircle(x0, y0, dx, dy, p.x, p.y, PB_PHYS.HIT_RADIUS);
      if (d < best) {
        best = d;
        victim = o;
      }
    }
    this.room.emit('shot', {
      s: e.player.slot, x0: round1(x0), y0: round1(y0),
      x1: round1(x0 + dx * best), y1: round1(y0 + dy * best), h: victim ? victim.player.slot : -1,
    });
    if (victim) this._hit(victim, e);
    return victim;
  }

  _free(x, y) {
    const probe = { x, y };
    collide(probe, this.obstacles, 0.5);
    return Math.abs(probe.x - x) < 1e-6 && Math.abs(probe.y - y) < 1e-6;
  }

  _hit(v, by) {
    if (v.shield > 0) {
      this.room.emit('block', { s: v.player.slot });
      return;
    }
    if (v.armor > 0) {
      v.armor--;
      this.room.emit('armor', { s: v.player.slot, by: by.player.slot, left: v.armor });
      return;
    }
    v.hp--;
    v.calm = 0;
    by.hits++;
    this.room.emit('hit', { s: v.player.slot, by: by.player.slot, hp: v.hp });
    if (v.hp > 0) return;
    v.alive = false;
    v.deaths++;
    v.respawn = R.RESPAWN_S;
    v.s.vx = 0;
    v.s.vy = 0;
    by.kills++;
    this.room.emit('splat', { s: v.player.slot, by: by.player.slot, x: round1(v.s.x), y: round1(v.s.y) });
  }

  // ---------------------------------------------------------------------------
  // Snapshot + results
  // ---------------------------------------------------------------------------
  // Body: u8 phase, f32 seconds left, u8 n × [u8 slot, u8 flags, u16 ack,
  //   f32 x, f32 y, f32 vx, f32 vy, f32 boost, i16 yaw, u8 hp, u8 ammo, i16 kills, u8 deaths,
  //   u8 respawn (ds), u8 reload (ds), u8 armor, u8 rapid, spread, camo (ds)],
  //   power-up pads (PaintPowers.write)
  snapshot(w) {
    const left = this.phase === ARCADE_PHASE.PLAY ? this.endsAt - this.time : this.phaseEnd - this.time;
    this.writePhase(w, left);
    w.u8(this.ents.length);
    for (const e of this.ents) {
      const p = e.player;
      const flags = ArcadeGame.flags(p) | (e.alive ? PB_FLAG.ALIVE : 0) | (e.shield > 0 ? PB_FLAG.SHIELD : 0) | (e.reload > 0 ? PB_FLAG.RELOAD : 0)
        | (e.camo > 0 ? PB_FLAG.CAMO : 0) | (e.rapid > 0 ? PB_FLAG.RAPID : 0) | (e.spread > 0 ? PB_FLAG.SPREAD : 0);
      const s = e.s;
      w.u8(p.slot).u8(flags).u16(e.queue.ackSeq);
      w.f32(s.x).f32(s.y).f32(s.vx).f32(s.vy).f32(s.boost).i16(yawToI16(e.yaw));
      w.u8(e.hp).u8(e.ammo).i16(Math.max(-32000, Math.min(32000, e.kills))).u8(Math.min(255, e.deaths));
      w.u8(ds(e.respawn)).u8(ds(e.reload));
      w.u8(e.armor).u8(ds(e.rapid)).u8(ds(e.spread)).u8(ds(e.camo));
    }
    this.powers.write(w);
  }

  results() {
    const sorted = [...this.ents].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.hits - a.hits);
    return {
      title: 'Uitslag Spetterveld',
      columns: ['Spetters', 'Gespetterd', 'Raak'],
      rows: this.rows(sorted, (e) => [e.kills, e.deaths, `${e.shots ? Math.round((e.hits / e.shots) * 100) : 0}%`]),
    };
  }
}

export default {
  id: 'paintball',
  realtime: true,
  create: (room, settings) => new PaintballGame(room, settings),
};
