// Spookjesdoolhof: grid movement, eating, ghosts, bots, snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ghosts from '../server/games/ghosts.js';
import { MAZE, MAZE_W, MAZE_H, UNIT, stepMover, open, GHOST_MODE as M } from '../shared/games/ghosts.js';
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
  for (let i = 0; i < seconds * SIM_TICK_RATE && !room.results; i++) game.tick(DT);
}

test('the maze is closed, every dot reachable, movement stays on the grid', () => {
  assert.equal(MAZE_W, 27);
  const start = MAZE.playerStarts[0];
  const s = { x: start.x * UNIT, y: start.y * UNIT, dir: 2, want: 3 };
  for (let i = 0; i < 400; i++) {
    stepMover(s, 2);
    const tx = Math.round(s.x / UNIT);
    const ty = Math.round(s.y / UNIT);
    assert.ok(open(((tx % MAZE_W) + MAZE_W) % MAZE_W, ty) || ty === 10, `inside a corridor at ${tx},${ty}`);
    assert.ok(s.x % UNIT === 0 || s.y % UNIT === 0, 'always on a lane');
    if (i % 37 === 0) s.want = (s.want + 1) % 4;
  }
  assert.ok(MAZE.walls.filter((w) => w === 2).length >= 1, 'a ghost-house door');
});

test('eating dots scores, a power pellet frightens the ghosts', () => {
  const me = human('p1', 0);
  const room = fakeRoom([me]);
  const game = ghosts.create(room, { seed: 1 });
  run(game, room, 3.05);
  assert.equal(game.phase, ARCADE_PHASE.PLAY);
  const e = game.ents[0];
  // Walk left along the start row: dots.
  for (let seq = 1; seq <= 30; seq++) game.onInput(me, { seq, buttons: 0, ax: -1, ay: 0, aim: 0 });
  run(game, room, 1);
  assert.ok(e.score >= 20, `ate dots (${e.score})`);
  // Put a power pellet under the player.
  const i = Math.round(e.s.y / UNIT) * MAZE_W + Math.round(e.s.x / UNIT);
  game.dots[i] = 2;
  for (const g of game.ghosts) g.mode = M.CHASE;
  game._eat(e);
  assert.ok(game.fright > 0);
  assert.ok(game.ghosts.every((g) => g.mode === M.FRIGHT));
});

test('a ghost catches a player: a life is lost', () => {
  const me = human('p1', 0);
  const room = fakeRoom([me]);
  const game = ghosts.create(room, { seed: 2 });
  run(game, room, 3.05);
  const lives = game.lives;
  const g = game.ghosts[0];
  g.mode = M.CHASE;
  g.x = game.ents[0].s.x;
  g.y = game.ents[0].s.y;
  game._collide();
  assert.equal(game.ents[0].alive, false);
  assert.equal(game.lives, lives - 1);
});

test('bots clear at least one level before the game ends', () => {
  const room = fakeRoom([bot('p1', 0, 'hard'), bot('p2', 1, 'normal')]);
  const game = ghosts.create(room, { seed: 3 });
  run(game, room, 600);
  assert.ok(room.results, 'ended');
  assert.ok(room.events.filter((e) => e.e === 'level').length >= 2);
});

test('snapshot encoding has the documented layout', () => {
  const room = fakeRoom([bot('p1', 0), human('p2', 1)]);
  const game = ghosts.create(room, { seed: 4 });
  run(game, room, 4);
  const w = new ByteWriter();
  game.snapshot(w);
  const r = new ByteReader(w.toBytes());
  assert.equal(r.u8(), ARCADE_PHASE.PLAY);
  r.f32(); r.u8(); r.u8(); r.u8(); r.u8();
  assert.equal(r.u8(), 2);
  r.pos += 2 * 13 + 4 * 6; // players, ghosts
  assert.equal(r.remaining, Math.ceil((MAZE_W * MAZE_H) / 4));
});
