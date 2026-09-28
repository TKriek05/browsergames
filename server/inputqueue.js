// Per-player input buffer for realtime games.
//
// The client simulates one input per fixed tick and sends it with a sequence
// number. The server applies inputs in order, normally one per tick. A
// "credit" system allows catching up after network hiccups (a few inputs in
// one tick) but makes speed-hacking by flooding inputs impossible: you can
// never apply more inputs than ticks that have passed (+ a small allowance).
import { INPUT_QUEUE_SIZE, INPUT_CREDIT_MAX } from '../shared/constants.js';
import { seqNewer } from '../shared/binary.js';

export class InputQueue {
  constructor(size = INPUT_QUEUE_SIZE) {
    this.slots = Array.from({ length: size }, () => ({ seq: 0, buttons: 0, ax: 0, ay: 0, aim: 0 }));
    this.head = 0;
    this.count = 0;
    this.credits = 1;
    this.lastReceived = -1; // highest seq received
    this.ackSeq = 0; // highest seq applied (sent back to the client)
    this.idleTicks = 0; // ticks without any applied input
  }

  push(input) {
    if (this.lastReceived >= 0 && !seqNewer(input.seq, this.lastReceived)) return; // duplicate or stale
    this.lastReceived = input.seq;
    if (this.count === this.slots.length) {
      // Full: drop the oldest. The client reconciles against the ack.
      this.head = (this.head + 1) % this.slots.length;
      this.count--;
    }
    const slot = this.slots[(this.head + this.count) % this.slots.length];
    slot.seq = input.seq;
    slot.buttons = input.buttons;
    slot.ax = input.ax;
    slot.ay = input.ay;
    slot.aim = input.aim;
    this.count++;
  }

  // Call once at the start of every server tick.
  beginTick() {
    this.credits = Math.min(INPUT_CREDIT_MAX, this.credits + 1);
  }

  // Next input to apply this tick, or null. The returned object is reused.
  next() {
    if (this.count === 0 || this.credits < 1) return null;
    const slot = this.slots[this.head];
    this.head = (this.head + 1) % this.slots.length;
    this.count--;
    this.credits--;
    this.ackSeq = slot.seq;
    return slot;
  }

  // Bookkeeping helper so games can detect AFK players.
  endTick(applied) {
    this.idleTicks = applied > 0 ? 0 : this.idleTicks + 1;
  }
}
