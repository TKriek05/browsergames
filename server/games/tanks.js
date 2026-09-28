// Tank Tumult (server side): tanks (shared deterministic physics, predicted
// by the owner's client), bouncing bullets, destructible crates, power-ups,
// deathmatch or last-tank-standing rounds, and server-side bots.
import { stepTank, createTankState, isSolid, TANK_PHYS } from '../../shared/physics/tanks.js';
import { TANK_ARENAS, TANK_TILE, TANK_COLS, TILE } from '../../shared/maps/tank-arenas.js';
import { TANK_PHASE, TANK_MODE, TANK_RULES as R, POWERUPS, POWERUP, TANK_FLAG, aimToI16 } from '../../shared/games/tanks.js';
import { BTN } from '../../shared/messages.js';
import { createRng } from '../../shared/rng.js';
import { InputQueue } from '../inputqueue.js';
import { createTankBot, stepTankBot } from './tanks-bots.js';

// Tuning
const COUNTDOWN_S = 3;
const ROUND_END_S = 3;
const END_HOLD_S = 3;
const PICKUP_EVERY_S = [7, 13];
const MAX_PICKUPS = 3;
const PICKUP_RADIUS = 11;
const CRATE_DROP_CHANCE = 0.3;
const BULLET_SUBSTEPS = 2;
const MAX_BULLETS_TOTAL = 80;

class TankGame {
  constructor(room, settings) {
    this.room = room;
    this.rng = createRng(settings.seed);
    this.arena = TANK_ARENAS[settings.arena] ?? TANK_ARENAS.kruispunt;
    this.mode = settings.mode === 'rounds' ? TANK_MODE.ROUNDS : TANK_MODE.DEATHMATCH;
    this.duration = settings.duration ?? 180;
    this.time = 0;
    this.round = 0;
    this.tanks = [];
    this.bullets = [];
    this.nextBulletId = 1;
    this.pickups = [];
    for (const p of room.gamePlayers()) this.onJoin(p);
    this._startRound();
  }

  // ---------------------------------------------------------------------------
  // Players
  // ---------------------------------------------------------------------------
  _tank(id) {
    return this.tanks.find((t) => t.player.id === id) ?? null;
  }

  onJoin(player) {
    if (this._tank(player.id)) return;
    const t = {
      player,
      s: createTankState(),
      aim: 0, hp: R.HP, alive: false, respawn: 0,
      shield: 0, triple: 0, bounce: 0, cooldown: 0,
      kills: 0, deaths: 0, roundWins: 0,
      queue: new InputQueue(),
      bot: createTankBot(),
    };
    this.tanks.push(t);
    // Late joiners in deathmatch drop in after a short wait.
    if (this.phase !== undefined && this.mode === TANK_MODE.DEATHMATCH) t.respawn = 1;
  }

  onLeave(player) {
    this.tanks = this.tanks.filter((t) => t.player.id !== player.id);
  }

  onReconnect(player) {
    const t = this._tank(player.id);
    if (t) t.queue = new InputQueue();
  }

  onInput(player, input) {
    this._tank(player.id)?.queue.push(input);
  }

  // ---------------------------------------------------------------------------
  // Rounds
  // ---------------------------------------------------------------------------
  _startRound() {
    this.round++;
    this.phase = TANK_PHASE.COUNTDOWN;
    this.phaseEnd = this.time + COUNTDOWN_S;
    this.tiles = this.arena.tiles.slice();
    this.crateHp = new Uint8Array(this.arena.crates.length).fill(R.CRATE_HP);
    this.bullets.length = 0;
    this.pickups.length = 0;
    this.pickupIn = 4;
    const spawns = this._spawnOrder();
    this.tanks.forEach((t, i) => this._place(t, spawns[i % spawns.length]));
    if (this.round === 1) this.endsAt = this.phaseEnd + this.duration;
    this.room.emit('round', { r: this.round });
  }

