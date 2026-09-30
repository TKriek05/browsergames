// Lag compensation: a short history of entity positions, so the server can
// judge a shot against the world the shooter actually saw.
//
// Clients render other entities INTERP_DELAY_MS in the past. A shot carries
// that "view time" (server clock). The server rewinds to it, clamped to
// MAX_REWIND_MS so a lying or very laggy client cannot shoot into the distant past.
//
// Storage is preallocated (typed arrays per frame): recording is allocation-free.
export const MAX_REWIND_MS = 350;

export class LagHistory {
  // frames: how many ticks to keep (16 at 30 Hz ≈ 530 ms). capacity: max entities per frame.
  constructor({ frames = 16, capacity = 64 } = {}) {
    this.frames = Array.from({ length: frames }, () => ({
      time: -Infinity,
      count: 0,
      ids: new Int32Array(capacity),
      xs: new Float32Array(capacity),
      ys: new Float32Array(capacity),
      zs: new Float32Array(capacity),
    }));
    this.capacity = capacity;
    this.head = -1; // index of the newest frame
    this.size = 0;
    this.current = null;
  }

  // Start a new frame (call once per tick, after moving the entities).
  begin(time) {
    this.head = (this.head + 1) % this.frames.length;
    this.size = Math.min(this.size + 1, this.frames.length);
    const f = this.frames[this.head];
    f.time = time;
    f.count = 0;
    this.current = f;
  }

  add(id, x, y, z = 0) {
    const f = this.current;
    if (!f || f.count >= this.capacity) return;
    f.ids[f.count] = id;
    f.xs[f.count] = x;
    f.ys[f.count] = y;
    f.zs[f.count] = z;
    f.count++;
  }

  get newestTime() {
    return this.size ? this.frames[this.head].time : -Infinity;
  }

  // The time a shot should be judged at: its view time, clamped to what we keep.
  clampTime(viewTime, now) {
    const t = Number.isFinite(viewTime) ? viewTime : now;
    return Math.max(now - MAX_REWIND_MS, Math.min(now, t));
  }

  // Frame i steps back from the newest (0 = newest).
  _frame(back) {
    return this.frames[(this.head - back + this.frames.length * 2) % this.frames.length];
  }

  // Interpolated position of entity `id` at `time`. Writes into out {x, y, z}.
  // Returns false when the entity did not exist around that time.
  positionAt(id, time, out) {
    if (!this.size) return false;
    let newer = null;
    for (let back = 0; back < this.size; back++) {
      const f = this._frame(back);
      if (f.time <= time) {
        const ia = indexOf(f, id);
        if (ia < 0) return false;
        const ib = newer && newer.time !== f.time ? indexOf(newer, id) : -1;
        if (ib < 0) {
          out.x = f.xs[ia];
          out.y = f.ys[ia];
          out.z = f.zs[ia];
          return true;
        }
        const t = (time - f.time) / (newer.time - f.time);
        out.x = f.xs[ia] + (newer.xs[ib] - f.xs[ia]) * t;
        out.y = f.ys[ia] + (newer.ys[ib] - f.ys[ia]) * t;
        out.z = f.zs[ia] + (newer.zs[ib] - f.zs[ia]) * t;
        return true;
      }
      newer = f;
    }
    // Older than the whole history: use the oldest frame we have.
    const oldest = this._frame(this.size - 1);
    const i = indexOf(oldest, id);
    if (i < 0) return false;
    out.x = oldest.xs[i];
    out.y = oldest.ys[i];
    out.z = oldest.zs[i];
    return true;
  }

  clear() {
    this.head = -1;
    this.size = 0;
    this.current = null;
  }
}

function indexOf(frame, id) {
  const ids = frame.ids;
  for (let i = 0; i < frame.count; i++) if (ids[i] === id) return i;
  return -1;
}
