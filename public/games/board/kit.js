// Shared client for every board game. A game only supplies a small `spec`
// (drawing, hit-testing, what a click means); the kit handles snapshots,
// animations, sounds, the side panel (turns, undo, rematch, result),
// keyboard control and screen-reader announcements.
//
// spec = {
//   id, width, height,
//   seatLabel(seat, f) → 'Wit' / 'Kruisje' …
//   draw(ctx, f)                   f = frame, see frame() below
//   pick(x, y, f) → target|null    logical canvas coords → something clickable
//   onPick(target, api, f)         what a click / Enter on a target does
//   cursor?: { cols, rows, target(col, row, f) }   keyboard grid
//   describe?(last, f) → string    announce the last move
//   animMs?(last, f) → number      animation length of the last move
//   sound?(last, f) → sfx name
//   panel?(el, f, api)             extra controls in the side panel (dice, …)
//   initLocal?() → {}              per-client UI state (selection, …)
//   turnText?(f) → string          override "Jouw beurt!"
// }
import { h, clear, preserveFocus } from '../../js/core/ui.js';
import { REACTIONS, C2S } from '../../../shared/messages.js';
import { getGame } from '../../../shared/catalog.js';
import { colorHex, clamp01 } from './draw.js';

export function createBoardModule(spec) {
  return {
    meta: {
      width: spec.width,
      height: spec.height,
      pixelated: false,
      step: 1 / 60,
      layout: 'board',
      input: false,
      touchControls: false,
    },
    createGame: () => new BoardClient(spec),
  };
}

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

class BoardClient {
  constructor(spec) {
    this.spec = spec;
    this.snap = null;
    this.prevView = null;
    this.animT = 1;
    this.animDur = 0;
    this.time = 0;
    this.hover = null;
    this.keyboard = false;
    this.cursor = { col: 0, row: 0 };
    this.statusText = '';
    this.local = spec.initLocal ? spec.initLocal() : {};
    this.cleanups = [];
  }

  mount(view, net, ctx) {
    this.view = view;
    this.g = view.ctx;
    this.net = net;
    this.session = ctx.session;
    this.sfx = ctx.sfx;
    this.side = ctx.side;
    this.reduced = ctx.reducedMotion;
    this.game = getGame(this.spec.id);
    if (this.spec.cursor) {
      this.cursor.col = Math.floor(this.spec.cursor.cols / 2);
      this.cursor.row = Math.floor(this.spec.cursor.rows / 2);
    }
    this.api = {
      move: (move) => this.send({ type: 'move', move }),
      send: (data) => this.send(data),
      local: this.local,
      sfx: this.sfx,
      refresh: () => this.renderPanel(),
    };
    this._bindCanvas();
    this._buildPanel();
  }

  // --- Networking -------------------------------------------------------------------
  send(data) {
    this.net.send(C2S.INPUT, { data });
  }

  onSnapshot(msg) {
    const s = msg.state;
    const prev = this.snap;
    this.snap = s;
    const f = this.frame();

    const newRound = !prev || prev.round !== s.round;
    const undone = prev && prev.undone !== s.undone;
    if (!prev || newRound || undone || !s.last || s.moveNo === prev.moveNo) {
      if (newRound || undone) {
        this.prevView = s.view;
        this.animT = 1;
        this.spec.onReset?.(this.local);
      }
    } else {
      // A new move: animate from the previous view.
      this.prevView = prev.view;
      this.animDur = this.reduced ? 0 : (this.spec.animMs?.(s.last, f) ?? 250);
      this.animT = this.animDur ? 0 : 1;
      this.sfx.play(this.spec.sound?.(s.last, f) ?? 'click');
      if (s.last.seat !== s.you) this.spec.onOpponentMove?.(this.local, f);
    }
    if (s.moveNo !== prev?.moveNo || newRound || undone) this.spec.onChange?.(this.local, f);

    // Sounds for the big moments.
    if (s.result && !prev?.result) {
      const won = s.result.winners.includes(s.you);
      this.sfx.play(s.result.draw ? 'countdown' : won ? 'win' : s.you >= 0 ? 'lose' : 'coin');
    } else if (prev && !prev.toMove.includes(s.you) && s.toMove.includes(s.you) && s.seats.length > 1) {
      this.sfx.play('ready');
    }
    this.renderPanel();
  }

  onEvent(msg) {
    if (msg.e === 'undo') this._flash(`${this._name(msg.by)} heeft een zet teruggenomen.`);
    else if (msg.e === 'undoDenied') this._flash(`${this._name(msg.by)} wil de zet niet terugnemen.`);
    else if (msg.e === 'rematch') this.sfx.play('go');
    this.spec.onEvent?.(msg, this.local);
  }

  onRoom() {
    this.renderPanel();
  }

  onReconnect() {}

