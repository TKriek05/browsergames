// Pesten: dealing, what may be played, every bully card, drawing, hidden
// hands and complete bot games for 2-6 players.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import rules, { canPlay, rankOf, suitOf, isJoker } from '../shared/rules/pesten.js';
import bot from '../server/ai/pesten.js';
import { createRng } from '../shared/rng.js';

// Card id helpers: suit 0-3 (harten, ruiten, klaveren, schoppen), rank 1-13.
const C = (suit, rank) => suit * 13 + rank - 1;
const total = (s) => s.hands.reduce((n, h) => n + h.length, 0) + s.deck.length + s.pile.length;

// A hand-made position: seat 0 to move, top card harten 5.
function position(hands, extra = {}) {
  return {
    n: hands.length, hands: hands.map((h) => h.slice()), deck: [C(3, 3), C(3, 4), C(3, 5), C(2, 9), C(2, 10), C(1, 4), C(1, 6), C(1, 9)],
    pile: [C(0, 5)], suit: 0, dir: 1, turn: 0, pending: 0, drew: false, moves: 0, over: null, ...extra,
  };
}
const play = (s, seat, card, suit) => rules.apply(s, seat, suit === undefined ? { type: 'play', card } : { type: 'play', card, suit }, createRng(1));

test('dealing: 7 cards each, 54 cards in total, a plain first card', () => {
  for (let seats = 2; seats <= 6; seats++) {
    const s = rules.setup({ seats, settings: {}, rng: createRng(seats) });
    assert.equal(s.hands.length, seats);
    for (const h of s.hands) assert.equal(h.length, 7);
    assert.equal(total(s), 54);
    const top = s.pile[0];
    assert.ok(!isJoker(top) && ![1, 2, 7, 8, 11].includes(rankOf(top)));
  }
  const small = rules.setup({ seats: 3, settings: { hand: 5, jokers: false }, rng: createRng(1) });
  assert.equal(small.hands[0].length, 5);
  assert.equal(total(small), 52);
});

test('same suit or rank; jack and joker go on anything', () => {
  const s = position([[C(0, 9), C(2, 5), C(2, 9), C(3, 11), 52], [C(1, 3)]]);
  assert.equal(canPlay(s, C(0, 9)), true, 'same suit');
  assert.equal(canPlay(s, C(2, 5)), true, 'same rank');
  assert.equal(canPlay(s, C(2, 9)), false);
  assert.equal(canPlay(s, C(3, 11)), true, 'jack');
  assert.equal(canPlay(s, 52), true, 'joker');
  const moves = rules.legalMoves(s, 0);
  assert.equal(moves.filter((m) => m.card === C(3, 11)).length, 4, 'a jack asks for one of four suits');
  assert.ok(moves.some((m) => m.type === 'draw'));
  assert.deepEqual(rules.legalMoves(s, 1), [], 'not your turn');
});

test('a 2 and a joker stack; drawing takes the whole pile of penalties', () => {
  let s = position([[C(0, 2), C(3, 1)], [C(1, 2), C(1, 13)], [52, C(2, 3)]]);
  s = play(s, 0, C(0, 2)).state;
  assert.equal(s.pending, 2);
  assert.equal(s.turn, 1);
  assert.equal(canPlay(s, C(1, 13)), false, 'only a 2 or a joker while cards are pending');
  s = play(s, 1, C(1, 2)).state;
  assert.equal(s.pending, 4);
  s = play(s, 2, 52).state;
  assert.equal(s.pending, 9);
  assert.equal(s.suit, -1, 'after a joker anything goes');
  const before = s.hands[0].length;
  const r = rules.apply(s, 0, { type: 'draw' }, createRng(2));
  assert.equal(r.state.hands[0].length, before + 9, 'the deck runs out: the pile (minus its top) is shuffled in');
  assert.deepEqual(r.state.pile, [52]);
  assert.equal(r.state.pending, 0);
  assert.equal(r.state.turn, 1);
  assert.equal(r.info.card, undefined, 'drawn cards stay secret');
  assert.equal(total(r.state), total(s));
});

test('7 plays again, 8 skips, ace reverses (with two players: again)', () => {
  let s = position([[C(0, 7), C(0, 8), C(0, 1), C(0, 3)], [C(1, 3)], [C(2, 3)], [C(3, 3)]]);
  let r = play(s, 0, C(0, 7));
  assert.equal(r.state.turn, 0);
  assert.equal(r.info.again, true);
  r = play(r.state, 0, C(0, 8));
  assert.equal(r.state.turn, 2, 'seat 1 has to wait');
  assert.equal(r.info.skip, 1);
  s = position([[C(0, 1), C(0, 3)], [C(1, 3)], [C(2, 3)], [C(3, 3)]]);
  r = play(s, 0, C(0, 1));
  assert.equal(r.state.dir, -1);
  assert.equal(r.state.turn, 3);
  const duo = position([[C(0, 1), C(0, 3)], [C(1, 3)]]);
  r = play(duo, 0, C(0, 1));
  assert.equal(r.state.turn, 0, 'two players: the ace means play again');
});

