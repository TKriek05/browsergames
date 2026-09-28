// Onthoud 'm and Mijnenveger: rules, hidden information, bots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import memory from '../shared/rules/memory.js';
import mines, { neighbours } from '../shared/rules/mines.js';
import memoryBot from '../server/ai/memory.js';
import minesBot from '../server/ai/mines.js';
import { createRng } from '../shared/rng.js';

test('memory: pairs stay yours and you go again; a miss passes the turn', () => {
  const rng = createRng(1);
  let s = memory.setup({ seats: 2, settings: { size: 'klein' }, rng });
  assert.equal(s.cards.length, 16);
  const pair = s.cards.indexOf(s.cards[0], 1);
  s = memory.apply(s, 0, { c: 0 }, rng).state;
  const r = memory.apply(s, 0, { c: pair }, rng);
  assert.equal(r.info.match, true);
  assert.equal(r.state.turn, 0, 'same player again');
  assert.equal(r.state.scores[0], 1);
  s = r.state;
  // Find two different unmatched cards.
  const a = s.owner.findIndex((o) => o === -1);
  const b = s.owner.findIndex((o, c) => o === -1 && s.cards[c] !== s.cards[a]);
  s = memory.apply(s, 0, { c: a }, rng).state;
  const miss = memory.apply(s, 0, { c: b }, rng);
  assert.equal(miss.info.match, false);
  assert.equal(miss.state.turn, 1);
  assert.deepEqual(miss.state.shown, [a, b], 'visible until the next flip');
  const next = memory.apply(miss.state, 1, { c: memory.legalMoves(miss.state, 1)[0].c }, rng).state;
  assert.deepEqual(next.shown, []);
});

test('memory: the view hides face-down cards', () => {
  const rng = createRng(2);
  const s = memory.setup({ seats: 2, settings: {}, rng });
  const v = memory.view(s, 0);
  assert.ok(v.cards.every((c) => c === null));
  const after = memory.apply(s, 0, { c: 3 }, rng).state;
  const v2 = memory.view(after, 1);
  assert.equal(v2.cards[3], s.cards[3]);
  assert.equal(v2.cards.filter((c) => c !== null).length, 1);
});

test('memory: a hard bot beats a forgetful one over a full game', () => {
  let hardWins = 0;
  for (let g = 0; g < 6; g++) {
    const rng = createRng(100 + g);
    let s = memory.setup({ seats: 2, settings: { size: 'normaal' }, rng });
    const levels = g % 2 ? ['easy', 'hard'] : ['hard', 'easy'];
    for (let i = 0; i < 500 && !memory.result(s); i++) {
      const seat = memory.toMove(s)[0];
      const move = memoryBot.pick(s, seat, levels[seat], rng);
      s = memory.apply(s, seat, move, rng).state;
    }
    const res = memory.result(s);
    assert.ok(res, 'game finished');
    const hardSeat = levels.indexOf('hard');
    if (res.winners.includes(hardSeat)) hardWins++;
  }
  assert.ok(hardWins >= 4, `hard bot won ${hardWins}/6`);
});

test('mines: first click is safe, zeros flood-fill, the view hides mines', () => {
  const rng = createRng(3);
  let s = mines.setup({ seats: 2, settings: { size: 'klein', lives: 3 } });
  const center = 4 * 9 + 4;
  const r = mines.apply(s, 0, { t: 'r', c: center }, rng);
  s = r.state;
  assert.equal(r.info.boom, undefined);
  assert.ok(r.info.n >= 9, 'at least the 3×3 block around the first click');
  for (const nb of neighbours(9, 9, center)) assert.equal(s.mines[nb], false);
  assert.equal(s.mines.filter(Boolean).length, 10);
  const v = mines.view(s, 1);
  assert.ok(!v.cells.includes('m') && !v.cells.includes('M'), 'no mines visible during play');
  assert.equal(v.cells.filter((c) => c !== null).length, r.info.n);
});

test('mines: a mine costs a life; flags block reveals; anyone may act (no turns)', () => {
  const rng = createRng(4);
  let s = mines.setup({ seats: 3, settings: { size: 'klein', lives: 2 } });
  assert.deepEqual(mines.toMove(s), [0, 1, 2]);
  s = mines.apply(s, 0, { t: 'r', c: 40 }, rng).state;
  const mine = s.mines.indexOf(true);
  s = mines.apply(s, 2, { t: 'f', c: mine }, rng).state;
  assert.equal(mines.isLegal(s, 1, { t: 'r', c: mine }), false, 'flagged');
  s = mines.apply(s, 1, { t: 'f', c: mine }, rng).state; // anyone can remove a flag
  s = mines.apply(s, 1, { t: 'r', c: mine }, rng).state;
  assert.equal(s.lives, 1);
  assert.equal(s.hits[1], 1);
  const other = s.mines.findIndex((m, c) => m && c !== mine);
  s = mines.apply(s, 0, { t: 'r', c: other }, rng).state;
  const res = mines.result(s);
  assert.ok(res && res.winners.length === 0, 'out of lives: everybody loses');
  assert.ok(mines.view(s, 0).cells.includes('m'), 'all mines shown at the end');
});

test('mines: hard bots clear a small field together', () => {
  let won = 0;
  for (let g = 0; g < 5; g++) {
    const rng = createRng(50 + g);
    let s = mines.setup({ seats: 2, settings: { size: 'klein', lives: 3 } });
    for (let i = 0; i < 400 && !mines.result(s); i++) {
      const seat = i % 2;
      const move = minesBot.pick(s, seat, 'hard', rng);
      if (!move || !mines.isLegal(s, seat, move)) continue;
      s = mines.apply(s, seat, move, rng).state;
    }
    if (mines.result(s)?.winners.length === 2) won++;
  }
  assert.ok(won >= 3, `won ${won}/5`);
});
