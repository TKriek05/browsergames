// Unit tests for pure shared modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeName } from '../shared/names.js';
import { ByteWriter, ByteReader, encodeInput, decodeInput, seqDiff, seqNewer, quantizeAxis, INPUT_BYTES } from '../shared/binary.js';
import { normalizeSettings, defaultSettings } from '../shared/settings.js';
import { checkCanStart } from '../shared/lobbyrules.js';
import { CATALOG } from '../shared/catalog.js';
import { GAME_LIMITS, ROOM_CODE_ALPHABET, PROTOCOL_VERSION } from '../shared/constants.js';
import { BIN } from '../shared/messages.js';

test('sanitizeName strips invisible chars, bidi tricks and limits length', () => {
  assert.equal(sanitizeName('  Timon  '), 'Timon');
  assert.equal(sanitizeName('Ti​mon'), 'Timon');
  assert.equal(sanitizeName('evil‮gnp.exe'), 'evilgnp.exe');
  assert.equal(sanitizeName('a\n\tb'), 'a b');
  assert.equal(sanitizeName('x'.repeat(50)).length, 16);
  assert.equal(sanitizeName('<b>hoi</b>'), '<b>hoi</b>', 'HTML stays text; the UI uses textContent');
  assert.equal(sanitizeName(42), '');
  assert.equal(sanitizeName('é́́́́').length <= 3, true, 'zalgo marks are capped');
  assert.equal(sanitizeName('kankerlijer'), '', 'word filter hook');
});

test('ByteWriter/ByteReader round trip', () => {
  const w = new ByteWriter(2); // forces growth
  w.u8(255).i8(-5).u16(65535).i16(-1234).u32(4000000000).f32(1.5).f64(Math.PI);
  const r = new ByteReader(w.toBytes());
  assert.deepEqual([r.u8(), r.i8(), r.u16(), r.i16(), r.u32(), r.f32(), r.f64()], [255, -5, 65535, -1234, 4000000000, 1.5, Math.PI]);
  assert.equal(r.remaining, 0);
});

test('input packets encode/decode exactly like the prediction expects', () => {
  const w = new ByteWriter();
  const input = { ax: 0.7071, ay: -1, buttons: 5, aim: 1.2 };
  const bytes = encodeInput(w, 65535, input);
  assert.equal(bytes.length, INPUT_BYTES);
  const r = new ByteReader(bytes);
  assert.equal(r.u8(), BIN.INPUT);
  assert.equal(r.u8(), PROTOCOL_VERSION);
  const out = {};
  assert.ok(decodeInput(r, out));
  assert.equal(out.seq, 65535);
  assert.equal(out.buttons, 5);
  assert.equal(out.ax, quantizeAxis(0.7071));
  assert.equal(out.ay, -1);
  assert.ok(Math.abs(out.aim - 1.2) < 0.001);
  // Malformed (too short) packets are rejected.
  const bad = new ByteReader(new Uint8Array([BIN.INPUT, PROTOCOL_VERSION, 1, 2]));
  bad.u8(); bad.u8();
  assert.equal(decodeInput(bad, {}), false);
  // NaN/Infinity are neutralised.
  const r2 = new ByteReader(encodeInput(w, 1, { ax: NaN, ay: Infinity, buttons: 0, aim: 0 }));
  r2.u8(); r2.u8();
  const o2 = {};
  decodeInput(r2, o2);
  assert.equal(o2.ax, 0);
});

test('sequence numbers wrap around correctly', () => {
  assert.equal(seqNewer(1, 0), true);
  assert.equal(seqNewer(0, 65535), true, 'wrap');
  assert.equal(seqNewer(65535, 0), false);
  assert.equal(seqDiff(5, 65530), 11);
});

test('settings are validated against the catalog schema', () => {
  assert.deepEqual(defaultSettings('tag'), { duration: 90, arena: 'pillars' });
  assert.deepEqual(normalizeSettings('tag', { duration: 60, arena: 'maze' }), { duration: 60, arena: 'maze' });
  assert.deepEqual(normalizeSettings('tag', { duration: 61, arena: '<script>', evil: 1 }), { duration: 90, arena: 'pillars' });
  assert.deepEqual(normalizeSettings('tag', { duration: '60' }, { duration: 120, arena: 'open' }), { duration: 120, arena: 'open' });
  assert.deepEqual(normalizeSettings('nope', { a: 1 }), {});
});

test('catalog and limits are consistent', () => {
  for (const [id, g] of Object.entries(CATALOG)) {
    assert.ok(GAME_LIMITS[id], `limits for ${id}`);
    assert.ok(g.min >= 1 && g.max <= 6 && g.min <= g.max, `sane limits for ${id}`);
    assert.ok(g.title && g.tagline, `texts for ${id}`);
  }
  assert.equal(CATALOG.chess.max, 2);
  assert.equal(CATALOG.ludo.max, 4);
  assert.equal(CATALOG.goose.max, 6);
  assert.ok(!/[ILO01]/.test(ROOM_CODE_ALPHABET));
});

test('checkCanStart explains why a game cannot start', () => {
  const room = (players) => ({ game: 'tag', state: 'lobby', hostId: 'p1', players });
  const host = { id: 'p1', name: 'Host', role: 'player', ready: false, bot: null, connected: true };
  assert.equal(checkCanStart(room([host])).ok, false, 'needs 2 players');
  const guest = { id: 'p2', name: 'Sanne', role: 'player', ready: false, bot: null, connected: true };
  const r1 = checkCanStart(room([host, guest]));
  assert.equal(r1.ok, false);
  assert.match(r1.reason, /Sanne/);
  assert.equal(checkCanStart(room([host, { ...guest, ready: true }])).ok, true);
  assert.equal(checkCanStart(room([host, { id: 'p3', name: 'Bliep', role: 'player', ready: true, bot: 'easy', connected: true }])).ok, true, 'solo with a bot');
  assert.equal(checkCanStart(room([host, { ...guest, connected: false }])).ok, true, 'disconnected players do not block');
});
