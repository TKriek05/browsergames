// Unit tests for server building blocks: protocol validation, rate limits,
// input queue and the shared tag physics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJson, parseBinary, encode } from '../server/protocol.js';
import { TokenBucket, IpLimiter } from '../server/ratelimit.js';
import { InputQueue } from '../server/inputqueue.js';
import { stepRunner, TAG_PHYS, touching } from '../shared/physics/tag.js';
import { TAG_FIELD, TAG_ARENAS } from '../shared/maps/tag-arenas.js';
import { PROTOCOL_VERSION } from '../shared/constants.js';

const msg = (obj) => JSON.stringify({ v: PROTOCOL_VERSION, ...obj });

test('parseJson accepts valid messages and copies only known fields', () => {
  const r = parseJson(msg({ t: 'join', code: 'KXQF', name: 'Timon', extra: 'x', token: 'A'.repeat(24) }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.msg, { t: 'join', code: 'KXQF', name: 'Timon', token: 'A'.repeat(24) });
});

test('encode: payload fields can never overwrite the message type or version', () => {
  const out = JSON.parse(encode('event', { e: 'shot', t: 1.5, v: 99, x: 3 }));
  assert.equal(out.t, 'event');
  assert.equal(out.v, PROTOCOL_VERSION);
  assert.equal(out.e, 'shot');
  assert.equal(out.x, 3);
});

test('parseJson rejects hostile input', () => {
  const cases = [
    '{nope',
    '[1,2,3]',
    'null',
    msg({ t: 'teleport' }),
    msg({ t: 'join', code: 'KXQO', name: 'x' }), // O is not in the alphabet
    msg({ t: 'join', code: 'kxqf', name: 'x' }),
    msg({ t: 'ready', ready: 'yes' }),
    msg({ t: 'react', r: 99 }),
    msg({ t: 'ping', c: 'now' }),
    msg({ t: 'kick', id: '../../etc' }),
    msg({ t: 'input', data: { a: { b: { c: { d: { e: { f: 1 } } } } } } }), // too deep
    msg({ t: 'input', data: JSON.parse('{"__proto__": {"polluted": true}}') }),
    msg({ t: 'create', game: 'tag', name: 'x'.repeat(500) }),
  ];
  for (const raw of cases) assert.equal(parseJson(raw).ok, false, raw.slice(0, 60));
  assert.equal({}.polluted, undefined);
});

test('parseJson reports version mismatches separately', () => {
  const r = parseJson(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION + 1 }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'version');
});

test('parseBinary only accepts input frames of the right version', () => {
  assert.equal(parseBinary(Buffer.from([1, PROTOCOL_VERSION, 0, 0])).ok, true);
  assert.equal(parseBinary(Buffer.from([2, PROTOCOL_VERSION, 0, 0])).ok, false, 'clients may not send snapshots');
  assert.equal(parseBinary(Buffer.from([1, 99])).reason, 'version');
  assert.equal(parseBinary(Buffer.alloc(1000)).ok, false);
});

test('TokenBucket refills over time', () => {
  const b = new TokenBucket(10, 2, 0);
  assert.equal(b.take(1, 0), true);
  assert.equal(b.take(1, 0), true);
  assert.equal(b.take(1, 0), false);
  assert.equal(b.take(1, 100), true, 'one token after 100 ms at 10/s');
});

test('IpLimiter limits concurrent connections and room creation', () => {
  const l = new IpLimiter({ maxConnPerIp: 2, maxRoomsPerIp: 1, connectPerMinute: 600, roomsPerMinute: 600 });
  assert.equal(l.checkConnect('1.1.1.1'), null);
  l.addConnection('1.1.1.1');
  l.addConnection('1.1.1.1');
  assert.ok(l.checkConnect('1.1.1.1'));
  assert.equal(l.checkConnect('2.2.2.2'), null);
  l.removeConnection('1.1.1.1');
  assert.equal(l.checkConnect('1.1.1.1'), null);
  assert.equal(l.checkCreateRoom('1.1.1.1'), null);
  l.addRoom('1.1.1.1');
  assert.ok(l.checkCreateRoom('1.1.1.1'));
});

