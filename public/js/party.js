// Party parts of the lobby: the next game (with a short roulette after a
// random draw), the party mode, the game picker / vote grid / random pool
// and the tournament standings. Rendered by lobby.js on every room update.
import { CATALOG, getGame } from '../../shared/catalog.js';
import { C2S } from '../../shared/messages.js';
import {
  PARTY_MODES, PARTY_MODE_LABELS, TOURNAMENT_LENGTHS, gameFits, votesPick, drawsPick, tallyVotes,
} from '../../shared/party.js';
import { h, prefersReducedMotion, confirmDialog } from './core/ui.js';
import { drawThumb } from './thumbs.js';
import * as sfx from './core/audio.js';

const SPIN_MS = 1500;
const MODE_HELP = {
  free: 'De host kiest elke keer de game. Iedereen kan een voorkeur doorgeven met een stem.',
  vote: 'Iedereen stemt: de game met de meeste stemmen wordt gespeeld.',
  random: 'Na elke game kiest de arcade een willekeurige volgende game.',
  tournament: 'Een reeks games: wie de meeste wint, wint het toernooi.',
};
const ORDER_LABELS = { random: 'Willekeurig', host: 'Host kiest', vote: 'Stemmen' };
const KIND_LABELS = { realtime: 'Actie', board: 'Bord- of kaartspel', quiz: 'Quiz' };

const games = () => Object.values(CATALOG).filter((g) => g.available);
// Shared place for equal wins and points.
const rankOf = (list, s) => 1 + list.filter((o) => o.wins > s.wins || (o.wins === s.wins && o.points > s.points)).length;
const playersText = (g) => (g.min === g.max ? `${g.max} spelers` : `${Math.max(1, g.min)}–${g.max} spelers`);

// Votes as the server counts them (voting order is not public: ties show in join order).
function votesOf(room) {
  return tallyVotes(room.players.filter((p) => p.vote && !p.bot).map((p, i) => ({ game: p.vote, at: i })));
}

// Humans who want to play (seated or waiting) and bots, as the server counts them.
function headcount(room) {
  let humans = 0;
  let bots = 0;
  for (const p of room.players) {
    if (p.bot) bots++;
    else if (p.role === 'player' || p.wants) humans++;
  }
  return { humans, bots };
}

function thumb(id, cls) {
  const canvas = h('canvas', { class: cls, 'aria-hidden': 'true' });
  drawThumb(canvas, id);
  return canvas;
}

export class PartyUi {
  constructor(lobby) {
    this.lobby = lobby;
    this.panel = null; // null | 'pick' | 'pool' (host) | 'vote' (everyone): open game grid
    this.openOnJoin = null; // panel to open in the next new room (a fresh party lobby)
    this.seen = { code: null, draws: 0, voting: false };
    this.spin = null; // { until, next, last }
    this.spinCanvas = null;
    this.tick = (now) => this._tick(now);
  }

  send(type, payload) {
    this.lobby.send(type, payload);
  }

  // Start the roulette when the server drew a new game since the last render.
  noteRoom(room) {
    const draws = room.party?.draws ?? 0;
    const voting = votesPick(room.party);
    if (this.seen.code !== room.code) {
      this.seen = { code: room.code, draws, voting };
      this.panel = this.openOnJoin ?? (voting && room.state === 'lobby' ? 'vote' : null);
      this.openOnJoin = null;
      return;
    }
    // The votes decide from now on: show everyone the games to vote for.
    if (voting && !this.seen.voting) this.panel = 'vote';
    if (drawsPick(room.party) && this.panel === 'vote') this.panel = null;
    this.seen.voting = voting;
    if (draws > this.seen.draws && !prefersReducedMotion() && !this.lobby.root.hidden) {
      this.spin = { until: performance.now() + SPIN_MS, next: 0, last: null };
      requestAnimationFrame(this.tick);
    }
    this.seen.draws = draws;
  }

  _tick(now) {
    if (!this.spin) return;
    if (now >= this.spin.until || this.lobby.root.hidden) {
      this.spin = null;
      sfx.play('coin');
      this.lobby.render();
      return;
    }
    if (now >= this.spin.next && this.spinCanvas) {
      const ids = this.lobby.session.room?.party?.pool ?? games().map((g) => g.id);
      const choices = ids.filter((id) => id !== this.spin.last);
      const id = choices[Math.floor(Math.random() * choices.length)] ?? ids[0];
      drawThumb(this.spinCanvas, id);
      this.spin.last = id;
      sfx.play('hover');
      const elapsed = SPIN_MS - (this.spin.until - now);
      this.spin.next = now + 55 + elapsed * 0.14; // slows down towards the end
    }
    requestAnimationFrame(this.tick);
  }

