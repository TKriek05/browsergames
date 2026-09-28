// Quizkoorts: the question bank, picking questions, scoring, hidden answers
// until the reveal, bots and a full quiz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import quiz, { pickQuestions } from '../server/games/quiz.js';
import { QUESTIONS, QUIZ_CATEGORIES } from '../server/games/quiz-questions.js';
import { getGame } from '../shared/catalog.js';
import { createRng } from '../shared/rng.js';

function fakeRoom(players) {
  const room = {
    events: [], results: null,
    gamePlayers: () => players,
    emit: (e, data) => room.events.push({ e, ...data }),
    endGame(results) { room.results = results; },
  };
  return room;
}
const human = (id, slot) => ({ id, slot, name: `Mens${slot}`, color: slot, isBot: false, connected: true });
const bot = (id, slot, level) => ({ id, slot, name: `Bot${slot}`, color: slot, isBot: true, botLevel: level });
const run = (game, seconds) => {
  for (let i = 0; i < seconds * 10; i++) game.tick(0.1);
};
const runUntil = (game, until, maxSeconds = 60) => {
  for (let i = 0; i < maxSeconds * 10 && !until(); i++) game.tick(0.1);
};

test('question bank: four different answers, known categories, enough per category', () => {
  const counts = {};
  for (const q of QUESTIONS) {
    assert.equal(q.length, 6, q[1]);
    assert.ok(QUIZ_CATEGORIES.includes(q[0]), q[0]);
    assert.equal(new Set(q.slice(2)).size, 4, `unique answers: ${q[1]}`);
    for (const s of q) assert.ok(typeof s === 'string' && s.length > 0 && s.length <= 200);
    counts[q[0]] = (counts[q[0]] ?? 0) + 1;
  }
  for (const c of QUIZ_CATEGORIES) assert.ok(counts[c] >= 15, `${c}: ${counts[c]} questions`);
  const setting = getGame('quiz').settings.find((s) => s.key === 'category');
  assert.deepEqual(setting.options.slice(1).map((o) => o.value), QUIZ_CATEGORIES, 'catalog categories match the bank');
});

test('picked questions keep the right answer after shuffling', () => {
  const qs = pickQuestions(createRng(3), 20, 'Wetenschap');
  assert.equal(qs.length, 20);
  for (const q of qs) {
    const src = QUESTIONS.find((x) => x[1] === q.text);
    assert.equal(q.category, 'Wetenschap');
    assert.equal(q.answers[q.correct], src[2]);
    assert.deepEqual([...q.answers].sort(), src.slice(2).sort());
  }
  assert.equal(new Set(qs.map((q) => q.text)).size, 20, 'no duplicates');
});

test('answers stay secret until the reveal; fast and right scores most', () => {
  const a = human('p1', 0);
  const b = human('p2', 1);
  const room = fakeRoom([a, b]);
  const game = quiz.create(room, { count: 3, time: 10, category: 'alles', seed: 7 });
  run(game, 4.1); // intro
  assert.equal(game.phase, 'ask');
  const right = game.questions[0].correct;
  game.onInput(a, { type: 'answer', a: right });
  let snap = game.snapshot(b);
  assert.equal(snap.correct, -1, 'no right answer before the reveal');
  assert.equal(snap.players.find((p) => p.id === 'p1').pick, -1, 'other picks are hidden');
  assert.equal(snap.players.find((p) => p.id === 'p1').answered, true);
  assert.equal(game.snapshot(a).mine, right);
  game.onInput(a, { type: 'answer', a: (right + 1) % 4 });
  assert.equal(game.entries.get('p1').answer, right, 'the first answer counts');
  run(game, 3);
  game.onInput(b, { type: 'answer', a: right });
  run(game, 1); // both answered: early reveal
  assert.equal(game.phase, 'reveal');
  snap = game.snapshot(b);
  assert.equal(snap.correct, right);
  const pa = snap.players.find((p) => p.id === 'p1');
  const pb = snap.players.find((p) => p.id === 'p2');
  assert.ok(pa.gain > pb.gain, 'the faster one gets more');
  assert.ok(pa.gain > 900 && pb.gain >= 500);
  game.onInput(b, { type: 'answer', a: 0 });
  game.onInput(b, { type: 'answer', a: 9 });
  game.onInput(b, null);
});

test('a wrong answer scores nothing and breaks the streak', () => {
  const a = human('p1', 0);
  const room = fakeRoom([a]);
  const game = quiz.create(room, { count: 3, time: 10, seed: 1 });
  run(game, 4.1);
  game.onInput(a, { type: 'answer', a: game.questions[0].correct });
  runUntil(game, () => game.phase === 'ask' && game.q === 1);
  assert.equal(game.entries.get('p1').streak, 1);
  game.onInput(a, { type: 'answer', a: (game.questions[1].correct + 1) % 4 });
  runUntil(game, () => game.phase === 'reveal');
  const e = game.entries.get('p1');
  assert.equal(e.streak, 0);
  assert.equal(e.gain, 0);
  assert.equal(e.correct, 1);
});

test('bots answer in time and hard bots are right more often', () => {
  const tally = { easy: 0, hard: 0 };
  for (let seed = 0; seed < 6; seed++) {
    const players = [bot('p1', 0, 'easy'), bot('p2', 1, 'hard'), human('p3', 2)];
    const room = fakeRoom(players);
    const game = quiz.create(room, { count: 10, time: 10, seed });
    run(game, 200);
    assert.ok(room.results, 'the quiz ends');
    tally.easy += game.entries.get('p1').correct;
    tally.hard += game.entries.get('p2').correct;
    assert.equal(room.results.rows.length, 3);
    assert.deepEqual(room.results.columns, ['Punten', 'Goed']);
  }
  assert.ok(tally.hard > tally.easy, `hard ${tally.hard} vs easy ${tally.easy}`);
});

test('late joiners get a place on the scoreboard', () => {
  const room = fakeRoom([human('p1', 0)]);
  const game = quiz.create(room, { count: 2, time: 10 });
  run(game, 5);
  game.onJoin(bot('p2', 1, 'normal'));
  run(game, 11);
  assert.ok(game.entries.get('p2').answer >= 0 || game.phase !== 'ask', 'the bot answered the running question');
  assert.equal(game.snapshot(null).players.length, 2);
});