test('InputQueue applies at most one input per tick on average (no speed hacks)', () => {
  const q = new InputQueue();
  for (let seq = 1; seq <= 12; seq++) q.push({ seq, buttons: 0, ax: 1, ay: 0, aim: 0 });
  let applied = 0;
  for (let tick = 0; tick < 4; tick++) {
    q.beginTick();
    while (q.next()) applied++;
  }
  assert.ok(applied <= 4 + 1, `applied ${applied} inputs in 4 ticks`);
  // Duplicates and old inputs are ignored.
  const q2 = new InputQueue();
  q2.push({ seq: 5, buttons: 0, ax: 0, ay: 0, aim: 0 });
  q2.push({ seq: 5, buttons: 0, ax: 0, ay: 0, aim: 0 });
  q2.push({ seq: 3, buttons: 0, ax: 0, ay: 0, aim: 0 });
  assert.equal(q2.count, 1);
  q2.beginTick();
  assert.equal(q2.next().seq, 5);
  assert.equal(q2.ackSeq, 5);
});

test('InputQueue catches up after a network hiccup', () => {
  const q = new InputQueue();
  for (let t = 0; t < 3; t++) q.beginTick(); // 3 ticks without input
  for (let seq = 1; seq <= 3; seq++) q.push({ seq, buttons: 0, ax: 0, ay: 0, aim: 0 });
  q.beginTick();
  let n = 0;
  while (q.next()) n++;
  assert.equal(n, 3);
});

test('tag physics is deterministic and stays inside the field', () => {
  const walls = TAG_ARENAS.pillars.walls;
  const run = () => {
    const s = { x: 30, y: 20, vx: 0, vy: 0, stun: 0 };
    for (let i = 0; i < 600; i++) stepRunner(s, Math.sin(i / 17), Math.cos(i / 23), TAG_PHYS.DT, walls, i % 2 === 0);
    return s;
  };
  const a = run();
  const b = run();
  assert.deepEqual(a, b);
  assert.ok(a.x >= TAG_PHYS.RADIUS && a.x <= TAG_FIELD.width - TAG_PHYS.RADIUS);
  assert.ok(a.y >= TAG_PHYS.RADIUS && a.y <= TAG_FIELD.height - TAG_PHYS.RADIUS);
  // Values are float32-exact, so they survive the snapshot encoding unchanged.
  assert.equal(a.x, Math.fround(a.x));
});

test('tag physics: walls block and speed is capped', () => {
  const walls = [{ x: 100, y: 0, w: 20, h: 180 }];
  const s = { x: 80, y: 90, vx: 0, vy: 0, stun: 0 };
  for (let i = 0; i < 120; i++) stepRunner(s, 1, 0, TAG_PHYS.DT, walls, false);
  assert.ok(s.x <= 100 - TAG_PHYS.RADIUS + 0.01, `stopped at the wall, x=${s.x}`);
  const free = { x: 20, y: 20, vx: 0, vy: 0, stun: 0 };
  for (let i = 0; i < 60; i++) stepRunner(free, 1, 1, TAG_PHYS.DT, [], false);
  assert.ok(Math.hypot(free.vx, free.vy) <= TAG_PHYS.MAX_SPEED + 0.01);
  const stunned = { x: 50, y: 50, vx: 0, vy: 0, stun: 0.5 };
  stepRunner(stunned, 1, 0, TAG_PHYS.DT, [], false);
  assert.equal(stunned.x, 50, 'stunned runners ignore input');
  assert.ok(touching({ x: 0, y: 0 }, { x: 9, y: 0 }));
  assert.ok(!touching({ x: 0, y: 0 }, { x: 11, y: 0 }));
});
