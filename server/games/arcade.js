// Shared base for the smaller realtime arcade games (phase 5): phases
// (countdown → play → round end → end), one entity per seated player with
// an InputQueue, and a few helpers. Subclasses implement:
//   createEntity(player) → {}          per-player state (player + queue are added)
//   step(dt)                           one PLAY tick
//   snapshot(w)                        binary body (call this.writePhase(w) first)
//   results()                          lobby results
//   nextRound?()                       after ROUND_END (default: finish)
//   onStart?()                         when PLAY begins
import { InputQueue } from '../inputqueue.js';
import { createRng } from '../../shared/rng.js';
import { ARCADE_PHASE } from '../../shared/games/arcade.js';

export class ArcadeGame {
  constructor(room, settings, { countdown = 3, endHold = 2.5 } = {}) {
    this.room = room;
    this.settings = settings;
    this.rng = createRng(settings.seed);
    this.time = 0;
    this.phase = ARCADE_PHASE.COUNTDOWN;
    this.phaseEnd = countdown;
    this.countdownS = countdown;
    this.endHold = endHold;
    this.ents = [];
  }

  // Call at the end of the subclass constructor.
  addPlayers() {
    for (const p of this.room.gamePlayers()) this.onJoin(p);
  }

  ent(id) {
    return this.ents.find((e) => e.player.id === id) ?? null;
  }

  onJoin(player) {
    if (this.ent(player.id)) return;
    const e = this.createEntity(player);
    e.player = player;
    e.queue = new InputQueue();
    this.ents.push(e);
  }

  onLeave(player) {
    this.ents = this.ents.filter((e) => e.player.id !== player.id);
  }

  onReconnect(player) {
    const e = this.ent(player.id);
    if (e) e.queue = new InputQueue();
  }

  onInput(player, input) {
    this.ent(player.id)?.queue.push(input);
  }

  // Apply a human's queued inputs (anti-speedhack credits): fn(input) each.
  eachInput(e, fn) {
    const q = e.queue;
    q.beginTick();
    let n = 0;
    for (let input = q.next(); input; input = q.next()) {
      fn(input);
      n++;
    }
    q.endTick(n);
    return n;
  }

  drain() {
    for (const e of this.ents) {
      e.queue.beginTick();
      while (e.queue.next());
    }
  }

  tick(dt) {
    this.time += dt;
    switch (this.phase) {
      case ARCADE_PHASE.COUNTDOWN:
        this.drain();
        if (this.time >= this.phaseEnd) {
          this.phase = ARCADE_PHASE.PLAY;
          this.onStart?.();
          this.room.emit('go');
        }
        return;
      case ARCADE_PHASE.ROUND_END:
        this.drain();
        this.roundEndStep?.(dt);
        if (this.time >= this.phaseEnd) {
          if (this.nextRound) this.nextRound();
          else this.finish();
        }
        return;
      case ARCADE_PHASE.END:
        this.drain();
        if (this.time >= this.phaseEnd) this.room.endGame(this.results());
        return;
      default:
        this.step(dt);
    }
  }

  startCountdown(seconds = this.countdownS) {
    this.phase = ARCADE_PHASE.COUNTDOWN;
    this.phaseEnd = this.time + seconds;
  }

  endRound(seconds, data = {}) {
    this.phase = ARCADE_PHASE.ROUND_END;
    this.phaseEnd = this.time + seconds;
    this.room.emit('roundEnd', data);
  }

  finish(data = {}) {
    if (this.phase === ARCADE_PHASE.END) return;
    this.phase = ARCADE_PHASE.END;
    this.phaseEnd = this.time + this.endHold;
    this.room.emit('end', data);
  }

  get playing() {
    return this.phase === ARCADE_PHASE.PLAY;
  }

  // Common snapshot prefix: u8 phase, f32 seconds left in this phase (or `left`).
  writePhase(w, left = this.phaseEnd - this.time) {
    w.u8(this.phase).f32(Math.max(0, left));
  }

  // Results helper: rows sorted by the caller, values as strings.
  rows(sorted, values) {
    return sorted.map((e, i) => ({
      id: e.player.id,
      name: e.player.name,
      color: e.player.color,
      rank: i + 1,
      values: values(e).map(String),
    }));
  }

  // Connected flag bits used by most snapshots.
  static flags(player) {
    return (player.isBot ? 1 : 0) | (player.isBot || player.connected ? 2 : 0);
  }
}