  // --- Next game ------------------------------------------------------------------------
  gameCard(room) {
    const game = getGame(room.game);
    if (this.spin) {
      this.spinCanvas = h('canvas', { class: 'gamecard__thumb', 'aria-hidden': 'true' });
      drawThumb(this.spinCanvas, this.spin.last ?? room.game);
      return h('div', { class: 'gamecard gamecard--spin' }, this.spinCanvas,
        h('div', { class: 'gamecard__body' },
          h('p', { class: 'gamecard__title', role: 'status' }, '🎲 Even kijken…')));
    }
    this.spinCanvas = null;
    const { humans, bots } = headcount(room);
    const warn = humans > game.max ? `Max. ${game.max} spelers: ${humans - game.max} kijk${humans - game.max > 1 ? 'en' : 't'} mee.` : '';
    const tally = drawsPick(room.party) ? [] : votesOf(room);
    const votes = tally.length ? h('p', { class: 'gamecard__votes small' },
      h('span', { class: 'muted' }, '🗳️ Stemmen: '),
      ...tally.map((e, i) => h('span', { class: `vote-tag ${e.game === room.game ? 'is-current' : ''}` },
        `${getGame(e.game)?.title ?? e.game} ${e.count}${i < tally.length - 1 ? ' · ' : ''}`))) : null;
    return h('div', { class: 'gamecard' },
      thumb(room.game, 'gamecard__thumb'),
      h('div', { class: 'gamecard__body' },
        h('p', { class: 'gamecard__title' }, game.title),
        h('p', { class: 'gamecard__tagline muted' }, game.tagline),
        h('ul', { class: 'card__meta' },
          h('li', {}, playersText(game)),
          h('li', {}, KIND_LABELS[game.kind] ?? 'Actie'),
          bots && game.bots ? h('li', {}, 'Met bots') : null),
        warn ? h('p', { class: 'gamecard__warn small' }, warn) : null,
        votes));
  }

  // Mode selector (host) or a line describing it (others).
  modeControls(room, isHost) {
    const party = room.party;
    const t = party.tournament;
    const wrap = h('div', { class: 'party-mode' });
    if (!isHost) {
      const extra = party.mode === 'tournament' ? ` · ${party.length} games, ${ORDER_LABELS[party.order].toLowerCase()}` : '';
      wrap.append(h('p', { class: 'party-mode__line' }, h('strong', {}, `Party-modus: ${PARTY_MODE_LABELS[party.mode]}`), extra),
        h('p', { class: 'muted small' }, MODE_HELP[party.mode]));
      return wrap;
    }
    const setMode = async (mode) => {
      if (mode === party.mode) return;
      if (party.mode === 'tournament' && t && t.played > 0 && !t.done
        && !(await confirmDialog('Toernooi stoppen?', 'De stand van dit toernooi verdwijnt.', 'Stop toernooi'))) return;
      this.panel = null;
      this.send(C2S.PARTY, { mode });
    };
    wrap.append(
      h('p', { id: 'party-mode-label', class: 'field__label' }, 'Party-modus'),
      h('div', { class: 'seg seg--grid', role: 'group', 'aria-labelledby': 'party-mode-label' },
        ...PARTY_MODES.map((m) => h('button', {
          class: 'seg__btn', type: 'button', 'data-key': `mode-${m}`, 'aria-pressed': String(party.mode === m),
          onclick: () => setMode(m),
        }, PARTY_MODE_LABELS[m]))),
      h('p', { class: 'muted small party-mode__help' }, MODE_HELP[party.mode]),
    );
    if (party.mode === 'tournament') {
      wrap.append(h('div', { class: 'party-mode__row' },
        h('div', { class: 'field' },
          h('label', { for: 'party-length' }, 'Aantal games'),
          h('select', {
            id: 'party-length', class: 'select', 'data-key': 'party-length',
            onchange: (e) => this.send(C2S.PARTY, { length: Number(e.target.value) }),
          }, ...TOURNAMENT_LENGTHS.map((n) => h('option', { value: String(n), selected: n === party.length, disabled: t && n < t.played }, `${n} games`)))),
        h('div', { class: 'field' },
          h('label', { for: 'party-order' }, 'Volgende game'),
          h('select', {
            id: 'party-order', class: 'select', 'data-key': 'party-order',
            onchange: (e) => this.send(C2S.PARTY, { order: e.target.value }),
          }, ...Object.entries(ORDER_LABELS).map(([v, label]) => h('option', { value: v, selected: v === party.order }, label))))));
    }
    return wrap;
  }

