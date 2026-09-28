// Hapvis (server side): fish grow by eating plankton and smaller fish, and
// flee from bigger ones. Points = everything you ate (they never go down, even
// when you are eaten and start small again). Most points after the time wins.
import { ArcadeGame } from './arcade.js';
import { ARCADE_PHASE } from '../../shared/games/arcade.js';
import { FISH, FISH_FLAG, createFish, stepFish, fishRadius, planktonSpots, canEat } from '../../shared/games/fish.js';
import { BTN } from '../../shared/messages.js';
import { createFishBot, stepFishBot } from './fish-bots.js';

const MASK_BYTES = FISH.PLANKTON / 8;

class FishGame extends ArcadeGame {
  constructor(room, settings) {
    super(room, settings, { countdown: 3, endHold: 4 });
    this.seed = (this.rng() * 0xffffffff) >>> 0;
    this.spots = planktonSpots(this.seed);
    this.food = new Uint8Array(FISH.PLANKTON).fill(1);
    this.foodBack = new Float32Array(FISH.PLANKTON); // respawn timers
    this.duration = settings.duration ?? 180;
    this.endsAt = this.phaseEnd + this.duration;
    this.addPlayers(); // onJoin spawns every fish
  }

  createEntity() {
    return { s: createFish(), alive: false, respawn: 0, score: 0, best: FISH.START_MASS, eaten: 0, bot: createFishBot() };
  }

  onJoin(player) {
    super.onJoin(player);
    if (this.seed !== undefined) this._spawn(this.ent(player.id));
  }

  // A fresh small fish, as far as possible from the big ones.
  _spawn(e) {
    let best = null;
    let bestD = -1;
    for (let k = 0; k < 12; k++) {
      const x = 40 + this.rng() * (FISH.WIDTH - 80);
      const y = 40 + this.rng() * (FISH.HEIGHT - 80);
      let d = Infinity;
      for (const o of this.ents) {
        if (o !== e && o.alive && o.s.mass > FISH.START_MASS * FISH.EAT_RATIO) d = Math.min(d, Math.hypot(o.s.x - x, o.s.y - y));
      }
      if (d > bestD) { bestD = d; best = { x, y }; }
    }
    Object.assign(e.s, createFish(Math.fround(best.x), Math.fround(best.y)));
    e.alive = true;
    e.respawn = 0;
  }

  step(dt) {
    if (this.time >= this.endsAt) {
      this.finish();
      return;
    }
    for (const e of this.ents) {
      if (!e.alive) {
        if (!e.player.isBot) this.eachInput(e, () => {});
        e.respawn -= dt;
        if (e.respawn <= 0) {
          this._spawn(e);
          this.room.emit('spawn', { s: e.player.slot });
        }
        continue;
      }
      if (e.player.isBot) {
        const b = stepFishBot(e, this, dt, this.rng);
        stepFish(e.s, b.ax, b.ay, b.a, dt);
      } else {
        this.eachInput(e, (input) => stepFish(e.s, input.ax, input.ay, input.buttons & BTN.A, dt));
      }
      // Giants slowly shrink.
      if (e.s.mass > FISH.DECAY_FROM) e.s.mass = Math.fround(e.s.mass - (e.s.mass - FISH.DECAY_FROM) * FISH.DECAY * dt * 10);
    }
    this._eatPlankton(dt);
    this._eatFish();
  }

  _eatPlankton(dt) {
    for (let i = 0; i < FISH.PLANKTON; i++) {
      if (!this.food[i]) {
        this.foodBack[i] -= dt;
        if (this.foodBack[i] <= 0) this.food[i] = 1;
        continue;
      }
      const px = this.spots.xs[i];
      const py = this.spots.ys[i];
      for (const e of this.ents) {
        if (!e.alive) continue;
        const r = fishRadius(e.s.mass) + FISH.PLANKTON_R;
        const dx = e.s.x - px;
        const dy = e.s.y - py;
        if (dx * dx + dy * dy > r * r) continue;
        this.food[i] = 0;
        const [lo, hi] = FISH.PLANKTON_RESPAWN_S;
        this.foodBack[i] = lo + this.rng() * (hi - lo);
        e.s.mass = Math.fround(e.s.mass + FISH.PLANKTON_MASS);
        e.score += FISH.PLANKTON_MASS;
        e.best = Math.max(e.best, e.s.mass);
        break;
      }
    }
  }

  _eatFish() {
    for (const a of this.ents) {
      if (!a.alive) continue;
      for (const b of this.ents) {
        if (a === b || !b.alive || !canEat(a.s, b.s)) continue;
        const d = Math.hypot(a.s.x - b.s.x, a.s.y - b.s.y);
        if (d > fishRadius(a.s.mass) - fishRadius(b.s.mass) * 0.4) continue;
        b.alive = false;
        b.respawn = FISH.RESPAWN_S;
        a.s.mass = Math.fround(a.s.mass + b.s.mass * FISH.EAT_GAIN);
        a.score += Math.round(b.s.mass);
        a.eaten++;
        a.best = Math.max(a.best, a.s.mass);
        this.room.emit('gulp', { s: a.player.slot, v: b.player.slot, x: Math.round(b.s.x), y: Math.round(b.s.y), m: Math.round(b.s.mass) });
      }
    }
  }

  // Body: u8 phase, f32 left, u32 seed,
  //   u8 n × [u8 slot, u8 flags, u16 ack, f32 x, y, vx, vy, mass, dash, cool, fx, fy, u8 prevA,
  //           u16 score, u8 respawn (ds)]
  //   32 bytes: plankton alive bits
  snapshot(w) {
    const left = this.phase === ARCADE_PHASE.PLAY ? this.endsAt - this.time : this.phaseEnd - this.time;
    this.writePhase(w, left);
    w.u32(this.seed);
    w.u8(this.ents.length);
    for (const e of this.ents) {
      const s = e.s;
      const flags = ArcadeGame.flags(e.player) | (e.alive ? FISH_FLAG.ALIVE : 0) | (s.dash > 0 ? FISH_FLAG.DASH : 0);
      w.u8(e.player.slot).u8(flags).u16(e.queue.ackSeq);
      w.f32(s.x).f32(s.y).f32(s.vx).f32(s.vy).f32(s.mass).f32(s.dash).f32(s.cool).f32(s.fx).f32(s.fy).u8(s.prevA);
      w.u16(Math.min(65535, e.score)).u8(Math.ceil(Math.max(0, e.respawn) * 10));
    }
    for (let b = 0; b < MASK_BYTES; b++) {
      let v = 0;
      for (let k = 0; k < 8; k++) if (this.food[b * 8 + k]) v |= 1 << k;
      w.u8(v);
    }
  }

  results() {
    const sorted = [...this.ents].sort((a, b) => b.score - a.score || b.best - a.best);
    return {
      title: 'Uitslag Hapvis',
      columns: ['Punten', 'Grootst', 'Vissen gehapt'],
      rows: this.rows(sorted, (e) => [e.score, Math.round(e.best), e.eaten]),
    };
  }
}

export default {
  id: 'fish',
  realtime: true,
  create: (room, settings) => new FishGame(room, settings),
};
