// Rotsregen (server side): asteroids for up to six ships. Co-op (clear the
// waves together) or versus (bullets hit ships too). Rocks split in two.
import { ArcadeGame } from './arcade.js';
import { BTN } from '../../shared/messages.js';
import { ARCADE_PHASE } from '../../shared/games/arcade.js';
import { stepShip, createShip, wrap, wrapDelta, ROCKS_FIELD as F, SHIP_PHYS } from '../../shared/physics/rocks.js';

const ROCK_R = [15, 8, 4];
const ROCK_SPEED = [[18, 34], [32, 55], [50, 80]];
const ROCK_POINTS = [20, 50, 100];
const SHIP_KILL_POINTS = 250;
const BULLET_SPEED = 210;
const BULLET_LIFE_S = 0.95;
const MAX_BULLETS = 4;
const FIRE_COOLDOWN_S = 0.22;
const RESPAWN_S = 2;
const SAFE_S = 2.5;
const WAVE_PAUSE_S = 2;
const MAX_ROCKS = 64;

const BOT = {
  easy: { aimTol: 0.3, react: 0.6, thrust: 0.2 },
  normal: { aimTol: 0.16, react: 0.3, thrust: 0.4 },
  hard: { aimTol: 0.08, react: 0.12, thrust: 0.6 },
};

class RocksGame extends ArcadeGame {
  constructor(room, settings) {
    super(room, settings);
    this.versus = settings.mode === 'versus';
    this.livesStart = settings.lives ?? 3;
    this.wave = 0;
    this.rocks = [];
    this.bullets = [];
    this.nextRock = 1;
    this.addPlayers();
    this.ents.forEach((e, i) => this._place(e, i));
    this._startWave();
  }

  createEntity() {
    return { s: createShip(), alive: true, safe: SAFE_S, respawn: 0, lives: this.livesStart, cooldown: 0, score: 0, rocks: 0, thrust: false, aimT: 0 };
  }

  _place(e, i) {
    const n = Math.max(1, this.ents.length);
    const a = (i / n) * Math.PI * 2;
    e.s = createShip(F.width / 2 + Math.cos(a) * 30, F.height / 2 + Math.sin(a) * 22);
    e.alive = e.lives > 0;
    e.safe = SAFE_S;
  }

  _startWave() {
    this.wave++;
    const count = Math.min(10, 2 + this.wave + Math.ceil(this.ents.length / 2));
    for (let i = 0; i < count; i++) {
      // Along the edges, away from the ships in the middle.
      const edge = this.rng() < 0.5;
      const x = edge ? (this.rng() < 0.5 ? 5 : F.width - 5) : this.rng() * F.width;
      const y = edge ? this.rng() * F.height : (this.rng() < 0.5 ? 5 : F.height - 5);
      this._rock(x, y, 0);
    }
    if (this.wave > 1) this.room.emit('wave', { n: this.wave });
  }

  _rock(x, y, size, dirHint = null) {
    if (this.rocks.length >= MAX_ROCKS) return;
    const [lo, hi] = ROCK_SPEED[size];
    const a = dirHint ?? this.rng() * Math.PI * 2;
    const v = lo + this.rng() * (hi - lo);
    this.rocks.push({ id: this.nextRock, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size, seed: Math.floor(this.rng() * 256) });
    this.nextRock = (this.nextRock % 65535) + 1;
  }

