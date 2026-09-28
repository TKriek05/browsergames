// Shared lobby UI for every game: room code + share options, player list with
// colours and ready state, host controls (settings, bots, kick, start),
// quick reactions and the results of the last round.
import { PLAYER_COLORS, BOT_LEVELS, NAME_MAX_LENGTH } from '../../shared/constants.js';
import { C2S, REACTIONS } from '../../shared/messages.js';
import { getGame, BOT_LEVEL_LABELS } from '../../shared/catalog.js';
import { settingLabel } from '../../shared/settings.js';
import { checkCanStart } from '../../shared/lobbyrules.js';
import { h, clear, preserveFocus, toast, copyText, dialog } from './core/ui.js';
import { PARTY_MODE_LABELS } from '../../shared/party.js';
import { PartyUi } from './party.js';
import { createQr, drawQr } from './core/qr.js';
import { local } from './core/storage.js';
import * as sfx from './core/audio.js';

export class Lobby {
  constructor(root, session, { onLeave }) {
    this.root = root;
    this.session = session;
    this.onLeave = onLeave;
    this.showQr = false;
    this.botLevel = local.get('botLevel', 'normal');
    this.party = new PartyUi(this);
    session.on('room', ({ room, prev }) => {
      if (!room) return;
      this._sounds(room, prev);
      this.party.noteRoom(room);
      if (!this.root.hidden) this.render();
    });
    session.on('react', (msg) => this.showReaction(msg.id, msg.r));
  }

  get link() {
    return `${location.origin}/?room=${this.session.room?.code ?? ''}`;
  }

  _sounds(room, prev) {
    if (!prev || prev.code !== room.code) return;
    if (room.players.length > prev.players.length) sfx.play('join');
    else if (room.players.length < prev.players.length) sfx.play('leave');
    else if (room.players.filter((p) => p.ready).length > prev.players.filter((p) => p.ready).length) sfx.play('ready');
  }

  send(type, payload) {
    sfx.play('click');
    this.session.send(type, payload);
  }

  render() {
    const room = this.session.room;
    if (!room) return;
    preserveFocus(this.root, () => {
      clear(this.root);
      this.root.append(this._build(room));
    });
  }

