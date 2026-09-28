// Ruimtegolf: shooting, bunkers, bombs, bots and the snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import invaders from '../server/games/invaders.js';
import { INV, bunkerX } from '../shared/games/invaders.js';
import { ARCADE_PHASE } from '../shared/games/arcade.js';
import { BTN } from '../shared/messages.js';
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

test('a shot kills the alien above; a bomb wears the bunker away', () => {
  const me = human('p1', 0);
  const room = fakeRoom([me]);
  const game = invaders.create(room, { waves: 3, seed: 1 });
  run(game, room, 3.05);
  assert.equal(game.phase, ARCADE_PHASE.PLAY);
  game.bombs.length = 0;
  game.bombT = 99;
  const e = game.ents[0];
  e.s.p = game.alienX(3) + INV.alienW / 2; // under column 3
  game.onInput(me, { seq: 1, buttons: BTN.A, ax: 0, ay: 0, aim: 0 });
  run(game, room, 1.2);
  const kill = room.events.find((x) => x.e === 'kill');
  assert.ok(kill, 'hit an alien');
  assert.equal(game.aliens[(INV.rows - 1) * INV.cols + 3], 0, 'the lowest alien of that column');
  assert.ok(e.score > 0);

  const before = game.bunkers[1].reduce((a, b) => a + b, 0);
  game.bombs.push({ x: bunkerX(1) + 6, y: INV.bunkerY - 10, v: 80 });
  run(game, room, 0.5);
  assert.ok(game.bunkers[1].reduce((a, b) => a + b, 0) < before, 'bunker damaged');
});

test('bots play a short campaign and the game ends', () => {
  const room = fakeRoom([bot('p1', 0, 'hard'), bot('p2', 1, 'normal')]);
  const game = invaders.create(room, { waves: 2, seed: 3 });
  run(game, room, 600);
  assert.ok(room.results, 'ended');
  assert.ok(room.events.filter((x) => x.e === 'kill').length >= 50, 'at least one wave cleared');
});

test('snapshot encoding has the documented layout', () => {
  const room = fakeRoom([bot('p1', 0), human('p2', 3)]);
  const game = invaders.create(room, { waves: 5, seed: 2 });
  run(game, room, 5);
  const w = new ByteWriter();
  game.snapshot(w);
  const r = new ByteReader(w.toBytes());
  assert.equal(r.u8(), ARCADE_PHASE.PLAY);
  r.f32();
  assert.equal(r.u8(), 1, 'wave');
  assert.equal(r.u8(), 5);
  r.u8(); r.f32(); r.f32(); r.u8();
  r.pos += 7;
  assert.equal(r.u8(), 2);
  r.pos += 2 * 11;
  const shots = r.u8();
  r.pos += shots * 5;
  const bombs = r.u8();
  r.pos += bombs * 4 + INV.bunkers * 12;
  r.i16();
  assert.equal(r.remaining, 0);
});
