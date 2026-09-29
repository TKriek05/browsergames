// Party lobby behaviour of a Room: switching games (with seats that follow),
// random draws, votes and tournaments. Installed on Room.prototype, so `this`
// is the room; the pure rules live in shared/party.js.
import { MAX_PEOPLE_PER_ROOM } from '../shared/constants.js';
import { getGame } from '../shared/catalog.js';
import { normalizeSettings } from '../shared/settings.js';
import {
  cleanPool, drawGame, newTournament, scoreGame, champions, votesPick, drawsPick, voteWinner,
} from '../shared/party.js';

export const partyMethods = {
  _useGame(gameId) {
    if (this.gameId) this.settingsByGame.set(this.gameId, this.settings);
    this.gameId = gameId;
    this.meta = getGame(gameId);
    this.module = this.registry.get(gameId);
    this.settings = normalizeSettings(gameId, this.settingsByGame.get(gameId) ?? {});
  },

  // The host, a random draw or the votes pick the next game. Lobby only.
  selectGame(gameId) {
    if (this.state !== 'lobby') return false;
    if (!getGame(gameId)?.available || !this.registry.get(gameId)) return false;
    if (gameId !== this.gameId) {
      this._useGame(gameId);
      this._fitSeats();
    }
    this.markDirty();
    return true;
  },

  // Board games in a random, vote or tournament party go back to the lobby
  // by themselves after one match, so the party keeps flowing.
  get autoReturn() {
    return this.party.mode !== 'free';
  },

  _randomPicks() {
    return drawsPick(this.party);
  },

  _votePicks() {
    return votesPick(this.party);
  },

  // People who want to play (not watching by choice) and the bots.
  headcount() {
    let humans = 0;
    let bots = 0;
    for (const p of this.players) {
      if (p.isBot) bots++;
      else if (p.wantsToPlay) humans++;
    }
    return { humans, bots };
  },

  // After a game switch. Short of seats: bots go to the bench first, then the
  // latest joiners watch (they keep wanting to play). Free seats go to those
  // spectators first, then to benched bots.
  _fitSeats() {
    if (!this.meta.bots) for (const bot of this.players.filter((p) => p.isBot)) this._bench(bot);
    while (this.seated.length > this.meta.max) {
      const bot = [...this.seated].reverse().find((p) => p.isBot);
      if (bot) {
        this._bench(bot);
        continue;
      }
      const humans = this.seated.filter((p) => p.id !== this.hostId).sort((a, b) => b.joinedAt - a.joinedAt);
      const out = humans[0] ?? this.seated[this.seated.length - 1];
      out.role = 'spectator';
      out.ready = false;
    }
    const waiting = this.players.filter((p) => p.role === 'spectator' && p.wantsToPlay).sort((a, b) => a.joinedAt - b.joinedAt);
    for (const p of waiting) {
      if (this.seated.length >= this.meta.max) break;
      p.role = 'player';
    }
    while (this.benched.length && this.meta.bots && this.seated.length < this.meta.max && this.players.length < MAX_PEOPLE_PER_ROOM) {
      const b = this.benched.shift();
      this._addBotPlayer(b.name, b.botLevel);
    }
  },

  _bench(bot) {
    this.benched.push({ name: bot.name, botLevel: bot.botLevel });
    this._remove(bot);
  },

  // Host changes the party mode, tournament length/order or the random pool.
  setParty({ mode, order, length, pool, restart = false }) {
    if (this.state !== 'lobby') return;
    const p = this.party;
    const wasRandom = this._randomPicks();
    const modeChanged = mode !== undefined && mode !== p.mode;
    if (mode) p.mode = mode;
    if (order) p.order = order;
    if (length) p.length = length;
    if (pool) p.pool = cleanPool(pool) ?? p.pool;

    if (p.mode !== 'tournament') p.tournament = null;
    else if (!p.tournament || modeChanged || restart) p.tournament = newTournament(p.length);
    else {
      // A longer or shorter series keeps the scores so far.
      p.tournament.length = p.length;
      p.tournament.done = p.tournament.played >= p.length;
    }
    const isRandom = this._randomPicks();
    if (isRandom) {
      this._clearVotes();
      if (!wasRandom || restart || !p.pool.includes(this.gameId)) this.drawNext();
    }
    this._applyVotes();
    this.markDirty();
  },

  // A random game from the pool that suits the group; in a tournament the
  // games played so far come last, otherwise the recent ones.
  drawNext() {
    if (this.state !== 'lobby') return false;
    const t = this.party.tournament;
    const exclude = [this.gameId, ...(t ? t.games.map((g) => g.game) : this.party.recent)];
    const id = drawGame(this.party.pool, { ...this.headcount(), exclude });
    if (!id || !this.selectGame(id)) return false;
    this.party.draws++;
    return true;
  },

  // Anyone (not a bot) may vote for the next game, or take the vote back
  // (gameId undefined). In free mode the votes only advise the host; in the
  // vote modes the leading game is selected right away. Random draws ignore votes.
  vote(player, gameId) {
    if (this.state !== 'lobby' || player.isBot || this._randomPicks()) return;
    if (gameId !== undefined && !getGame(gameId)?.available) return;
    player.vote = gameId ?? null;
    player.votedAt = ++this.voteSeq;
    this._applyVotes();
    this.markDirty();
  },

  _clearVotes() {
    for (const p of this.players) p.vote = null;
  },

  // Vote modes: switch to the game with the most votes. A game with fewer
  // seats than people who want to play does not count.
  _applyVotes() {
    if (this.state !== 'lobby' || !this._votePicks()) return;
    const { humans } = this.headcount();
    const votes = this.players.filter((p) => p.vote && !p.isBot).map((p) => ({ game: p.vote, at: p.votedAt }));
    const winner = voteWinner(votes, this.gameId, (id) => getGame(id)?.max >= humans);
    if (winner && winner !== this.gameId) this.selectGame(winner);
  },

  _afterPartyGame(results) {
    const p = this.party;
    p.recent = [this.gameId, ...p.recent.filter((id) => id !== this.gameId)].slice(0, 4);
    const t = p.tournament;
    if (p.mode === 'tournament' && t && !t.done) {
      scoreGame(t, this.gameId, results);
      if (t.done) {
        const names = champions(t.standings).map((s) => s.name);
        if (names.length) this.notice(names.length > 1 ? `🏆 ${names.join(' en ')} winnen samen het toernooi!` : `🏆 ${names[0]} wint het toernooi!`);
      }
    }
    if (this._randomPicks() && !t?.done) this.drawNext();
  },
};
