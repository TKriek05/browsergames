// Synthesized sound effects with the WebAudio API (no audio files).
// Browsers only allow audio after a user gesture, so the context is created
// lazily on the first click/key/touch.
import { local } from './storage.js';

let ctx = null;
let master = null;
let noiseBuffer = null;
let muted = local.get('muted', false);
const listeners = new Set();

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(comp).connect(ctx.destination);
  // One second of white noise, reused for explosions/hits.
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

export function unlockAudio() {
  const c = ensureContext();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

// Unlock on the first interaction anywhere.
for (const type of ['pointerdown', 'keydown', 'touchend']) {
  window.addEventListener(type, unlockAudio, { once: true, passive: true, capture: true });
}

// For music.js: the running context, the master bus and the noise buffer;
// null until the browser allows audio.
export function audioOut() {
  return ctx && ctx.state === 'running' ? { ctx, master, noise: noiseBuffer } : null;
}

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = !!value;
  local.set('muted', muted);
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02);
  for (const fn of listeners) fn(muted);
}

export function onMuteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// --- Building blocks -------------------------------------------------------------
function tone({ type = 'square', freq = 440, to = null, dur = 0.12, vol = 0.3, delay = 0, attack = 0.005 }) {
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise({ dur = 0.3, vol = 0.4, filter = 1200, to = 200, delay = 0 }) {
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(filter, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp).connect(gain).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// --- Presets ------------------------------------------------------------------------
const SOUNDS = {
  click: () => tone({ freq: 660, dur: 0.05, vol: 0.15 }),
  hover: () => tone({ type: 'triangle', freq: 880, dur: 0.03, vol: 0.06 }),
  join: () => { tone({ freq: 523, dur: 0.08 }); tone({ freq: 784, dur: 0.12, delay: 0.08 }); },
  leave: () => { tone({ freq: 523, dur: 0.08 }); tone({ freq: 330, dur: 0.14, delay: 0.08 }); },
  ready: () => tone({ type: 'triangle', freq: 880, to: 1320, dur: 0.1, vol: 0.2 }),
  react: () => tone({ type: 'sine', freq: 1200, to: 1600, dur: 0.08, vol: 0.12 }),
  countdown: () => tone({ type: 'square', freq: 440, dur: 0.12, vol: 0.2 }),
  go: () => { tone({ freq: 880, dur: 0.1 }); tone({ freq: 1320, dur: 0.25, delay: 0.1 }); },
  tag: () => { tone({ type: 'sawtooth', freq: 220, to: 880, dur: 0.15, vol: 0.25 }); noise({ dur: 0.12, vol: 0.2, filter: 4000, to: 800 }); },
  hit: () => noise({ dur: 0.15, vol: 0.35, filter: 3000, to: 300 }),
  explode: () => { noise({ dur: 0.6, vol: 0.6, filter: 2000, to: 60 }); tone({ type: 'sine', freq: 120, to: 40, dur: 0.4, vol: 0.4 }); },
  shoot: () => { tone({ type: 'square', freq: 900, to: 200, dur: 0.1, vol: 0.18 }); noise({ dur: 0.08, vol: 0.2 }); },
  coin: () => { tone({ freq: 988, dur: 0.07 }); tone({ freq: 1319, dur: 0.2, delay: 0.07 }); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.18, vol: 0.25, delay: i * 0.11 })),
  lose: () => [392, 330, 262].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.22, vol: 0.22, delay: i * 0.15 })),
  error: () => tone({ type: 'square', freq: 160, dur: 0.18, vol: 0.2 }),
  // Kwek Kwek Knal
  gun: () => { noise({ dur: 0.22, vol: 0.55, filter: 5000, to: 300 }); tone({ type: 'square', freq: 180, to: 60, dur: 0.12, vol: 0.25 }); },
  gunFar: () => noise({ dur: 0.14, vol: 0.18, filter: 2500, to: 300 }),
  reload: () => { noise({ dur: 0.04, vol: 0.3, filter: 6000, to: 3000 }); noise({ dur: 0.05, vol: 0.3, filter: 4000, to: 2000, delay: 0.18 }); },
  quack: () => { tone({ type: 'sawtooth', freq: 620, to: 420, dur: 0.1, vol: 0.12 }); tone({ type: 'sawtooth', freq: 600, to: 380, dur: 0.12, vol: 0.12, delay: 0.13 }); },
  flap: () => [0, 0.07, 0.14].forEach((d) => noise({ dur: 0.05, vol: 0.12, filter: 1500, to: 600, delay: d })),
  pop: () => { noise({ dur: 0.08, vol: 0.5, filter: 8000, to: 1000 }); tone({ type: 'square', freq: 200, to: 90, dur: 0.2, vol: 0.2 }); },
  thud: () => tone({ type: 'sine', freq: 110, to: 50, dur: 0.15, vol: 0.3 }),
  laugh: () => [0, 0.14, 0.28].forEach((d) => tone({ type: 'square', freq: 520 - d * 400, to: 330, dur: 0.1, vol: 0.14, delay: d })),
  // Ruimtegolf: the formation's marching beat
  beat: () => tone({ type: 'square', freq: 82, dur: 0.07, vol: 0.16 }),
  // Turbo Kart GP
  boost: () => { noise({ dur: 0.5, vol: 0.35, filter: 900, to: 4000 }); tone({ type: 'sawtooth', freq: 180, to: 520, dur: 0.4, vol: 0.12 }); },
  spin: () => tone({ type: 'triangle', freq: 900, to: 150, dur: 0.6, vol: 0.22 }),
  item: () => [0, 0.06, 0.12, 0.18].forEach((d, i) => tone({ type: 'square', freq: 700 + i * 120, dur: 0.05, vol: 0.1, delay: d })),
  // Minigolf
  putt: () => { tone({ type: 'sine', freq: 1500, to: 900, dur: 0.05, vol: 0.25 }); noise({ dur: 0.03, vol: 0.15, filter: 7000, to: 3000 }); },
  plop: () => { tone({ type: 'sine', freq: 520, to: 180, dur: 0.12, vol: 0.3 }); tone({ type: 'sine', freq: 300, to: 120, dur: 0.1, vol: 0.2, delay: 0.1 }); },
  splash: () => noise({ dur: 0.45, vol: 0.35, filter: 1800, to: 400 }),
  // Spetterveld
  marker: () => { noise({ dur: 0.08, vol: 0.4, filter: 2600, to: 500 }); tone({ type: 'sine', freq: 300, to: 120, dur: 0.07, vol: 0.22 }); },
  markerFar: () => noise({ dur: 0.06, vol: 0.14, filter: 1800, to: 400 }),
  splat: () => { noise({ dur: 0.14, vol: 0.45, filter: 1400, to: 250 }); tone({ type: 'sine', freq: 180, to: 70, dur: 0.1, vol: 0.18 }); },
  // Turbo Kart GP items and contact
  rocket: () => { noise({ dur: 0.7, vol: 0.3, filter: 600, to: 3500 }); tone({ type: 'sawtooth', freq: 220, to: 660, dur: 0.5, vol: 0.08 }); },
  throw: () => { noise({ dur: 0.18, vol: 0.2, filter: 2500, to: 800 }); tone({ type: 'triangle', freq: 500, to: 300, dur: 0.15, vol: 0.1 }); },
  star: () => [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone({ type: 'square', freq: f, dur: 0.1, vol: 0.08, delay: i * 0.06 })),
  zap: () => { noise({ dur: 0.9, vol: 0.55, filter: 6000, to: 200 }); tone({ type: 'sawtooth', freq: 1400, to: 90, dur: 0.35, vol: 0.18 }); },
  bump: () => { tone({ type: 'sine', freq: 140, to: 60, dur: 0.14, vol: 0.3 }); noise({ dur: 0.08, vol: 0.18, filter: 1200, to: 300 }); },
  scrape: () => noise({ dur: 0.25, vol: 0.22, filter: 3800, to: 1400 }),
  charge1: () => tone({ type: 'square', freq: 880, to: 1175, dur: 0.07, vol: 0.07 }),
  charge2: () => tone({ type: 'square', freq: 1175, to: 1568, dur: 0.09, vol: 0.08 }),
};

