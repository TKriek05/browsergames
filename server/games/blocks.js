// Blokval (server side): falling-block versus. Each client plays its own
// board locally (instant controls) and reports every locked piece; the
// server checks it against its own copy with the shared rules, handles line
// clears, garbage and knock-outs, and plays the bots. realtime: false →
// 10 Hz ticks and a JSON snapshot whenever something changed.
//
// Not verified: whether a piece could actually reach its spot (no path
// search). Placements must fit and rest on something, in the right order.
import { createRng } from '../../shared/rng.js';
import {
  COLS, ROWS, ATTACK, comboBonus, createSequence, emptyBoard, spawn, fits, resting, place, addGarbage,
  encodeBoard, dropY,
} from '../../shared/games/blocks.js';
import { ARCADE_PHASE } from '../../shared/games/arcade.js';

const COUNTDOWN_S = 3;
const END_HOLD_S = 3;
const LEVEL_EVERY_S = 25;
const MIN_LOCK_GAP_MS = 50;
const PIECE_MSG_GAP_MS = 90;
const BOT_PACE = { easy: 1.35, normal: 0.8, hard: 0.42 };
const BOT_SLOPPY = { easy: 0.35, normal: 0.08, hard: 0 };

class BlocksGame {
  constructor(room, settings) {
    this.room = room;
    this.rng = createRng(settings.seed);
    this.seed = Math.floor(this.rng() * 2 ** 31);
    this.next = createSequence(this.seed);
    this.time = 0;
    this.phase = ARCADE_PHASE.COUNTDOWN;
    this.phaseEnd = COUNTDOWN_S;
    this.playTime = 0;
    this.boards = [];
    this.knockouts = 0;
    for (const p of room.gamePlayers()) this.onJoin(p);
    this.dirty = true;
  }

  get level() {
    return Math.min(15, 1 + Math.floor(this.playTime / LEVEL_EVERY_S));
  }

  _b(id) {
    return this.boards.find((b) => b.player.id === id) ?? null;
  }

  onJoin(player) {
    if (this._b(player.id)) return;
    this.boards.push({
      player, board: emptyBoard(), idx: 0, pending: [], alive: this.phase === ARCADE_PHASE.COUNTDOWN,
      lines: 0, sent: 0, combo: -1, place: 0, piece: null, resync: 0, lastLock: 0, lastPiece: 0, botT: 1,
    });
    this.dirty = true;
  }

  onLeave(player) {
    const b = this._b(player.id);
    if (b?.alive) this._knockout(b);
    this.boards = this.boards.filter((x) => x.player.id !== player.id);
    this.dirty = true;
  }

  onBotTakeover() {
    this.dirty = true;
  }

  onInput(player, data) {
    const b = this._b(player.id);
    if (!b || !data || typeof data !== 'object' || this.phase !== ARCADE_PHASE.PLAY || !b.alive) return;
    const now = Date.now();
    if (data.t === 'piece') {
      if (now - b.lastPiece < PIECE_MSG_GAP_MS) return;
      const { x, y, r } = data;
      if (![x, y, r].every(Number.isInteger) || x < -3 || x > COLS || y < -2 || y > ROWS || r < 0 || r > 3) return;
      b.lastPiece = now;
      b.piece = { x, y, r, k: this.next(b.idx) };
      this.dirty = true;
    } else if (data.t === 'lock') {
      if (now - b.lastLock < MIN_LOCK_GAP_MS) return;
      b.lastLock = now;
      const { i, x, y, r } = data;
      const k = this.next(b.idx);
      const ok = i === b.idx && [x, y, r].every(Number.isInteger) && r >= 0 && r < 4 && resting(b.board, k, r, x, y);
      if (!ok) {
        b.resync++; // the client throws away its prediction and takes our board
        this.dirty = true;
        return;
      }
      this._lock(b, k, r, x, y);
    } else if (data.t === 'topout') {
      if (!fits(b.board, this.next(b.idx), 0, spawn(0).x, 0)) this._knockout(b);
    }
  }

  _lock(b, k, r, x, y) {
    const res = place(b.board, k, r, x, y);
    b.board = res.board;
    b.idx++;
    b.piece = null;
    if (res.lines) {
      b.lines += res.lines;
      b.combo++;
      let attack = ATTACK[res.lines] + comboBonus(b.combo);
      // Clearing lines first cancels garbage that is waiting for you.
      while (attack > 0 && b.pending.length) {
        const g = b.pending[0];
        const cancel = Math.min(g.lines, attack);
        g.lines -= cancel;
        attack -= cancel;
        if (!g.lines) b.pending.shift();
      }
      if (attack > 0) this._send(b, attack);
      this.room.emit('clear', { s: b.player.slot, n: res.lines });
    } else {
      b.combo = -1;
      // No lines: the waiting garbage comes in now.
      for (const g of b.pending) {
        const out = addGarbage(b.board, g.lines, g.hole);
        b.board = out.board;
        if (out.overflow) return this._knockout(b);
      }
      if (b.pending.length) this.room.emit('garbage', { s: b.player.slot });
      b.pending = [];
    }
    const nk = this.next(b.idx);
    if (!fits(b.board, nk, 0, spawn(nk).x, 0)) this._knockout(b);
    this.dirty = true;
  }

