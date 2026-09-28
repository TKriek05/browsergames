// Fixed-timestep game loop for one room, plus snapshot sending and tick-time
// statistics. Realtime games: 30 Hz ticks, binary snapshots at 20 Hz.
// Board games: 10 Hz ticks, a JSON snapshot per recipient when `dirty`.
import { SIM_TICK_RATE, SNAPSHOT_RATE, BOARD_TICK_RATE, MAX_TICK_CATCHUP } from '../shared/constants.js';
import { S2C } from '../shared/messages.js';
import { ByteWriter, writeSnapshotHeader } from '../shared/binary.js';

export class GameLoop {
  constructor(room) {
    this.room = room;
    this.timer = null;
    this.tick = 0;
    this.writer = new ByteWriter(512);
    this.stats = { count: 0, totalMs: 0, maxMs: 0 };
  }

  get tickRate() {
    const m = this.room.module;
    return m.tickRate ?? (m.realtime ? SIM_TICK_RATE : BOARD_TICK_RATE);
  }

  start() {
    this.stop();
    this.tick = 0;
    const room = this.room;
    const stepMs = 1000 / this.tickRate;
    const snapMs = 1000 / SNAPSHOT_RATE;
    let next = performance.now() + stepMs;
    let snapAcc = 0;

    const run = () => {
      this.timer = null;
      if (!room.game) return;
      const now = performance.now();
      let steps = 0;
      while (now >= next && steps < MAX_TICK_CATCHUP) {
        next += stepMs;
        steps++;
        // Nobody watching: pause the simulation (game time uses ticks, not wall time).
        if (room.connectedHumans().length === 0) continue;

        const t0 = performance.now();
        room.game.tick(stepMs / 1000);
        this.tick++;
        if (!room.game) return; // the game ended inside tick()

        if (room.module.realtime) {
          snapAcc += stepMs;
          if (snapAcc >= snapMs) {
            snapAcc -= snapMs;
            this.sendSnapshot();
          }
        } else if (room.game.dirty) {
          room.game.dirty = false;
          this.sendSnapshot();
        }
        this._record(performance.now() - t0);
      }
      if (steps === MAX_TICK_CATCHUP && now >= next) {
        room.log.warn('tick loop behind, skipping ahead', { room: room.code, behindMs: Math.round(now - next) });
        next = now + stepMs;
      }
      this.timer = setTimeout(run, Math.max(0, next - performance.now()));
    };
    this.timer = setTimeout(run, stepMs);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  sendSnapshot() {
    const room = this.room;
    if (!room.game) return;
    if (room.module.realtime) {
      // One binary buffer shared by every recipient; slow clients are skipped.
      const bytes = this._binarySnapshot();
      for (const p of room.players) {
        if (p.conn && !p.conn.backlogged) p.conn.sendRaw(bytes);
      }
    } else {
      for (const p of room.players) if (p.conn) this.sendSnapshotTo(p.conn, p);
    }
  }

  // Board games may hide information per player (e.g. Zeeslag), so their
  // snapshot is built per recipient.
  sendSnapshotTo(conn, player) {
    const room = this.room;
    if (!room.game) return;
    if (room.module.realtime) conn.sendRaw(this._binarySnapshot());
    else conn.send(S2C.SNAP, { tick: this.tick, time: room.now(), state: room.game.snapshot(player) });
  }

  _binarySnapshot() {
    const w = this.writer;
    writeSnapshotHeader(w, this.tick, this.room.now());
    this.room.game.snapshot(w);
    return w.toBytes();
  }

  _record(ms) {
    const s = this.stats;
    s.count++;
    s.totalMs += ms;
    if (ms > s.maxMs) s.maxMs = ms;
  }

  takeStats() {
    const s = this.stats;
    this.stats = { count: 0, totalMs: 0, maxMs: 0 };
    return s;
  }
}