export function play(name) {
  // Never create the context here: that would log autoplay warnings.
  if (muted || !ctx || ctx.state !== 'running') return;
  SOUNDS[name]?.();
}

// Gears for the engine note: the pitch climbs within a gear and drops at a shift.
const GEARS = [0, 0.3, 0.55, 0.78, 1.01];

// A continuous engine for racing games: { set(speed01, boost, volume = 1), stop() },
// or null while audio is not unlocked yet (call again later). A sawtooth and a
// square an octave down through a low-pass, plus a little noise for texture.
export function engineSound() {
  if (!ctx || ctx.state !== 'running') return null;
  const t = ctx.currentTime;
  const saw = ctx.createOscillator();
  const sub = ctx.createOscillator();
  saw.type = 'sawtooth';
  sub.type = 'square';
  saw.detune.value = 6;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 500;
  lp.Q.value = 2;
  const grit = ctx.createBufferSource();
  grit.buffer = noiseBuffer;
  grit.loop = true;
  const gritFilter = ctx.createBiquadFilter();
  gritFilter.type = 'bandpass';
  gritFilter.frequency.value = 180;
  const gritGain = ctx.createGain();
  gritGain.gain.value = 0.25;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  saw.connect(lp);
  sub.connect(lp);
  grit.connect(gritFilter).connect(gritGain).connect(lp);
  lp.connect(gain).connect(master);
  saw.start(t);
  sub.start(t);
  grit.start(t);
  let stopped = false;
  return {
    set(speed01, boost, volume = 1) {
      if (stopped) return;
      const now = ctx.currentTime;
      let g = 0;
      while (g < GEARS.length - 2 && speed01 > GEARS[g + 1]) g++;
      const inGear = (speed01 - GEARS[g]) / (GEARS[g + 1] - GEARS[g]);
      const f = 46 + g * 9 + Math.max(0, Math.min(1, inGear)) * 62 + (boost ? 18 : 0);
      saw.frequency.setTargetAtTime(f, now, 0.05);
      sub.frequency.setTargetAtTime(f / 2, now, 0.05);
      gritFilter.frequency.setTargetAtTime(f * 3, now, 0.08);
      lp.frequency.setTargetAtTime(360 + speed01 * 1100 + (boost ? 500 : 0), now, 0.08);
      gain.gain.setTargetAtTime((0.035 + speed01 * 0.045) * volume, now, 0.1);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const now = ctx.currentTime;
      gain.gain.setTargetAtTime(0, now, 0.05);
      saw.stop(now + 0.3);
      sub.stop(now + 0.3);
      grit.stop(now + 0.3);
    },
  };
}

// Looping noise sounds with a level you can change: 'screech' (tyres in a
// drift) or 'rumble' (driving over grass). { set(level 0..1), stop() } or null.
export function loopSound(kind) {
  if (!ctx || ctx.state !== 'running') return null;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = kind === 'screech' ? 'bandpass' : 'lowpass';
  filter.frequency.value = kind === 'screech' ? 2400 : 260;
  filter.Q.value = kind === 'screech' ? 6 : 0.8;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(filter).connect(gain).connect(master);
  src.start();
  const max = kind === 'screech' ? 0.12 : 0.22;
  let stopped = false;
  return {
    set(level) {
      if (stopped) return;
      const now = ctx.currentTime;
      gain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * max, now, 0.05);
      if (kind === 'screech') filter.frequency.setTargetAtTime(2200 + level * 600, now, 0.1);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
      src.stop(ctx.currentTime + 0.25);
    },
  };
}
