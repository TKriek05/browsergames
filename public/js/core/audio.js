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
  // Neon Kart GP
  boost: () => { noise({ dur: 0.5, vol: 0.35, filter: 900, to: 4000 }); tone({ type: 'sawtooth', freq: 180, to: 520, dur: 0.4, vol: 0.12 }); },
  spin: () => tone({ type: 'triangle', freq: 900, to: 150, dur: 0.6, vol: 0.22 }),
  item: () => [0, 0.06, 0.12, 0.18].forEach((d, i) => tone({ type: 'square', freq: 700 + i * 120, dur: 0.05, vol: 0.1, delay: d })),
  // Minigolf
  putt: () => { tone({ type: 'sine', freq: 1500, to: 900, dur: 0.05, vol: 0.25 }); noise({ dur: 0.03, vol: 0.15, filter: 7000, to: 3000 }); },
  plop: () => { tone({ type: 'sine', freq: 520, to: 180, dur: 0.12, vol: 0.3 }); tone({ type: 'sine', freq: 300, to: 120, dur: 0.1, vol: 0.2, delay: 0.1 }); },
  splash: () => noise({ dur: 0.45, vol: 0.35, filter: 1800, to: 400 }),
};

export function play(name) {
  // Never create the context here: that would log autoplay warnings.
  if (muted || !ctx || ctx.state !== 'running') return;
  SOUNDS[name]?.();
}

// A continuous engine hum for racing games: { set(speed01, boost), stop() },
// or null while audio is not unlocked yet (call again later).
export function engineSound() {
  if (!ctx || ctx.state !== 'running') return null;
  const t = ctx.currentTime;
  const saw = ctx.createOscillator();
  const sub = ctx.createOscillator();
  saw.type = 'sawtooth';
  sub.type = 'square';
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 500;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  saw.connect(lp);
  sub.connect(lp);
  lp.connect(gain).connect(master);
  saw.start(t);
  sub.start(t);
  let stopped = false;
  return {
    set(speed01, boost) {
      if (stopped) return;
      const now = ctx.currentTime;
      const f = 48 + speed01 * 105 + (boost ? 22 : 0);
      saw.frequency.setTargetAtTime(f, now, 0.06);
      sub.frequency.setTargetAtTime(f / 2, now, 0.06);
      lp.frequency.setTargetAtTime(380 + speed01 * 1000, now, 0.08);
      gain.gain.setTargetAtTime(0.035 + speed01 * 0.045, now, 0.1);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const now = ctx.currentTime;
      gain.gain.setTargetAtTime(0, now, 0.05);
      saw.stop(now + 0.3);
      sub.stop(now + 0.3);
    },
  };
}
