// One WebSocket client. Knows its IP, rate limits and (optionally) the room
// and player it belongs to. The socket itself never leaves this class.
import { WebSocket } from 'ws';
import { encode } from './protocol.js';
import { createConnLimiter, CONN_LIMITS } from './ratelimit.js';
import { S2C, CLOSE } from '../shared/messages.js';

const MAX_BUFFERED_BYTES = 256 * 1024; // skip snapshots for clients that cannot keep up

let nextConnId = 1;

export class Connection {
  constructor(ws, ip, log) {
    this.id = nextConnId++;
    this.ws = ws;
    this.ip = ip;
    this.log = log;
    this.limiter = createConnLimiter();
    this.alive = true;
    this.helloed = false;
    this.room = null;
    this.player = null;
    this.closed = false;
  }

  get open() {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }

  get backlogged() {
    return this.ws.bufferedAmount > MAX_BUFFERED_BYTES;
  }

  send(type, payload) {
    if (this.open) this.ws.send(encode(type, payload));
  }

  // Pre-encoded JSON string or binary Uint8Array (shared between recipients).
  sendRaw(data) {
    if (this.open) this.ws.send(data);
  }

  error(code, extra = {}) {
    this.send(S2C.ERROR, { code, ...extra });
  }

  // Invalid or abusive message. Too many (strikes cool down over time) and we hang up.
  strike(reason) {
    const now = Date.now();
    const l = this.limiter;
    l.strikes = Math.max(0, l.strikes - ((now - (l.lastStrikeAt || now)) / 1000) * CONN_LIMITS.strikeDecayPerSec) + 1;
    l.lastStrikeAt = now;
    if (this.log.isDebug) this.log.debug('strike', { conn: this.id, ip: this.ip, reason, strikes: this.limiter.strikes });
    if (this.limiter.strikes > CONN_LIMITS.maxStrikes) {
      this.log.warn('closing abusive connection', { conn: this.id, ip: this.ip, reason });
      this.close(CLOSE.POLICY, 'policy');
    }
  }

  close(code, reason = '') {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close(code, reason);
    } catch {
      this.ws.terminate();
    }
    // Do not wait forever for a close handshake from a misbehaving client.
    setTimeout(() => this.ws.terminate(), 3000).unref();
  }
}