  // --- Frame data for the spec ------------------------------------------------------------
  frame() {
    const s = this.snap;
    return {
      view: s.view,
      prev: this.prevView ?? s.view,
      snap: s,
      you: s.you,
      spectator: s.you < 0,
      myTurn: s.toMove.includes(s.you),
      legal: s.legal ?? [],
      last: s.last,
      anim: clamp01(this.animT),
      time: this.time,
      hover: this.keyboard ? null : this.hover,
      cursor: this.keyboard && this.spec.cursor ? this.cursor : null,
      local: this.local,
      reduced: this.reduced,
      colorOf: (seat) => this._colorOf(seat),
      nameOf: (seat) => this._nameOfSeat(seat),
    };
  }

  _player(id) {
    return this.session.room?.players.find((p) => p.id === id) ?? null;
  }
  _name(id) {
    return this._player(id)?.name ?? 'Iemand';
  }
  _nameOfSeat(seat) {
    return seat === this.snap?.you ? 'Jij' : this._name(this.snap?.seats[seat]);
  }
  _colorOf(seat) {
    const p = this._player(this.snap?.seats[seat]);
    return colorHex(p ? p.color : seat);
  }

  // --- Loop ------------------------------------------------------------------------------------
  update(dt) {
    this.time += dt;
    if (this.animT < 1) this.animT += this.animDur ? (dt * 1000) / this.animDur : 1;
  }

  render() {
    const g = this.g;
    if (!this.snap) {
      g.fillStyle = '#0b0b1e';
      g.fillRect(0, 0, this.spec.width, this.spec.height);
      return;
    }
    this.spec.draw(g, this.frame());
  }

  unmount() {
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
  }

  // --- Canvas input: mouse, touch, keyboard ----------------------------------------------------
  _bindCanvas() {
    const c = this.view.canvas;
    c.tabIndex = 0;
    c.setAttribute('role', 'application');
    c.setAttribute('aria-label', `${this.game?.title ?? 'Spel'}: speelbord. Pijltjestoetsen om te kiezen, Enter om te zetten.`);
    c.setAttribute('aria-describedby', 'board-status');
    const on = (type, fn, opts) => {
      c.addEventListener(type, fn, opts);
      this.cleanups.push(() => c.removeEventListener(type, fn, opts));
    };
    const at = (e) => {
      const p = this.view.toLogical(e.clientX, e.clientY);
      return this.snap ? this.spec.pick(p.x, p.y, this.frame()) : null;
    };
    on('pointermove', (e) => {
      this.keyboard = false;
      this.hover = at(e);
      c.style.cursor = this.hover !== null && this.hover !== undefined ? 'pointer' : 'default';
    });
    on('pointerleave', () => { this.hover = null; });
    on('click', (e) => {
      this.keyboard = false;
      const target = at(e);
      if (target !== null && target !== undefined) this._pick(target);
    });
    on('keydown', (e) => {
      const cur = this.spec.cursor;
      if (!cur || !this.snap) return;
      if (ARROWS[e.key]) {
        e.preventDefault();
        this.keyboard = true;
        const [dx, dy] = ARROWS[e.key];
        this.cursor.col = (this.cursor.col + dx + cur.cols) % cur.cols;
        this.cursor.row = (this.cursor.row + dy + cur.rows) % cur.rows;
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.keyboard = true;
        const target = cur.target(this.cursor.col, this.cursor.row, this.frame());
        if (target !== null && target !== undefined) this._pick(target);
      } else if (e.key === 'Escape') {
        this.spec.onCancel?.(this.local);
      }
    });
  }

  _pick(target) {
    this.spec.onPick(target, this.api, this.frame());
  }

  // --- Side panel ---------------------------------------------------------------------------------
  _buildPanel() {
    const side = this.side;
    clear(side);
    this.el = {
      round: h('span', { class: 'bp__round' }),
      seats: h('ol', { class: 'bp__seats' }),
      status: h('p', { id: 'board-status', class: 'bp__status', role: 'status', 'aria-live': 'polite' }, 'Laden…'),
      flash: h('p', { class: 'bp__flash', 'aria-live': 'polite' }),
      extra: h('div', { class: 'bp__extra' }),
      actions: h('div', { class: 'bp__actions' }),
    };
    const reactions = h('div', { class: 'bp__reactions', role: 'group', 'aria-label': 'Snelle reacties' },
      ...REACTIONS.map((emoji, i) => h('button', {
        class: 'reactions__btn reactions__btn--small', type: 'button', 'aria-label': `Reageer met ${emoji}`,
        onclick: () => this.session.send(C2S.REACT, { r: i }),
      }, emoji)));
    side.append(
      h('div', { class: 'bp__head' }, h('h2', { class: 'bp__title' }, this.game?.title ?? ''), this.el.round),
      this.el.seats, this.el.status, this.el.flash, this.el.extra, this.el.actions, reactions,
    );
  }

