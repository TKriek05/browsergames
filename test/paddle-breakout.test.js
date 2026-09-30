// Paddle Party and Stenenbreker: bot games, rules, snapshots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import paddle from '../server/games/paddle.js';
import breakout from '../server/games/breakout.js';
import { stepPaddle } from '../shared/physics/paddle.js';
import { parseLevel, BRICK, BF, stepBreakoutPaddle } from '../shared/games/breakout.js';
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

test('paddles stay inside their range and are float32-exact', () => {
  const s = { p: 50 };
  for (let i = 0; i < 100; i++) stepPaddle(s, -1, DT, 20, 150);
  assert.equal(s.p, 20);
  for (let i = 0; i < 7; i++) stepPaddle(s, 0.37, DT, 20, 150);
  assert.equal(s.p, Math.fround(s.p));
  const b = { p: 160, wide: 1 };
  for (let i = 0; i < 40; i++) stepBreakoutPaddle(b, 1, DT);
  assert.equal(b.wide, 0);
  assert.equal(b.p, BF.width - BF.paddleW / 2);
});

test('paddle party: sides are assigned; a hard bot usually beats an easy one', () => {
  const four = paddle.create(fakeRoom([bot('p1', 0), bot('p2', 1), bot('p3', 2), bot('p4', 3)]), { lives: 3, seed: 1 });
  assert.deepEqual(four.ents.map((e) => e.side), [0, 1, 2, 3]);
  let hardWins = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const room = fakeRoom([bot('p1', 0, seed % 2 ? 'hard' : 'easy'), bot('p2', 1, seed % 2 ? 'easy' : 'hard')]);
    const game = paddle.create(room, { lives: 3, seed });
    run(game, room, 400);
    assert.ok(room.results, 'ended');
    const winner = room.results.rows[0].name;
    if ((seed % 2 && winner === 'Bot0') || (!(seed % 2) && winner === 'Bot1')) hardWins++;
  }
  assert.ok(hardWins >= 3, `hard bot won ${hardWins}/4`);
});

test('paddle party: a missed ball costs a life', () => {
  const room = fakeRoom([human('p1', 0), human('p2', 1)]);
  const game = paddle.create(room, { lives: 3, seed: 1 });
  run(game, room, 3.05);
  game.balls = [{ id: 9, x: 150, y: 150, vx: 0, vy: 120, wait: 0, speed: 120 }];
  game.ents[0].s.p = 30; // far away from the ball
  run(game, room, 0.6);
  assert.equal(game.ents[0].lives, 2);
  assert.ok(room.events.some((e) => e.e === 'goal' && e.s === 0));
});

test('stenenbreker: levels parse, bricks break and a bot team clears a level', () => {
  const lvl = parseLevel(0);
  assert.equal(lvl.length, BF.cols * BF.rows);
  assert.ok(lvl.includes(BRICK.TOUGH));
  const players = [bot('p1', 0, 'hard'), bot('p2', 1, 'hard')];
  const room = fakeRoom(players);
  const game = breakout.create(room, { seed: 4 });
  run(game, room, 240);
  assert.ok(room.events.filter((e) => e.e === 'brick').length > 40, 'lots of bricks broken');
  assert.ok(game.level >= 1 || room.results, 'first wall cleared');
});

test('stenenbreker: losing every ball ends the game', () => {
  const room = fakeRoom([human('p1', 0)]);
  const game = breakout.create(room, { seed: 5 });
  run(game, room, 60);
  assert.ok(room.results, 'a paddle that never moves loses all lives');
  assert.match(room.results.title, /gestrand/);
});

test('snapshots have the documented layout', () => {
  const r1 = fakeRoom([bot('p1', 0), human('p2', 2)]);
  const g1 = paddle.create(r1, { lives: 5, seed: 2 });
  run(g1, r1, 4);
  let w = new ByteWriter();
  g1.snapshot(w);
  let r = new ByteReader(w.toBytes());
  assert.equal(r.u8(), ARCADE_PHASE.PLAY);
  r.f32();
  assert.equal(r.u8(), 2);
  r.pos += 2 * 11;
  const balls = r.u8();
  assert.equal(r.remaining, balls * 7);

  const r2 = fakeRoom([bot('p1', 0), human('p2', 2)]);
  const g2 = breakout.create(r2, { seed: 2 });
  run(g2, r2, 4);
  w = new ByteWriter();
  g2.snapshot(w);
  r = new ByteReader(w.toBytes());
  assert.equal(r.u8(), ARCADE_PHASE.PLAY);
  r.f32(); r.u8(); r.u8(); r.u8();
  assert.equal(r.u8(), 2);
  r.pos += 2 * 14;
  const nb = r.u8();
  r.pos += nb * 8 + BF.cols * BF.rows;
  const caps = r.u8();
  assert.equal(r.remaining, caps * 5);
});

test('stenenbreker: a player away from the keys stops draining the lives quickly', () => {
  const room = fakeRoom([human('p1', 0), bot('p2', 1)]);
  const game = breakout.create(room, { seed: 5 });
  const e = game.ents.find((x) => !x.player.isBot);
  run(game, room, 4); // launched by itself
  const lose = (who) => {
    game.balls = game.balls.filter((b) => b.owner !== who);
    game._lost(who);
  };
  lose(e);
  assert.ok(e.launchIn <= 3, 'the first lost ball comes back quickly');
  game._launch(e); // … and launches by itself again (no key pressed)
  lose(e);
  assert.ok(game.balls.some((b) => b.owner === e && b.attached), 'a new ball waits on the paddle');
  assert.ok(e.launchIn > 10, `… for a long while after two misses in a row (${e.launchIn.toFixed(1)} s)`);
  const bot2 = game.ents.find((x) => x.player.isBot);
  bot2.misses = 5;
  lose(bot2);
  assert.ok(bot2.launchIn <= 3, 'bots launch as usual');
});
