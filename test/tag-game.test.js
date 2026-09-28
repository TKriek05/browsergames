// The tag server module with a fake room: full game in fast-forward.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import tag, { PHASE } from '../server/games/tag.js';
import { ByteWriter, ByteReader } from '../shared/binary.js';
import { SIM_TICK_RATE } from '../shared/constants.js';

function fakeRoom(players) {
  const events = [];
  return {
    events,
    results: null,
    gamePlayers: () => players,
    now: () => 0,
    emit: (e, data) => events.push({ e, ...data }),
    endGame(results) { this.results = results; },
  };
}

const bot = (id, slot, level = 'normal') => ({ id, slot, name: `Bot${slot}`, color: slot, isBot: true, botLevel: level, connected: false });

test('a full bot-only game runs to the end with a ranking', () => {
  const players = [bot('p1', 0, 'hard'), bot('p2', 1), bot('p3', 2, 'easy'), bot('p4', 3)];
  const room = fakeRoom(players);
  const game = tag.create(room, { duration: 60, arena: 'pillars' });
  const dt = 1 / SIM_TICK_RATE;
  let ticks = 0;
  while (!room.results && ticks < 100 * SIM_TICK_RATE) {
    game.tick(dt);
    ticks++;
  }
  assert.ok(room.results, 'game ended');
  assert.equal(room.results.rows.length, 4);
  const times = room.results.rows.map((r) => parseFloat(r.values[0].replace(',', '.')));
  assert.deepEqual([...times].sort((a, b) => a - b), times, 'sorted by time as tagger');
  const total = times.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 60) < 1, `someone is always "it" (total ${total})`);
  assert.ok(room.events.some((e) => e.e === 'go'));
  assert.ok(room.events.some((e) => e.e === 'tag'), 'bots actually tag each other');
});

test('snapshot encoding has the documented layout', () => {
  const players = [bot('p1', 0), bot('p2', 4)];
  const game = tag.create(fakeRoom(players), { duration: 60, arena: 'open' });
  const w = new ByteWriter();
  game.snapshot(w);
  const r = new ByteReader(w.toBytes());
  assert.equal(r.u8(), PHASE.COUNTDOWN);
  assert.ok(r.f32() > 0);
  const itSlot = r.u8();
  assert.ok(itSlot === 0 || itSlot === 4);
  assert.equal(r.u8(), 2);
  assert.equal(r.u8(), 0, 'first runner slot');
  assert.equal(r.remaining, 26 + 27, 'rest of runner 1 + runner 2');
});

test('humans are only moved by their queued inputs', () => {
  const human = { id: 'p1', slot: 0, name: 'Mens', color: 0, isBot: false, connected: true };
  const game = tag.create(fakeRoom([human, bot('p2', 1)]), { duration: 60, arena: 'open' });
  const dt = 1 / SIM_TICK_RATE;
  for (let i = 0; i < 3 * SIM_TICK_RATE + 1; i++) game.tick(dt); // countdown
  const runner = game.runners.find((r) => r.player === human);
  const x0 = runner.x;
  game.tick(dt);
  assert.equal(runner.x, x0, 'no input, no movement');
  for (let seq = 1; seq <= 10; seq++) game.onInput(human, { seq, buttons: 0, ax: 1, ay: 0, aim: 0 });
  for (let i = 0; i < 10; i++) game.tick(dt);
  assert.ok(runner.x > x0);
  assert.equal(runner.queue.ackSeq, 10);
});
