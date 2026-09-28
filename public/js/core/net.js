// WebSocket client: connect, hello handshake, automatic reconnect with
// backoff, JSON + binary messages, latency (RTT) and server-clock estimate.
import {
  PROTOCOL_VERSION, WS_PATH, CLIENT_PING_INTERVAL_MS, RECONNECT_BACKOFF_MS, RECONNECT_GIVE_UP_MS,
} from '../../../shared/constants.js';
import { C2S, S2C, BIN, CLOSE } from '../../../shared/messages.js';
import { ByteReader } from '../../../shared/binary.js';

// Close codes after which reconnecting makes no sense.
const FATAL_CLOSES = new Set([CLOSE.VERSION, CLOSE.KICKED, CLOSE.REPLACED]);

export class Net {
  constructor(url = defaultUrl()) {
    this.url = url;
    this.ws = null;
    this.status = 'idle'; // idle | connecting | open | reconnecting | failed | closed
    this.handlers = new Map();
    this.rtt = 0;
    this.clockOffset = 0; // serverTime ≈ performance.now() + clockOffset
    this.bestRtt = Infinity;
    this.attempt = 0;
    this.lostAt = 0;
    this.pingTimer = null;
    this.retryTimer = null;
    this.intentional = false;
    this.welcome = null;

    this._onOnline = () => this.status === 'reconnecting' && this._retryNow();
    this._onVisible = () => document.visibilityState === 'visible' && this.status === 'reconnecting' && this._retryNow();
  }

  // --- Events --------------------------------------------------------------------
  // Types: any S2C type, 'binary' ({ type, tick, time, reader }), 'status', 'welcome'
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  emit(type, data) {
    const set = this.handlers.get(type);
    if (set) for (const fn of [...set]) fn(data);
  }

  _setStatus(status, extra = {}) {
    this.status = status;
    this.emit('status', { status, ...extra });
  }

  // --- Connection ------------------------------------------------------------------
  connect() {
    if (this.status === 'open' || this.status === 'connecting') return;
    this.intentional = false;
    this.attempt = 0;
    this.lostAt = 0;
    window.addEventListener('online', this._onOnline);
    document.addEventListener('visibilitychange', this._onVisible);
    this._open(false);
  }

  _open(isRetry) {
    clearTimeout(this.retryTimer);
    this._setStatus(isRetry ? 'reconnecting' : 'connecting', { attempt: this.attempt });
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      return this._scheduleRetry();
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => this.sendNow(C2S.HELLO, { build: document.documentElement.dataset.build ?? '' });
    ws.onmessage = (ev) => this._onMessage(ev.data);
    ws.onclose = (ev) => this._onClose(ev);
    ws.onerror = () => {}; // onclose follows; nothing useful to log
  }

  _onMessage(data) {
    if (typeof data !== 'string') return this._onBinary(data);
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.t === S2C.PONG) return this._onPong(msg);
    if (msg.t === S2C.WELCOME) {
      this.welcome = msg;
      this.clockOffset = msg.time - performance.now(); // rough, refined by pings
      this.bestRtt = Infinity;
      const wasReconnect = this.attempt > 0 || this.lostAt > 0;
      this.attempt = 0;
      this.lostAt = 0;
      this._setStatus('open', { reconnected: wasReconnect });
      this._startPing();
      this.emit('welcome', msg);
      return;
    }
    this.emit(msg.t, msg);
  }

  _onBinary(buf) {
    if (buf.byteLength < 2) return;
    const reader = new ByteReader(buf);
    const type = reader.u8();
    const version = reader.u8();
    if (version !== PROTOCOL_VERSION) return;
    if (type === BIN.SNAPSHOT) {
      const tick = reader.u32();
      const time = reader.f64();
      this.emit('binary', { type, tick, time, reader });
    }
  }

  _onClose(ev) {
    this._stopPing();
    this.ws = null;
    if (this.intentional) return this._setStatus('closed');
    if (FATAL_CLOSES.has(ev.code)) return this._setStatus('failed', { code: ev.code });
    if (!this.lostAt) this.lostAt = performance.now();
    this._scheduleRetry(ev.code);
  }

  _scheduleRetry(code) {
    if (performance.now() - this.lostAt > RECONNECT_GIVE_UP_MS) return this._setStatus('failed', { code });
    // Never connected at all (server down, blocked): give up quickly.
    if (!this.welcome && this.attempt >= 3) return this._setStatus('failed', { code });
    const delay = RECONNECT_BACKOFF_MS[Math.min(this.attempt, RECONNECT_BACKOFF_MS.length - 1)];
    this.attempt++;
    this._setStatus('reconnecting', { attempt: this.attempt, code, delay });
    this.retryTimer = setTimeout(() => this._open(true), delay);
  }

  _retryNow() {
    clearTimeout(this.retryTimer);
    this._open(true);
  }

  // Manual retry after we gave up.
  retry() {
    this.lostAt = performance.now();
    this.attempt = 0;
    this._retryNow();
  }

  close() {
    this.intentional = true;
    clearTimeout(this.retryTimer);
    this._stopPing();
    window.removeEventListener('online', this._onOnline);
    document.removeEventListener('visibilitychange', this._onVisible);
    if (this.ws) this.ws.close(1000, 'bye');
    else this._setStatus('closed');
  }

  // --- Sending -------------------------------------------------------------------------
  get isOpen() {
    return this.status === 'open' && this.ws?.readyState === WebSocket.OPEN;
  }

  // Only after the welcome (hello handshake done).
  send(type, payload = {}) {
    if (!this.isOpen) return false;
    return this.sendNow(type, payload);
  }

  sendNow(type, payload = {}) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ t: type, v: PROTOCOL_VERSION, ...payload }));
    return true;
  }

  sendBinary(bytes) {
    if (!this.isOpen) return false;
    this.ws.send(bytes);
    return true;
  }

  // --- Latency + clock sync -----------------------------------------------------------
  _startPing() {
    this._stopPing();
    const ping = () => this.sendNow(C2S.PING, { c: performance.now() });
    ping();
    this.pingTimer = setInterval(ping, CLIENT_PING_INTERVAL_MS);
  }

  _stopPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  _onPong({ c, s }) {
    const now = performance.now();
    const rtt = now - c;
    if (rtt < 0 || rtt > 30_000) return;
    this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
    // Samples with a low RTT give the most accurate offset (NTP-style).
    const offset = s - (c + rtt / 2);
    if (rtt <= this.bestRtt * 1.3) {
      this.bestRtt = Math.min(this.bestRtt, rtt);
      this.clockOffset = this.clockOffset ? this.clockOffset * 0.6 + offset * 0.4 : offset;
    } else {
      this.bestRtt *= 1.05; // slowly forget an old best when the network changes
    }
    this.emit('rtt', this.rtt);
  }

  serverNow() {
    return performance.now() + this.clockOffset;
  }
}

function defaultUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${WS_PATH}`;
}