  step(dt) {
    for (const e of this.ents) {
      e.cooldown = Math.max(0, e.cooldown - dt);
      e.safe = Math.max(0, e.safe - dt);
      if (!e.alive) {
        if (!e.player.isBot) this.eachInput(e, () => {});
        if (e.lives > 0) {
          e.respawn -= dt;
          if (e.respawn <= 0) {
            e.s = createShip(F.width / 2, F.height / 2);
            e.alive = true;
            e.safe = SAFE_S;
            this.room.emit('spawn', { s: e.player.slot });
          }
        }
        continue;
      }
      if (e.player.isBot) this._bot(e, dt);
      else {
        e.thrust = false;
        this.eachInput(e, (inp) => {
          const thrust = inp.ay < -0.5 || (inp.buttons & BTN.B) !== 0;
          e.thrust = thrust;
          stepShip(e.s, inp.ax, thrust, dt);
          if (inp.buttons & BTN.A) this._fire(e);
        });
      }
    }
    for (const r of this.rocks) {
      r.x = wrap(r.x + r.vx * dt, F.width);
      r.y = wrap(r.y + r.vy * dt, F.height);
    }
    this._stepBullets(dt);
    this._shipCollisions();

    const alive = this.ents.filter((e) => e.alive || e.lives > 0);
    if (!alive.length) this.finish({});
    else if (this.versus && this.ents.length > 1 && alive.length === 1) this.finish({ s: alive[0].player.slot });
    else if (!this.rocks.length) this.endRound(WAVE_PAUSE_S, { wave: this.wave });
  }

  nextRound() {
    this.phase = ARCADE_PHASE.PLAY; // straight back to play, the ships stay where they are
    this._startWave();
  }

  _fire(e) {
    if (e.cooldown > 0) return;
    let mine = 0;
    for (const b of this.bullets) if (b.owner === e) mine++;
    if (mine >= MAX_BULLETS) return;
    e.cooldown = FIRE_COOLDOWN_S;
    const s = e.s;
    this.bullets.push({
      x: wrap(s.x + s.hx * 6, F.width), y: wrap(s.y + s.hy * 6, F.height),
      vx: s.hx * BULLET_SPEED + s.vx * 0.5, vy: s.hy * BULLET_SPEED + s.vy * 0.5,
      life: BULLET_LIFE_S, owner: e,
    });
    this.room.emit('fire', { s: e.player.slot });
  }

