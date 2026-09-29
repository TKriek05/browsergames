// Raak de Roos: arrow flight (gravity, wind), scoring, aiming for bots,
// the end/phase flow with human shots, moving targets and bot matches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import archery from '../server/games/archery.js';
import { ARC, WIND_MAX, endDistances, flyArrow, ringScore, solveAim, targetOffset } from '../shared/games/archery.js';

function fakeRoom(players) {
  const room = {
    events: [], results: null,
    gamePlayers: () => players,
    emit: (e, data) => room.events.push({ e, ...data }),
    endGame(results) { room.results = results; },
  };
  return room;
}
const bot = (id, slot, level = 'normal') => ({ id, slot, name: `Bot${slot}`, color: slot, isBot: true, botLevel: level });
const human = (id, slot) => ({ id, slot, name: `Mens${slot}`, color: slot, isBot: false, connected: true });
const run = (game, room, seconds) => {
  for (let i = 0; i < seconds * 10 && !room.results; i++) game.tick(0.1);
};

test('arrows drop with gravity, drift with the wind and fly faster at full draw', () => {
  const flat = flyArrow(30, 0, 0, 1, 0);
  assert.ok(flat.hit && flat.y < ARC.EYE, 'drops');
  assert.ok(Math.abs(flat.x) < 1e-9);
  const windy = flyArrow(30, 0, 0.05, 1, 5);
  assert.ok(windy.x > 0.05, `drifts with the wind (${windy.x.toFixed(3)} m)`);
  const weak = flyArrow(30, 0, 0.05, 0.4, 0);
  const strong = flyArrow(30, 0, 0.05, 1, 0);
  assert.ok(weak.t > strong.t && weak.y < strong.y);
  const ground = flyArrow(70, 0, -0.1, 1, 0);
  assert.equal(ground.hit, false);
  assert.equal(ground.y, 0);
  assert.ok(ground.z > 5 && ground.z < 70);
  const path = [];
  flyArrow(50, 0, 0.06, 1, 2, path);
  assert.ok(path.length > 5 && path[0][2] === 0 && path.at(-1)[2] === 50);
});

test('scoring: rings of 6.1 cm, X in the middle, nothing outside the face', () => {
  assert.deepEqual(ringScore(0, 0), { score: 10, x: true });
  assert.deepEqual(ringScore(0.04, 0), { score: 10, x: false });
  assert.equal(ringScore(0.07, 0).score, 9);
  assert.equal(ringScore(0, -0.6).score, 1);
  assert.equal(ringScore(0.5, 0.5).score, 0);
});

test('distances grow; the aim solver hits the middle with and without wind', () => {
  assert.deepEqual(endDistances(5), [18, 31, 44, 57, 70]);
  assert.equal(endDistances(1)[0], 30);
  for (const dist of [18, 44, 70]) {
    for (const wind of [0, -WIND_MAX.sterk, WIND_MAX.normaal]) {
      const aim = solveAim(dist, 0.2, ARC.TARGET_H, 1, wind);
      const r = flyArrow(dist, aim.yaw, aim.pitch, 1, wind);
      assert.ok(r.hit && Math.hypot(r.x - 0.2, r.y - ARC.TARGET_H) < 0.01, `${dist} m, wind ${wind}`);
    }
  }
});

function game(settings = {}, players = [human('p1', 0), human('p2', 1)]) {
  const room = fakeRoom(players);
  const g = archery.create(room, { seed: 3, ends: 3, wind: 'uit', moving: 'uit', ...settings });
  return { room, g, players };
}

