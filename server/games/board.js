// Generic server adapter that turns a pure rules module (shared/rules/*) into
// a game module: seats, turn validation, bots, undo-by-agreement, rematch,
// per-player hidden views and a running score across rounds.
import { createRng } from '../../shared/rng.js';
import { chooseMove, hasEngine } from '../ai/index.js';

// Tuning
const BOT_DELAY_S = { easy: 0.9, normal: 0.7, hard: 0.5 }; // "thinking" pause so moves are followable
const AUTO_RETURN_S = 6; // party modes: back to the lobby this long after a match
const HISTORY_MAX = 300;
const MAX_LEGAL_IN_SNAPSHOT = 400;

const moveKey = (m) => JSON.stringify(m, Object.keys(m).sort());

export function boardGame(rules) {
  return {
    id: rules.id,
    realtime: false,
    create: (room, settings) => new BoardGame(room, rules, settings),
  };
}

class BoardGame {
  constructor(room, rules, settings) {
    this.room = room;
    this.rules = rules;
    this.settings = settings;
    this.rng = createRng();
    this.baseSeats = room.gamePlayers().map((p) => p.id);
    this.round = 0;
    this.score = new Map(this.baseSeats.map((id) => [id, { wins: 0, draws: 0, points: 0 }]));
    this.dirty = true;
    this._newRound();
  }

  _newRound() {
    // Rotate seats every round so a different player starts / gets white.
    const n = this.baseSeats.length;
    this.seatIds = this.baseSeats.map((_, i) => this.baseSeats[(i + this.round) % n]);
    this.state = this.rules.setup({ seats: n, settings: this.settings, rng: this.rng });
    this.history = [];
    this.moveNo = 0;
    this.last = null;
    this.over = this.rules.result(this.state);
    this.undoReq = null;
    this.rematch = new Set();
    this.thinking = new Set(); // seats with a pending bot move
    this.botWait = new Map(); // seat → seconds waited
    this.backIn = AUTO_RETURN_S;
    this.epoch = (this.epoch ?? 0) + 1; // changes on every move/undo/round: stale bot answers are ignored
    this.dirty = true;
  }

  // --- Seats ---------------------------------------------------------------------
  seatOf(player) {
    return this.seatIds.indexOf(player.id);
  }

  playerAt(seat) {
    const id = this.seatIds[seat];
    return this.room.players.find((p) => p.id === id) ?? null;
  }

  _isBotSeat(seat) {
    const p = this.playerAt(seat);
    return !p || p.isBot;
  }

  onJoin() {} // seats are fixed per game; late joiners spectate
  onLeave(player) {
    // Only happens when bots cannot take over: the leaver forfeits.
    const seat = this.seatOf(player);
    if (seat < 0 || this.over) return;
    const winners = this.seatIds.map((_, i) => i).filter((i) => i !== seat);
    this._finish({ winners, draw: false, reason: `${player.name} heeft het spel verlaten` });
  }
  onBotTakeover() {
    this.dirty = true;
  }

  // --- Input -----------------------------------------------------------------------
  onInput(player, data) {
    const seat = this.seatOf(player);
    if (seat < 0 || !data || typeof data !== 'object') return;
    switch (data.type) {
      case 'move':
        return this._tryMove(seat, data.move);
      case 'undo':
        return this._requestUndo(seat);
      case 'undoAnswer':
        return this._answerUndo(seat, data.accept === true);
      case 'rematch':
        if (this.over) {
          this.rematch.add(seat);
          this.dirty = true;
        }
        return;
      default:
    }
  }

  _tryMove(seat, move) {
    if (this.over || !move || typeof move !== 'object') return false;
    if (!this.rules.toMove(this.state).includes(seat)) return false;
    let chosen = null;
    if (this.rules.isLegal) {
      if (this.rules.isLegal(this.state, seat, move)) chosen = move;
    } else {
      const key = moveKey(move);
      chosen = this.rules.legalMoves(this.state, seat).find((m) => moveKey(m) === key) ?? null;
    }
    if (!chosen) return false;
    this._apply(seat, chosen);
    return true;
  }

