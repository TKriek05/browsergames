// Party lobby: the host picks games, random draws, benched bots and the
// tournament (pure rules in shared/party.js + the room behaviour).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, TestClient, createRoom, joinRoom } from './helpers.js';
import { ERR } from '../shared/messages.js';
import { getGame } from '../shared/catalog.js';
import {
  drawGame, gameFits, cleanPool, newTournament, scoreGame, champions, tournamentView, availableGameIds,
  tallyVotes, voteWinner, votesPick, drawsPick,
} from '../shared/party.js';
import { checkCanStart } from '../shared/lobbyrules.js';
import { createRng } from '../shared/rng.js';
import { makeGame, human } from './board-helpers.js';
import tictactoe from '../shared/rules/tictactoe.js';

const results = (...ids) => ({ title: 'x', columns: [], rows: ids.map((id, i) => ({ id, name: id, color: i, rank: i + 1, values: [] })) });

// --- Pure rules -------------------------------------------------------------------------
test('gameFits: never more humans than seats, bots may fill up to the minimum', () => {
  const chess = getGame('chess');
  assert.equal(gameFits(chess, 2, 0), true);
  assert.equal(gameFits(chess, 3, 0), false);
  assert.equal(gameFits(chess, 1, 0), false);
  assert.equal(gameFits(chess, 1, 1), true);
  assert.equal(gameFits(getGame('kartrace'), 1, 0), true);
});

test('drawGame picks fitting games, avoids excluded ones and falls back', () => {
  const rng = createRng(7);
  const pool = ['chess', 'tanks', 'kartrace'];
  for (let i = 0; i < 50; i++) {
    const id = drawGame(pool, { humans: 4, bots: 0, rng });
    assert.ok(['tanks', 'kartrace'].includes(id), 'chess seats only two');
  }
  for (let i = 0; i < 20; i++) assert.equal(drawGame(pool, { humans: 4, exclude: ['tanks'], rng }), 'kartrace');
  // Everything excluded: repeats are better than nothing.
  assert.ok(pool.includes(drawGame(pool, { humans: 1, bots: 1, exclude: pool, rng })));
  // Nothing fits: still an answer from the pool.
  assert.equal(drawGame(['chess'], { humans: 5, rng }), 'chess');
  assert.equal(drawGame([], { humans: 1, rng }), null);
});

test('cleanPool keeps known, playable, unique games', () => {
  assert.deepEqual(cleanPool(['tag', 'tag', 'nope', 'chess']), ['tag', 'chess']);
  assert.equal(cleanPool(['nope']), null);
  assert.equal(cleanPool('tag'), null);
  assert.ok(availableGameIds().length >= 20);
});

test('tournament scoring: wins first, placement points break ties, a draw has no winner', () => {
  const t = newTournament(3);
  assert.deepEqual(scoreGame(t, 'tanks', results('a', 'b', 'c')), ['a']);
  assert.deepEqual(scoreGame(t, 'kartrace', results('b', 'a', 'c')), ['b']);
  const draw = results('a', 'c');
  draw.rows[1].rank = 1;
  assert.deepEqual(scoreGame(t, 'chess', draw), [], 'everybody shares first place: no win');
  assert.equal(t.done, true);
  const view = tournamentView(t);
  assert.deepEqual(view.standings.map((s) => [s.id, s.wins, s.points, s.played]), [
    ['a', 1, 4, 3], // 2 + 1 + 1 (shared first place)
    ['b', 1, 3, 2], // 1 + 2
    ['c', 0, 1, 3],
  ]);
  assert.deepEqual(champions(t.standings).map((s) => s.id), ['a']);
  assert.deepEqual(view.games.map((g) => g.game), ['tanks', 'kartrace', 'chess']);

  const even = newTournament(2);
  scoreGame(even, 'tanks', results('a', 'b'));
  scoreGame(even, 'snake', results('b', 'a'));
  assert.deepEqual(champions(even.standings).map((s) => s.id), ['a', 'b'], 'same wins and points: shared title');
});