  // Spread players over the spawns: each next spawn is the one farthest
  // from the spawns already handed out (deterministic).
  _spawnOrder() {
    const left = [...this.arena.spawns];
    const order = [left.shift()];
    while (left.length) {
      let bestI = 0;
      let bestD = -1;
      left.forEach((sp, i) => {
        const d = Math.min(...order.map((o) => Math.hypot(o.x - sp.x, o.y - sp.y)));
        if (d > bestD) { bestD = d; bestI = i; }
      });
      order.push(left.splice(bestI, 1)[0]);
    }
    return order;
  }

  _place(t, spawn) {
    const s = t.s;
    s.x = Math.fround(spawn.x);
    s.y = Math.fround(spawn.y);
    // Face the middle of the arena.
    const dx = TANK_COLS * TANK_TILE / 2 - spawn.x;
    s.dx = Math.fround(Math.sign(dx) || 1);
    s.dy = 0;
    s.v = 0;
    s.boost = 0;
    t.aim = Math.atan2(0, s.dx);
    t.hp = R.HP;
    t.alive = true;
    t.respawn = 0;
    t.shield = R.SPAWN_SHIELD_S;
    t.triple = 0;
    t.bounce = 0;
    t.cooldown = 0.3;
  }

  // Deathmatch respawn: the spawn farthest from any living enemy.
  _respawn(t) {
    let best = this.arena.spawns[0];
    let bestD = -1;
    for (const sp of this.arena.spawns) {
      let d = Infinity;
      for (const o of this.tanks) if (o !== t && o.alive) d = Math.min(d, Math.hypot(o.s.x - sp.x, o.s.y - sp.y));
      if (d > bestD) { bestD = d; best = sp; }
    }
    this._place(t, best);
    this.room.emit('spawn', { s: t.player.slot });
  }

  tick(dt) {
    this.time += dt;
    if (this.phase === TANK_PHASE.COUNTDOWN) {
      this._drainInputs();
      if (this.time >= this.phaseEnd) {
        this.phase = TANK_PHASE.PLAY;
        this.room.emit('go');
      }
      return;
    }
    if (this.phase === TANK_PHASE.ROUND_END) {
      this._drainInputs();
      this._stepBullets(dt);
      if (this.time >= this.phaseEnd) {
        if (this.tanks.some((t) => t.roundWins >= R.ROUNDS_TO_WIN)) this._finish();
        else this._startRound();
      }
      return;
    }
    if (this.phase === TANK_PHASE.END) {
      this._drainInputs();
      if (this.time >= this.phaseEnd) this.room.endGame(this.results());
      return;
    }

    // --- PLAY ---
    for (const t of this.tanks) this._stepTank(t, dt);
    this._separateTanks();
    this._stepBullets(dt);
    this._stepPickups(dt);

    if (this.mode === TANK_MODE.DEATHMATCH) {
      if (this.time >= this.endsAt) this._finish();
    } else {
      const alive = this.tanks.filter((t) => t.alive);
      if (alive.length <= 1 && this.tanks.length > 1) {
        const winner = alive[0] ?? null;
        if (winner) winner.roundWins++;
        this.phase = TANK_PHASE.ROUND_END;
        this.phaseEnd = this.time + ROUND_END_S;
        this.room.emit('roundEnd', { s: winner ? winner.player.slot : -1 });
      }
    }
  }

  _finish() {
    this.phase = TANK_PHASE.END;
    this.phaseEnd = this.time + END_HOLD_S;
    this.room.emit('end');
  }

  _drainInputs() {
    for (const t of this.tanks) {
      t.queue.beginTick();
      while (t.queue.next());
    }
  }