  _send(from, lines) {
    const targets = this.boards.filter((o) => o !== from && o.alive);
    if (!targets.length) return;
    const to = targets[Math.floor(this.rng() * targets.length)];
    to.pending.push({ lines, hole: Math.floor(this.rng() * COLS) });
    from.sent += lines;
    this.room.emit('attack', { from: from.player.slot, to: to.player.slot, n: lines });
  }

  _knockout(b) {
    if (!b.alive) return;
    b.alive = false;
    b.place = this.boards.filter((o) => o.alive).length + 1;
    this.knockouts++;
    this.room.emit('ko', { s: b.player.slot });
    this.dirty = true;
  }

  tick(dt) {
    this.time += dt;
    if (this.phase === ARCADE_PHASE.COUNTDOWN) {
      if (this.time >= this.phaseEnd) {
        this.phase = ARCADE_PHASE.PLAY;
        for (const b of this.boards) b.alive = true;
        this.room.emit('go');
        this.dirty = true;
      }
      return;
    }
    if (this.phase === ARCADE_PHASE.END) {
      if (this.time >= this.phaseEnd) this.room.endGame(this.results());
      return;
    }
    const levelBefore = this.level;
    this.playTime += dt;
    if (this.level !== levelBefore) this.dirty = true;
    for (const b of this.boards) if (b.alive && b.player.isBot) this._bot(b, dt);
    const alive = this.boards.filter((b) => b.alive);
    if ((this.boards.length > 1 && alive.length <= 1) || !alive.length) {
      if (alive[0]) alive[0].place = 1;
      this.phase = ARCADE_PHASE.END;
      this.phaseEnd = this.time + END_HOLD_S;
      this.room.emit('end', { s: alive[0]?.player.slot ?? -1 });
      this.dirty = true;
    }
  }

  // Classic placement heuristic: low stacks, few holes, flat surface, lines.
  _bot(b, dt) {
    b.botT -= dt;
    if (b.botT > 0) return;
    const level = b.player.botLevel ?? 'normal';
    b.botT = (BOT_PACE[level] ?? 0.8) * Math.max(0.45, 1 - (this.level - 1) * 0.04);
    const k = this.next(b.idx);
    const options = [];
    for (let r = 0; r < 4; r++) {
      for (let x = -3; x < COLS + 3; x++) {
        if (!fits(b.board, k, r, x, 0)) continue;
        const y = dropY(b.board, k, r, x, 0);
        const res = place(b.board, k, r, x, y);
        options.push({ r, x, y, score: evaluate(res.board) + res.lines * 0.76 });
      }
    }
    if (!options.length) return this._knockout(b);
    options.sort((p, q) => q.score - p.score);
    const pick = this.rng() < (BOT_SLOPPY[level] ?? 0) ? options[Math.min(options.length - 1, 1 + Math.floor(this.rng() * 3))] : options[0];
    this._lock(b, k, pick.r, pick.x, pick.y);
  }

  snapshot(player) {
    return {
      phase: this.phase,
      left: Math.max(0, this.phaseEnd - this.time),
      level: this.level,
      seed: this.seed,
      players: this.boards.map((b) => ({
        slot: b.player.slot,
        alive: b.alive,
        place: b.place,
        idx: b.idx,
        board: encodeBoard(b.board),
        pending: b.pending.reduce((a, g) => a + g.lines, 0),
        lines: b.lines,
        sent: b.sent,
        piece: b.piece,
        resync: b.resync,
        bot: b.player.isBot,
      })),
      you: player?.slot ?? -1,
    };
  }

  results() {
    const sorted = [...this.boards].sort((a, b) => (a.place || 1) - (b.place || 1) || b.sent - a.sent);
    return {
      title: 'Uitslag Blokval',
      columns: ['Rijen', 'Rommel verstuurd'],
      rows: sorted.map((b, i) => ({
        id: b.player.id, name: b.player.name, color: b.player.color, rank: i + 1, values: [String(b.lines), String(b.sent)],
      })),
    };
  }
}

function evaluate(board) {
  const heights = new Array(COLS).fill(0);
  let holes = 0;
  for (let c = 0; c < COLS; c++) {
    let seen = false;
    for (let r = 0; r < ROWS; r++) {
      if (board[r * COLS + c]) {
        if (!seen) heights[c] = ROWS - r;
        seen = true;
      } else if (seen) holes++;
    }
  }
  let agg = 0;
  let bump = 0;
  for (let c = 0; c < COLS; c++) {
    agg += heights[c];
    if (c) bump += Math.abs(heights[c] - heights[c - 1]);
  }
  return -0.51 * agg - 1.1 * holes - 0.18 * bump;
}

export default {
  id: 'blocks',
  realtime: false,
  create: (room, settings) => new BlocksGame(room, settings),
};