  // Buttons under the game card: the host picks, draws or edits the pool;
  // everyone can vote (except when the arcade draws the games).
  gameTools(room, isHost) {
    const party = room.party;
    const random = drawsPick(party);
    const toggle = (which, label, hide) => h('button', {
      class: 'btn btn--small', type: 'button', 'data-key': `panel-${which}`, 'aria-expanded': String(this.panel === which), 'aria-controls': 'game-grid',
      onclick: () => { this.panel = this.panel === which ? null : which; this.lobby.render(); },
    }, this.panel === which ? hide : label);
    const mine = room.players.find((p) => p.id === this.lobby.session.me)?.vote;
    const voteLabel = mine ? `🗳️ Jouw stem: ${getGame(mine)?.title ?? mine}` : '🗳️ Stem op een game';
    if (votesPick(party) || (!isHost && !random)) {
      return h('div', { class: 'gamecard__tools' }, toggle('vote', voteLabel, 'Verberg games'));
    }
    if (!isHost) return null;
    return h('div', { class: 'gamecard__tools' },
      random ? null : toggle('pick', 'Kies een game', 'Verberg games'),
      h('button', { class: 'btn btn--small', type: 'button', 'data-key': 'draw', disabled: !!this.spin, onclick: () => this.send(C2S.DRAW) },
        random ? '🎲 Andere game' : '🎲 Verras ons'),
      random ? toggle('pool', `Welke games? (${party.pool.length})`, 'Verberg keuze') : null);
  }

  // Full-width grid of every game: pick one (host), vote for one (everyone)
  // or toggle games in the random pool (host).
  gameGrid(room) {
    if (!this.panel || this.spin) return null;
    if (this.panel === 'vote' ? drawsPick(room.party) : !this.lobby.session.isHost) return null;
    const pool = new Set(room.party.pool);
    const picking = this.panel === 'pick';
    const voting = this.panel === 'vote';
    const myVote = room.players.find((p) => p.id === this.lobby.session.me)?.vote ?? null;
    const voters = (id) => room.players.filter((p) => p.vote === id && !p.bot);
    const { humans, bots } = headcount(room);
    const groups = [
      ['Actiegames', games().filter((g) => g.kind === 'realtime')],
      ['Bord-, kaart- en quizspellen', games().filter((g) => g.kind !== 'realtime')],
    ];
    const card = (g) => {
      const fits = gameFits(g, humans, bots);
      const on = voting ? g.id === myVote : picking ? g.id === room.game : pool.has(g.id);
      const why = g.max < humans ? `Max. ${g.max} spelers` : !fits ? `Min. ${g.min} spelers (voeg bots toe)` : playersText(g);
      const who = picking || voting ? voters(g.id) : [];
      const label = who.length ? `${g.title}, ${who.length} ${who.length > 1 ? 'stemmen' : 'stem'}: ${who.map((p) => p.name).join(', ')}` : null;
      return h('li', {},
        h('button', {
          class: `pick ${fits ? '' : 'pick--off'} ${voting && g.id === room.game ? 'pick--current' : ''}`, type: 'button', 'data-key': `pick-${g.id}`, 'aria-pressed': String(on),
          'aria-label': label, title: label,
          onclick: () => {
            if (voting) this.send(C2S.VOTE, g.id === myVote ? {} : { game: g.id });
            else if (picking) this.send(C2S.GAME, { game: g.id });
            else {
              const next = on ? room.party.pool.filter((id) => id !== g.id) : [...room.party.pool, g.id];
              if (next.length) this.send(C2S.PARTY, { pool: next });
            }
          },
        },
        thumb(g.id, 'pick__thumb'),
        h('span', { class: 'pick__title' }, g.title),
        h('span', { class: 'pick__meta' }, why),
        voting && g.id === room.game ? h('span', { class: 'pick__now' }, votesPick(room.party) ? 'Wint nu' : 'Gekozen') : null,
        on ? h('span', { class: 'pick__check', 'aria-hidden': 'true' }, '✓') : null,
        who.length ? h('span', { class: 'pick__votes', 'aria-hidden': 'true' },
          ...who.map((p) => h('span', { class: 'player__chip player__chip--dot', dataset: { color: String(p.color) } })),
          h('span', { class: 'pick__count' }, String(who.length))) : null));
    };
    const section = h('section', { id: 'game-grid', class: 'panel game-grid', 'aria-labelledby': 'grid-title' },
      h('div', { class: 'game-grid__head' },
        h('h3', { id: 'grid-title', class: 'panel__title' },
          voting ? 'Op welke game stem jij?' : picking ? 'Kies de volgende game' : 'Uit welke games mag de arcade kiezen?'),
        voting ? h('p', { class: 'muted small game-grid__hint' }, votesPick(room.party)
          ? 'De game met de meeste stemmen wordt gespeeld. Klik nog eens om je stem in te trekken.'
          : 'De host ziet je stem en kiest de game.') : null,
        picking || voting ? null : h('div', { class: 'game-grid__bulk' },
          h('button', { class: 'btn btn--small', type: 'button', 'data-key': 'pool-all', onclick: () => this.send(C2S.PARTY, { pool: games().map((g) => g.id) }) }, 'Alles'),
          h('button', {
            class: 'btn btn--small', type: 'button', 'data-key': 'pool-fit',
            onclick: () => {
              const fit = games().filter((g) => gameFits(g, humans, bots)).map((g) => g.id);
              if (fit.length) this.send(C2S.PARTY, { pool: fit });
            },
          }, 'Alleen wat past'))));
    for (const [title, list] of groups) {
      section.append(h('h4', { class: 'panel__subtitle' }, title), h('ul', { class: 'picks' }, ...list.map(card)));
    }
    return section;
  }