  _flash(text) {
    this.el.flash.textContent = text;
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { this.el.flash.textContent = ''; }, 4000);
  }

  renderPanel() {
    const s = this.snap;
    if (!s || !this.el) return;
    const f = this.frame();
    preserveFocus(this.side, () => {
      this.el.round.textContent = `Potje ${s.round + 1}`;
      this._renderSeats(s, f);
      clear(this.el.extra);
      this.spec.panel?.(this.el.extra, f, this.api);
      this._renderActions(s);
    });
    const text = this._statusText(s, f);
    if (text !== this.statusText) {
      this.statusText = text;
      this.el.status.textContent = text;
    }
  }

  _renderSeats(s, f) {
    clear(this.el.seats);
    s.seats.forEach((id, seat) => {
      const p = this._player(id);
      const turn = s.toMove.includes(seat) && !s.result;
      const won = s.result?.winners.includes(seat);
      this.el.seats.append(h('li', { class: `bp__seat ${turn ? 'is-turn' : ''} ${seat === s.you ? 'is-me' : ''}` },
        h('span', { class: 'player__chip player__chip--seat', dataset: { color: String(p?.color ?? seat) }, 'aria-hidden': 'true' },
          this.spec.seatIcon?.(seat, f) ?? ''),
        h('span', { class: 'bp__seat-text' },
          h('strong', {}, p?.name ?? '?', seat === s.you ? ' (jij)' : ''),
          h('small', {}, this.spec.seatLabel(seat, f), p?.isBot || p?.bot ? ' · bot' : '', p && !p.connected ? ' · weg' : '')),
        h('span', { class: 'bp__seat-score', title: 'Gewonnen potjes' }, won ? '🏆' : String(s.score[seat]?.wins ?? 0)),
        turn ? h('span', { class: 'visually-hidden' }, ' is aan de beurt') : null));
    });
  }

  _statusText(s, f) {
    const describe = s.last && !s.result && this.spec.describe ? `${this.spec.describe(s.last, f)} ` : '';
    if (s.result) {
      const r = s.result;
      let head;
      if (r.draw) head = 'Gelijkspel!';
      else if (r.winners.includes(s.you)) head = 'Jij wint! 🎉';
      else head = `${r.winners.map((w) => this._name(s.seats[w])).join(' en ')} ${r.winners.length > 1 ? 'winnen' : 'wint'}.`;
      return `${head} ${r.reason ?? ''}`.trim();
    }
    if (s.undo && s.undo.by === s.you) return 'Wachten tot de ander akkoord gaat…';
    const turnSeats = s.toMove;
    if (turnSeats.includes(s.you)) return `${describe}${this.spec.turnText?.(f) ?? 'Jouw beurt!'}`;
    const names = turnSeats.map((seat) => this._name(s.seats[seat]));
    const prefix = s.you < 0 ? 'Je kijkt mee. ' : '';
    return `${prefix}${describe}${names.join(' en ') || 'Iemand'} ${names.length > 1 ? 'zijn' : 'is'} aan de beurt…`;
  }

  _renderActions(s) {
    const a = this.el.actions;
    clear(a);
    const isHost = this.session.isHost;
    if (s.result) {
      if (s.you >= 0) {
        const voted = s.rematch.includes(s.you);
        a.append(h('button', {
          class: 'btn btn--primary', type: 'button', 'data-key': 'rematch', disabled: voted,
          onclick: () => this.send({ type: 'rematch' }),
        }, voted ? `Wachten op de rest (${s.rematch.length}/${s.seats.length})` : 'Nog een potje'));
      }
      if (isHost) {
        a.append(h('button', { class: 'btn', type: 'button', 'data-key': 'lobby', onclick: () => this.session.send(C2S.TO_LOBBY) }, 'Terug naar lobby'));
      }
      return;
    }
    if (s.undo && s.undo.by !== s.you && s.you >= 0 && !s.undo.yes.includes(s.you)) {
      a.append(
        h('p', { class: 'bp__ask' }, `${this._name(s.seats[s.undo.by])} wil een zet terugnemen.`),
        h('button', { class: 'btn btn--primary', type: 'button', 'data-key': 'undo-yes', onclick: () => this.send({ type: 'undoAnswer', accept: true }) }, 'Akkoord'),
        h('button', { class: 'btn', type: 'button', 'data-key': 'undo-no', onclick: () => this.send({ type: 'undoAnswer', accept: false }) }, 'Nee'),
      );
      return;
    }
    if (s.canUndo && s.you >= 0 && !s.undo) {
      a.append(h('button', { class: 'btn', type: 'button', 'data-key': 'undo', onclick: () => this.send({ type: 'undo' }) }, '↶ Zet terugnemen'));
    }
  }
}
