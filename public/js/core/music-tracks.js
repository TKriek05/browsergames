// Background music: a style per kind of game and a track per game. Every
// game gets its own melody (seed = its id) and its own key or tempo, so two
// chiptune games still sound different. Patterns: see music-song.js.

// --- Sounds (WebAudio voice settings, see music.js) ---------------------------------
// wave, vol, envelope a/d/s/r (seconds, sustain 0..1), cut = low-pass Hz,
// detune = cents for a second oscillator, partial = extra sine at f × partial,
// vib = vibrato depth, echo = send to the song's echo.
const SND = {
  sawLead: { wave: 'sawtooth', detune: 7, cut: 2400, a: 0.01, d: 0.25, s: 0.55, r: 0.15, vol: 0.075, echo: true },
  squareLead: { wave: 'square', cut: 3000, a: 0.004, d: 0.12, s: 0.45, r: 0.06, vol: 0.055 },
  brightLead: { wave: 'square', cut: 4200, a: 0.004, d: 0.1, s: 0.5, r: 0.05, vol: 0.05 },
  spookLead: { wave: 'square', cut: 2200, a: 0.006, d: 0.15, s: 0.5, r: 0.08, vol: 0.05, vib: 0.012 },
  brass: { wave: 'sawtooth', cut: 1500, a: 0.03, d: 0.2, s: 0.7, r: 0.1, vol: 0.075 },
  pluck: { wave: 'triangle', a: 0.003, d: 0.35, s: 0, r: 0.1, vol: 0.2 },
  bell: { wave: 'sine', partial: 3.01, partialVol: 0.3, a: 0.002, d: 0.7, s: 0, r: 0.3, vol: 0.14 },
  epiano: { wave: 'sine', partial: 2, partialVol: 0.2, a: 0.005, d: 0.8, s: 0.25, r: 0.25, vol: 0.13 },
  calliope: { wave: 'triangle', partial: 2, partialVol: 0.35, a: 0.01, d: 0.1, s: 0.7, r: 0.06, vol: 0.12, vib: 0.008 },
  dreamLead: { wave: 'sine', a: 0.03, d: 0.6, s: 0.5, r: 0.6, vol: 0.13, echo: true },

  sawBass: { wave: 'sawtooth', cut: 650, a: 0.004, d: 0.15, s: 0.5, r: 0.05, vol: 0.13 },
  funkBass: { wave: 'sawtooth', cut: 900, q: 4, a: 0.003, d: 0.1, s: 0.3, r: 0.04, vol: 0.13 },
  triBass: { wave: 'triangle', a: 0.004, d: 0.25, s: 0.8, r: 0.05, vol: 0.2 },
  sineBass: { wave: 'sine', a: 0.01, d: 0.3, s: 0.8, r: 0.1, vol: 0.2 },
  squareBass: { wave: 'square', cut: 800, a: 0.004, d: 0.12, s: 0.6, r: 0.04, vol: 0.08 },

  sawPad: { wave: 'sawtooth', detune: 10, cut: 1000, a: 0.4, d: 0.5, s: 0.7, r: 0.6, vol: 0.028 },
  softPad: { wave: 'triangle', a: 0.4, d: 0.5, s: 0.8, r: 0.8, vol: 0.045 },
  stab: { wave: 'triangle', a: 0.005, d: 0.25, s: 0.2, r: 0.1, vol: 0.05 },
  brassStab: { wave: 'sawtooth', cut: 1600, a: 0.01, d: 0.15, s: 0.3, r: 0.08, vol: 0.035 },
  organ: { wave: 'square', cut: 900, a: 0.15, d: 0.3, s: 0.7, r: 0.3, vol: 0.022 },

  sineArp: { wave: 'sine', a: 0.003, d: 0.15, s: 0, r: 0.05, vol: 0.08 },
  chipArp: { wave: 'square', cut: 3800, a: 0.002, d: 0.06, s: 0.2, r: 0.03, vol: 0.035 },
  softPluck: { wave: 'triangle', a: 0.003, d: 0.25, s: 0, r: 0.08, vol: 0.1 },
};

const at = (sound, oct) => ({ ...sound, oct });