  _stepTank(t, dt) {
    if (t.cooldown > 0) t.cooldown = Math.max(0, t.cooldown - dt);
    if (t.shield > 0) t.shield = Math.max(0, t.shield - dt);
    if (t.triple > 0) t.triple = Math.max(0, t.triple - dt);
    if (t.bounce > 0) t.bounce = Math.max(0, t.bounce - dt);

    if (!t.alive) {
      if (!t.player.isBot) this._drainOne(t);
      if (this.mode === TANK_MODE.DEATHMATCH && t.respawn > 0) {
        t.respawn -= dt;
        if (t.respawn <= 0) this._respawn(t);
      }
      return;
    }
    if (t.player.isBot) {
      const b = stepTankBot(t, this, dt, this.rng);
      stepTank(t.s, b.ax, b.ay, dt, this.tiles);
      t.aim = b.aim;
      if (b.fire) this._fire(t);
      return;
    }
    const q = t.queue;
    q.beginTick();
    let applied = 0;
    for (let input = q.next(); input; input = q.next()) {
      stepTank(t.s, input.ax, input.ay, dt, this.tiles);
      t.aim = input.aim;
      if (input.buttons & BTN.A) this._fire(t);
      applied++;
    }
    q.endTick(applied);
  }

  _drainOne(t) {
    t.queue.beginTick();
    while (t.queue.next());
  }

