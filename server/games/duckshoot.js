// Kwek Kwek Knal (server side). Ducks fly, players shoot. Shots are judged
// with lag compensation: the server rewinds the ducks to the moment the
// shooter saw them (see server/lagcomp.js).
import {
  DUCK_FIELD, DUCK_PHASE, DUCK_STATE, DUCK_MODE, DUCK_TYPES, AMMO, COOP_QUOTA, DOUBLE_BONUS, axisToCursor,
} from '../../shared/games/duckshoot.js';
import { createRng } from '../../shared/rng.js';
import { LagHistory } from '../lagcomp.js';
import { createDuckBot, stepDuckBot } from './duckshoot-bots.js';

// Tuning
const COUNTDOWN_S = 3;
const ROUND_END_S = 3.5;
const END_HOLD_S = 2.5;
const ROUND_MAX_S = 40; // after this every duck flies away
const HIT_FREEZE_S = 0.35;
const FALL_ACCEL = 320;
const ESCAPE_SPEED = 95;
const SPEEDUP_PER_ROUND = 0.08;
const MAX_DUCKS = 40;
const HIT_TOLERANCE = 1.5; // px, forgiving edge of the sprite
const HIDDEN_MARGIN = 3; // a duck lower than grassY - this is hidden by the reeds

const W = DUCK_FIELD.width;
const GRASS = DUCK_FIELD.grassY;

class DuckGame {
  constructor(room, settings) {
    this.room = room;
    this.mode = settings.mode === 'coop' ? DUCK_MODE.COOP : DUCK_MODE.VERSUS;
    this.rounds = settings.rounds ?? 5;
    this.rng = createRng(settings.seed);
    this.time = 0;
    this.round = 0;
    this.shooters = [];
    this.ducks = [];
    this.nextDuckId = 1;
    this.history = new LagHistory({ frames: 16, capacity: MAX_DUCKS });
    this.teamScore = 0;
    this.failed = false;
    this.tmp = { x: 0, y: 0 };
    for (const p of room.gamePlayers()) this.onJoin(p);
    this._startRound();
  }

  // ---------------------------------------------------------------------------
  // Players
  // ---------------------------------------------------------------------------
  _shooter(id) {
    return this.shooters.find((s) => s.player.id === id) ?? null;
  }

  onJoin(player) {
    if (this._shooter(player.id)) return;
    this.shooters.push({
      player,
      cx: W / 2 + (player.slot - 2.5) * 30,
      cy: 80,
      score: 0, hits: 0, shots: 0, doubles: 0,
      ammo: AMMO.MAGAZINE, reload: 0, cooldown: 0,
      bot: createDuckBot(),
    });
  }

  onLeave(player) {
    this.shooters = this.shooters.filter((s) => s.player.id !== player.id);
  }

  // Binary input: the cursor position travels as the movement axes.
  onInput(player, input) {
    const s = this._shooter(player.id);
    if (!s) return;
    const [x, y] = axisToCursor(input.ax, input.ay);
    s.cx = x;
    s.cy = y;
  }

  // JSON actions: { x, y, t } = shot at (x, y) as seen at server time t; { r: 1 } = reload.
  onAction(player, data) {
    const s = this._shooter(player.id);
    if (!s || !data || typeof data !== 'object') return;
    if (data.r === 1) return this._startReload(s);
    const { x, y, t } = data;
    if (![x, y, t].every(Number.isFinite)) return;
    if (x < 0 || x > W || y < 0 || y > DUCK_FIELD.height) return;
    this.shoot(s, x, y, this.history.clampTime(t, this.room.now()));
  }

  _startReload(s) {
    if (s.reload > 0 || s.ammo >= AMMO.MAGAZINE) return;
    s.reload = AMMO.RELOAD_S;
    this.room.emit('reload', { s: s.player.slot });
  }