test('votes: most votes win, the earliest supported game breaks a tie, the current game stays on a tie', () => {
  const v = (game, at) => ({ game, at });
  assert.deepEqual(tallyVotes([v('tag', 3), v('chess', 1), v('tag', 4), v(null, 5)]).map((e) => [e.game, e.count]), [['tag', 2], ['chess', 1]]);
  assert.equal(voteWinner([]), null);
  assert.equal(voteWinner([v('tag', 2), v('chess', 1)]), 'chess', 'tie: first vote earliest');
  assert.equal(voteWinner([v('tag', 2), v('chess', 1)], 'tag'), 'tag', 'tie with the current game: no flip');
  assert.equal(voteWinner([v('tag', 2), v('tag', 3), v('chess', 1)], 'chess'), 'tag');
  assert.equal(voteWinner([v('chess', 1), v('chess', 2), v('tag', 3)], null, (id) => id !== 'chess'), 'tag', 'games that do not fit are skipped');
  assert.equal(votesPick({ mode: 'vote' }), true);
  assert.equal(votesPick({ mode: 'tournament', order: 'vote' }), true);
  assert.equal(votesPick({ mode: 'free' }), false);
  assert.equal(drawsPick({ mode: 'tournament', order: 'random' }), true);
  assert.equal(drawsPick({ mode: 'vote' }), false);
});

test('checkCanStart blocks a finished tournament', () => {
  const room = {
    game: 'tag', state: 'lobby', hostId: 'p1',
    players: [{ id: 'p1', role: 'player', connected: true }, { id: 'p2', role: 'player', bot: 'normal', connected: true }],
    party: { tournament: { done: true } },
  };
  assert.equal(checkCanStart(room).ok, false);
  room.party.tournament.done = false;
  assert.equal(checkCanStart(room).ok, true);
});

test('board games return to the lobby by themselves in a party', () => {
  const a = human('p1', 0);
  const b = human('p2', 1);
  const { room, game } = makeGame(tictactoe, [a, b]);
  room.autoReturn = true;
  for (const [p, c] of [[a, 0], [b, 3], [a, 1], [b, 4], [a, 2]]) game.onInput(p, { type: 'move', move: { c } });
  assert.ok(game.over);
  assert.equal(game.snapshot(a).autoReturn, true);
  for (let i = 0; i < 50 && !room.ended; i++) game.tick(0.2);
  assert.ok(room.ended, 'back to the lobby without a rematch vote');
  assert.equal(room.ended.rows[0].id, 'p1');
  assert.equal(room.ended.rows[0].rank, 1);
  assert.equal(room.ended.rows[1].rank, 2);
});

test('board results: nothing to show before the first match ends', () => {
  const { game } = makeGame(tictactoe, [human('p1', 0), human('p2', 1)]);
  game.onInput(game.playerAt(0), { type: 'move', move: { c: 4 } });
  assert.equal(game.finalResults(), null);
});

// --- Room behaviour against a real server ------------------------------------------------
let server;
before(async () => {
  server = await startTestServer();
});
after(() => server.close());

const serverRoom = (code) => server.rooms.rooms.get(code);

// The newest room state that satisfies `pred` (or the last one seen, so the
// assertion after it fails with a clear message). No fixed sleeps: robust on busy machines.
async function roomWhere(c, pred, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < end) {
    const r = await c.latestRoom(20);
    if (r) {
      last = r;
      if (pred(r)) return r;
    }
  }
  return last;
}

async function createParty(name, mode, extra = {}) {
  const c = await new TestClient(server).open();
  c.send('create', { name, mode, ...extra });
  const joined = await c.waitType('joined');
  c.id = joined.you.id;
  c.code = joined.room.code;
  c.room = joined.room;
  return c;
}

test('a party lobby without a game draws one; the host can pick another', async () => {
  const host = await createParty('Host', 'random');
  assert.equal(host.room.party.mode, 'random');
  assert.ok(getGame(host.room.game)?.available);
  assert.ok(host.room.party.draws >= 1);
  const guest = await joinRoom(server, host.code, 'Gast');

  guest.send('game', { game: 'chess' });
  assert.equal((await guest.waitType('error')).code, ERR.NOT_HOST);
  host.send('game', { game: 'chess' });
  let room = await roomWhere(host, (r) => r.game === 'chess');
  assert.equal(room.game, 'chess');
  assert.deepEqual(room.settings, {});

  host.send('game', { game: 'nope' });
  host.send('draw');
  room = await roomWhere(host, (r) => r.party.draws > 1 && r.game !== 'chess');
  assert.notEqual(room.game, 'chess', 'a fresh draw avoids the current game');
  host.close();
  guest.close();
});

test('settings are kept per game when switching back and forth', async () => {
  const host = await createRoom(server, 'Host', 'tag');
  host.send('settings', { settings: { duration: 60 } });
  host.send('game', { game: 'snake' });
  host.send('game', { game: 'tag' });
  const room = await roomWhere(host, (r) => r.game === 'tag' && r.settings.duration === 60);
  assert.equal(room.game, 'tag');
  assert.equal(room.settings.duration, 60);
  host.close();
});

