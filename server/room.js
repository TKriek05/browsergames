// A single room: its people (humans, bots, spectators), lobby actions, the
// reconnect grace period, host migration and the game lifecycle
// (the tick loop itself lives in gameloop.js).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { MAX_PEOPLE_PER_ROOM, PLAYER_COLORS, SNAPSHOT_RATE } from '../shared/constants.js';
import { S2C, ERR, CLOSE, C2S } from '../shared/messages.js';
import { getGame } from '../shared/catalog.js';
import { normalizeSettings } from '../shared/settings.js';
import { checkCanStart } from '../shared/lobbyrules.js';
import { sanitizeName, defaultName, BOT_NAMES } from '../shared/names.js';
import { decodeInput } from '../shared/binary.js';
import { encode } from './protocol.js';
import { serverNow } from './clock.js';
import { GameLoop } from './gameloop.js';

const newToken = () => randomBytes(18).toString('base64url'); // 24 chars

export class Room {
  constructor({ code, gameId, module, creatorIp, timing, log, onEmptyTick }) {
    this.code = code;
    this.gameId = gameId;
    this.meta = getGame(gameId);
    this.module = module;
    this.creatorIp = creatorIp;
    this.timing = timing;
    this.log = log;
    this.onEmptyTick = onEmptyTick;

    this.state = 'lobby'; // 'lobby' | 'playing' | 'closed'
    this.players = []; // join order; includes bots and spectators
    this.hostId = null;
    this.hostLostAt = 0;
    this.settings = normalizeSettings(gameId, {});
    this.lastResults = null;
    this.nextPlayerNum = 1;

    const now = Date.now();
    this.createdAt = now;
    this.lastActivity = now;
    this.emptySince = now;

    this.game = null;
    this.loop = new GameLoop(this);
    this.inputScratch = { seq: 0, buttons: 0, ax: 0, ay: 0, aim: 0 };
    this.roomUpdateQueued = false;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------
  now() {
    return serverNow();
  }

  get seated() {
    return this.players.filter((p) => p.role === 'player').sort((a, b) => a.slot - b.slot);
  }

  // Players taking part in the game (humans + bots), ordered by slot.
  gamePlayers() {
    return this.seated;
  }

  connectedHumans() {
    return this.players.filter((p) => !p.isBot && p.connected);
  }

  findById(id) {
    return this.players.find((p) => p.id === id) ?? null;
  }

  findByToken(token) {
    const probe = Buffer.from(token);
    return (
      this.players.find((p) => p.token && p.token.length === token.length && timingSafeEqual(Buffer.from(p.token), probe)) ?? null
    );
  }

  _freeSlot() {
    for (let s = 0; s < MAX_PEOPLE_PER_ROOM; s++) if (!this.players.some((p) => p.slot === s)) return s;
    return -1;
  }

  _freeColor(preferred) {
    const used = new Set(this.players.map((p) => p.color));
    if (!used.has(preferred)) return preferred;
    for (let c = 0; c < PLAYER_COLORS.length; c++) if (!used.has(c)) return c;
    return preferred;
  }

  _uniqueName(name, except = null) {
    const taken = (n) => this.players.some((p) => p !== except && p.name.toLowerCase() === n.toLowerCase());
    if (!taken(name)) return name;
    for (let i = 2; i < 10; i++) {
      const candidate = `${Array.from(name).slice(0, 14).join('')} ${i}`;
      if (!taken(candidate)) return candidate;
    }
    return name;
  }

  _newPlayer({ name, isBot = false, botLevel = null, role = 'player' }) {
    const slot = this._freeSlot();
    return {
      id: `p${this.nextPlayerNum++}`,
      token: isBot ? null : newToken(),
      name,
      slot,
      color: this._freeColor(slot),
      role,
      wantsToPlay: role === 'player',
      ready: isBot,
      isBot,
      botLevel,
      conn: null,
      connected: false,
      disconnectedAt: 0,
      joinedAt: Date.now(),
    };
  }

  // ---------------------------------------------------------------------------
  // Membership
  // ---------------------------------------------------------------------------

  // Adds a human. Returns the player, or null when the room is full.
  addHuman(conn, rawName) {
    const inLobby = this.state === 'lobby';
    const seatFree = this.seated.length < this.meta.max;

    // In the lobby, bots are placeholders: a human takes over a bot's place.
    if ((this.players.length >= MAX_PEOPLE_PER_ROOM || !seatFree) && inLobby) {
      const bot = [...this.players].reverse().find((p) => p.isBot);
      if (bot) this._remove(bot);
    }
    if (this.players.length >= MAX_PEOPLE_PER_ROOM) return null;

    const role = inLobby && this.seated.length < this.meta.max ? 'player' : 'spectator';
    const player = this._newPlayer({ name: '', role });
    player.name = this._uniqueName(sanitizeName(rawName) || defaultName(player.slot));
    player.wantsToPlay = true;
    this.players.push(player);
    this._attach(player, conn);
    if (!this.hostId) this.hostId = player.id;
    if (this.game && player.role === 'player') this.game.onJoin?.(player);
    this.log.debug('join', { room: this.code, player: player.id, role });
    this.markDirty();
    return player;
  }

  _attach(player, conn) {
    player.conn = conn;
    player.connected = true;
    player.disconnectedAt = 0;
    conn.room = this;
    conn.player = player;
    this.emptySince = 0;
    if (player.id === this.hostId) this.hostLostAt = 0;
  }

  _unbind(player) {
    const conn = player.conn;
    if (conn) {
      conn.room = null;
      conn.player = null;
    }
    player.conn = null;
    player.connected = false;
  }

  // Same seat, new socket (reconnect or page reload with the session token).
  reattach(player, conn) {
    const old = player.conn;
    if (old && old !== conn) {
      this._unbind(player);
      old.close(CLOSE.REPLACED, 'replaced'); // the client shows "opened in another tab"
    }
    this._attach(player, conn);
    this.touch();
    if (this.game) this.game.onReconnect?.(player);
    this.log.debug('reattach', { room: this.code, player: player.id });
    this.markDirty();
  }

  // After JOINED: a (re)joining client needs the running game + a snapshot.
  resync(player) {
    if (!this.game || !player.conn) return;
    player.conn.send(S2C.START, this.startPayload());
    this.loop.sendSnapshotTo(player.conn, player);
  }

  // Socket dropped: keep the seat for the grace period.
  detach(player) {
    this._unbind(player);
    player.disconnectedAt = Date.now();
    if (player.id === this.hostId) this.hostLostAt = Date.now();
    if (this.connectedHumans().length === 0) this.emptySince = Date.now();
    this.markDirty();
  }

  // Explicit leave or grace expired. During a game a bot may take over.
  vacate(player, reason) {
    if (this.game && player.role === 'player' && this.meta.bots) {
      this._botTakeover(player);
    } else {
      this._remove(player);
    }
    this.log.debug('vacate', { room: this.code, player: player.id, reason });
  }

  _botTakeover(player) {
    this._unbind(player);
    player.isBot = true;
    player.botLevel = 'normal';
    player.token = null;
    player.ready = true;
    this.game?.onBotTakeover?.(player);
    if (player.id === this.hostId) this._migrateHost();
    this.markDirty();
  }

  _remove(player) {
    this._unbind(player);
    this.players = this.players.filter((p) => p !== player);
    if (this.game && player.role === 'player') this.game.onLeave?.(player);
    if (player.id === this.hostId) this._migrateHost();
    if (this.connectedHumans().length === 0 && !this.emptySince) this.emptySince = Date.now();
    this.markDirty();
  }

  // Next connected human (join order) becomes host.
  _migrateHost() {
    const humans = this.players.filter((p) => !p.isBot).sort((a, b) => a.joinedAt - b.joinedAt);
    const next = humans.find((p) => p.connected) ?? humans[0] ?? null;
    const prev = this.hostId;
    this.hostId = next ? next.id : null;
    this.hostLostAt = next && !next.connected ? Date.now() : 0;
    if (prev !== this.hostId && next) this.notice(`${next.name} is nu de host.`);
    this.markDirty();
  }

  // Called every second by the manager. Returns true when the room should close.
  update(now) {
    const { reconnectGraceMs, hostMigrateDelayMs, emptyRoomTtlMs, idleRoomTtlMs } = this.timing;
    for (const p of [...this.players]) {
      if (!p.isBot && !p.connected && p.disconnectedAt && now - p.disconnectedAt > reconnectGraceMs) {
        this.vacate(p, 'timeout');
      }
    }
    const host = this.findById(this.hostId);
    if (host && !host.connected && this.hostLostAt && now - this.hostLostAt > hostMigrateDelayMs) {
      if (this.connectedHumans().length > 0) this._migrateHost();
    }
    if (this.emptySince && now - this.emptySince > emptyRoomTtlMs) return true;
    if (now - this.lastActivity > idleRoomTtlMs) return true;
    return false;
  }

  touch() {
    this.lastActivity = Date.now();
  }

  // ---------------------------------------------------------------------------
  // Messages from members (lobby actions + game input)
  // ---------------------------------------------------------------------------
  handle(player, msg) {
    this.touch();
    const isHost = player.id === this.hostId;
    const hostOnly = () => {
      if (!isHost) player.conn?.error(ERR.NOT_HOST);
      return isHost;
    };

    switch (msg.t) {
      case C2S.READY:
        if (this.state === 'lobby' && player.role === 'player') player.ready = msg.ready;
        break;
      case C2S.NAME: {
        const name = sanitizeName(msg.name);
        if (name) player.name = this._uniqueName(name, player);
        break;
      }
      case C2S.COLOR:
        this._cycleColor(player);
        break;
      case C2S.ROLE:
        this._setRole(player, msg.role);
        break;
      case C2S.SETTINGS:
        if (hostOnly() && this.state === 'lobby') this.settings = normalizeSettings(this.gameId, msg.settings, this.settings);
        break;
      case C2S.ADD_BOT:
        if (hostOnly()) this.addBot(msg.level ?? 'normal', player);
        break;
      case C2S.FILL_BOTS:
        if (hostOnly()) this.fillBots(msg.level ?? 'normal', player);
        break;
      case C2S.REMOVE_BOT: {
        const bot = this.findById(msg.id);
        if (hostOnly() && bot?.isBot && this.state === 'lobby') this._remove(bot);
        break;
      }
      case C2S.BOT_LEVEL: {
        const bot = this.findById(msg.id);
        if (hostOnly() && bot?.isBot) {
          bot.botLevel = msg.level;
          this.game?.onBotLevel?.(bot);
        }
        break;
      }
      case C2S.KICK: {
        const target = this.findById(msg.id);
        if (hostOnly() && target && target !== player) this.kick(target);
        break;
      }
      case C2S.START:
        if (hostOnly()) this.start(player);
        break;
      case C2S.TO_LOBBY:
        if (hostOnly() && this.state === 'playing') this.endGame(null, 'aborted');
        break;
      case C2S.REACT:
        this.broadcast(S2C.REACT, { id: player.id, r: msg.r });
        return; // no room update needed
      case C2S.INPUT:
        if (this.game && player.role === 'player' && !player.isBot) this.game.onInput?.(player, msg.data);
        return;
      default:
        return;
    }
    this.markDirty();
  }

  // Returns false only when the packet is malformed.
  handleBinaryInput(player, reader) {
    if (!decodeInput(reader, this.inputScratch)) return false;
    if (!this.game || player.role !== 'player' || player.isBot) return true;
    this.lastActivity = Date.now();
    this.game.onInput?.(player, this.inputScratch);
    return true;
  }

  _cycleColor(player) {
    const used = new Set(this.players.filter((p) => p !== player).map((p) => p.color));
    for (let i = 1; i <= PLAYER_COLORS.length; i++) {
      const c = (player.color + i) % PLAYER_COLORS.length;
      if (!used.has(c)) {
        player.color = c;
        return;
      }
    }
  }

  _setRole(player, role) {
    if (this.state !== 'lobby' || player.role === role) return;
    if (role === 'player') {
      if (this.seated.length >= this.meta.max) {
        const bot = [...this.seated].reverse().find((p) => p.isBot);
        if (!bot) return player.conn?.error(ERR.NO_SEAT);
        this._remove(bot);
      }
      player.role = 'player';
      player.wantsToPlay = true;
    } else {
      player.role = 'spectator';
      player.wantsToPlay = false;
      player.ready = false;
    }
  }

  addBot(level, by = null) {
    if (this.state !== 'lobby' || !this.meta.bots) return false;
    if (this.seated.length >= this.meta.max || this.players.length >= MAX_PEOPLE_PER_ROOM) {
      by?.conn?.error(ERR.NO_SEAT);
      return false;
    }
    const used = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.nextPlayerNum}`;
    this.players.push(this._newPlayer({ name, isBot: true, botLevel: level }));
    this.markDirty();
    return true;
  }

  fillBots(level, by = null) {
    let added = 0;
    while (this.seated.length < this.meta.max && this.players.length < MAX_PEOPLE_PER_ROOM) {
      if (!this.addBot(level)) break;
      added++;
    }
    if (!added) by?.conn?.error(ERR.NO_SEAT);
  }

  kick(target) {
    if (target.isBot) return this._remove(target);
    const conn = target.conn;
    this._remove(target);
    if (conn) {
      conn.error(ERR.KICKED);
      conn.close(CLOSE.KICKED, 'kicked');
    }
  }

  // ---------------------------------------------------------------------------
  // Game lifecycle
  // ---------------------------------------------------------------------------
  start(by) {
    const check = checkCanStart(this.publicState());
    if (!check.ok) return by?.conn?.error(ERR.CANNOT_START, { reason: check.reason });

    this.state = 'playing';
    this.lastResults = null;
    this.game = this.module.create(this, { ...this.settings });
    this.loop.start();
    this.broadcast(S2C.START, this.startPayload());
    this.loop.sendSnapshot();
    this.log.info('game start', { room: this.code, game: this.gameId, players: this.seated.length });
    this.markDirty();
  }

  startPayload() {
    return {
      game: this.gameId,
      settings: this.settings,
      tickRate: this.loop.tickRate,
      snapshotRate: this.module.realtime ? SNAPSHOT_RATE : 0,
      time: this.now(),
    };
  }

  // Called by the game module (results) or by the host (abort).
  endGame(results, reason = 'finished') {
    if (this.state !== 'playing') return;
    this.loop.stop();
    this.game?.dispose?.();
    this.game = null;
    this.state = 'lobby';
    this.lastResults = results ?? null;
    for (const p of this.players) {
      if (!p.isBot) p.ready = false;
    }
    // Spectators who want to play get a free seat for the next round.
    for (const p of this.players) {
      if (p.role === 'spectator' && p.wantsToPlay && this.seated.length < this.meta.max) p.role = 'player';
    }
    this.broadcast(S2C.END, { results: this.lastResults, reason });
    this.log.info('game end', { room: this.code, game: this.gameId, reason });
    this.markDirty();
  }

  takeTickStats() {
    return this.loop.takeStats();
  }

  // ---------------------------------------------------------------------------
  // Output
  // ---------------------------------------------------------------------------
  broadcast(type, payload) {
    const data = encode(type, payload);
    for (const p of this.players) p.conn?.sendRaw(data);
  }

  sendTo(player, type, payload) {
    player.conn?.send(type, payload);
  }

  // Game events (sounds, effects): { e: 'name', ...data }
  emit(e, data = {}) {
    this.broadcast(S2C.EVENT, { e, ...data });
  }

  notice(text) {
    this.broadcast(S2C.NOTICE, { text });
  }

  // Coalesce many changes in one turn of the event loop into one room update.
  markDirty() {
    if (this.roomUpdateQueued || this.state === 'closed') return;
    this.roomUpdateQueued = true;
    setImmediate(() => {
      this.roomUpdateQueued = false;
      if (this.state !== 'closed') this.broadcast(S2C.ROOM, { room: this.publicState() });
    });
  }

  publicState() {
    return {
      code: this.code,
      game: this.gameId,
      state: this.state,
      hostId: this.hostId,
      settings: this.settings,
      results: this.lastResults,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        slot: p.slot,
        color: p.color,
        role: p.role,
        ready: p.ready,
        bot: p.isBot ? p.botLevel : null,
        connected: p.isBot || p.connected,
      })),
    };
  }

  close(reason) {
    if (this.state === 'closed') return;
    this.loop.stop();
    this.game?.dispose?.();
    this.game = null;
    this.state = 'closed';
    for (const p of this.players) {
      const conn = p.conn;
      this._unbind(p);
      conn?.error(ERR.ROOM_CLOSED, { reason });
    }
    this.players = [];
  }
}