  _stepBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.x = wrap(b.x + b.vx * dt, F.width);
      b.y = wrap(b.y + b.vy * dt, F.height);
      let hit = b.life <= 0;
      for (let j = 0; j < this.rocks.length && !hit; j++) {
        const r = this.rocks[j];
        if (dist2(b.x - r.x, b.y - r.y) > ROCK_R[r.size] ** 2) continue;
        this._breakRock(j, b);
        hit = true;
      }
      if (!hit && this.versus) {
        for (const e of this.ents) {
          if (e === b.owner || !e.alive || e.safe > 0) continue;
          if (dist2(b.x - e.s.x, b.y - e.s.y) > (SHIP_PHYS.RADIUS + 1) ** 2) continue;
          b.owner.score += SHIP_KILL_POINTS;
          this._killShip(e, b.owner);
          hit = true;
          break;
        }
      }
      if (hit) this.bullets.splice(i, 1);
    }
  }

  _breakRock(j, bullet) {
    const r = this.rocks[j];
    this.rocks.splice(j, 1);
    bullet.owner.score += ROCK_POINTS[r.size];
    bullet.owner.rocks++;
    this.room.emit('rock', { x: Math.round(r.x), y: Math.round(r.y), size: r.size, s: bullet.owner.player.slot });
    if (r.size < 2) {
      const base = Math.atan2(r.vy, r.vx);
      this._rock(r.x, r.y, r.size + 1, base + 0.6);
      this._rock(r.x, r.y, r.size + 1, base - 0.6);
    }
  }

  _shipCollisions() {
    for (const e of this.ents) {
      if (!e.alive || e.safe > 0) continue;
      for (const r of this.rocks) {
        const reach = ROCK_R[r.size] + SHIP_PHYS.RADIUS - 1;
        if (dist2(e.s.x - r.x, e.s.y - r.y) > reach * reach) continue;
        this._killShip(e, null);
        break;
      }
    }
  }

  _killShip(e, by) {
    e.alive = false;
    e.lives--;
    e.respawn = RESPAWN_S;
    this.room.emit('boom', { s: e.player.slot, x: Math.round(e.s.x), y: Math.round(e.s.y), by: by ? by.player.slot : -1 });
  }

  // Bots: turn towards the nearest rock (with lead), fire when lined up,
  // thrust away when a rock gets too close.
  _bot(e, dt) {
    const cfg = BOT[e.player.botLevel] ?? BOT.normal;
    const s = e.s;
    let best = null;
    let bestD = Infinity;
    const targets = this.versus ? [...this.rocks, ...this.ents.filter((o) => o !== e && o.alive).map((o) => ({ x: o.s.x, y: o.s.y, vx: o.s.vx, vy: o.s.vy }))] : this.rocks;
    for (const r of targets) {
      const d = Math.hypot(wrapDelta(r.x - s.x, F.width), wrapDelta(r.y - s.y, F.height));
      if (d < bestD) { bestD = d; best = r; }
    }
    let ax = 0;
    let thrust = false;
    if (best) {
      const t = bestD / BULLET_SPEED;
      const tx = wrapDelta(best.x + best.vx * t - s.x, F.width);
      const ty = wrapDelta(best.y + best.vy * t - s.y, F.height);
      const want = Math.atan2(ty, tx);
      const have = Math.atan2(s.hy, s.hx);
      let diff = want - have;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      ax = Math.max(-1, Math.min(1, diff * 3));
      if (Math.abs(diff) < cfg.aimTol) {
        e.aimT += dt;
        if (e.aimT >= cfg.react && bestD < 150) this._fire(e);
      } else e.aimT = 0;
      // Too close: thrust away (only when roughly facing away) or keep turning.
      if (bestD < 26 && Math.abs(diff) > 2.2) thrust = true;
      else if (bestD > 110 && this.rng() < cfg.thrust * dt * 3) thrust = true;
    }
    e.thrust = thrust;
    stepShip(s, ax, thrust, dt);
  }

  // Body: u8 phase, f32 left, u8 wave, u8 versus,
  // u8 n × [u8 slot, u8 flags, u16 ack, f32 x, y, vx, vy, hx, hy, u8 state, u8 lives, u16 score],
  // u8 rocks × [u16 id, u8 size, u8 seed, i16 x*8, i16 y*8], u8 bullets × [i16 x*8, i16 y*8, u8 slot]
  snapshot(w) {
    this.writePhase(w);
    w.u8(this.wave).u8(this.versus ? 1 : 0);
    w.u8(this.ents.length);
    for (const e of this.ents) {
      const s = e.s;
      w.u8(e.player.slot).u8(ArcadeGame.flags(e.player)).u16(e.queue.ackSeq);
      w.f32(s.x).f32(s.y).f32(s.vx).f32(s.vy).f32(s.hx).f32(s.hy);
      w.u8((e.alive ? 1 : 0) | (e.safe > 0 ? 2 : 0) | (e.thrust ? 4 : 0)).u8(Math.max(0, e.lives)).u16(Math.min(65535, e.score));
    }
    w.u8(this.rocks.length);
    for (const r of this.rocks) w.u16(r.id).u8(r.size).u8(r.seed).i16(Math.round(r.x * 8)).i16(Math.round(r.y * 8));
    w.u8(this.bullets.length);
    for (const b of this.bullets) w.i16(Math.round(b.x * 8)).i16(Math.round(b.y * 8)).u8(b.owner.player.slot);
  }

  results() {
    const sorted = [...this.ents].sort((a, b) => b.score - a.score);
    return {
      title: this.versus ? 'Uitslag Rotsregen (tegen elkaar)' : `Rotsregen: tot golf ${this.wave} gekomen`,
      columns: ['Punten', 'Rotsen'],
      rows: this.rows(sorted, (e) => [e.score, e.rocks]),
    };
  }
}

const dist2 = (dx, dy) => {
  const x = wrapDelta(dx, F.width);
  const y = wrapDelta(dy, F.height);
  return x * x + y * y;
};

export default {
  id: 'rocks',
  realtime: true,
  create: (room, settings) => new RocksGame(room, settings),
};