  _build(room) {
    const game = getGame(room.game);
    const me = this.session.myPlayer;
    const isHost = this.session.isHost;
    const seated = room.players.filter((p) => p.role === 'player').sort((a, b) => a.slot - b.slot);
    const spectators = room.players.filter((p) => p.role === 'spectator');

    const wrap = h('div', { class: 'lobby' });

    // --- Header: code + sharing ------------------------------------------------------
    const codeLetters = h('span', { class: 'room-code', 'aria-label': `Kamercode ${room.code.split('').join(' ')}` },
      ...room.code.split('').map((ch) => h('span', { class: 'room-code__char', 'aria-hidden': 'true' }, ch)));
    const share = h('div', { class: 'lobby__share' },
      h('button', { class: 'btn', type: 'button', 'data-key': 'copy', onclick: () => this._copy() }, 'Kopieer link'),
      navigator.share ? h('button', { class: 'btn', type: 'button', 'data-key': 'share', onclick: () => this._share(game) }, 'Delen') : null,
      h('button', {
        class: 'btn', type: 'button', 'data-key': 'qr', 'aria-expanded': String(this.showQr), 'aria-controls': 'lobby-qr',
        onclick: () => { this.showQr = !this.showQr; this.render(); },
      }, this.showQr ? 'Verberg QR' : 'QR-code'),
    );
    const head = h('header', { class: 'lobby__head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, room.party.mode === 'free' ? 'Lobby' : `Party-lobby · ${PARTY_MODE_LABELS[room.party.mode]}`),
        h('h2', { class: 'lobby__title' }, h('span', { class: 'lobby__code-label' }, 'Kamer'), codeLetters),
        h('p', { class: 'muted' }, 'Deel de link of code. Wie hem opent, zit meteen in deze lobby.'),
      ),
      share,
    );
    wrap.append(head);
    if (this.showQr) wrap.append(this._qr());

    // Last game's results next to the tournament standings.
    const tournament = this.party.tournament(room, isHost);
    const results = room.results ? this._results(room) : null;
    if (tournament && results) wrap.append(h('div', { class: 'lobby__grid lobby__grid--even' }, results, tournament));
    else if (tournament || results) wrap.append(tournament ?? results);

    // --- Players -------------------------------------------------------------------------
    const list = h('ul', { class: 'players' });
    for (const p of seated) list.append(this._playerRow(p, room, isHost));
    for (let i = seated.length; i < game.max; i++) {
      const canAdd = isHost && game.bots && room.players.length < 6;
      list.append(h('li', { class: 'player player--empty' },
        h('span', { class: 'player__chip', 'aria-hidden': 'true' }),
        h('span', { class: 'player__name muted' }, 'Vrije plek'),
        canAdd ? h('button', { class: 'btn btn--small', type: 'button', 'data-key': `addbot-${i}`, onclick: () => this.send(C2S.ADD_BOT, { level: this.botLevel }) }, '+ Bot') : null,
      ));
    }
    const playersPanel = h('section', { class: 'panel', 'aria-labelledby': 'players-title' },
      h('h3', { id: 'players-title', class: 'panel__title' }, `Spelers (${seated.length}/${game.max})`),
      list,
    );
    if (spectators.length) {
      const specList = h('ul', { class: 'players players--spectators' });
      for (const p of spectators) specList.append(this._playerRow(p, room, isHost));
      playersPanel.append(h('h4', { class: 'panel__subtitle' }, `Toeschouwers (${spectators.length})`), specList);
    }

    // --- Next game, party mode, settings + host tools -------------------------------------
    const settingsPanel = h('section', { class: 'panel panel--game', 'aria-labelledby': 'settings-title' },
      h('h3', { id: 'settings-title', class: 'panel__title' }, room.party.mode === 'free' ? 'Game' : 'Volgende game'),
      this.party.modeControls(room, isHost),
      this.party.gameCard(room),
      isHost ? this.party.gameTools(room) : null,
      h('h4', { class: 'panel__subtitle' }, 'Instellingen'));
    if (!game.settings.length) settingsPanel.append(h('p', { class: 'muted small' }, 'Deze game heeft geen instellingen.'));
    for (const s of game.settings) {
      const id = `setting-${s.key}`;
      if (isHost && s.type === 'toggle') {
        settingsPanel.append(h('div', { class: 'field field--toggle' },
          h('input', {
            id, type: 'checkbox', class: 'checkbox', 'data-key': id, checked: room.settings[s.key] === true,
            onchange: (e) => this.send(C2S.SETTINGS, { settings: { [s.key]: e.target.checked } }),
          }),
          h('label', { for: id }, s.label)));
      } else if (isHost) {
        const select = h('select', {
          id, class: 'select', 'data-key': id,
          onchange: (e) => {
            const opt = s.options.find((o) => String(o.value) === e.target.value);
            if (opt) this.send(C2S.SETTINGS, { settings: { [s.key]: opt.value } });
          },
        }, ...s.options.map((o) => h('option', { value: String(o.value), selected: o.value === room.settings[s.key] }, o.label)));
        settingsPanel.append(h('div', { class: 'field' }, h('label', { for: id }, s.label), select));
      } else {
        settingsPanel.append(h('div', { class: 'field field--readonly' },
          h('span', { class: 'field__label' }, s.label),
          h('span', { class: 'field__value' }, settingLabel(room.game, s.key, room.settings[s.key]))));
      }
    }
    if (isHost && game.bots) {
      const levelSelect = h('select', {
        id: 'bot-level', class: 'select', 'data-key': 'bot-level',
        onchange: (e) => { this.botLevel = e.target.value; local.set('botLevel', this.botLevel); },
      }, ...BOT_LEVELS.map((l) => h('option', { value: l, selected: l === this.botLevel }, BOT_LEVEL_LABELS[l])));
      settingsPanel.append(
        h('div', { class: 'field' }, h('label', { for: 'bot-level' }, 'Niveau nieuwe bots'), levelSelect),
        h('button', {
          class: 'btn', type: 'button', 'data-key': 'fill-bots',
          disabled: seated.length >= game.max || room.players.length >= 6,
          onclick: () => this.send(C2S.FILL_BOTS, { level: this.botLevel }),
        }, 'Vul lege plekken met bots'),
      );
    }
    if (game.controls) settingsPanel.append(h('p', { class: 'muted small' }, `Besturing: ${game.controls}`));

    wrap.append(h('div', { class: 'lobby__grid' }, playersPanel, settingsPanel));
    const grid = this.party.gameGrid(room);
    if (grid) wrap.append(grid);

    // --- Actions ------------------------------------------------------------------------
    const actions = h('div', { class: 'lobby__actions' });
    const check = checkCanStart(room);
    if (isHost) {
      actions.append(h('button', {
        class: 'btn btn--primary btn--big', type: 'button', 'data-key': 'start',
        disabled: !check.ok, 'aria-describedby': 'start-reason',
        onclick: () => this.send(C2S.START),
      }, 'Start spel'));
    } else if (me?.role === 'player') {
      actions.append(h('button', {
        class: `btn btn--big ${me.ready ? 'btn--ok' : 'btn--primary'}`, type: 'button', 'data-key': 'ready',
        'aria-pressed': String(me.ready),
        onclick: () => this.send(C2S.READY, { ready: !me.ready }),
      }, me.ready ? '✓ Klaar (klik om te annuleren)' : 'Ik ben klaar'));
    }
    if (me) {
      actions.append(
        h('button', {
          class: 'btn', type: 'button', 'data-key': 'role',
          onclick: () => this.send(C2S.ROLE, { role: me.role === 'player' ? 'spectator' : 'player' }),
        }, me.role === 'player' ? 'Kijk alleen mee' : 'Speel mee'),
        h('button', { class: 'btn', type: 'button', 'data-key': 'color', onclick: () => this.send(C2S.COLOR) }, 'Andere kleur'),
        h('button', { class: 'btn', type: 'button', 'data-key': 'rename', onclick: () => this._rename() }, 'Naam wijzigen'),
      );
    }
    actions.append(h('button', { class: 'btn btn--ghost', type: 'button', 'data-key': 'leave', onclick: () => this.onLeave() }, 'Verlaat kamer'));
    wrap.append(actions);
    let reason = check.reason;
    if (check.ok) reason = isHost ? 'Iedereen is klaar. Start maar!' : 'Wachten tot de host start…';
    else if (!isHost && me?.role === 'player' && !me.ready) reason = 'Klik op ‘Ik ben klaar’ als je zover bent.';
    wrap.append(h('p', { id: 'start-reason', class: 'lobby__reason', role: 'status' }, reason));

    // --- Reactions ----------------------------------------------------------------------
    const reactions = h('div', { class: 'reactions', role: 'group', 'aria-label': 'Snelle reacties' },
      ...REACTIONS.map((emoji, i) => h('button', {
        class: 'reactions__btn', type: 'button', 'data-key': `react-${i}`, 'aria-label': `Reageer met ${emoji}`,
        onclick: () => this.session.send(C2S.REACT, { r: i }),
      }, emoji)));
    wrap.append(reactions);
    return wrap;
  }

