// Neon Tikkertje (server side). Small realtime game that exercises the whole
// netcode path: input queues, prediction-friendly shared physics, binary
// snapshots, server-side bots and results.
import { TAG_PHYS, stepRunner, touching } from '../../shared/physics/tag.js';
import { TAG_ARENAS, TAG_SPAWNS, TAG_FIELD } from '../../shared/maps/tag-arenas.js';
import { SIM_TICK_RATE } from '../../shared/constants.js';
import { InputQueue } from '../inputqueue.js';

// Tuning
const COUNTDOWN_S = 3;
const END_HOLD_S = 2.5; // freeze on the final state before the results
const IT_IDLE_PASS_S = 4; // an AFK tagger passes the role on
const BOT_LEVELS = {
  easy: { think: 0.5, speed: 0.72, lead: 0, jitter: 0.7, panic: 70 },
  normal: { think: 0.22, speed: 0.86, lead: 0.25, jitter: 0.35, panic: 90 },
  hard: { think: 0.08, speed: 1, lead: 0.55, jitter: 0.12, panic: 110 },
};

export const PHASE = { COUNTDOWN: 0, PLAY: 1, END: 2 };

class TagGame {
  constructor(room, settings) {
    this.room = room;
    this.duration = settings.duration;
    this.walls = (TAG_ARENAS[settings.arena] ?? TAG_ARENAS.pillars).walls;
    this.time = 0;
    this.phase = PHASE.COUNTDOWN;
    this.phaseEnd = COUNTDOWN_S;
    this.runners = []; // hot-loop friendly array
    this.itId = null;
    for (const p of room.gamePlayers()) this.onJoin(p);
    if (this.runners.length) this.itId = this.runners[Math.floor(Math.random() * this.runners.length)].player.id;
  }

  _runner(id) {
    return this.runners.find((r) => r.player.id === id) ?? null;
  }

  onJoin(player) {
    if (this._runner(player.id)) return;
    const spawn = TAG_SPAWNS[player.slot % TAG_SPAWNS.length];
    this.runners.push({
      player,
      x: spawn.x, y: spawn.y, vx: 0, vy: 0, stun: 0,
      immune: 0, itTime: 0, tags: 0,
      queue: new InputQueue(),
      bot: { ax: 0, ay: 0, thinkIn: 0 },
    });
  }

  onLeave(player) {
    this.runners = this.runners.filter((r) => r.player.id !== player.id);
    if (this.itId === player.id) this._passToRandom(null);
  }

  onReconnect(player) {
    const r = this._runner(player.id);
    if (r) r.queue = new InputQueue(); // the client may restart its sequence numbers
  }

  onInput(player, input) {
    this._runner(player.id)?.queue.push(input);
  }

  tick(dt) {
    this.time += dt;

    if (this.phase === PHASE.COUNTDOWN) {
      this._drainInputs();
      if (this.time >= this.phaseEnd) {
        this.phase = PHASE.PLAY;
        this.phaseEnd = this.time + this.duration;
        this.room.emit('go');
      }
      return;
    }
    if (this.phase === PHASE.END) {
      this._drainInputs();
      if (this.time >= this.phaseEnd) this.room.endGame(this.results());
      return;
    }

    // --- PLAY ---
    const it = this._runner(this.itId);
    for (let i = 0; i < this.runners.length; i++) {
      const r = this.runners[i];
      const isIt = r === it;
      if (r.player.isBot) {
        this._botThink(r, it, dt);
        stepRunner(r, r.bot.ax, r.bot.ay, dt, this.walls, isIt);
      } else {
        const q = r.queue;
        q.beginTick();
        let applied = 0;
        for (let input = q.next(); input; input = q.next()) {
          stepRunner(r, input.ax, input.ay, dt, this.walls, isIt);
          applied++;
        }
        q.endTick(applied);
      }
      if (r.immune > 0) r.immune = Math.max(0, r.immune - dt);
    }

    if (it) {
      it.itTime += dt;
      if (it.stun <= 0) {
        for (let i = 0; i < this.runners.length; i++) {
          const o = this.runners[i];
          if (o !== it && o.immune <= 0 && touching(it, o)) {
            this._transfer(it, o);
            break;
          }
        }
      }
      if (!it.player.isBot && it.queue.idleTicks > IT_IDLE_PASS_S * SIM_TICK_RATE) this._passToRandom(it);
    }

    if (this.time >= this.phaseEnd) {
      this.phase = PHASE.END;
      this.phaseEnd = this.time + END_HOLD_S;
      this.room.emit('end');
    }
  }

  // Outside PLAY we still acknowledge inputs, but nobody moves.
  _drainInputs() {
    for (const r of this.runners) {
      r.queue.beginTick();
      while (r.queue.next());
    }
  }

