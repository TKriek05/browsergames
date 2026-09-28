// Slangenstrijd: body packing, movement rules, bots, snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import snake from '../server/games/snake.js';
import { packBody, unpackBody, dirFromAxes, SNAKE_TICKS_PER_MOVE } from '../shared/games/snake.js';
import { ARCADE_PHASE } from '../shared/games/arcade.js';
import { ByteWriter, ByteReader } from '../shared/binary.js';
import { SIM_TICK_RATE } from '../shared/constants.js';

const DT = 1 / SIM_TICK_RATE;
function fakeRoom(players) {
  const room = { clock: 0, events: [], results: null, gamePlayers: () => players, now: () => room.clock,
    emit: (e, d) => room.events.push({ e, ...d }), endGame(r) { room.results = r; } };
  return room;
}
const bot = (id, slot, level = 'normal') => ({ id, slot, name: `Bot${slot}`, color: slot, isBot: true, botLevel: level });
const human = (id, slot) => ({ id, slot, name: `Mens${slot}`, color: slot, isBot: false, connected: true });
function run(game, room, seconds) {
  for (let i = 0; i < seconds * SIM_TICK_RATE && !room.results; i++) { room.clock += DT * 1000; game.tick(DT); }
}

test('bodies survive packing into 2-bit directions', () => {
  const cells = [[5, 5], [4, 5], [4, 6], [4, 7], [5, 7], [6, 7], [6, 6]];
  assert.deepEqual(unpackBody(5, 5, cells.length, packBody(cells)), cells);
  assert.equal(dirFromAxes(1, 0.2), 0);
  assert.equal(dirFromAxes(0, -1), 3);
  assert.equal(dirFromAxes(0.1, 0.1), -1);
});

test('a snake turns with the input, cannot reverse and dies at the wall', () => {
  const me = human('p1', 0);
  const room = fakeRoom([me, bot('p2', 1)]);
  const game = snake.create(room, { rounds: 1, seed: 1 });
  run(game, room, 3.05);
  assert.equal(game.phase, ARCADE_PHASE.PLAY);
  const e = game.ents[0];
  assert.equal(e.dir, 0);
  game.onInput(me, { seq: 1, buttons: 0, ax: -1, ay: 0, aim: 0 }); // reverse: ignored
  game.onInput(me, { seq: 2, buttons: 0, ax: 0, ay: 1, aim: 0 }); // down
  run(game, room, (SNAKE_TICKS_PER_MOVE * 2) / SIM_TICK_RATE);
  assert.equal(e.dir, 1);
  for (let i = 0; i < 60 && e.alive; i++) run(game, room, SNAKE_TICKS_PER_MOVE / SIM_TICK_RATE);
  assert.equal(e.alive, false, 'crashed into the bottom wall');
  assert.ok(room.events.some((x) => x.e === 'die' && x.s === 0));
});

test('a bot-only game of three rounds ends with points', () => {
  const players = [bot('p1', 0, 'hard'), bot('p2', 1, 'normal'), bot('p3', 2, 'easy'), bot('p4', 3, 'normal')];
  const room = fakeRoom(players);
  const game = snake.create(room, { rounds: 3, seed: 7 });
  run(game, room, 500);
  assert.ok(room.results, 'ended');
  assert.equal(room.events.filter((x) => x.e === 'round').length, 3);
  const points = room.results.rows.map((r) => Number(r.values[0]));
  assert.equal(points.reduce((a, b) => a + b, 0), 3 * (0 + 1 + 2 + 3), 'placement points per round');
  assert.ok(room.events.some((x) => x.e === 'eat'), 'bots eat apples');
});

test('snapshot encoding has the documented layout', () => {
  const room = fakeRoom([bot('p1', 0), human('p2', 3)]);
  const game = snake.create(room, { rounds: 3, seed: 2 });
  run(game, room, 4);
  const w = new ByteWriter();
  game.snapshot(w);
  const r = new ByteReader(w.toBytes());
  assert.equal(r.u8(), ARCADE_PHASE.PLAY);
  r.f32();
  assert.equal(r.u8(), 1);
  assert.equal(r.u8(), 3);
  r.u16();
  assert.equal(r.u8(), 2);
  for (let i = 0; i < 2; i++) {
    r.u8(); r.u8(); r.u8(); r.u8();
    const len = r.u16();
    r.u16(); r.u8(); r.u8(); r.u8();
    r.pos += Math.ceil((len - 1) / 4);
  }
  const food = r.u8();
  assert.equal(r.remaining, food * 2);
});