  _apply(seat, move) {
    if (this.rules.undo) {
      this.history.push({ state: this.state, last: this.last, moveNo: this.moveNo });
      if (this.history.length > HISTORY_MAX) this.history.shift();
    }
    const { state, info } = this.rules.apply(this.state, seat, move, this.rng);
    this.state = state;
    this.moveNo++;
    this.epoch++;
    this.last = { seat, info, n: this.moveNo };
    this.undoReq = null;
    // Turn-based: every bot starts thinking afresh. Simultaneous games
    // (everyone may move at any time): only the mover waits again.
    if (this.rules.simultaneous) this.botWait.delete(seat);
    else this.botWait.clear();
    const res = this.rules.result(state);
    if (res) this._finish(res);
    this.dirty = true;
  }

  _finish(res) {
    this.over = res;
    const n = this.seatIds.length;
    for (let seat = 0; seat < n; seat++) {
      const s = this.score.get(this.seatIds[seat]);
      if (!s) continue;
      if (res.draw) s.draws++;
      else if (res.winners.includes(seat)) s.wins++;
      // Ranking games (ludo, goose): points n-1 … 0.
      const rank = res.ranking ? res.ranking.indexOf(seat) : -1;
      s.points += rank >= 0 ? n - 1 - rank : res.winners.includes(seat) ? 1 : 0;
    }
    this.dirty = true;
  }

  // --- Undo (only when every other human agrees; bots always agree) --------------
  _requestUndo(seat) {
    if (!this.rules.undo || this.over || !this.history.length || this.undoReq) return;
    if (!this._hasMoved(seat)) return; // you can only take back your own move

    this.undoReq = { by: seat, yes: new Set([seat]) };
    this.dirty = true;
  }

  // history[k].last is move k (k ≥ 1); this.last is the newest move.
  _hasMoved(seat) {
    return [...this.history.slice(1).map((h) => h.last), this.last].some((m) => m?.seat === seat);
  }

  _answerUndo(seat, accept) {
    if (!this.undoReq || seat === this.undoReq.by) return;
    if (!accept) {
      this.undoReq = null;
      this.room.emit('undoDenied', { by: this.seatIds[seat] });
    } else this.undoReq.yes.add(seat);
    this.dirty = true;
  }

  _undoAgreed() {
    for (let seat = 0; seat < this.seatIds.length; seat++) {
      if (!this._isBotSeat(seat) && !this.undoReq.yes.has(seat)) return false;
    }
    return true;
  }

  _performUndo() {
    const by = this.undoReq.by;
    // Step back until it is the requester's turn again (at least one move).
    let steps = 0;
    do {
      const h = this.history.pop();
      this.state = h.state;
      this.last = h.last;
      this.moveNo = h.moveNo;
      steps++;
    } while (this.history.length && !this.rules.toMove(this.state).includes(by) && steps < this.seatIds.length * 2);
    this.undoReq = null;
    this.thinking.clear();
    this.botWait.clear();
    this.epoch++;
    this.undone = (this.undone ?? 0) + 1;
    this.room.emit('undo', { by: this.seatIds[by] });
    this.dirty = true;
  }

