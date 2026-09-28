// Client-side prediction + server reconciliation for the entity you control.
//
// Every fixed tick: sample input → give it a sequence number → apply it
// locally with the SAME shared physics as the server → send it.
// When a snapshot arrives with "last applied seq = N": reset to the server
// state, drop inputs ≤ N and replay the rest. Small differences are smoothed
// out visually instead of snapping.
import { seqNewer } from '../../../shared/binary.js';

const MAX_PENDING = 90; // 3 s at 30 Hz

export class Predictor {
  // step(state, input): mutates state. copy(dst, src). smoothKeys: numeric fields to smooth.
  constructor({ step, copy, create, smoothKeys = ['x', 'y'], smoothing = 0.82 }) {
    this.step = step;
    this.copy = copy;
    this.smoothKeys = smoothKeys;
    this.smoothing = smoothing;
    this.state = create();
    this.prev = create();
    this.offset = Object.fromEntries(smoothKeys.map((k) => [k, 0]));
    this.pending = [];
    this.pool = [];
    this.seq = 0;
    this.ready = false; // true after the first server state
    this.corrections = 0;
  }

  // Apply one local input; returns its sequence number (to send to the server).
  apply(input) {
    this.seq = (this.seq + 1) & 0xffff;
    const rec = this.pool.pop() ?? { seq: 0, ax: 0, ay: 0, buttons: 0, aim: 0 };
    rec.seq = this.seq;
    rec.ax = input.ax;
    rec.ay = input.ay;
    rec.buttons = input.buttons;
    rec.aim = input.aim;
    this.pending.push(rec);
    if (this.pending.length > MAX_PENDING) this.pool.push(this.pending.shift());

    this.copy(this.prev, this.state);
    this.step(this.state, rec);
    this._decay();
    return this.seq;
  }

  // No input this tick (e.g. game not running): keep prev in sync for rendering.
  idle() {
    this.copy(this.prev, this.state);
    this._decay();
  }

  _decay() {
    for (const k of this.smoothKeys) {
      this.offset[k] *= this.smoothing;
      if (Math.abs(this.offset[k]) < 0.01) this.offset[k] = 0;
    }
  }

  reconcile(serverState, ackSeq) {
    while (this.pending.length && !seqNewer(this.pending[0].seq, ackSeq)) this.pool.push(this.pending.shift());

    if (!this.ready) {
      this.copy(this.state, serverState);
      this.copy(this.prev, serverState);
      this.ready = true;
      return;
    }
    const before = {};
    for (const k of this.smoothKeys) before[k] = this.state[k];

    this.copy(this.state, serverState);
    for (const rec of this.pending) this.step(this.state, rec);

    let moved = false;
    for (const k of this.smoothKeys) {
      const delta = before[k] - this.state[k];
      if (Math.abs(delta) > 1e-4) moved = true;
      // Large errors (teleport, respawn): snap instead of sliding.
      if (Math.abs(delta) > 40) {
        this.offset[k] = 0;
        this.prev[k] = this.state[k];
      } else {
        this.offset[k] += delta;
        this.prev[k] -= delta;
      }
    }
    if (moved) this.corrections++;
  }

  // Reset after a reconnect or new round.
  reset(serverState) {
    this.pool.push(...this.pending);
    this.pending.length = 0;
    this.ready = false;
    if (serverState) this.reconcile(serverState, this.seq);
  }

  // Interpolated + smoothed value for rendering.
  get(key, alpha) {
    return this.prev[key] + (this.state[key] - this.prev[key]) * alpha + (this.offset[key] ?? 0);
  }
}
