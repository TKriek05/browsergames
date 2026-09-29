// Background music: every game has a track, songs are deterministic and
// musically sane (notes in the scale, sensible ranges, well-formed patterns).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableGameIds } from '../shared/party.js';
import { STYLES, GAME_MUSIC, trackFor, seedOf } from '../public/js/core/music-tracks.js';
import { buildSong, parsePattern, degreeToMidi, SCALES, STEPS_PER_BAR } from '../public/js/core/music-song.js';

const events = (song, kind) => song.steps.flatMap((list, at) => list.filter((e) => e.i === kind).map((e) => ({ ...e, at })));

test('every playable game has its own track', () => {
  for (const id of availableGameIds()) {
    const track = trackFor(id);
    assert.ok(track, `${id} has music`);
    assert.ok(STYLES[track.style], `${id}: known style`);
    assert.ok(SCALES[track.scale], `${id}: known scale`);
  }
  for (const id of Object.keys(GAME_MUSIC)) assert.ok(availableGameIds().includes(id), `${id} is a real game`);
  assert.equal(trackFor('nope'), null);
  assert.notEqual(seedOf('snake'), seedOf('paddle'));
});

test('patterns are one bar long and parse into hits with holds', () => {
  assert.deepEqual(parsePattern('0--2..x-'), [{ at: 0, len: 3, ch: '0' }, { at: 3, len: 1, ch: '2' }, { at: 6, len: 2, ch: 'x' }]);
  for (const [name, s] of Object.entries(STYLES)) {
    for (const key of ['bassPattern', 'arpPattern', 'padPattern']) {
      if (s[key]) assert.equal(s[key].length, STEPS_PER_BAR, `${name}.${key}`);
    }
    for (const [kind, p] of Object.entries(s.drums ?? {})) assert.equal(p.length, STEPS_PER_BAR, `${name}.drums.${kind}`);
    if (s.fill) assert.equal(s.fill.length, 4, `${name}.fill`);
    assert.ok((s.bars ?? 8) % 2 === 0, 'melodies come in two-bar phrases');
  }
});

test('songs are deterministic, and games of the same style still differ', () => {
  const a = buildSong(trackFor('snake'), seedOf('snake'));
  const b = buildSong(trackFor('snake'), seedOf('snake'));
  assert.deepEqual(a, b);
  const lead = (id) => events(buildSong(trackFor(id), seedOf(id)), 'lead').map((e) => e.n).join(',');
  assert.notEqual(lead('snake'), lead('breakout'));
  assert.notEqual(lead('tictactoe'), lead('connect4'));
});

test('notes stay in the key and in a sensible range', () => {
  for (const id of availableGameIds()) {
    const track = trackFor(id);
    const song = buildSong(track, track.seed);
    assert.equal(song.length, (track.bars ?? 8) * STEPS_PER_BAR);
    assert.ok(song.bpm >= 60 && song.bpm <= 180, `${id}: tempo`);
    const scale = SCALES[track.scale];
    const inKey = (n) => scale.includes((((n - track.root) % 12) + 12) % 12);
    const lead = events(song, 'lead');
    assert.ok(lead.length >= 16, `${id}: a real melody (${lead.length} notes)`);
    for (const e of lead) {
      assert.ok(inKey(e.n), `${id}: lead note ${e.n} in the scale`);
      assert.ok(e.n >= 55 && e.n <= 100, `${id}: lead note ${e.n} in range`);
      assert.ok(e.d >= 1 && e.at + e.d <= song.length + STEPS_PER_BAR, `${id}: lead length`);
    }
    // The loop ends on the tonic, so it lands before it starts over.
    const last = lead.at(-1);
    assert.equal((((last.n - track.root) % 12) + 12) % 12, 0, `${id}: ends on the tonic`);
    for (const e of events(song, 'bass')) assert.ok(e.n >= 30 && e.n <= 70, `${id}: bass note ${e.n}`);
    for (const e of events(song, 'pad')) for (const n of e.n) assert.ok(inKey(n), `${id}: chord note ${n} in the scale`);
    assert.ok(song.steps.some((list) => list.length), `${id}: not silent`);
  }
});

test('degreeToMidi walks the scale across octaves', () => {
  const maj = SCALES.major;
  assert.equal(degreeToMidi(60, maj, 0), 60);
  assert.equal(degreeToMidi(60, maj, 2), 64);
  assert.equal(degreeToMidi(60, maj, 7), 72);
  assert.equal(degreeToMidi(60, maj, -1), 59);
  assert.equal(degreeToMidi(60, maj, -7), 48);
});
