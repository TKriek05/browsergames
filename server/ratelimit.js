// Rate limiting: token buckets per connection and bookkeeping per IP address.

// Classic token bucket: `rate` tokens per second, at most `burst` stored.
export class TokenBucket {
  constructor(rate, burst, now = Date.now()) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.last = now;
  }

  take(n = 1, now = Date.now()) {
    const elapsed = (now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate);
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

// Per-connection limits (messages per second).
export const CONN_LIMITS = {
  messages: { rate: 60, burst: 100 }, // everything incl. realtime input at 30 Hz
  lobby: { rate: 8, burst: 16 }, // lobby actions (ready, settings, bots, ...)
  react: { rate: 1.5, burst: 4 }, // emoji reactions
  maxStrikes: 40, // invalid / over-limit messages before we hang up
  strikeDecayPerSec: 0.5, // strikes slowly cool down
};

export function createConnLimiter(now = Date.now()) {
  return {
    messages: new TokenBucket(CONN_LIMITS.messages.rate, CONN_LIMITS.messages.burst, now),
    lobby: new TokenBucket(CONN_LIMITS.lobby.rate, CONN_LIMITS.lobby.burst, now),
    react: new TokenBucket(CONN_LIMITS.react.rate, CONN_LIMITS.react.burst, now),
    strikes: 0,
    lastStrikeAt: 0,
  };
}

// Per-IP limits: concurrent connections, connection attempts, rooms created.
export class IpLimiter {
  constructor({ maxConnPerIp = 24, maxRoomsPerIp = 8, connectPerMinute = 60, roomsPerMinute = 12 } = {}) {
    this.maxConnPerIp = maxConnPerIp;
    this.maxRoomsPerIp = maxRoomsPerIp;
    this.connectPerMinute = connectPerMinute;
    this.roomsPerMinute = roomsPerMinute;
    this.ips = new Map();
  }

  _get(ip, now) {
    let e = this.ips.get(ip);
    if (!e) {
      e = {
        conns: 0,
        rooms: 0,
        connectBucket: new TokenBucket(this.connectPerMinute / 60, this.connectPerMinute / 2, now),
        roomBucket: new TokenBucket(this.roomsPerMinute / 60, Math.ceil(this.roomsPerMinute / 3), now),
        lastSeen: now,
      };
      this.ips.set(ip, e);
    }
    e.lastSeen = now;
    return e;
  }

  // Returns null when allowed, otherwise a reason string.
  checkConnect(ip, now = Date.now()) {
    const e = this._get(ip, now);
    if (e.conns >= this.maxConnPerIp) return 'too many connections';
    if (!e.connectBucket.take(1, now)) return 'too many connection attempts';
    return null;
  }

  addConnection(ip) { this._get(ip, Date.now()).conns++; }
  removeConnection(ip) {
    const e = this.ips.get(ip);
    if (e) e.conns = Math.max(0, e.conns - 1);
  }

  checkCreateRoom(ip, now = Date.now()) {
    const e = this._get(ip, now);
    if (e.rooms >= this.maxRoomsPerIp) return 'too many rooms';
    if (!e.roomBucket.take(1, now)) return 'creating rooms too fast';
    return null;
  }

  addRoom(ip) { this._get(ip, Date.now()).rooms++; }
  removeRoom(ip) {
    const e = this.ips.get(ip);
    if (e) e.rooms = Math.max(0, e.rooms - 1);
  }

  // Forget IPs without connections or rooms that have been quiet for a while.
  sweep(now = Date.now(), idleMs = 10 * 60_000) {
    for (const [ip, e] of this.ips) {
      if (e.conns === 0 && e.rooms === 0 && now - e.lastSeen > idleMs) this.ips.delete(ip);
    }
  }
}