  // --- Tick: bots, undo votes, rematch ------------------------------------------------
  tick(dt) {
    if (this.undoReq && this._undoAgreed()) this._performUndo();

    if (this.over) {
      // Random or tournament party: one match, then on to the next game.
      if (this.room.autoReturn) {
        this.backIn -= dt;
        if (this.backIn <= 0) this.room.endGame(this.finalResults());
        return;
      }
      const humans = this.seatIds.map((_, i) => i).filter((i) => !this._isBotSeat(i));
      if (humans.length && humans.every((s) => this.rematch.has(s))) {
        this.round++;
        this._newRound();
        this.room.emit('rematch', { round: this.round });
      }
      return;
    }

    for (const seat of this.rules.toMove(this.state)) {
      if (!this._isBotSeat(seat) || this.thinking.has(seat) || this.undoReq) continue;
      const level = this.playerAt(seat)?.botLevel ?? 'normal';
      const waited = (this.botWait.get(seat) ?? 0) + dt;
      this.botWait.set(seat, waited);
      // botPace > 1 slows bots down (games where everyone moves at once).
      if (waited < (BOT_DELAY_S[level] ?? 0.7) * (this.rules.botPace ?? 1)) continue;
      this._botMove(seat, level);
    }
  }

  _botMove(seat, level) {
    this.thinking.add(seat);
    const stamp = this.epoch;
    const fallback = () => {
      const legal = this.rules.legalMoves(this.state, seat) ?? [];
      return legal[Math.floor(this.rng() * legal.length)] ?? null;
    };
    const done = (move) => {
      this.thinking.delete(seat);
      // Ignore answers for a position that no longer exists (undo, rematch, end).
      if (this.epoch !== stamp || this.over || this.room.game !== this) return;
      if (!(move && this._tryMove(seat, move))) {
        const alt = fallback();
        if (alt) this._tryMove(seat, alt);
      }
    };
    if (!hasEngine(this.rules.id)) return done(fallback());
    chooseMove(this.rules.id, this.state, seat, level).then(done, () => done(null));
  }

  // --- Output ---------------------------------------------------------------------------
  snapshot(player) {
    const seat = player ? this.seatOf(player) : -1;
    const toMove = this.over ? [] : this.rules.toMove(this.state);
    let legal = null;
    if (toMove.includes(seat)) {
      const moves = this.rules.legalMoves(this.state, seat);
      if (moves && moves.length <= MAX_LEGAL_IN_SNAPSHOT) legal = moves;
    }
    return {
      round: this.round,
      seats: this.seatIds,
      you: seat,
      toMove,
      moveNo: this.moveNo,
      epoch: this.epoch,
      undone: this.undone ?? 0, // increases on every undo (client: no animation, just snap)
      last: this.last,
      view: this.rules.view(this.state, seat),
      legal,
      result: this.over,
      undo: this.undoReq ? { by: this.undoReq.by, yes: [...this.undoReq.yes] } : null,
      canUndo: !!this.rules.undo && this.history.length > 0 && !this.over,
      rematch: [...this.rematch],
      autoReturn: !!this.room.autoReturn, // no rematch: the party goes on by itself
      score: this.seatIds.map((id) => this.score.get(id) ?? { wins: 0, draws: 0, points: 0 }),
    };
  }

  // Results for the lobby when the host goes back (only after a finished match).
  finalResults() {
    if (!this.over && !this.round) return null;
    const rows = this.baseSeats
      .map((id) => {
        const p = this.room.players.find((x) => x.id === id);
        const s = this.score.get(id);
        return { id, name: p?.name ?? '?', color: p?.color ?? 0, s };
      })
      .sort((a, b) => b.s.points - a.s.points || b.s.wins - a.s.wins);
    const usesPoints = this.rules.rankingScore === true;
    return {
      title: `Uitslag na ${this.round + (this.over ? 1 : 0)} ${this.round + (this.over ? 1 : 0) === 1 ? 'potje' : 'potjes'}`,
      columns: usesPoints ? ['Punten', 'Gewonnen'] : ['Gewonnen', 'Gelijk'],
      rows: rows.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        rank: 1 + rows.filter((o) => o.s.points > r.s.points || (o.s.points === r.s.points && o.s.wins > r.s.wins)).length,
        values: usesPoints ? [String(r.s.points), String(r.s.wins)] : [String(r.s.wins), String(r.s.draws)],
      })),
    };
  }
}
