// Minigolf: course data, ball physics, shots, water, scoring, bots, snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minigolf from '../server/games/minigolf.js';
import {
  HOLES, BALL_STATE, GIVE_UP_SCORE, MAX_STROKES, wallSegments, onCourse, simulateShot, stepBall, holeSet,
} from '../shared/games/minigolf.js';
import { bestShot, distanceField } from '../server/games/minigolf-bots.js';
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
function run(game, room, seconds, until = () => false) {
  for (let i = 0; i < seconds * SIM_TICK_RATE && !room.results && !until(); i++) game.tick(DT);
}

test('every hole: tee and cup on the course, the cup can be reached', () => {
  HOLES.forEach((hole, i) => {
    assert.ok(onCourse(hole, ...hole.tee), `${hole.name}: tee`);
    assert.ok(onCourse(hole, ...hole.cup), `${hole.name}: cup`);
    const field = distanceField(i);
    const cell = Math.floor(hole.tee[1] / 4) * 72 + Math.floor(hole.tee[0] / 4);
    assert.ok(Number.isFinite(field[cell]), `${hole.name}: cup reachable from the tee`);
  });
  assert.deepEqual(holeSet(3).length, 3);
  assert.deepEqual(holeSet(9), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('ball physics: straight putt sinks, too fast skips, walls bounce, water returns', () => {
  const hole = HOLES[0]; // straight lane from (65,80) to cup (212,80)
  const segs = wallSegments(hole);
  const good = simulateShot(hole, segs, 65, 80, 0, 0.62);
  assert.equal(good.sunk, true, 'firm straight putt drops');
  const weak = simulateShot(hole, segs, 65, 80, 0, 0.2);
  assert.equal(weak.sunk, false);
  assert.ok(weak.x > 65 && weak.x < 200, 'weak putt stops short');
  // Straight into the side wall: comes back, stays on the course.
  const ball = { x: 100, y: 80, vx: 0, vy: 200 };
  let bounced = false;
  for (let i = 0; i < 60 && !bounced; i++) bounced = stepBall(ball, hole, segs, 1 / 120) === 'wall';
  assert.ok(bounced && ball.vy < 0 && onCourse(hole, ball.x, ball.y));
  const water = HOLES[4];
  const splash = simulateShot(water, wallSegments(water), 55, 80, 0, 0.8);
  assert.equal(splash.water, true, 'straight through the pond');
});

test('a human shot rolls, water costs a penalty stroke, balls stop and sink', () => {
  const a = human('p1', 0);
  const room = fakeRoom([a]);
  const game = minigolf.create(room, { holes: 3, seed: 1 });
  game.onAction(a, { a: 0, p: 0.5 });
  assert.equal(game.ents[0].strokes, 0, 'no shots during the countdown');
  run(game, room, 3.05);
  assert.equal(game.phase, ARCADE_PHASE.PLAY);
  const e = game.ents[0];
  game.onAction(a, { a: 0, p: 'hard' });
  game.onAction(a, { a: Infinity, p: 1 });
  assert.equal(e.strokes, 0, 'invalid shots ignored');
  game.onAction(a, { a: 0, p: 0.2 });
  game.onAction(a, { a: 0, p: 1 }); // still rolling: ignored
  assert.equal(e.strokes, 1);
  assert.equal(e.state, BALL_STATE.ROLLING);
  run(game, room, 6, () => e.state !== BALL_STATE.ROLLING);
  assert.equal(e.state, BALL_STATE.REST);
  assert.ok(e.x > 65);
  // Putt it in from where it lies.
  const shot = bestShot(game.holeIndex, game.segs, e.x, e.y);
  game.onAction(a, shot);
  run(game, room, 6, () => e.state !== BALL_STATE.ROLLING);
  assert.equal(e.state, BALL_STATE.SUNK);
  assert.ok(room.events.some((ev) => ev.e === 'sink' && ev.s === 0));
  // Only player holed → the hole ends and the score is written down.
  run(game, room, 0.1);
  assert.equal(game.phase, ARCADE_PHASE.ROUND_END);
  assert.equal(e.scores[0], 2);

  // Hole 2 of this set is "Water overs": straight into the pond.
  run(game, room, 8, () => game.phase === ARCADE_PHASE.PLAY);
  assert.equal(game.holeNo, 1);
  assert.equal(game.hole.name, 'Water overs');
  game.onAction(a, { a: 0, p: 0.8 });
  run(game, room, 3, () => e.state !== BALL_STATE.ROLLING);
  assert.ok(room.events.some((ev) => ev.e === 'splash'));
  assert.equal(e.strokes, 2, 'shot + penalty');
  assert.deepEqual([e.x, e.y], game.hole.tee, 'back to where it was hit from');
});

test('stroke limit and time limit give the give-up score', () => {
  const a = human('p1', 0);
  const b = human('p2', 1);
  const room = fakeRoom([a, b]);
  const game = minigolf.create(room, { holes: 3, seed: 2 });
  run(game, room, 3.05);
  const ea = game.ents[0];
  for (let i = 0; i < MAX_STROKES; i++) {
    game.onAction(a, { a: Math.PI, p: 0.05 }); // tiny taps backwards
    run(game, room, 3, () => ea.state !== BALL_STATE.ROLLING);
  }
  assert.equal(ea.state, BALL_STATE.OUT);
  run(game, room, 95, () => game.phase !== ARCADE_PHASE.PLAY); // B never plays: time runs out
  assert.equal(game.phase, ARCADE_PHASE.ROUND_END);
  assert.deepEqual([ea.scores[0], game.ents[1].scores[0]], [GIVE_UP_SCORE, GIVE_UP_SCORE]);
});

test('bots play a full 6-hole round; hard beats easy; results and snapshot', () => {
  const room = fakeRoom([bot('p1', 0, 'hard'), bot('p2', 1, 'easy')]);
  const game = minigolf.create(room, { holes: 6, seed: 5 });
  // Snapshot mid-game decodes cleanly.
  run(game, room, 5);
  const w = new ByteWriter();
  game.snapshot(w);
  const bytes = w.toBytes();
  const r = new ByteReader(bytes);
  assert.equal(r.u8(), ARCADE_PHASE.PLAY);
  r.f32();
  assert.deepEqual([r.u8(), r.u8(), r.u8()], [0, 6, 0]);
  const n = r.u8();
  assert.equal(n, 2);
  for (let i = 0; i < n; i++) {
    r.u8(); r.u8(); r.f32(); r.f32(); r.u8(); r.u8();
    const k = r.u8();
    for (let j = 0; j < k; j++) r.u8();
  }
  assert.equal(r.pos, bytes.length, 'snapshot fully read');

  run(game, room, 900);
  assert.ok(room.results, 'game finished');
  const rows = room.results.rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Bot0', 'hard bot wins');
  const total = Number(rows[0].values[0]);
  assert.ok(total >= 6 && total <= 6 * GIVE_UP_SCORE);
  assert.match(rows[0].values[1], /^(par|[+-]\d+)$/);
});
