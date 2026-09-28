// Room session on top of Net: create/join/leave, the current room state, and
// automatic re-join with the session token after a reconnect.
import { C2S, S2C, ERR, CLOSE } from '../../../shared/messages.js';
import { session as sessionStore, local } from './storage.js';
import { Net } from './net.js';

export class Session {
  constructor() {
    this.net = null;
    this.room = null; // public room state from the server
    this.me = null; // my player id
    this.pending = null; // { resolve, reject } for create/join
    this.handlers = new Map();
    this.lastStart = null;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  emit(type, data) {
    const set = this.handlers.get(type);
    if (set) for (const fn of [...set]) fn(data);
  }

  get myPlayer() {
    return this.room?.players.find((p) => p.id === this.me) ?? null;
  }

  get isHost() {
    return !!this.room && this.room.hostId === this.me;
  }

  // Lazily connect; resolves once the hello handshake is done.
  _ensureNet() {
    if (this.net && this.net.status === 'open') return Promise.resolve();
    if (!this.net) {
      this.net = new Net();
      this._wire(this.net);
    }
    return new Promise((resolve, reject) => {
      const offOk = this.net.on('welcome', () => { offOk(); offStatus(); resolve(); });
      const offStatus = this.net.on('status', ({ status }) => {
        if (status === 'failed') { offOk(); offStatus(); reject(new Error('connect failed')); }
      });
      this.net.connect();
    });
  }

  _wire(net) {
    net.on('status', (s) => this.emit('status', s));
    net.on('welcome', (w) => {
      // After a reconnect: take our seat back with the stored token.
      const saved = sessionStore.get('seat');
      if (this.room && saved && saved.code === this.room.code) {
        net.send(C2S.JOIN, { code: saved.code, name: local.get('name', ''), token: saved.token });
      }
      const build = document.documentElement.dataset.build;
      if (w.build && build && build !== '__BUILD__' && w.build !== build) this.emit('outdated', w);
    });
    net.on(S2C.JOINED, (msg) => {
      this.me = msg.you.id;
      sessionStore.set('seat', { code: msg.room.code, token: msg.you.token });
      this._setRoom(msg.room);
      this.pending?.resolve(msg.room);
      this.pending = null;
      this.emit('joined', msg.room);
    });
    net.on(S2C.ROOM, (msg) => {
      if (!msg.room) return; // we left
      this._setRoom(msg.room);
    });
    net.on(S2C.ERROR, (msg) => {
      if (this.pending) {
        this.pending.reject(Object.assign(new Error(msg.code), { code: msg.code }));
        this.pending = null;
        return;
      }
      if (msg.code === ERR.ROOM_CLOSED || msg.code === ERR.KICKED || msg.code === ERR.ROOM_NOT_FOUND) {
        this._forget();
      }
      this.emit('error', msg);
    });
    net.on(S2C.START, (msg) => {
      this.lastStart = msg;
      this.emit('start', msg);
    });
    net.on(S2C.END, (msg) => this.emit('end', msg));
    net.on(S2C.REACT, (msg) => this.emit('react', msg));
    net.on(S2C.NOTICE, (msg) => this.emit('notice', msg));
    net.on('status', ({ status, code }) => {
      if (status === 'failed' && code === CLOSE.KICKED) this._forget();
    });
  }

  _setRoom(room) {
    const prev = this.room;
    this.room = room;
    this.emit('room', { room, prev });
  }

  _request(type, payload) {
    return this._ensureNet().then(
      () =>
        new Promise((resolve, reject) => {
          this.pending?.reject(new Error('superseded'));
          this.pending = { resolve, reject };
          this.net.send(type, payload);
        }),
    );
  }

  create(game, name, solo = false) {
    return this._request(C2S.CREATE, { game, name, solo });
  }

  join(code, name) {
    const saved = sessionStore.get('seat');
    const token = saved && saved.code === code ? saved.token : undefined;
    return this._request(C2S.JOIN, { code, name, token });
  }

  leave() {
    if (this.net?.isOpen) this.net.send(C2S.LEAVE);
    this._forget();
    // Close the socket when idle in the hub; it is reopened on demand.
    this.net?.close();
    this.net = null;
  }

  _forget() {
    sessionStore.remove('seat');
    this.room = null;
    this.me = null;
    this.lastStart = null;
  }

  send(type, payload) {
    return this.net?.send(type, payload) ?? false;
  }
}