test('a smaller game benches bots and moves late joiners to the stands; a bigger one brings them back', async () => {
  const host = await createRoom(server, 'Host', 'tag');
  host.send('fillBots', { level: 'hard' });
  let room = await roomWhere(host, (r) => r.players.filter((p) => p.bot).length === 5);
  assert.equal(room.players.filter((p) => p.bot).length, 5);

  host.send('game', { game: 'chess' });
  room = await roomWhere(host, (r) => r.game === 'chess');
  assert.equal(room.players.length, 2, 'four bots on the bench');
  assert.equal(room.players.filter((p) => p.bot).length, 1);

  host.send('game', { game: 'tanks' });
  room = await roomWhere(host, (r) => r.game === 'tanks');
  assert.equal(room.players.filter((p) => p.bot && p.bot === 'hard').length, 5, 'bots come back with their level');

  const guest = await joinRoom(server, host.code, 'Gast'); // takes a bot's place
  host.send('game', { game: 'connect4' });
  room = await roomWhere(host, (r) => r.game === 'connect4');
  const seated = room.players.filter((p) => p.role === 'player');
  assert.deepEqual(seated.map((p) => p.id).sort(), [host.id, guest.id].sort(), 'humans before bots');

  const third = await joinRoom(server, host.code, 'Derde');
  room = await roomWhere(host, (r) => r.players.some((p) => p.id === third.id));
  assert.equal(room.players.find((p) => p.id === third.id).role, 'spectator');
  host.send('game', { game: 'ludo' });
  room = await roomWhere(host, (r) => r.game === 'ludo');
  assert.equal(room.players.find((p) => p.id === third.id).role, 'player', 'a free seat for the waiting spectator');
  for (const c of [host, guest, third]) c.close();
});

test('removing a bot by hand empties the bench', async () => {
  const host = await createRoom(server, 'Host', 'tag');
  host.send('fillBots', { level: 'easy' });
  host.send('game', { game: 'chess' });
  let room = await roomWhere(host, (r) => r.game === 'chess' && r.players.some((p) => p.bot));
  const bot = room.players.find((p) => p.bot);
  host.send('removeBot', { id: bot.id });
  host.send('game', { game: 'tag' });
  room = await roomWhere(host, (r) => r.game === 'tag');
  assert.equal(room.players.filter((p) => p.bot).length, 0);
  host.close();
});

test('tournament: scores per finished game, auto-draws the next one and crowns a winner', async () => {
  const host = await createParty('Host', 'tournament', { solo: true });
  let room = host.room;
  assert.equal(room.party.mode, 'tournament');
  assert.equal(room.party.tournament.played, 0);
  host.send('party', { length: 3 });
  room = await roomWhere(host, (r) => r.party.tournament?.length === 3);
  assert.equal(room.party.tournament.length, 3);

  const r = serverRoom(host.code);
  const played = [];
  for (let i = 0; i < 3; i++) {
    r.start(null);
    assert.equal(r.state, 'playing');
    played.push(r.gameId);
    const ids = r.seated.map((p) => p.id);
    const winner = i < 2 ? host.id : ids.find((id) => id !== host.id) ?? host.id;
    r.endGame(results(winner, ...ids.filter((id) => id !== winner)), 'finished');
  }
  room = await roomWhere(host, (x) => x.party.tournament?.played === 3);
  const t = room.party.tournament;
  assert.equal(t.played, 3);
  assert.equal(t.done, true);
  assert.deepEqual(t.games.map((g) => g.game), played);
  assert.equal(new Set(played).size, 3, 'no repeats while the pool has more games');
  assert.equal(t.standings[0].id, host.id);
  assert.equal(t.standings[0].wins, 2);
  assert.ok(host.messages.some((m) => m.t === 'notice' && m.text.includes('wint het toernooi')));

  host.send('start');
  assert.equal((await host.waitType('error')).code, ERR.CANNOT_START);
  host.send('party', { restart: true });
  room = await roomWhere(host, (x) => x.party.tournament?.played === 0);
  assert.equal(room.party.tournament.played, 0);
  assert.equal(room.party.tournament.done, false);
  host.close();
});

test('an aborted game does not count for the tournament', async () => {
  const host = await createParty('Host', 'tournament', { solo: true });
  const r = serverRoom(host.code);
  r.start(null);
  r.endGame(null, 'aborted');
  const room = await roomWhere(host, (x) => x.state === 'lobby');
  assert.equal(room.party.tournament.played, 0);
  host.close();
});