  _playerRow(p, room, isHost) {
    const isMe = p.id === this.session.me;
    const color = PLAYER_COLORS[p.color];
    const chip = h('span', { class: 'player__chip', 'aria-hidden': 'true', dataset: { color: String(p.color) } }, String(p.slot + 1));
    const nameEl = h('span', { class: 'player__name' }, p.name, isMe ? h('span', { class: 'muted' }, ' (jij)') : null);
    const badges = h('span', { class: 'player__badges' });
    if (p.id === room.hostId) badges.append(h('span', { class: 'badge badge--host' }, '👑 Host'));
    if (p.bot) badges.append(h('span', { class: 'badge' }, `Bot · ${BOT_LEVEL_LABELS[p.bot]}`));

    let status;
    if (!p.connected) status = h('span', { class: 'player__status player__status--away' }, 'Verbinding weg…');
    else if (p.role === 'spectator') status = h('span', { class: 'player__status' }, p.wants ? 'Wacht op een plek' : 'Kijkt mee');
    else if (p.bot || p.id === room.hostId) status = h('span', { class: 'player__status player__status--ok' }, 'Klaar');
    else status = h('span', { class: `player__status ${p.ready ? 'player__status--ok' : ''}` }, p.ready ? '✓ Klaar' : 'Nog niet klaar');

    const tools = h('span', { class: 'player__tools' });
    if (isHost && p.bot && room.state === 'lobby') {
      const id = `lvl-${p.id}`;
      tools.append(
        h('label', { class: 'visually-hidden', for: id }, `Niveau van ${p.name}`),
        h('select', {
          id, class: 'select select--small', 'data-key': id,
          onchange: (e) => this.send(C2S.BOT_LEVEL, { id: p.id, level: e.target.value }),
        }, ...BOT_LEVELS.map((l) => h('option', { value: l, selected: l === p.bot }, BOT_LEVEL_LABELS[l]))),
        h('button', { class: 'btn btn--small btn--ghost', type: 'button', 'data-key': `rm-${p.id}`, 'aria-label': `Verwijder ${p.name}`, onclick: () => this.send(C2S.REMOVE_BOT, { id: p.id }) }, '✕'),
      );
    } else if (isHost && !isMe && !p.bot) {
      tools.append(h('button', {
        class: 'btn btn--small btn--ghost', type: 'button', 'data-key': `kick-${p.id}`, 'aria-label': `Verwijder ${p.name} uit de kamer`,
        onclick: async () => {
          const ok = await dialog({
            title: `${p.name} verwijderen?`,
            body: 'Deze speler wordt uit de kamer gezet.',
            actions: [{ label: 'Annuleer', value: false }, { label: 'Verwijder', value: true, primary: true }],
          });
          if (ok) this.send(C2S.KICK, { id: p.id });
        },
      }, 'Verwijder'));
    }

    return h('li', {
      class: `player ${isMe ? 'player--me' : ''} ${p.connected ? '' : 'player--away'}`,
      dataset: { player: p.id },
      'aria-label': `${p.name}, kleur ${color.name}${p.id === room.hostId ? ', host' : ''}`,
    }, chip, nameEl, badges, status, tools);
  }