  // Tanks push each other apart (server only; the owner's prediction corrects).
  _separateTanks() {
    const min = TANK_PHYS.RADIUS * 2;
    for (let i = 0; i < this.tanks.length; i++) {
      const a = this.tanks[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.tanks.length; j++) {
        const b = this.tanks[j];
        if (!b.alive) continue;
        const dx = b.s.x - a.s.x;
        const dy = b.s.y - a.s.y;
        const d = Math.hypot(dx, dy);
        if (d >= min || d < 1e-6) continue;
        const push = (min - d) / 2;
        a.s.x = Math.fround(a.s.x - (dx / d) * push);
        a.s.y = Math.fround(a.s.y - (dy / d) * push);
        b.s.x = Math.fround(b.s.x + (dx / d) * push);
        b.s.y = Math.fround(b.s.y + (dy / d) * push);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Bullets
  // ---------------------------------------------------------------------------
  ownBullets(t) {
    let n = 0;
    for (const b of this.bullets) if (b.owner === t) n++;
    return n;
  }

  _fire(t) {
    if (t.cooldown > 0 || !t.alive || this.bullets.length >= MAX_BULLETS_TOTAL) return;
    const spread = t.triple > 0 ? [-0.18, 0, 0.18] : [0];
    if (this.ownBullets(t) + spread.length > R.MAX_BULLETS + (t.triple > 0 ? 3 : 0)) return;
    t.cooldown = R.FIRE_COOLDOWN_S;
    for (const off of spread) {
      const a = t.aim + off;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      this.bullets.push({
        id: this.nextBulletId,
        owner: t,
        x: t.s.x + dx * R.MUZZLE,
        y: t.s.y + dy * R.MUZZLE,
        vx: dx * R.BULLET_SPEED,
        vy: dy * R.BULLET_SPEED,
        bounces: t.bounce > 0 ? 3 : R.BOUNCES,
        age: 0,
      });
      this.nextBulletId = (this.nextBulletId % 65535) + 1;
    }
    this.room.emit('fire', { s: t.player.slot });
  }

  _stepBullets(dt) {
    const h = dt / BULLET_SUBSTEPS;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.age += dt;
      let dead = b.age > R.BULLET_LIFE_S;
      for (let k = 0; k < BULLET_SUBSTEPS && !dead; k++) {
        dead = this._moveAxis(b, b.vx * h, 0) || this._moveAxis(b, 0, b.vy * h) || this._hitTanks(b);
      }
      if (!dead) dead = this._hitBullets(b, i);
      if (dead) this.bullets.splice(i, 1);
    }
  }

  // Move along one axis; bounce off walls, break crates. Returns true when the bullet dies.
  _moveAxis(b, mx, my) {
    b.x += mx;
    b.y += my;
    const tx = Math.floor(b.x / TANK_TILE);
    const ty = Math.floor(b.y / TANK_TILE);
    if (!isSolid(this.tiles, tx, ty)) return false;
    const idx = ty * TANK_COLS + tx;
    if (this.tiles[idx] === TILE.CRATE) {
      this._damageCrate(idx);
      this.room.emit('spark', { x: Math.round(b.x), y: Math.round(b.y) });
      return true;
    }
    b.x -= mx;
    b.y -= my;
    if (b.bounces <= 0) {
      this.room.emit('spark', { x: Math.round(b.x), y: Math.round(b.y) });
      return true;
    }
    b.bounces--;
    if (mx) b.vx = -b.vx;
    if (my) b.vy = -b.vy;
    this.room.emit('bounce', { x: Math.round(b.x), y: Math.round(b.y) });
    return false;
  }

  _hitTanks(b) {
    const reach = TANK_PHYS.RADIUS + R.BULLET_RADIUS;
    for (const t of this.tanks) {
      if (!t.alive) continue;
      if (t === b.owner && b.age < R.SELF_HIT_AFTER_S) continue;
      const dx = t.s.x - b.x;
      const dy = t.s.y - b.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      this._damageTank(t, b.owner, b.x, b.y);
      return true;
    }
    return false;
  }

  _hitBullets(b, index) {
    for (let j = index - 1; j >= 0; j--) {
      const o = this.bullets[j];
      const dx = o.x - b.x;
      const dy = o.y - b.y;
      if (dx * dx + dy * dy > (R.BULLET_RADIUS * 2) ** 2) continue;
      this.bullets.splice(j, 1);
      this.room.emit('spark', { x: Math.round(b.x), y: Math.round(b.y) });
      return true;
    }
    return false;
  }

  _damageCrate(idx) {
    const c = this.arena.crates.indexOf(idx);
    if (c < 0) return;
    this.crateHp[c] = Math.max(0, this.crateHp[c] - 1);
    if (this.crateHp[c] > 0) return;
    this.tiles[idx] = TILE.FLOOR;
    const x = (idx % TANK_COLS + 0.5) * TANK_TILE;
    const y = (Math.floor(idx / TANK_COLS) + 0.5) * TANK_TILE;
    this.room.emit('crate', { x: Math.round(x), y: Math.round(y) });
    if (this.rng() < CRATE_DROP_CHANCE && this.pickups.length < MAX_PICKUPS + 2) {
      this.pickups.push({ x, y, type: Math.floor(this.rng() * POWERUPS.length) });
    }
  }

  _damageTank(t, attacker, x, y) {
    if (t.shield > 0) {
      this.room.emit('shieldHit', { x: Math.round(x), y: Math.round(y), s: t.player.slot });
      return;
    }
    t.hp--;
    this.room.emit('hit', { x: Math.round(x), y: Math.round(y), s: t.player.slot });
    if (t.hp > 0) return;
    t.alive = false;
    t.deaths++;
    t.respawn = R.RESPAWN_S;
    t.s.v = 0;
    if (attacker && attacker !== t) attacker.kills++;
    else if (attacker === t) t.kills--;
    this.room.emit('boom', {
      x: Math.round(t.s.x), y: Math.round(t.s.y), s: t.player.slot,
      by: attacker ? attacker.player.slot : -1,
    });
  }

  // ---------------------------------------------------------------------------
  // Power-ups
  // ---------------------------------------------------------------------------
  _stepPickups(dt) {
    this.pickupIn -= dt;
    if (this.pickupIn <= 0) {
      this.pickupIn = PICKUP_EVERY_S[0] + this.rng() * (PICKUP_EVERY_S[1] - PICKUP_EVERY_S[0]);
      const free = this.arena.pickups.filter((p) => !this.pickups.some((q) => q.x === p.x && q.y === p.y));
      if (free.length && this.pickups.length < MAX_PICKUPS) {
        const spot = free[Math.floor(this.rng() * free.length)];
        this.pickups.push({ x: spot.x, y: spot.y, type: Math.floor(this.rng() * POWERUPS.length) });
      }
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      for (const t of this.tanks) {
        if (!t.alive || Math.hypot(t.s.x - p.x, t.s.y - p.y) > PICKUP_RADIUS) continue;
        this._apply(t, p.type);
        this.pickups.splice(i, 1);
        this.room.emit('pickup', { s: t.player.slot, type: p.type });
        break;
      }
    }
  }

  _apply(t, type) {
    const secs = POWERUPS[type].seconds;
    if (type === POWERUP.REPAIR) t.hp = R.HP;
    else if (type === POWERUP.TRIPLE) t.triple = secs;
    else if (type === POWERUP.SPEED) t.s.boost = Math.fround(secs);
    else if (type === POWERUP.SHIELD) t.shield = secs;
    else if (type === POWERUP.BOUNCE) t.bounce = secs;
  }

  // ---------------------------------------------------------------------------
  // Snapshot + results
  // ---------------------------------------------------------------------------
  // Body layout (after the 14-byte header), decoded in public/games/tanks/state.js:
  // u8 phase, u8 mode, f32 remaining, u8 round,
  // u8 n × [u8 slot, u8 flags, u16 ack, f32 x, f32 y, f32 dx, f32 dy, f32 v, f32 boost,
  //         i16 aim, u8 hp, i16 kills, u8 deaths, u8 roundWins, u8 respawn(ds), u8 power(ds max of timers)]
  // u8 bullets × [u16 id, u8 ownerSlot, i16 x*8, i16 y*8]
  // u8 crates × u8 hp   (same order as arena.crates)
  // u8 pickups × [i16 x, i16 y, u8 type]
  snapshot(w) {
    const remaining = this.phase === TANK_PHASE.PLAY && this.mode === TANK_MODE.DEATHMATCH
      ? Math.max(0, this.endsAt - this.time)
      : Math.max(0, this.phaseEnd - this.time);
    w.u8(this.phase).u8(this.mode).f32(remaining).u8(this.round);
    w.u8(this.tanks.length);
    for (const t of this.tanks) {
      const p = t.player;
      const flags = (p.isBot ? TANK_FLAG.BOT : 0) | (p.isBot || p.connected ? TANK_FLAG.CONNECTED : 0)
        | (t.alive ? TANK_FLAG.ALIVE : 0) | (t.shield > 0 ? TANK_FLAG.SHIELD : 0)
        | (t.triple > 0 ? TANK_FLAG.TRIPLE : 0) | (t.bounce > 0 ? TANK_FLAG.BOUNCE : 0);
      const s = t.s;
      w.u8(p.slot).u8(flags).u16(t.queue.ackSeq);
      w.f32(s.x).f32(s.y).f32(s.dx).f32(s.dy).f32(s.v).f32(s.boost);
      w.i16(aimToI16(t.aim)).u8(t.hp).i16(Math.max(-32000, Math.min(32000, t.kills))).u8(Math.min(255, t.deaths));
      w.u8(t.roundWins).u8(Math.min(255, Math.ceil(Math.max(0, t.respawn) * 10)));
      w.u8(Math.min(255, Math.ceil(Math.max(t.shield, t.triple, t.bounce, s.boost) * 10)));
    }
    w.u8(this.bullets.length);
    for (const b of this.bullets) {
      w.u16(b.id).u8(b.owner.player.slot).i16(Math.round(b.x * 8)).i16(Math.round(b.y * 8));
    }
    w.u8(this.crateHp.length);
    for (let i = 0; i < this.crateHp.length; i++) w.u8(this.crateHp[i]);
    w.u8(this.pickups.length);
    for (const p of this.pickups) w.i16(Math.round(p.x)).i16(Math.round(p.y)).u8(p.type);
  }

  results() {
    const rounds = this.mode === TANK_MODE.ROUNDS;
    const sorted = [...this.tanks].sort((a, b) => (rounds ? b.roundWins - a.roundWins : 0) || b.kills - a.kills || a.deaths - b.deaths);
    return {
      title: 'Uitslag Tank Tumult',
      columns: rounds ? ['Rondes', 'Uitgeschakeld', 'Kapot'] : ['Uitgeschakeld', 'Kapot'],
      rows: sorted.map((t, i) => ({
        id: t.player.id,
        name: t.player.name,
        color: t.player.color,
        rank: i + 1,
        values: rounds ? [String(t.roundWins), String(t.kills), String(t.deaths)] : [String(t.kills), String(t.deaths)],
      })),
    };
  }
}

export default {
  id: 'tanks',
  realtime: true,
  create: (room, settings) => new TankGame(room, settings),
};