test('random mode draws a new game after each finished one; the pool is respected', async () => {
  const host = await createParty('Host', 'random', { solo: true });
  host.send('party', { pool: ['tanks', 'kartrace', 'nope'] });
  let room = await roomWhere(host, (x) => x.party.pool.length === 2);
  assert.deepEqual(room.party.pool, ['tanks', 'kartrace']);
  assert.ok(['tanks', 'kartrace'].includes(room.game), 'current game left the pool: redrawn');
  const r = serverRoom(host.code);
  const first = r.gameId;
  r.start(null);
  r.endGame(results(host.id), 'finished');
  room = await roomWhere(host, (x) => x.results?.game === first);
  assert.notEqual(room.game, first);
  assert.equal(room.results.game, first, 'results say which game they belong to');
  host.close();
});

test('everyone can vote: advice in free mode, the leading game is picked in vote mode', async () => {
  const host = await createRoom(server, 'Host', 'tag');
  const guest = await joinRoom(server, host.code, 'Gast');
  const third = await joinRoom(server, host.code, 'Derde');

  // Free mode: votes are visible, the host still decides.
  guest.send('vote', { game: 'snake' });
  let room = await roomWhere(host, (r) => r.players.find((p) => p.id === guest.id)?.vote === 'snake');
  assert.equal(room.players.find((p) => p.id === guest.id).vote, 'snake');
  assert.equal(room.game, 'tag');

  // Vote mode: the votes carry over and decide right away; the host can no longer pick.
  host.send('party', { mode: 'vote' });
  room = await roomWhere(host, (r) => r.party.mode === 'vote' && r.game === 'snake');
  assert.equal(room.game, 'snake');
  host.send('game', { game: 'chess' });
  host.send('draw');
  third.send('vote', { game: 'tanks' }); // 1-1 tie: snake stays (it is the current game)
  room = await roomWhere(host, (r) => r.players.find((p) => p.id === third.id)?.vote === 'tanks');
  assert.equal(room.game, 'snake');
  host.send('vote', { game: 'tanks' });
  room = await roomWhere(host, (r) => r.game === 'tanks');
  assert.equal(room.game, 'tanks', 'two votes beat one');

  // Taking a vote back and leaving both count.
  host.send('vote', {});
  guest.send('vote', { game: 'chess' }); // chess seats two, three people want to play: ignored
  room = await roomWhere(host, (r) => r.players.find((p) => p.id === guest.id)?.vote === 'chess');
  assert.equal(room.game, 'tanks');
  guest.send('vote', { game: 'snake' });
  host.send('vote', { game: 'snake' });
  room = await roomWhere(host, (r) => r.game === 'snake');
  third.send('vote', { game: 'kartrace' });
  guest.send('leave'); // snake 1, kartrace 1: the current game stays
  room = await roomWhere(host, (r) => !r.players.some((p) => p.id === guest.id));
  assert.equal(room.game, 'snake');
  host.send('vote', {});
  room = await roomWhere(host, (r) => r.game === 'kartrace');
  assert.equal(room.game, 'kartrace', 'only the kartrace vote is left');

  // Votes reset when a game starts.
  third.send('ready', { ready: true });
  await roomWhere(host, (x) => x.players.find((p) => p.id === third.id)?.ready);
  const r = serverRoom(host.code);
  r.start(null);
  assert.equal(r.state, 'playing');
  r.endGame(null, 'aborted');
  room = await roomWhere(host, (x) => x.state === 'lobby' && x.players.every((p) => !p.vote));
  assert.ok(room.players.every((p) => !p.vote));
  for (const c of [host, guest, third]) c.close();
});

test('random draws ignore votes; bad votes are rejected', async () => {
  const host = await createParty('Host', 'random');
  const guest = await joinRoom(server, host.code, 'Gast');
  guest.send('vote', { game: 'tag' });
  guest.send('vote', { game: 'nope' });
  guest.send('vote', { game: 42 });
  guest.send('ready', { ready: true });
  const room = await roomWhere(host, (r) => r.players.find((p) => p.id === guest.id)?.ready);
  assert.equal(room.players.find((p) => p.id === guest.id).vote, null);
  host.close();
  guest.close();
});

test('party messages are validated', async () => {
  const host = await createRoom(server, 'Host');
  host.send('party', { mode: 'chaos' });
  host.send('party', { length: 4 });
  host.send('party', { pool: 'tag' });
  host.send('party', { pool: Array(100).fill('tag') });
  host.send('party', {}); // a valid no-op: the room answers once everything before it was handled
  const room = await roomWhere(host, (x) => x.party.pool.length > 1);
  assert.equal(room.party.mode, 'free');
  assert.equal(room.party.length, 5);
  host.close();
});