// --- Styles --------------------------------------------------------------------------
// root = MIDI note of the key at octave 0 (45 = A2); oct is relative to it.
export const STYLES = {
  synthwave: {
    bpm: 108, scale: 'minor', root: 45, chords: [0, 5, 2, 6],
    lead: at(SND.sawLead, 2), melody: { grid: 2, density: 0.5, range: [0, 9] },
    bass: at(SND.sawBass, 0), bassPattern: '0.3.0.3.0.3.0.3.',
    pad: at(SND.sawPad, 1),
    arp: at(SND.sineArp, 2), arpPattern: '0121012101210121',
    drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..o...o...o...o.' }, fill: 'xoxx',
  },
  chip: {
    bpm: 140, scale: 'minor', root: 45, chords: [0, 5, 6, 4],
    lead: at(SND.squareLead, 2), melody: { grid: 2, density: 0.65, staccato: 0.3, range: [0, 10] },
    bass: at(SND.triBass, 0), bassPattern: '0.0.3.0.0.0.3.0.',
    arp: at(SND.chipArp, 2), arpPattern: '0123012301230123',
    drums: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'o.o.o.o.o.o.o.o.' }, fill: 'xxxx', kit: 'chip',
  },
  march: {
    bpm: 112, scale: 'major', root: 43, chords: [0, 3, 0, 4, 0, 3, 4, 0],
    lead: at(SND.brass, 2), melody: { grid: 2, density: 0.5, staccato: 0.4, range: [0, 9] },
    bass: at(SND.triBass, 0), bassPattern: '0.......2.......',
    pad: at(SND.brassStab, 1), padPattern: '....x-......x-..',
    drums: { kick: 'x.......x.......', snare: 'o.o.x.o.o.o.x.oo' }, fill: 'xxxx',
  },
  race: {
    bpm: 150, scale: 'major', root: 45, chords: [0, 4, 5, 3],
    lead: at(SND.brightLead, 2), melody: { grid: 2, density: 0.7, range: [0, 10] },
    bass: at(SND.sawBass, 0), bassPattern: '0.0.0.0.0.0.0.0.',
    pad: at(SND.sawPad, 1), padPattern: 'x-------x-------',
    drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '.o.o.o.o.o.o.o.o' }, fill: 'xoxx',
  },
  jazz: {
    bpm: 92, swing: 0.3, scale: 'major', root: 41, seventh: true, chords: [1, 4, 0, 5, 1, 4, 0, 0],
    lead: at(SND.epiano, 2), melody: { grid: 2, density: 0.45, staccato: 0.2, range: [2, 10] },
    bass: at(SND.triBass, 0), bassPattern: '0---1---2---a---',
    pad: at(SND.stab, 1), padPattern: '......x-......x-',
    drums: { ride: 'x...x.x.x...x.x.', hat: '....o.......o...', kick: 'o...............' }, vol: 0.6,
  },
  folk: {
    bpm: 104, scale: 'major', root: 43, chords: [0, 3, 4, 0, 0, 3, 4, 0],
    lead: at(SND.pluck, 2), melody: { grid: 2, density: 0.55, range: [0, 9] },
    bass: at(SND.triBass, 0), bassPattern: '0.......2.......',
    arp: at(SND.softPluck, 1), arpPattern: '0.1.2.1.0.1.2.1.',
    drums: { kick: 'x.......x.......', snare: '....o.......o...', shaker: 'oooooooooooooooo' },
  },
  spooky: {
    bpm: 126, scale: 'harmonic', root: 45, chords: [0, 5, 3, 4],
    lead: at(SND.spookLead, 2), melody: { grid: 2, density: 0.5, staccato: 0.5, range: [0, 9] },
    bass: at(SND.squareBass, 0), bassPattern: '0..3..0.0..3..0.',
    pad: at(SND.organ, 1),
    drums: { kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'o.o.o.o.o.o.o.o.' }, kit: 'chip',
  },
  ice: {
    bpm: 116, scale: 'major', root: 48, chords: [0, 5, 3, 4],
    lead: at(SND.bell, 2), melody: { grid: 2, density: 0.5, range: [0, 9] },
    bass: at(SND.sineBass, 0), bassPattern: '0.....0.2.....2.',
    arp: at(SND.sineArp, 2), arpPattern: '0.1.2.3.2.1.0.1.',
    pad: at(SND.softPad, 1),
    drums: { kick: 'x.......x.......', snare: '....o.......o...', shaker: 'o.o.o.o.o.o.o.o.' },
  },
  underwater: {
    bpm: 80, scale: 'lydian', root: 41, chords: [0, 1, 5, 4],
    lead: at(SND.dreamLead, 2), melody: { grid: 4, density: 0.45, range: [2, 9] },
    bass: at(SND.sineBass, 0), bassPattern: '0-------2-------',
    pad: at(SND.softPad, 1),
    arp: at({ ...SND.sineArp, echo: true }, 2), arpPattern: '0...2...4...2...',
    drums: { shaker: '....o.......o...' }, vol: 0.7,
  },
  quiz: {
    bpm: 116, scale: 'dorian', root: 43, chords: [0, 3, 0, 3, 0, 3, 6, 4],
    lead: at(SND.squareLead, 2), melody: { grid: 2, density: 0.6, staccato: 0.6, range: [0, 9] },
    bass: at(SND.funkBass, 0), bassPattern: '0..0..3.0.0..2.a',
    pad: at(SND.brassStab, 1), padPattern: '..x.......x.....',
    drums: { kick: 'x..x..x...x..x..', snare: '....x.......x...', clap: '....x.......x...', hat: 'ooxoooxoooxoooxo' }, fill: 'xoxx',
  },
  action: {
    bpm: 138, scale: 'minor', root: 40, chords: [0, 0, 5, 6],
    lead: at(SND.sawLead, 2), melody: { grid: 2, density: 0.55, range: [0, 9] },
    bass: at(SND.sawBass, 0), bassPattern: '0-0-0-0-0-0-0-0-',
    pad: at(SND.sawPad, 1),
    drums: { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'o.o.o.o.o.o.o.o.' }, fill: 'xxxx',
  },
  lounge: {
    bpm: 104, scale: 'major', root: 43, seventh: true, chords: [0, 5, 1, 4],
    lead: at(SND.epiano, 2), melody: { grid: 2, density: 0.5, range: [1, 9] },
    bass: at(SND.sineBass, 0), bassPattern: '0--2--0-0--2--0-',
    pad: at(SND.stab, 1), padPattern: '..x..x....x..x..',
    drums: { shaker: 'oooooooooooooooo', kick: 'x.....x.x.....x.' }, vol: 0.65,
  },
  puzzle: {
    bpm: 104, scale: 'major', root: 48, chords: [0, 3, 4, 5],
    lead: at(SND.bell, 2), melody: { grid: 2, density: 0.5, range: [0, 9] },
    bass: at(SND.sineBass, 0), bassPattern: '0.......2.......',
    arp: at(SND.sineArp, 2), arpPattern: '0.2.4.2.0.2.4.2.',
    drums: { shaker: '..o...o...o...o.', kick: 'o.......o.......' }, vol: 0.8,
  },
  carnival: {
    bpm: 126, scale: 'major', root: 41, chords: [0, 4, 0, 4, 0, 3, 4, 0],
    lead: at(SND.calliope, 2), melody: { grid: 2, density: 0.65, staccato: 0.3, range: [0, 9] },
    bass: at(SND.triBass, 0), bassPattern: '0...2...0...2...',
    pad: at(SND.stab, 1), padPattern: '..x-..x-..x-..x-',
    drums: { kick: 'x.......x.......', snare: '....o.......o...' },
  },
};

