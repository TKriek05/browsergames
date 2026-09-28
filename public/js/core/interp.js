// Snapshot interpolation for entities you do not control. We render them
// INTERP_DELAY_MS in the past, between the two snapshots around that time.
import { INTERP_DELAY_MS, MAX_EXTRAPOLATE_MS } from '../../../shared/constants.js';

export class SnapshotBuffer {
  constructor(maxAgeMs = 1000) {
    this.items = []; // { time, state } sorted by time
    this.maxAgeMs = maxAgeMs;
  }

  push(time, state) {
    const items = this.items;
    if (items.length && time <= items[items.length - 1].time) return; // out of order / duplicate
    items.push({ time, state });
    const cutoff = time - this.maxAgeMs;
    while (items.length > 2 && items[0].time < cutoff) items.shift();
  }

  clear() {
    this.items.length = 0;
  }

  get latest() {
    return this.items[this.items.length - 1] ?? null;
  }

  // Returns { a, b, t } with t in [0, 1 + extrapolation], or null when empty.
  sample(serverNow, delayMs = INTERP_DELAY_MS) {
    const items = this.items;
    if (!items.length) return null;
    const target = serverNow - delayMs;
    if (items.length === 1 || target <= items[0].time) return { a: items[0], b: items[0], t: 0 };

    for (let i = items.length - 1; i > 0; i--) {
      const a = items[i - 1];
      if (a.time <= target) {
        const b = items[i];
        return { a, b, t: (target - a.time) / (b.time - a.time) };
      }
    }
    // Target is newer than everything we have: extrapolate a little.
    const a = items[items.length - 2];
    const b = items[items.length - 1];
    const over = Math.min(target - b.time, MAX_EXTRAPOLATE_MS);
    return { a, b, t: 1 + over / (b.time - a.time) };
  }
}

export const lerp = (a, b, t) => a + (b - a) * t;
