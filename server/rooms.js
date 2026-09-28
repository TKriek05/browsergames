// Room manager: room codes, create/join/leave, reconnect by token, cleanup.
import { randomInt } from 'node:crypto';
import {
  ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, RECONNECT_GRACE_MS, HOST_MIGRATE_DELAY_MS,
  EMPTY_ROOM_TTL_MS, IDLE_ROOM_TTL_MS, ROOM_SWEEP_INTERVAL_MS,
} from '../shared/constants.js';
import { C2S, S2C, ERR } from '../shared/messages.js';
import { getGame } from '../shared/catalog.js';
import { Room } from './room.js';

// Codes we never hand out (the alphabet has no I/L/O, so the list stays short).
const BLOCKED_CODES = new Set(['FUCK', 'SHIT', 'CUNT', 'DICK', 'KUTT', 'HOER', 'PENS', 'NAZI', 'SEKS', 'ANUS', 'TYFS', 'TERG']);

export class RoomManager {
  constructor({ config, log, ipLimiter, registry }) {
    this.config = config;
    this.log = log;
    this.ipLimiter = ipLimiter;
    this.registry = registry;
    this.rooms = new Map();
    this.timing = {
      reconnectGraceMs: RECONNECT_GRACE_MS,
      hostMigrateDelayMs: HOST_MIGRATE_DELAY_MS,
      emptyRoomTtlMs: EMPTY_ROOM_TTL_MS,
      idleRoomTtlMs: IDLE_ROOM_TTL_MS,
      sweepIntervalMs: ROOM_SWEEP_INTERVAL_MS,
      ...config.timing,
    };
    this.sweepTimer = setInterval(() => this.sweep(), this.timing.sweepIntervalMs);
    this.sweepTimer.unref();
    this.statsTimer = setInterval(() => this.logTickStats(), 60_000);
    this.statsTimer.unref();
    this.lastTickStats = { rooms: 0, avgMs: 0, maxMs: 0 };
  }

  newCode() {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!BLOCKED_CODES.has(code) && !this.rooms.has(code)) return code;
    }
    return null;
  }

  // Entry point for every validated JSON message except hello/ping.
  handle(conn, msg) {
    switch (msg.t) {
      case C2S.CREATE:
        return this.create(conn, msg);
      case C2S.JOIN:
        return this.join(conn, msg);
      case C2S.LEAVE:
        return this.leave(conn);
      default:
        if (!conn.room || !conn.player) return conn.error(ERR.NOT_IN_ROOM);
        return conn.room.handle(conn.player, msg);
    }
  }

  // Returns false only for malformed packets. Inputs that arrive just after
  // leaving or after a game ended are normal and silently ignored.
  handleBinary(conn, reader) {
    if (!conn.room || !conn.player) return true;
    return conn.room.handleBinaryInput(conn.player, reader);
  }

  create(conn, { game, name, solo }) {
    const meta = getGame(game);
    const module = this.registry.get(game);
    if (!meta || !meta.available || !module) return conn.error(ERR.GAME_UNAVAILABLE);
    if (this.rooms.size >= this.config.maxRooms) return conn.error(ERR.SERVER_FULL);
    const limited = this.ipLimiter.checkCreateRoom(conn.ip);
    if (limited) {
      this.log.info('room create refused', { ip: conn.ip, reason: limited });
      return conn.error(ERR.TOO_MANY_ROOMS);
    }
    const code = this.newCode();
    if (!code) return conn.error(ERR.SERVER_FULL);

    if (conn.room) this.leave(conn, true);
    const room = new Room({
      code,
      gameId: game,
      module,
      creatorIp: conn.ip,
      timing: this.timing,
      log: this.log,
    });
    this.rooms.set(code, room);
    this.ipLimiter.addRoom(conn.ip);

    const player = room.addHuman(conn, name);
    if (solo) room.fillBots('normal');
    this.log.info('room created', { room: code, game, ip: conn.ip });
    conn.send(S2C.JOINED, { room: room.publicState(), you: { id: player.id, token: player.token } });
  }

  join(conn, { code, name, token }) {
    const room = this.rooms.get(code);
    if (!room) return conn.error(ERR.ROOM_NOT_FOUND, { room: code });
    if (room.state === 'closed') return conn.error(ERR.ROOM_CLOSED, { room: code });

    // Reconnect: same seat, same token.
    if (token) {
      const existing = room.findByToken(token);
      if (existing) {
        if (conn.room && conn.room !== room) this.leave(conn, true);
        room.reattach(existing, conn);
        conn.send(S2C.JOINED, { room: room.publicState(), you: { id: existing.id, token: existing.token } });
        return room.resync(existing);
      }
    }
    if (conn.room === room && conn.player) {
      return conn.send(S2C.JOINED, { room: room.publicState(), you: { id: conn.player.id, token: conn.player.token } });
    }
    if (conn.room) this.leave(conn, true);

    const player = room.addHuman(conn, name);
    if (!player) return conn.error(ERR.ROOM_FULL, { room: code });
    room.touch();
    conn.send(S2C.JOINED, { room: room.publicState(), you: { id: player.id, token: player.token } });
    room.resync(player); // spectators joining a running game
  }

  leave(conn, silent = false) {
    const room = conn.room;
    const player = conn.player;
    if (!room || !player) return;
    room.vacate(player, 'left');
    // vacate() unbinds the connection; make sure it is detached in every case.
    conn.room = null;
    conn.player = null;
    if (!silent) conn.send(S2C.ROOM, { room: null });
  }

  onDisconnect(conn) {
    if (conn.room && conn.player) conn.room.detach(conn.player);
  }

  sweep() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.update(now)) this.closeRoom(room, 'inactive');
    }
    this.ipLimiter.sweep(now);
  }

  closeRoom(room, reason) {
    room.close(reason);
    this.rooms.delete(room.code);
    this.ipLimiter.removeRoom(room.creatorIp);
    this.log.info('room closed', { room: room.code, reason });
  }

  // Aggregated tick-duration stats, logged once a minute.
  logTickStats() {
    let count = 0, total = 0, max = 0, playing = 0;
    for (const room of this.rooms.values()) {
      const s = room.takeTickStats();
      if (room.state === 'playing') playing++;
      count += s.count;
      total += s.totalMs;
      if (s.maxMs > max) max = s.maxMs;
    }
    this.lastTickStats = { rooms: playing, avgMs: count ? +(total / count).toFixed(3) : 0, maxMs: +max.toFixed(3) };
    if (playing > 0) {
      const lvl = max > 10 ? 'warn' : 'info';
      this.log[lvl]('tick stats', { ...this.lastTickStats, rooms: this.rooms.size });
    }
  }

  stats() {
    let people = 0;
    for (const room of this.rooms.values()) people += room.connectedHumans().length;
    return { rooms: this.rooms.size, people, tick: this.lastTickStats };
  }

  shutdown(reason = 'shutdown') {
    clearInterval(this.sweepTimer);
    clearInterval(this.statsTimer);
    for (const room of [...this.rooms.values()]) this.closeRoom(room, reason);
  }
}
