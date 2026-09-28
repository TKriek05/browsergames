#!/usr/bin/env node
// Stress/soak test: N fake clients join one room (or several rooms), start a
// game and send random input at 30 Hz. With --chaos they also drop and
// resume connections, leave as host, send junk and try to overfill the room.
//
//   node tools/botclients.js                       # 6 clients, 1 room, 20 s
//   node tools/botclients.js --rooms 5 --duration 60
//   node tools/botclients.js --chaos
//   node tools/botclients.js --url wss://games.tkriek.dev/ws --origin https://games.tkriek.dev
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../shared/constants.js';
import { C2S, S2C, BIN, ERR } from '../shared/messages.js';
import { ByteWriter, encodeInput } from '../shared/binary.js';

// --- CLI arguments -----------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, all) => {
    if (arg.startsWith('--')) acc.push([arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const URL_ = args.url ?? 'ws://localhost:3000/ws';
const ORIGIN = args.origin ?? URL_.replace(/^ws/, 'http').replace(/\/ws$/, '');
const CLIENTS = Number(args.clients ?? 6);
const ROOMS = Number(args.rooms ?? 1);
const GAME = args.game ?? 'tag';
const DURATION_S = Number(args.duration ?? 20);
const CHAOS = !!args.chaos;
const JOIN_CODE = typeof args.room === 'string' ? args.room.toUpperCase() : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const stats = {
  snapshots: 0, jsonMsgs: 0, bytes: 0, reconnectsOk: 0, reconnectsFailed: 0, hostMigrations: 0,
  junkSent: 0, fullRejected: 0, unexpectedCloses: 0, errors: {},
};

// --- One fake client -----------------------------------------------------------------
class BotClient {
  constructor(name) {
    this.name = name;
    this.ws = null;
    this.room = null;
    this.me = null;
    this.token = null;
    this.code = null;
    this.playing = false;
    this.seq = 0;
    this.writer = new ByteWriter(16);
    this.input = { ax: 0, ay: 0, buttons: 0, aim: 0 };
    this.snapshots = 0;
    this.lastSnapAt = 0;
    this.maxGapMs = 0;
    this.rtt = 0;
    this.waiters = [];
    this.expectClose = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(URL_, { origin: ORIGIN });
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.on('open', () => {
        this.send(C2S.HELLO, { build: 'botclients' });
      });
      ws.on('message', (data, isBinary) => this.onMessage(data, isBinary, resolve));
      ws.on('close', (code) => {
        this.playing = false;
        if (!this.expectClose) {
          stats.unexpectedCloses++;
          log(`${this.name}: unexpected close ${code}`);
        }
      });
      ws.on('error', (err) => reject(err));
    });
  }

  onMessage(data, isBinary, onWelcome) {
    stats.bytes += data.byteLength ?? data.length;
    if (isBinary) {
      const view = new DataView(data);
      if (view.getUint8(0) === BIN.SNAPSHOT) {
        const now = Date.now();
        if (this.lastSnapAt && this.playing) this.maxGapMs = Math.max(this.maxGapMs, now - this.lastSnapAt);
        this.lastSnapAt = now;
        this.snapshots++;
        stats.snapshots++;
      }
      return;
    }
    const msg = JSON.parse(data.toString());
    stats.jsonMsgs++;
    switch (msg.t) {
      case S2C.WELCOME: onWelcome(); break;
      case S2C.JOINED:
        this.me = msg.you.id;
        this.token = msg.you.token;
        this.code = msg.room.code;
        this.room = msg.room;
        break;
      case S2C.ROOM: if (msg.room) this.room = msg.room; break;
      case S2C.START: this.playing = true; this.lastSnapAt = 0; break;
      case S2C.END: this.playing = false; break;
      case S2C.PONG: this.rtt = Date.now() - msg.c; break;
      case S2C.ERROR:
        stats.errors[msg.code] = (stats.errors[msg.code] ?? 0) + 1;
        break;
      default: break;
    }
    for (const w of [...this.waiters]) {
      if (w.test(msg)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  }

  waitFor(test, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const w = { test, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          reject(new Error(`${this.name}: timeout waiting`));
        }
      }, timeoutMs);
    });
  }

  send(t, payload = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t, v: PROTOCOL_VERSION, ...payload }));
  }

  get isHost() {
    return this.room?.hostId === this.me;
  }

  tickInput() {
    if (!this.playing || this.ws?.readyState !== WebSocket.OPEN) return;
    // Random walk that changes direction now and then.
    if (Math.random() < 0.08) {
      const a = Math.random() * Math.PI * 2;
      this.input.ax = Math.cos(a);
      this.input.ay = Math.sin(a);
    }
    this.seq = (this.seq + 1) & 0xffff;
    this.ws.send(encodeInput(this.writer, this.seq, this.input));
  }

  close() {
    this.expectClose = true;
    this.ws?.close();
  }

  // Abrupt drop (no close handshake), like a phone losing wifi.
  drop() {
    this.expectClose = true;
    this.ws?.terminate();
  }
}