test('an end: three arrows each, scored by the server, then the next end', () => {
  const { room, g, players } = game();
  assert.equal(g.phase, 'intro');
  assert.equal(g.shoot(g.archers.get('p1'), 0, 0, 1), null, 'not during the intro');
  run(g, room, ARC.INTRO_S + 0.1);
  assert.equal(g.phase, 'shoot');
  const aim = solveAim(g.distance, 0, ARC.TARGET_H, 1, g.wind);
  g.onInput(players[0], { yaw: aim.yaw, pitch: aim.pitch, draw: 1, t: g.endTime });
  const a = g.archers.get('p1');
  assert.equal(a.arrows.length, 1);
  assert.equal(a.arrows[0].s, 10);
  g.onInput(players[0], { yaw: aim.yaw, pitch: aim.pitch, draw: 1 });
  assert.equal(a.arrows.length, 1, 'wait between two arrows');
  run(g, room, ARC.ARROW_GAP_S + 0.1);
  g.onInput(players[0], { yaw: 0.25, pitch: aim.pitch, draw: 1 });
  assert.equal(a.arrows[1].s, 0, 'far off: a miss');
  run(g, room, ARC.ARROW_GAP_S + 0.1);
  g.onInput(players[0], { yaw: 'x', pitch: 0, draw: 1 });
  g.onInput(players[0], null);
  g.onInput(players[0], { yaw: aim.yaw, pitch: aim.pitch, draw: 1 });
  assert.equal(a.left, 0);
  g.onInput(players[0], { yaw: aim.yaw, pitch: aim.pitch, draw: 1 });
  assert.equal(a.arrows.length, 3, 'no fourth arrow');
  assert.ok(room.events.filter((e) => e.e === 'shot').length === 3);
  // The other player never shoots: the end closes when time is up.
  run(g, room, ARC.SHOOT_S);
  assert.equal(g.phase, 'score');
  assert.deepEqual(a.scores, [20]);
  run(g, room, ARC.SCORE_S + 0.1);
  assert.equal(g.end, 2);
  assert.ok(g.distance > 18);
  assert.equal(a.arrows.length, 0, 'new end, empty target');
  const snap = g.snapshot();
  assert.equal(snap.archers.length, 2);
  assert.equal(snap.archers[0].total, 20);
});

test('moving targets: the target is where it is when the arrow arrives', () => {
  const { room, g, players } = game({ moving: 'altijd' });
  run(g, room, ARC.INTRO_S + 1.05);
  const a = g.archers.get('p1');
  const t = g.endTime;
  const still = solveAim(g.distance, 0, ARC.TARGET_H, 1, 0);
  const tx = targetOffset(a.lane, t + still.t, true);
  const aim = solveAim(g.distance, tx, ARC.TARGET_H, 1, 0);
  const tx2 = targetOffset(a.lane, t + aim.t, true);
  const aim2 = solveAim(g.distance, tx2, ARC.TARGET_H, 1, 0);
  g.onInput(players[0], { yaw: aim2.yaw, pitch: aim2.pitch, draw: 1, t });
  assert.ok(a.arrows[0].s >= 9, `leading the target scores (${a.arrows[0].s})`);
  // A release time far in the past is not believed.
  run(g, room, ARC.ARROW_GAP_S + 0.1);
  g.onInput(players[0], { yaw: aim2.yaw, pitch: aim2.pitch, draw: 1, t: 0 });
  const shot = room.events.filter((e) => e.e === 'shot').at(-1);
  assert.ok(shot.t >= g.endTime - ARC.TIME_SLACK_S - 1e-9);
});

test('bot matches finish; better bots score more', () => {
  const totals = { easy: 0, hard: 0 };
  for (let seed = 1; seed <= 4; seed++) {
    const players = [bot('p1', 0, 'hard'), bot('p2', 1, 'easy'), bot('p3', 2, 'normal')];
    const room = fakeRoom(players);
    const g = archery.create(room, { seed, ends: 5, wind: 'normaal', moving: 'laatste' });
    run(g, room, 600);
    assert.ok(room.results, 'the match ends');
    assert.deepEqual(room.results.columns, ['Punten', 'Tienen', "X'en"]);
    assert.equal(g.archers.get('p1').scores.length, 5);
    totals.hard += g.archers.get('p1').total;
    totals.easy += g.archers.get('p2').total;
  }
  assert.ok(totals.hard > totals.easy, `hard ${totals.hard} > easy ${totals.easy}`);
});
