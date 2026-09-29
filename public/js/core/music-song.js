// Procedural songs: turns a style (tempo, scale, chords, patterns, sounds)
// and a seed into a loop of note events on a 16th-note grid. Pure and
// deterministic (same seed = same song); the WebAudio side is music.js.
//
// Pattern strings have one character per 16th note (16 per bar):
//   '.' rest, '-' hold the previous note, 'x' hit, 'o' soft hit,
//   bass/arp digits pick a chord tone (0 root, 1 third, 2 fifth, 3 root up an
//   octave, 4 third up, 5 fifth up), 'a' = a half step below the next chord's root.
import { createRng } from '../../../shared/rng.js';

export const STEPS_PER_BAR = 16;

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

const DRUMS = ['kick', 'snare', 'hat', 'ohat', 'clap', 'ride', 'shaker'];

// Scale degree (may be negative or past the octave) → MIDI note.
export function degreeToMidi(root, scale, d) {
  const n = scale.length;
  return root + Math.floor(d / n) * 12 + scale[((d % n) + n) % n];
}

const chordTones = (c, seventh) => (seventh ? [c, c + 2, c + 4, c + 6] : [c, c + 2, c + 4]);

// Reads a pattern: [{ at, len, ch }] for every non-rest character.
export function parsePattern(pattern) {
  const out = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '.' || ch === '-') continue;
    let len = 1;
    while (pattern[i + len] === '-') len++;
    out.push({ at: i, len, ch });
  }
  return out;
}

export function buildSong(style, seed) {
  const rng = createRng(seed);
  const scale = SCALES[style.scale] ?? SCALES.major;
  const bars = style.bars ?? 8;
  const length = bars * STEPS_PER_BAR;
  const steps = Array.from({ length }, () => []);
  const add = (step, ev) => steps[step % length].push(ev);
  const chordAt = (bar) => style.chords[bar % style.chords.length];
  const note = (oct, d) => degreeToMidi(style.root + oct * 12, scale, d);

  for (let bar = 0; bar < bars; bar++) {
    const base = bar * STEPS_PER_BAR;
    const chord = chordTones(chordAt(bar), style.seventh);
    const tone = (oct, k) => note(oct + Math.floor(k / 3), chord[k % 3]);

    // Chords: whole bar, or the comping rhythm of the pad pattern.
    if (style.pad) {
      const hits = parsePattern(style.padPattern ?? 'x---------------');
      for (const hit of hits) add(base + hit.at, { i: 'pad', n: chord.map((d) => note(style.pad.oct, d)), d: hit.len, v: hit.ch === 'o' ? 0.6 : 1 });
    }
    if (style.bass) {
      for (const hit of parsePattern(style.bassPattern)) {
        let n;
        if (hit.ch === 'a') n = note(style.bass.oct, chordAt(bar + 1)) - 1;
        else n = tone(style.bass.oct, Number(hit.ch));
        add(base + hit.at, { i: 'bass', n, d: hit.len, v: 1 });
      }
    }
    if (style.arp) {
      for (const hit of parsePattern(style.arpPattern)) add(base + hit.at, { i: 'arp', n: tone(style.arp.oct, Number(hit.ch)), d: hit.len, v: 1 });
    }
    // Drums, with a fill in the last bar of the loop.
    const last = bar === bars - 1;
    for (const kind of DRUMS) {
      let pattern = style.drums?.[kind];
      if (!pattern) continue;
      if (last && style.fill && kind === 'snare') pattern = pattern.slice(0, 12) + style.fill;
      for (const hit of parsePattern(pattern)) add(base + hit.at, { i: kind, v: hit.ch === 'o' ? 0.5 : 1 });
    }
  }
  if (style.lead) melody(style, rng, scale, bars, chordAt).forEach((ev) => add(ev.at, ev));
  return { bpm: style.bpm, swing: style.swing ?? 0, length, steps };
}

// A melody built from a two-bar motif: rhythm and contour stay, the notes
// follow the chords (A, answer, A, cadence), so it sounds like a tune.
function melody(style, rng, scale, bars, chordAt) {
  const m = style.melody ?? {};
  const grid = m.grid ?? 2; // 16ths per slot: 2 = eighth notes
  const slotsPerBar = STEPS_PER_BAR / grid;
  const motifSlots = slotsPerBar * 2;
  const density = m.density ?? 0.55;
  const [lo, hi] = m.range ?? [0, 9];
  const n = scale.length;

  const makeRhythm = (from) => {
    const onsets = [];
    for (let s = from; s < motifSlots; s++) {
      const strong = s % (slotsPerBar / 2) === 0;
      if (s === 0 || rng() < (strong ? Math.min(1, density + 0.3) : density)) onsets.push(s);
    }
    return onsets;
  };
  const makeSteps = (count) => Array.from({ length: count }, () => {
    const r = rng();
    if (r < (m.leaps ?? 0.12)) return (rng() < 0.5 ? -1 : 1) * (3 + Math.floor(rng() * 2));
    return [-2, -1, -1, 0, 1, 1, 2][Math.floor(rng() * 7)];
  });
  const motif = makeRhythm(0);
  const contour = makeSteps(motif.length);
  // The answer keeps the first bar and varies the second.
  const answer = [...motif.filter((s) => s < slotsPerBar), ...makeRhythm(slotsPerBar)];
  const answerContour = makeSteps(answer.length);

  const out = [];
  let cur = Math.round((lo + hi) / 2);
  const phrases = bars / 2;
  for (let p = 0; p < phrases; p++) {
    const isAnswer = p % 2 === 1;
    const cadence = p === phrases - 1 && phrases > 1;
    const rhythm = isAnswer ? answer : motif;
    const steps = isAnswer ? answerContour : contour;
    for (let k = 0; k < rhythm.length; k++) {
      const slot = rhythm[k];
      const bar = p * 2 + Math.floor(slot / slotsPerBar);
      const nextSlot = k + 1 < rhythm.length ? rhythm[k + 1] : motifSlots;
      let len = nextSlot - slot;
      if (m.staccato && len > 1 && rng() < m.staccato) len = 1;
      cur += steps[k];
      const strong = slot % (slotsPerBar / 2) === 0;
      if (strong) cur = nearestChordTone(cur, chordAt(bar), n);
      if (cadence && k === rhythm.length - 1) {
        cur = nearestChordTone(cur, 0, n, true); // end on the tonic
        len = Math.max(len, slotsPerBar - (slot % slotsPerBar));
      }
      // Back into range by whole octaves, so chord tones stay chord tones.
      while (cur < lo) cur += n;
      while (cur > hi) cur -= n;
      out.push({ at: p * 2 * STEPS_PER_BAR + slot * grid, i: 'lead', n: degreeToMidi(style.root + style.lead.oct * 12, scale, cur), d: len * grid, v: strong ? 1 : 0.8 });
    }
  }
  return out;
}

// Closest degree to `d` that is a tone of the chord on degree `c` (or only its root).
function nearestChordTone(d, c, n, rootOnly = false) {
  const tones = rootOnly ? [c] : [c, c + 2, c + 4];
  let best = d;
  let bestDist = Infinity;
  for (let x = d - n; x <= d + n; x++) {
    if (!tones.some((t) => (((x - t) % n) + n) % n === 0)) continue;
    const dist = Math.abs(x - d);
    if (dist < bestDist) {
      best = x;
      bestDist = dist;
    }
  }
  return best;
}