  _results(room) {
    const r = room.results;
    const allTied = r.rows.length > 1 && r.rows.every((row) => row.rank === r.rows[0].rank); // a draw
    const table = h('table', { class: 'results' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '#'), h('th', { scope: 'col' }, 'Speler'), ...r.columns.map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, ...r.rows.map((row) => h('tr', { class: row.id === this.session.me ? 'is-me' : '' },
        h('td', {}, allTied ? '=' : row.rank === 1 ? '🏆' : String(row.rank)),
        h('td', {}, h('span', { class: 'player__chip player__chip--small', dataset: { color: String(row.color) }, 'aria-hidden': 'true' }), row.name),
        ...row.values.map((v) => h('td', {}, v))))));
    const of = getGame(r.game)?.title;
    return h('section', { class: 'panel panel--results', 'aria-labelledby': 'results-title' },
      of ? h('p', { class: 'eyebrow' }, `Vorige game · ${of}`) : null,
      h('h3', { id: 'results-title', class: 'panel__title' }, r.title), table);
  }

  _qr() {
    const canvas = h('canvas', { class: 'qr', role: 'img', 'aria-label': `QR-code met de link ${this.link}` });
    try {
      const qr = createQr(this.link);
      const px = 5;
      canvas.width = canvas.height = (qr.size + 8) * px;
      drawQr(canvas.getContext('2d'), qr, px, { dark: '#0a0a16', light: '#ffffff' });
    } catch {
      /* link too long: unlikely */
    }
    return h('div', { class: 'lobby__qr', id: 'lobby-qr' }, canvas, h('p', { class: 'muted small' }, 'Scan met je telefoon om mee te doen.'));
  }

  async _copy() {
    if (await copyText(this.link)) {
      sfx.play('coin');
      toast('Link gekopieerd!', { type: 'ok' });
    } else {
      await dialog({
        title: 'Kopieer de link',
        body: h('input', { class: 'input', value: this.link, readonly: true, 'aria-label': 'Link naar de kamer', onfocus: (e) => e.target.select() }),
      });
    }
  }

  async _share(game) {
    try {
      const what = this.session.room.party?.mode === 'free' ? game.title : 'een party';
      await navigator.share({ title: `${what} in Timon's Arcade`, text: `Doe mee met ${what}! Code: ${this.session.room.code}`, url: this.link });
    } catch {
      /* user cancelled */
    }
  }

  async _rename() {
    const me = this.session.myPlayer;
    const input = h('input', { class: 'input', value: me?.name ?? '', maxlength: String(NAME_MAX_LENGTH), 'aria-label': 'Nieuwe bijnaam', autocomplete: 'nickname' });
    const ok = await dialog({
      title: 'Naam wijzigen',
      body: input,
      actions: [{ label: 'Annuleer', value: false }, { label: 'Opslaan', value: true, primary: true }],
    });
    const name = input.value.trim();
    if (ok && name) {
      local.set('name', name);
      this.send(C2S.NAME, { name });
    }
  }

  // Floating emoji next to the player's row (or in the corner during a game).
  showReaction(playerId, index) {
    const emoji = REACTIONS[index];
    if (!emoji) return;
    sfx.play('react');
    const row = this.root.hidden ? null : this.root.querySelector(`[data-player="${CSS.escape(playerId)}"]`);
    const bubble = h('span', { class: 'reaction-float', 'aria-hidden': 'true' }, emoji);
    if (row) row.append(bubble);
    else {
      const name = this.session.room?.players.find((p) => p.id === playerId)?.name ?? '';
      bubble.classList.add('reaction-float--corner');
      bubble.append(h('small', {}, ` ${name}`));
      document.body.append(bubble);
    }
    setTimeout(() => bubble.remove(), 1600);
  }
}