  // Judge one shot at `time` (server clock, already clamped). Returns the hits.
  shoot(s, x, y, time) {
    if (this.phase !== DUCK_PHASE.PLAY || s.reload > 0 || s.cooldown > 0 || s.ammo <= 0) return null;
    s.ammo--;
    s.shots++;
    s.cooldown = AMMO.COOLDOWN_S;
    if (s.ammo === 0) s.reload = AMMO.RELOAD_S;

    const hits = [];
    for (const d of this.ducks) {
      if (d.state !== DUCK_STATE.FLY && d.state !== DUCK_STATE.ESCAPE) continue;
      if (!this.history.positionAt(d.id, time, this.tmp)) continue;
      if (this.tmp.y > GRASS - HIDDEN_MARGIN) continue; // still behind the reeds
      const r = DUCK_TYPES[d.type].radius + HIT_TOLERANCE;
      const dx = this.tmp.x - x;
      const dy = this.tmp.y - y;
      if (dx * dx + dy * dy <= r * r) hits.push(d);
    }
    const bonus = hits.filter((d) => DUCK_TYPES[d.type].points > 0).length >= 2 ? DOUBLE_BONUS : 1;
    if (bonus > 1) s.doubles++;
    const out = [];
    for (const d of hits) {
      const base = DUCK_TYPES[d.type].points;
      const points = base > 0 ? base * bonus : base;
      d.state = DUCK_STATE.HIT;
      d.stateT = HIT_FREEZE_S;
      d.hitBy = s.player.slot;
      s.score += points;
      if (base > 0) {
        s.hits++;
        this.roundHits++;
      }
      this.teamScore += points;
      out.push({ id: d.id, p: points });
    }
    this.room.emit('shot', { s: s.player.slot, x: Math.round(x), y: Math.round(y), hits: out });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Rounds
  // ---------------------------------------------------------------------------
  _startRound() {
    this.round++;
    this.phase = DUCK_PHASE.COUNTDOWN;
    this.phaseEnd = this.time + COUNTDOWN_S;
    this.ducks.length = 0;
    this.history.clear();
    this.roundHits = 0;
    this.roundTotal = 0;
    this.roundTime = 0;
    this.plan = this._planRound();
    this.quota = Math.ceil(this._planCount() * COOP_QUOTA);
    for (const s of this.shooters) {
      s.ammo = AMMO.MAGAZINE;
      s.reload = 0;
    }
    this.room.emit('round', { r: this.round });
  }

  _planCount() {
    return this.plan.filter((p) => DUCK_TYPES[p.type].points > 0).length;
  }

  // A list of { at (s into the round), type }, spread over ~20 s in small groups.
  _planRound() {
    const rng = this.rng;
    const players = Math.max(1, this.shooters.length);
    const count = Math.min(24, 5 + players * 2 + this.round);
    const plan = [];
    let at = 0.6;
    let goldLeft = this.round >= 2 ? 1 : 0;
    while (plan.length < count) {
      const group = Math.min(count - plan.length, 1 + Math.floor(rng() * Math.min(3, 1 + this.round / 2)));
      for (let i = 0; i < group; i++) {
        const roll = rng();
        let type = 0;
        if (goldLeft && roll < 0.08) { type = 2; goldLeft--; }
        else if (this.round >= 2 && roll < 0.2) type = 3;
        else if (roll < 0.45 + this.round * 0.04) type = 1;
        plan.push({ at: at + i * 0.25, type });
      }
      at += 1.6 + rng() * 1.6 - Math.min(1, this.round * 0.12);
    }
    return plan;
  }

  _spawn(type) {
    const rng = this.rng;
    const def = DUCK_TYPES[type];
    const speed = def.speed * (1 + (this.round - 1) * SPEEDUP_PER_ROUND) * (0.9 + rng() * 0.2);
    const angle = -Math.PI / 2 + (rng() - 0.5) * 1.6;
    this.ducks.push({
      id: this.nextDuckId,
      type,
      state: DUCK_STATE.FLY,
      x: 30 + rng() * (W - 60),
      y: GRASS + 10,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      speed,
      age: 0,
      turnT: 0.8 + rng(),
      stateT: 0,
      hitBy: -1,
    });
    this.nextDuckId = (this.nextDuckId % 65535) + 1;
    if (def.points > 0) this.roundTotal++;
    this.room.emit('quack', { kind: type });
  }

  tick(dt) {
    this.time += dt;
    for (const s of this.shooters) {
      if (s.cooldown > 0) s.cooldown = Math.max(0, s.cooldown - dt);
      if (s.reload > 0) {
        s.reload -= dt;
        if (s.reload <= 0) {
          s.reload = 0;
          s.ammo = AMMO.MAGAZINE;
        }
      }
    }

    if (this.phase === DUCK_PHASE.COUNTDOWN) {
      if (this.time >= this.phaseEnd) {
        this.phase = DUCK_PHASE.PLAY;
        this.room.emit('go');
      }
      return;
    }
    if (this.phase === DUCK_PHASE.ROUND_END) {
      if (this.time >= this.phaseEnd) {
        if (this.failed || this.round >= this.rounds) {
          this.phase = DUCK_PHASE.END;
          this.phaseEnd = this.time + END_HOLD_S;
          this.room.emit('end', { failed: this.failed });
        } else {
          this._startRound();
        }
      }
      return;
    }
    if (this.phase === DUCK_PHASE.END) {
      if (this.time >= this.phaseEnd) this.room.endGame(this.results());
      return;
    }

    // --- PLAY ---
    this.roundTime += dt;
    while (this.plan.length && this.plan[0].at <= this.roundTime && this.ducks.length < MAX_DUCKS) {
      this._spawn(this.plan.shift().type);
    }
    const forceEscape = this.roundTime > ROUND_MAX_S;
    for (let i = this.ducks.length - 1; i >= 0; i--) {
      if (this._stepDuck(this.ducks[i], dt, forceEscape)) this.ducks.splice(i, 1);
    }
    this.history.begin(this.room.now());
    for (const d of this.ducks) this.history.add(d.id, d.x, d.y);

    for (const s of this.shooters) {
      if (!s.player.isBot) continue;
      const shot = stepDuckBot(s, this.ducks, dt, this.rng);
      if (shot) this.shoot(s, shot.x, shot.y, this.room.now());
      else if (s.ammo === 0 || (s.ammo < 2 && !this.ducks.length)) this._startReload(s);
    }

    if (!this.plan.length && !this.ducks.length) this._endRound();
  }

  // Returns true when the duck is gone.
  _stepDuck(d, dt, forceEscape) {
    const def = DUCK_TYPES[d.type];
    switch (d.state) {
      case DUCK_STATE.FLY: {
        d.age += dt;
        if (d.age > def.life || forceEscape) {
          d.state = DUCK_STATE.ESCAPE;
          d.vx *= 0.35;
          d.vy = -ESCAPE_SPEED;
          break;
        }
        d.turnT -= dt;
        if (d.turnT <= 0) {
          d.turnT = 0.5 + this.rng() * 1.1;
          const a = Math.atan2(d.vy, d.vx) + (this.rng() - 0.5) * 2 * Math.PI * def.turn;
          d.vx = Math.cos(a) * d.speed;
          d.vy = Math.sin(a) * d.speed;
        }
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.x < 10) d.vx = Math.abs(d.vx);
        if (d.x > W - 10) d.vx = -Math.abs(d.vx);
        if (d.y < 12) d.vy = Math.abs(d.vy);
        if (d.y > GRASS - 12 && d.vy > 0 && d.age > 1) d.vy = -Math.abs(d.vy);
        return false;
      }
      case DUCK_STATE.ESCAPE:
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.y < -14) {
          if (def.points > 0) this.room.emit('escape', { id: d.id });
          return true;
        }
        return false;
      case DUCK_STATE.HIT:
        d.stateT -= dt;
        if (d.stateT <= 0) {
          d.state = DUCK_STATE.FALL;
          d.vx = 0;
          d.vy = 20;
        }
        return false;
      case DUCK_STATE.FALL:
        d.vy += FALL_ACCEL * dt;
        d.y += d.vy * dt;
        if (d.y > GRASS + 12) {
          this.room.emit('land', { x: Math.round(d.x) });
          return true;
        }
        return false;
      default:
        return true;
    }
  }

  _endRound() {
    this.phase = DUCK_PHASE.ROUND_END;
    this.phaseEnd = this.time + ROUND_END_S;
    const ok = this.mode !== DUCK_MODE.COOP || this.roundHits >= this.quota;
    if (!ok) this.failed = true;
    this.room.emit('roundEnd', { r: this.round, hits: this.roundHits, total: this.roundTotal, ok });
  }

  // ---------------------------------------------------------------------------
  // Snapshot + results
  // ---------------------------------------------------------------------------
  // Body layout (after the 14-byte header), decoded in public/games/duckshoot/client.js:
  // u8 phase, u8 mode, u8 round, u8 rounds, f32 remaining, u8 roundHits, u8 roundTotal, u8 quota,
  // i32 teamScore, u8 n × [u8 slot, u8 flags, i32 score, u8 ammo, u16 hits, u16 shots,
  //                        u16 cx*100, u16 cy*100, u8 reload(0..255)],
  // u8 m × [u16 id, u8 type, u8 state | facingLeft << 4, i16 x*8, i16 y*8]
  snapshot(w) {
    const remaining = this.phase === DUCK_PHASE.PLAY ? Math.max(0, ROUND_MAX_S - this.roundTime) : Math.max(0, this.phaseEnd - this.time);
    w.u8(this.phase).u8(this.mode).u8(this.round).u8(this.rounds).f32(remaining);
    w.u8(Math.min(255, this.roundHits)).u8(Math.min(255, this.roundTotal)).u8(Math.min(255, this.quota));
    w.i32(this.teamScore);
    w.u8(this.shooters.length);
    for (const s of this.shooters) {
      const p = s.player;
      const flags = (p.isBot ? 1 : 0) | (p.isBot || p.connected ? 2 : 0) | (s.reload > 0 ? 4 : 0);
      w.u8(p.slot).u8(flags).i32(s.score).u8(s.ammo);
      w.u16(Math.min(65535, s.hits)).u16(Math.min(65535, s.shots));
      w.u16(Math.round(clamp(s.cx, 0, W) * 100)).u16(Math.round(clamp(s.cy, 0, DUCK_FIELD.height) * 100));
      w.u8(s.reload > 0 ? Math.round((1 - s.reload / AMMO.RELOAD_S) * 255) : 255);
    }
    w.u8(this.ducks.length);
    for (const d of this.ducks) {
      w.u16(d.id).u8(d.type).u8(d.state | (d.vx < 0 ? 16 : 0));
      w.i16(Math.round(d.x * 8)).i16(Math.round(d.y * 8));
    }
  }

  results() {
    const coop = this.mode === DUCK_MODE.COOP;
    const sorted = [...this.shooters].sort((a, b) => b.score - a.score || b.hits - a.hits);
    const survived = this.failed ? this.round - 1 : this.round;
    return {
      title: coop
        ? `Samen ${this.teamScore} punten · ${survived} van ${this.rounds} rondes gehaald`
        : 'Uitslag Kwek Kwek Knal',
      columns: ['Punten', 'Raak', 'Trefzekerheid'],
      rows: sorted.map((s, i) => ({
        id: s.player.id,
        name: s.player.name,
        color: s.player.color,
        rank: i + 1,
        values: [String(s.score), String(s.hits), s.shots ? `${Math.round((s.hits / s.shots) * 100)}%` : '–'],
      })),
    };
  }
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export default {
  id: 'duckshoot',
  realtime: true,
  create: (room, settings) => new DuckGame(room, settings),
};
