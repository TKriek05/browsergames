// Test helpers: start a real server on a random port and talk to it with ws.
import WebSocket from 'ws';
import { startServer } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { createLogger } from '../server/log.js';
import { PROTOCOL_VERSION } from '../shared/constants.js';

export async function startTestServer(overrides = {}) {
  const config = loadConfig({
    port: 0,
    host: '127.0.0.1',
    allowedOrigins: [],
    log: createLogger('silent'),
    // All test clients share 127.0.0.1, so per-IP limits are relaxed by default.
    maxConnPerIp: 1000,
    maxRoomsPerIp: 1000,
    connectsPerMinute: 100_000,
    roomsPerMinute: 100_000,
    immutableAssets: true, // test the production cache headers
    ...overrides,
    timing: { sweepIntervalMs: 50, ...(overrides.timing ?? {}) },
  });
  const app = await startServer(config);
  const base = `http://127.0.0.1:${app.port}`;
  return {
    ...app,
    base,
    wsUrl: `ws://127.0.0.1:${app.port}/ws`,
    origin: base,
  };
}

export class TestClient {
  constructor(server, { origin = server.origin } = {}) {
    this.server = server;
    this.origin = origin;
    this.messages = [];
    this.binary = [];
    this.waiters = [];
    this.closeInfo = null;
  }

  open({ hello = true } = {}) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.server.wsUrl, { origin: this.origin });
      this.ws = ws;
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          this.binary.push(data);
          return;
        }
        const msg = JSON.parse(data.toString());
        this.messages.push(msg);
        for (const w of [...this.waiters]) {
          if (w.test(msg)) {
            this.waiters.splice(this.waiters.indexOf(w), 1);
            w.resolve(msg);
          }
        }
      });
      ws.on('close', (code, reason) => {
        this.closeInfo = { code, reason: reason.toString() };
        for (const w of this.waiters) w.onClose?.(this.closeInfo);
      });
      ws.on('error', (err) => reject(err));
      ws.on('unexpected-response', (req, res) => reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode })));
      ws.on('open', async () => {
        if (!hello) return resolve(this);
        this.send('hello');
        await this.waitFor((m) => m.t === 'welcome');
        resolve(this);
      });
    });
  }

  send(t, payload = {}) {
    this.ws.send(JSON.stringify({ t, v: PROTOCOL_VERSION, ...payload }));
  }

  waitFor(test, timeoutMs = 2000) {
    const found = this.messages.find(test);
    if (found) {
      this.messages.splice(this.messages.indexOf(found), 1);
      return Promise.resolve(found);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
      this.waiters.push({ test, resolve: (m) => { clearTimeout(timer); this.messages.splice(this.messages.indexOf(m), 1); resolve(m); } });
    });
  }

  waitType(t, timeoutMs) {
    return this.waitFor((m) => m.t === t, timeoutMs);
  }

  // Latest room state received so far (drains 'room' messages).
  async latestRoom(settleMs = 30) {
    await sleep(settleMs);
    const rooms = this.messages.filter((m) => m.t === 'room');
    this.messages = this.messages.filter((m) => m.t !== 'room');
    return rooms.length ? rooms[rooms.length - 1].room : null;
  }

  waitClose(timeoutMs = 2000) {
    if (this.closeInfo) return Promise.resolve(this.closeInfo);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for close')), timeoutMs);
      this.ws.once('close', (code, reason) => { clearTimeout(timer); resolve({ code, reason: reason.toString() }); });
    });
  }

  close() {
    this.ws?.terminate();
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function createRoom(server, name = 'Host', game = 'tag') {
  const c = await new TestClient(server).open();
  c.send('create', { game, name });
  const joined = await c.waitType('joined');
  c.id = joined.you.id;
  c.token = joined.you.token;
  c.code = joined.room.code;
  return c;
}

export async function joinRoom(server, code, name = 'Gast', token) {
  const c = await new TestClient(server).open();
  c.send('join', { code, name, token });
  const msg = await c.waitFor((m) => m.t === 'joined' || m.t === 'error');
  if (msg.t === 'joined') {
    c.id = msg.you.id;
    c.token = msg.you.token;
    c.code = msg.room.code;
  }
  c.joinResult = msg;
  return c;
}
