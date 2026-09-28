// Tiny binary helpers for compact realtime messages (little-endian).
// Works on DataView/ArrayBuffer, so the same code runs in browsers and Node.
import { BIN } from './messages.js';
import { PROTOCOL_VERSION } from './constants.js';

export class ByteWriter {
  constructor(capacity = 256) {
    this._alloc(capacity);
    this.pos = 0;
  }

  _alloc(capacity) {
    const old = this.bytes8;
    this.buffer = new ArrayBuffer(capacity);
    this.view = new DataView(this.buffer);
    this.bytes8 = new Uint8Array(this.buffer);
    if (old) this.bytes8.set(old.subarray(0, this.pos));
  }

  reset() {
    this.pos = 0;
    return this;
  }

  _ensure(n) {
    if (this.pos + n > this.buffer.byteLength) this._alloc(Math.max(this.buffer.byteLength * 2, this.pos + n));
  }

  u8(v) { this._ensure(1); this.view.setUint8(this.pos, v); this.pos += 1; return this; }
  i8(v) { this._ensure(1); this.view.setInt8(this.pos, v); this.pos += 1; return this; }
  u16(v) { this._ensure(2); this.view.setUint16(this.pos, v, true); this.pos += 2; return this; }
  i16(v) { this._ensure(2); this.view.setInt16(this.pos, v, true); this.pos += 2; return this; }
  u32(v) { this._ensure(4); this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; return this; }
  i32(v) { this._ensure(4); this.view.setInt32(this.pos, v | 0, true); this.pos += 4; return this; }
  f32(v) { this._ensure(4); this.view.setFloat32(this.pos, v, true); this.pos += 4; return this; }
  f64(v) { this._ensure(8); this.view.setFloat64(this.pos, v, true); this.pos += 8; return this; }

  // A fresh copy of the written bytes. Sockets may hold on to the buffer
  // after send(), so never hand out the reusable internal buffer.
  toBytes() {
    return this.bytes8.slice(0, this.pos);
  }
}

export class ByteReader {
  // Accepts ArrayBuffer, TypedArray or Node Buffer.
  constructor(data) {
    if (data instanceof ArrayBuffer) this.view = new DataView(data);
    else this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.pos = 0;
  }

  get remaining() { return this.view.byteLength - this.pos; }

  u8() { const v = this.view.getUint8(this.pos); this.pos += 1; return v; }
  i8() { const v = this.view.getInt8(this.pos); this.pos += 1; return v; }
  u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i16() { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  i32() { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  f32() { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  f64() { const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }
}

// ---------------------------------------------------------------------------
// Sequence numbers are u16 and wrap around; compare them with these helpers.
// ---------------------------------------------------------------------------
export function seqDiff(a, b) {
  return ((a - b + 0x8000) & 0xffff) - 0x8000;
}
export function seqNewer(a, b) {
  return seqDiff(a, b) > 0;
}

// ---------------------------------------------------------------------------
// Realtime input packet (10 bytes), identical for every realtime game:
// [u8 type][u8 version][u16 seq][u16 buttons][i8 ax][i8 ay][i16 aim]
// ax/ay: movement axes -1..1, aim: angle in radians (-PI..PI)
// ---------------------------------------------------------------------------
export const INPUT_BYTES = 10;

export function encodeInput(w, seq, input) {
  w.reset();
  w.u8(BIN.INPUT).u8(PROTOCOL_VERSION).u16(seq & 0xffff).u16(input.buttons & 0xffff);
  w.i8(axisToI8(input.ax)).i8(axisToI8(input.ay));
  w.i16(Math.round(clamp(input.aim || 0, -Math.PI, Math.PI) / Math.PI * 32767));
  return w.toBytes();
}

// Decodes into `out` (reused object). Returns false if the packet is malformed.
export function decodeInput(reader, out) {
  if (reader.remaining !== INPUT_BYTES - 2) return false; // header already consumed
  out.seq = reader.u16();
  out.buttons = reader.u16();
  out.ax = i8ToAxis(reader.i8());
  out.ay = i8ToAxis(reader.i8());
  out.aim = reader.i16() / 32767 * Math.PI;
  return true;
}

// Quantize an axis exactly like the wire does, so prediction uses the same value.
export function quantizeAxis(v) {
  return i8ToAxis(axisToI8(v));
}

function axisToI8(v) {
  return Math.round(clamp(Number.isFinite(v) ? v : 0, -1, 1) * 127);
}
function i8ToAxis(v) {
  return Math.max(-127, v) / 127;
}
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Snapshot header: [u8 type][u8 version][u32 tick][f64 serverTimeMs]
export const SNAPSHOT_HEADER_BYTES = 14;

export function writeSnapshotHeader(w, tick, time) {
  w.reset();
  w.u8(BIN.SNAPSHOT).u8(PROTOCOL_VERSION).u32(tick).f64(time);
}