  // --- Tournament -----------------------------------------------------------------------
  tournament(room, isHost) {
    const t = room.party?.tournament;
    if (room.party?.mode !== 'tournament' || !t) return null;
    const me = this.lobby.session.me;
    const title = t.done ? 'Toernooi afgelopen' : `Toernooi · game ${Math.min(t.played + 1, t.length)} van ${t.length}`;
    const section = h('section', { class: 'panel panel--tournament', 'aria-labelledby': 'tournament-title' },
      h('h3', { id: 'tournament-title', class: 'panel__title' }, `🏆 ${title}`));
    const top = t.standings[0];
    if (t.done && top) {
      const champs = t.standings.filter((s) => s.wins === top.wins && s.points === top.points);
      section.append(h('p', { class: 'champion' },
        champs.length > 1 ? `${champs.map((s) => s.name).join(' en ')} winnen samen!` : `${top.name} wint het toernooi!`));
    }
    if (!t.played) {
      section.append(h('p', { class: 'muted' }, `Speel ${t.length} games. Win er zoveel mogelijk: bij gelijke stand tellen de plaatsen.`));
    } else {
      section.append(h('table', { class: 'results standings' },
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col' }, '#'), h('th', { scope: 'col' }, 'Speler'),
          h('th', { scope: 'col', title: 'Gewonnen games' }, 'Winst'), h('th', { scope: 'col', title: 'Plaatspunten' }, 'Punten'))),
        h('tbody', {}, ...t.standings.map((s) => h('tr', { class: s.id === me ? 'is-me' : '' },
          h('td', {}, t.done && s.wins === top.wins && s.points === top.points ? '🏆' : String(rankOf(t.standings, s))),
          h('td', {}, h('span', { class: 'player__chip player__chip--small', dataset: { color: String(s.color) }, 'aria-hidden': 'true' }), s.name),
          h('td', {}, String(s.wins)),
          h('td', {}, String(s.points)))))));
      const names = new Map(t.standings.map((s) => [s.id, s.name]));
      section.append(h('ol', { class: 'tgames' }, ...t.games.map((g) => h('li', {},
        h('span', { class: 'tgames__game' }, getGame(g.game)?.title ?? g.game),
        h('span', { class: 'tgames__winner' }, g.winners.length ? `🏆 ${g.winners.map((id) => names.get(id) ?? '?').join(' en ')}` : 'gelijkspel')))));
    }
    if (isHost && (t.done || t.played > 0)) {
      section.append(h('button', {
        class: `btn ${t.done ? 'btn--primary' : 'btn--small'}`, type: 'button', 'data-key': 'tournament-restart',
        onclick: async () => {
          if (!t.done && !(await confirmDialog('Opnieuw beginnen?', 'De stand gaat terug naar nul.', 'Begin opnieuw'))) return;
          this.send(C2S.PARTY, { restart: true });
        },
      }, t.done ? 'Nieuw toernooi' : 'Begin opnieuw'));
    }
    return section;
  }
}