// --- Tracks per game -------------------------------------------------------------------
export const GAME_MUSIC = {
  tag: { style: 'synthwave' },
  tictactoe: { style: 'jazz', root: 43, bpm: 94 },
  connect4: { style: 'jazz', root: 41, bpm: 100 },
  checkers: { style: 'jazz', root: 46, bpm: 88 },
  checkers4: { style: 'jazz', root: 44, bpm: 92, chords: [0, 5, 1, 4] },
  reversi: { style: 'jazz', root: 38, scale: 'dorian', chords: [0, 3, 0, 3, 1, 4, 0, 0], bpm: 96 },
  chess: { style: 'jazz', root: 45, scale: 'harmonic', chords: [1, 4, 0, 0, 3, 4, 0, 0], bpm: 84 },
  ludo: { style: 'folk', root: 43, bpm: 110 },
  goose: { style: 'folk', root: 41, bpm: 100, chords: [0, 4, 5, 3] },
  battleship: { style: 'march', scale: 'minor', root: 45, bpm: 100, chords: [0, 6, 5, 4, 0, 6, 4, 4], vol: 0.8 },
  duckshoot: { style: 'carnival' },
  tanks: { style: 'march' },
  kartrace: { style: 'race' },
  snake: { style: 'chip', bpm: 128, scale: 'dorian', root: 45 },
  paddle: { style: 'chip', bpm: 136, scale: 'major', root: 48, chords: [0, 4, 5, 3] },
  breakout: { style: 'chip', bpm: 144, root: 40 },
  bomber: { style: 'chip', bpm: 132, scale: 'dorian', root: 43, chords: [0, 3, 0, 6] },
  ghosts: { style: 'spooky' },
  blocks: { style: 'chip', bpm: 150, scale: 'harmonic', root: 45, chords: [0, 5, 3, 4] },
  minigolf: { style: 'lounge' },
  memory: { style: 'puzzle', root: 48 },
  mines: { style: 'puzzle', root: 45, bpm: 96, chords: [0, 5, 3, 4] },
  invaders: { style: 'chip', bpm: 120, scale: 'phrygian', root: 40, chords: [0, 1, 0, 6] },
  rocks: { style: 'synthwave', root: 40, bpm: 120, scale: 'dorian' },
  paintball: { style: 'action' },
  pesten: { style: 'folk', root: 45, bpm: 112, chords: [0, 5, 3, 4] },
  quiz: { style: 'quiz' },
  penguins: { style: 'ice' },
  artillery: { style: 'march', root: 41, bpm: 104 },
  fish: { style: 'underwater' },
  kladder: { style: 'carnival', root: 48, bpm: 126, scale: 'major', chords: [0, 3, 4, 0, 5, 3, 4, 4] },
  archery: { style: 'folk', root: 38, scale: 'dorian', bpm: 92, chords: [0, 6, 3, 4] },
};

// Stable 32-bit seed from a game id (FNV-1a).
export function seedOf(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// The full style of a game's track (style + its own tweaks), or null.
export function trackFor(gameId) {
  const entry = GAME_MUSIC[gameId];
  if (!entry) return null;
  const { style, ...tweaks } = entry;
  return { ...STYLES[style], ...tweaks, style, seed: seedOf(gameId) };
}