// --- Scenario per room -------------------------------------------------------------------
async function runRoom(index) {
  const clients = Array.from({ length: CLIENTS }, (_, i) => new BotClient(`r${index}-bot${i + 1}`));
  for (const c of clients) await c.connect();

  const host = clients[0];
  if (JOIN_CODE) {
    for (const c of clients) c.send(C2S.JOIN, { code: JOIN_CODE, name: c.name });
  } else {
    host.send(C2S.CREATE, { game: GAME, name: host.name });
    await host.waitFor((m) => m.t === S2C.JOINED);
    for (const c of clients.slice(1)) {
      c.send(C2S.JOIN, { code: host.code, name: c.name });
      await c.waitFor((m) => m.t === S2C.JOINED || m.t === S2C.ERROR);
    }
  }
  const code = clients[0].code ?? JOIN_CODE;
  log(`room ${code}: ${clients.filter((c) => c.me).length} clients joined`);

  for (const c of clients) c.send(C2S.READY, { ready: true });
  await sleep(300);
  if (!JOIN_CODE) {
    host.send(C2S.START);
    await host.waitFor((m) => m.t === S2C.START, 3000).catch(() => log(`room ${code}: start failed`, JSON.stringify(stats.errors)));
  }

  const inputTimer = setInterval(() => clients.forEach((c) => c.tickInput()), 1000 / 30);
  const pingTimer = setInterval(() => clients.forEach((c) => c.send(C2S.PING, { c: Date.now() })), 2000);
  const chaosTimer = CHAOS ? setInterval(() => chaos(clients, code).catch((e) => log('chaos error', e.message)), 2500) : null;

  await sleep(DURATION_S * 1000);
  clearInterval(inputTimer);
  clearInterval(pingTimer);
  if (chaosTimer) clearInterval(chaosTimer);
  return clients;
}

// --- Chaos actions -------------------------------------------------------------------------
async function chaos(clients, code) {
  const action = ['drop', 'drop', 'hostLeave', 'junk', 'overfill'][Math.floor(Math.random() * 5)];
  const live = clients.filter((c) => c.ws?.readyState === WebSocket.OPEN && c.me);
  if (!live.length) return;

  if (action === 'drop') {
    const c = live[Math.floor(Math.random() * live.length)];
    const { me, token } = c;
    c.drop();
    await sleep(500 + Math.random() * 1500);
    c.expectClose = false;
    await c.connect();
    c.send(C2S.JOIN, { code, name: c.name, token });
    const msg = await c.waitFor((m) => m.t === S2C.JOINED || m.t === S2C.ERROR).catch(() => null);
    if (msg?.t === S2C.JOINED && msg.you.id === me) stats.reconnectsOk++;
    else {
      stats.reconnectsFailed++;
      log(`${c.name}: reconnect failed`, msg?.code ?? 'timeout');
    }
  } else if (action === 'hostLeave') {
    const host = live.find((c) => c.isHost);
    if (!host) return;
    const oldHost = host.me;
    host.send(C2S.LEAVE);
    host.me = null;
    host.playing = false;
    await sleep(300);
    const other = live.find((c) => c !== host);
    if (other && other.room.hostId && other.room.hostId !== oldHost) stats.hostMigrations++;
    else log('host migration not observed');
    // Come back as a fresh player (spectator while the game runs).
    host.send(C2S.JOIN, { code, name: host.name });
    await host.waitFor((m) => m.t === S2C.JOINED || m.t === S2C.ERROR).catch(() => null);
  } else if (action === 'junk') {
    const c = live[Math.floor(Math.random() * live.length)];
    const junk = ['{not json', JSON.stringify({ t: 'hack', v: PROTOCOL_VERSION }), JSON.stringify({ t: 'ready', v: PROTOCOL_VERSION, ready: 'yes' }), JSON.stringify([1, 2, 3])];
    for (const j of junk) c.ws.send(j);
    c.ws.send(new Uint8Array([BIN.INPUT, PROTOCOL_VERSION, 1])); // truncated input
    stats.junkSent += junk.length + 1;
  } else if (action === 'overfill') {
    const extra = new BotClient('intruder');
    await extra.connect();
    extra.send(C2S.JOIN, { code, name: 'Intruder' });
    const msg = await extra.waitFor((m) => m.t === S2C.JOINED || m.t === S2C.ERROR).catch(() => null);
    if (msg?.t === S2C.ERROR && msg.code === ERR.ROOM_FULL) stats.fullRejected++;
    extra.close();
  }
}

// --- Main ------------------------------------------------------------------------------------
log(`botclients → ${URL_} | ${ROOMS} room(s) × ${CLIENTS} clients | game=${GAME} | ${DURATION_S}s${CHAOS ? ' | CHAOS' : ''}`);
const statsTimer = setInterval(() => {
  log(`snapshots=${stats.snapshots} json=${stats.jsonMsgs} kB=${Math.round(stats.bytes / 1024)} reconnects=${stats.reconnectsOk}/${stats.reconnectsOk + stats.reconnectsFailed}`);
}, 5000);

const all = (await Promise.all(Array.from({ length: ROOMS }, (_, i) => runRoom(i)))).flat();
clearInterval(statsTimer);

const withSnaps = all.filter((c) => c.snapshots > 0);
const rtts = all.map((c) => c.rtt).filter(Boolean);
const summary = {
  clients: all.length,
  clientsWithSnapshots: withSnaps.length,
  snapshotsPerClientPerSec: +(stats.snapshots / all.length / DURATION_S).toFixed(1),
  maxSnapshotGapMs: Math.max(0, ...all.map((c) => c.maxGapMs)),
  avgRttMs: rtts.length ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) : null,
  kBPerClientPerSec: +(stats.bytes / 1024 / all.length / DURATION_S).toFixed(2),
  ...(CHAOS && {
    reconnectsOk: stats.reconnectsOk,
    reconnectsFailed: stats.reconnectsFailed,
    hostMigrations: stats.hostMigrations,
    junkMessagesSent: stats.junkSent,
    overfillRejected: stats.fullRejected,
  }),
  unexpectedCloses: stats.unexpectedCloses,
  serverErrors: stats.errors,
};
console.log('\nResultaat:', JSON.stringify(summary, null, 2));
for (const c of all) c.close();

const ok = !JOIN_CODE ? withSnaps.length > 0 && stats.reconnectsFailed === 0 && stats.unexpectedCloses === 0 : true;
setTimeout(() => process.exit(ok ? 0 : 1), 300);
