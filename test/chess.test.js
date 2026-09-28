// Schaken: perft on standard positions (move generator correctness), rules
// edge cases and the engine.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Position, START_FEN } from '../shared/chess/position.js';
import chess from '../shared/rules/chess.js';
import engine, { searchChess } from '../server/ai/chess.js';
import { chooseMove, shutdownAi } from '../server/ai/index.js';

after(() => shutdownAi());

// Reference numbers from the Chess Programming Wiki "Perft Results".
const PERFT = [
  ['startpositie', START_FEN, [20, 400, 8902, 197281]],
  ['Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['positie 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238, 674624]],
  ['positie 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467, 422333]],
  ['positie 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
];

for (const [name, fen, expected] of PERFT) {
  test(`perft ${name}`, () => {
    const pos = new Position(fen);
    expected.forEach((n, i) => assert.equal(pos.perft(i + 1), n, `depth ${i + 1}`));
    assert.equal(pos.fen(), fen, 'make/unmake restores the position exactly');
  });
}

const play = (sans, fen) => {
  let s = chess.setup();
  if (fen) s = { ...s, fen, seen: {} };
  for (const w of sans) {
    const seat = chess.toMove(s)[0];
    const [from, to, promo] = w.split(/[-=]/);
    const move = promo ? { from, to, promo } : { from, to };
    assert.ok(chess.isLegal(s, seat, move), `illegal: ${w}`);
    s = chess.apply(s, seat, move).state;
  }
  return s;
};

test('scholar\'s mate is checkmate, with Dutch notation', () => {
  const s = play(['e2-e4', 'e7-e5', 'f1-c4', 'b8-c6', 'd1-h5', 'g8-f6', 'h5-f7']);
  assert.deepEqual(chess.result(s).winners, [0]);
  assert.equal(chess.result(s).reason, 'Schaakmat');
  assert.deepEqual(s.moves, ['e4', 'e5', 'Lc4', 'Pc6', 'Dh5', 'Pf6', 'Dxf7#']);
});

test('stalemate is a draw', () => {
  // Kh8 has no moves after Qf7 (g8/g7/h7 covered) but is not in check.
  const s = play(['e7-f7'], '7k/4Q3/6K1/8/8/8/8/8 w - - 0 1');
  assert.equal(chess.result(s).draw, true);
  assert.equal(chess.result(s).reason, 'Pat');
});

test('castling, en passant and promotion', () => {
  let s = play(['e2-e4', 'a7-a6', 'g1-f3', 'a6-a5', 'f1-e2', 'a5-a4', 'e1-g1']);
  assert.match(s.fen, /RNBQ1RK1 b kq/);
  s = play(['e2-e4', 'a7-a6', 'e4-e5', 'd7-d5', 'e5-d6']);
  assert.ok(!s.fen.startsWith('rnbqkbnr/1pp1pppp/p2P4'.slice(0, 5)) || s.fen.includes('p2P4'), 'pawn on d6');
  assert.match(s.fen.split(' ')[0], /1pp1pppp\/p2P4/);
  const promo = play(['a7-a8=n'], '8/P6k/8/8/8/8/8/K7 w - - 0 1');
  assert.match(promo.fen, /^N7/);
  assert.equal(promo.moves[0], 'a8=P');
});

test('castling is illegal through check or after the rook moved', () => {
  const through = { ...chess.setup(), fen: 'r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1' };
  assert.ok(!chess.isLegal(through, 0, { from: 'e1', to: 'g1' }), 'f1 is attacked');
  assert.ok(chess.isLegal(through, 0, { from: 'e1', to: 'c1' }));
  const s = play(['h1-h2', 'a8-a7', 'h2-h1', 'a7-a8'], 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.ok(!chess.isLegal(s, 0, { from: 'e1', to: 'g1' }));
  assert.ok(chess.isLegal(s, 0, { from: 'e1', to: 'c1' }));
});

test('draws: repetition, fifty moves and insufficient material', () => {
  const rep = play(['g1-f3', 'g8-f6', 'f3-g1', 'f6-g8', 'g1-f3', 'g8-f6', 'f3-g1', 'f6-g8']);
  assert.equal(chess.result(rep).reason, 'Drie keer dezelfde stelling');
  const fifty = play(['a1-a2'], 'k7/8/8/8/8/8/8/R6K w - - 99 80');
  assert.match(chess.result(fifty).reason, /50 zetten/);
  const bare = play(['e4-a8'], 'r6k/8/8/8/4B3/8/8/7K w - - 0 1'); // K+L tegen K
  assert.match(chess.result(bare)?.reason ?? '', /materiaal/);
});

test('illegal moves are rejected (pinned piece, moving into check)', () => {
  const s = { ...chess.setup(), fen: '4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1' };
  assert.ok(!chess.isLegal(s, 0, { from: 'e2', to: 'd3' }), 'the bishop is pinned');
  assert.ok(!chess.isLegal(s, 0, { from: 'e1', to: 'e2' }));
  assert.ok(!chess.isLegal(s, 1, { from: 'e7', to: 'e6' }), 'not black\'s turn');
});

test('engine finds mate in one and wins material', async () => {
  const mate = searchChess('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', { depth: 3, timeMs: 1000 });
  assert.equal((mate.move >> 7) & 0x7f, 0x73, 'Td8#');
  const hanging = await chooseMove('chess', { fen: 'rnb1kbnr/pppp1ppp/8/4p1q1/3P4/2N5/PPP1PPPP/R1BQKBNR w KQkq - 0 1' }, 0, 'hard');
  assert.deepEqual(hanging, { from: 'c1', to: 'g5' }, 'takes the free queen');
  const t0 = performance.now();
  const m = engine.pick(chess.setup(), 0, 'normal', Math.random);
  assert.ok(chess.isLegal(chess.setup(), 0, m));
  assert.ok(performance.now() - t0 < 2500);
});
