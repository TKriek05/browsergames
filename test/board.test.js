// Board adapter (server/games/board.js) + tic-tac-toe rules and bot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runTicks, human, bot } from './board-helpers.js';
import tictactoe from '../shared/rules/tictactoe.js';
import ttBot from '../server/ai/tictactoe.js';
import { createRng } from '../shared/rng.js';

test('tic-tac-toe rules: win, draw and illegal moves', () => {
  let s = tictactoe.setup({ seats: 2 });
  for (const [seat, c] of [[0, 0], [1, 3], [0, 1], [1, 4], [0, 2]]) s = tictactoe.apply(s, seat, { c }).state;
  assert.deepEqual(tictactoe.result(s).winners, [0]);
  assert.deepEqual(s.line, [0, 1, 2]);
  assert.deepEqual(tictactoe.toMove(s), []);

  let d = tictactoe.setup({ seats: 2 });
  for (const [seat, c] of [[0, 0], [1, 1], [0, 2], [1, 4], [0, 3], [1, 5], [0, 7], [1, 6], [0, 8]]) d = tictactoe.apply(d, seat, { c }).state;
  assert.equal(tictactoe.result(d).draw, true);
});

test('adapter validates turns and moves', () => {
  const a = human('p1', 0);
  const b = human('p2', 1);
  const { game } = makeGame(tictactoe, [a, b]);
  game.onInput(b, { type: 'move', move: { c: 4 } }); // not b's turn
  assert.equal(game.moveNo, 0);
  game.onInput(a, { type: 'move', move: { c: 9 } }); // off the board
  game.onInput(a, { type: 'move', move: { c: 4, hack: true } }); // extra field → no match
  assert.equal(game.moveNo, 0);
  game.onInput(a, { type: 'move', move: { c: 4 } });
  assert.equal(game.moveNo, 1);
  game.onInput(b, { type: 'move', move: { c: 4 } }); // occupied
  assert.equal(game.moveNo, 1);
  const snapB = game.snapshot(b);
  assert.equal(snapB.you, 1);
  assert.deepEqual(snapB.toMove, [1]);
  assert.equal(snapB.legal.length, 8);
  assert.equal(game.snapshot(a).legal, null, 'no legal list when it is not your turn');
});

test('undo needs agreement from the other human', () => {
  const a = human('p1', 0);
  const b = human('p2', 1);
  const { game } = makeGame(tictactoe, [a, b]);
  game.onInput(a, { type: 'move', move: { c: 0 } });
  game.onInput(b, { type: 'undo' }); // b has not moved yet
  assert.equal(game.undoReq, null);
  game.onInput(a, { type: 'undo' });
  game.tick(0.1);
  assert.equal(game.moveNo, 1, 'nothing happens without agreement');
  game.onInput(b, { type: 'undoAnswer', accept: false });
  assert.equal(game.undoReq, null);
  game.onInput(a, { type: 'undo' });
  game.onInput(b, { type: 'undoAnswer', accept: true });
  game.tick(0.1);
  assert.equal(game.moveNo, 0);
  assert.equal(game.state.board[0], -1);
  assert.deepEqual(tictactoe.toMove(game.state), [0]);
});

test('undo against a bot takes back both moves', async () => {
  const a = human('p1', 0);
  const { game } = makeGame(tictactoe, [a, bot('p2', 1)]);
  game.onInput(a, { type: 'move', move: { c: 0 } });
  await runTicks(game, () => game.moveNo === 2);
  game.onInput(a, { type: 'undo' });
  game.tick(0.1);
  assert.equal(game.moveNo, 0);
  assert.deepEqual(tictactoe.toMove(game.state), [0]);
});

test('rematch starts a new round with swapped seats and keeps score', async () => {
  const a = human('p1', 0);
  const b = human('p2', 1);
  const { game } = makeGame(tictactoe, [a, b]);
  for (const [p, c] of [[a, 0], [b, 3], [a, 1], [b, 4], [a, 2]]) game.onInput(p, { type: 'move', move: { c } });
  assert.ok(game.over);
  game.onInput(a, { type: 'rematch' });
  game.tick(0.1);
  assert.equal(game.round, 0, 'waits for everyone');
  game.onInput(b, { type: 'rematch' });
  game.tick(0.1);
  assert.equal(game.round, 1);
  assert.equal(game.seatOf(b), 0, 'the other player starts now');
  const res = game.finalResults();
  assert.equal(res.rows[0].id, 'p1');
  assert.equal(res.rows[0].values[0], '1');
});

test('bots play a full game; a perfect bot never loses', async () => {
  for (let i = 0; i < 5; i++) {
    const { game } = makeGame(tictactoe, [bot('p1', 0, 'hard'), bot('p2', 1, 'hard')]);
    assert.ok(await runTicks(game, () => !!game.over));
    assert.equal(game.over.draw, true, 'perfect play is a draw');
  }
  // Hard bot against a random player: never loses.
  const rng = createRng(42);
  for (let g = 0; g < 40; g++) {
    let s = tictactoe.setup({ seats: 2 });
    const botSeat = g % 2;
    while (!tictactoe.result(s)) {
      const seat = tictactoe.toMove(s)[0];
      const legal = tictactoe.legalMoves(s, seat);
      const move = seat === botSeat ? ttBot.pick(s, seat, 'hard', rng) : legal[Math.floor(rng() * legal.length)];
      s = tictactoe.apply(s, seat, move).state;
    }
    const res = tictactoe.result(s);
    assert.ok(res.draw || res.winners.includes(botSeat), `game ${g}`);
  }
});