  _transfer(from, to) {
    this.itId = to.player.id;
    to.stun = TAG_PHYS.STUN_TIME;
    from.immune = TAG_PHYS.IMMUNE_TIME;
    from.tags++;
    this.room.emit('tag', { from: from.player.id, to: to.player.id, x: Math.round(to.x), y: Math.round(to.y) });
  }

  _passToRandom(except) {
    const others = this.runners.filter((r) => r !== except);
    if (!others.length) {
      this.itId = null;
      return;
    }
    const next = others[Math.floor(Math.random() * others.length)];
    this.itId = next.player.id;
    next.stun = TAG_PHYS.STUN_TIME;
    if (except) except.immune = TAG_PHYS.IMMUNE_TIME;
    this.room.emit('pass', { to: next.player.id });
  }

  // Simple steering bot: chase (with lead) when tagger, flee otherwise.
  _botThink(r, it, dt) {
    const cfg = BOT_LEVELS[r.player.botLevel] ?? BOT_LEVELS.normal;
    r.bot.thinkIn -= dt;
    if (r.bot.thinkIn > 0) return;
    r.bot.thinkIn = cfg.think * (0.7 + Math.random() * 0.6);

    let dx = 0;
    let dy = 0;
    if (r === it) {
      let best = null;
      let bestD = Infinity;
      for (const o of this.runners) {
        if (o === r || o.immune > 0) continue;
        const d = (o.x - r.x) ** 2 + (o.y - r.y) ** 2;
        if (d < bestD) { bestD = d; best = o; }
      }
      if (best) {
        dx = best.x + best.vx * cfg.lead - r.x;
        dy = best.y + best.vy * cfg.lead - r.y;
      }
    } else if (it) {
      dx = r.x - it.x;
      dy = r.y - it.y;
      const dist = Math.hypot(dx, dy);
      if (dist > cfg.panic * 1.6) {
        // Far away: drift towards the open middle and wander a bit.
        dx = (TAG_FIELD.width / 2 - r.x) * 0.3 + (Math.random() - 0.5) * 60;
        dy = (TAG_FIELD.height / 2 - r.y) * 0.3 + (Math.random() - 0.5) * 60;
      } else {
        // Avoid getting cornered: push away from the field edges.
        const m = 36;
        if (r.x < m) dx += (m - r.x) * 3;
        if (r.x > TAG_FIELD.width - m) dx -= (r.x - (TAG_FIELD.width - m)) * 3;
        if (r.y < m) dy += (m - r.y) * 3;
        if (r.y > TAG_FIELD.height - m) dy -= (r.y - (TAG_FIELD.height - m)) * 3;
      }
    }
    const len = Math.hypot(dx, dy) || 1;
    const jitter = cfg.jitter;
    r.bot.ax = (dx / len + (Math.random() - 0.5) * jitter) * cfg.speed;
    r.bot.ay = (dy / len + (Math.random() - 0.5) * jitter) * cfg.speed;
  }

  // Body layout (after the 14-byte header), see public/games/tag/client.js:
  // u8 phase, f32 phaseRemaining, u8 itSlot, u8 count,
  // count × [u8 slot, u8 flags, u16 ack, f32 x, f32 y, f32 vx, f32 vy, f32 stun, u16 itTime(ds), u8 tags]
  snapshot(w) {
    const it = this._runner(this.itId);
    w.u8(this.phase);
    w.f32(Math.max(0, this.phaseEnd - this.time));
    w.u8(it ? it.player.slot : 255);
    w.u8(this.runners.length);
    for (const r of this.runners) {
      const flags = (r.player.isBot ? 1 : 0) | (r.immune > 0 ? 2 : 0) | (r.player.isBot || r.player.connected ? 4 : 0);
      w.u8(r.player.slot).u8(flags).u16(r.queue.ackSeq);
      w.f32(r.x).f32(r.y).f32(r.vx).f32(r.vy).f32(r.stun);
      w.u16(Math.min(65535, Math.round(r.itTime * 10))).u8(Math.min(255, r.tags));
    }
  }

  results() {
    const sorted = [...this.runners].sort((a, b) => a.itTime - b.itTime || b.tags - a.tags);
    return {
      title: 'Uitslag Neon Tikkertje',
      columns: ['Tijd als tikker', 'Getikt'],
      rows: sorted.map((r, i) => ({
        id: r.player.id,
        name: r.player.name,
        color: r.player.color,
        rank: i + 1,
        values: [`${r.itTime.toFixed(1).replace('.', ',')} s`, String(r.tags)],
      })),
    };
  }
}

export default {
  id: 'tag',
  realtime: true,
  create: (room, settings) => new TagGame(room, settings),
};