test('a jack asks for a suit', () => {
  const s = position([[C(3, 11), C(2, 4)], [C(1, 3), C(1, 5)]]);
  const r = play(s, 0, C(3, 11), 1);
  assert.equal(r.state.suit, 1);
  assert.equal(canPlay(r.state, C(1, 3)), true);
  assert.equal(canPlay(r.state, C(0, 11)), true);
  assert.equal(canPlay(r.state, C(2, 3)), false);
});

test('draw one: a card that fits may be played, otherwise the turn passes', () => {
  let s = position([[C(2, 9)], [C(1, 3)]], { deck: [C(0, 12)] });
  let r = rules.apply(s, 0, { type: 'draw' }, createRng(1));
  assert.equal(r.state.turn, 0, 'the drawn queen of hearts fits');
  assert.equal(r.state.drew, true);
  assert.deepEqual(rules.legalMoves(r.state, 0).map((m) => m.type).sort(), ['pass', 'play']);
  r = rules.apply(r.state, 0, { type: 'pass' }, createRng(1));
  assert.equal(r.state.turn, 1);
  s = position([[C(2, 9)], [C(1, 3)]], { deck: [C(3, 12)] });
  r = rules.apply(s, 0, { type: 'draw' }, createRng(1));
  assert.equal(r.info.pass, true);
  assert.equal(r.state.turn, 1);
});

test('the last card wins; the others are ranked by cards left', () => {
  const s = position([[C(0, 9)], [C(1, 3), C(1, 4), C(1, 5)], [C(2, 3)]]);
  const r = play(s, 0, C(0, 9));
  assert.deepEqual(r.state.over.winners, [0]);
  assert.deepEqual(r.state.over.ranking, [0, 2, 1]);
});

test('view: only your own hand; everything is open when it is over', () => {
  const s = rules.setup({ seats: 3, settings: {}, rng: createRng(4) });
  const v = rules.view(s, 1);
  assert.deepEqual(v.hand, s.hands[1]);
  assert.equal(v.hands, null);
  assert.deepEqual(v.counts, [7, 7, 7]);
  assert.equal(JSON.stringify(v).includes(JSON.stringify(s.hands[0])), false);
  assert.equal(rules.view(s, -1).hand, null);
});

test('bots of every level finish games for 2-6 players without losing cards', () => {
  for (let seats = 2; seats <= 6; seats++) {
    for (const level of ['easy', 'normal', 'hard']) {
      const rng = createRng(seats * 10 + level.length);
      let s = rules.setup({ seats, settings: {}, rng });
      let guard = 0;
      while (!rules.result(s) && guard++ < 2000) {
        const seat = rules.toMove(s)[0];
        const move = bot.pick(s, seat, level, rng);
        assert.ok(rules.legalMoves(s, seat).some((m) => JSON.stringify(m) === JSON.stringify(move)), `legal bot move ${JSON.stringify(move)}`);
        s = rules.apply(s, seat, move, rng).state;
        assert.equal(total(s), 54);
      }
      const res = rules.result(s);
      assert.ok(res, `${seats} players / ${level}: the game ends`);
      assert.equal(res.ranking.length, seats);
    }
  }
});

test('smarter bots win more often than easy ones', () => {
  let wins = 0;
  const games = 60;
  for (let g = 0; g < games; g++) {
    const rng = createRng(1000 + g);
    let s = rules.setup({ seats: 2, settings: {}, rng });
    const levels = g % 2 ? ['hard', 'easy'] : ['easy', 'hard'];
    while (!rules.result(s)) {
      const seat = rules.toMove(s)[0];
      s = rules.apply(s, seat, bot.pick(s, seat, levels[seat], rng), rng).state;
    }
    if (levels[rules.result(s).winners[0]] === 'hard') wins++;
  }
  assert.ok(wins > games * 0.55, `hard beats easy (${wins}/${games})`);
});

test('suits and ranks of the card ids', () => {
  assert.equal(suitOf(C(2, 11)), 2);
  assert.equal(rankOf(C(2, 11)), 11);
  assert.equal(isJoker(53), true);
});
