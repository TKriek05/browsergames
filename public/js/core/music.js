// Background music per game: plays the procedural songs of music-song.js
// with small WebAudio synth voices. A look-ahead scheduler queues notes a
// fraction of a second ahead. Music follows the global mute (it runs through
// the same master bus) and has its own on/off switch, saved per browser.
import { local } from './storage.js';
import { audioOut } from './audio.js';
import { buildSong } from './music-song.js';
import { trackFor } from './music-tracks.js';

const LOOKAHEAD_S = 0.3;
const TIMER_MS = 50;
const MUSIC_GAIN = 0.42; // music stays under the sound effects
const FADE_S = 0.6;
const ECHO_FEEDBACK = 0.3;
const ECHO_WET = 0.22;
const DRUM_KINDS = new Set(['kick', 'snare', 'hat', 'ohat', 'clap', 'ride', 'shaker']);
// Noise drums: filter type + frequency, decay, level (Q for band-pass).
const NOISE_DRUMS = {
  snare: { type: 'highpass', f: 1500, dur: 0.16, vol: 0.2, body: 190 },
  hat: { type: 'highpass', f: 7500, dur: 0.035, vol: 0.07 },
  ohat: { type: 'highpass', f: 7000, dur: 0.22, vol: 0.05 },
  clap: { type: 'bandpass', f: 1300, dur: 0.12, vol: 0.22, q: 1.2 },
  ride: { type: 'bandpass', f: 5500, dur: 0.4, vol: 0.05, q: 1.5 },
  shaker: { type: 'bandpass', f: 5000, dur: 0.05, vol: 0.05, q: 1.2 },
};

let enabled = local.get('music', true);
const listeners = new Set();
let bus = null; // music on/off gain → master bus of audio.js
let busCtx = null;
let song = null; // { track, data, step, next, out, echo }
let timer = 0;

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

export function isMusicOn() {
  return enabled;
}

export function setMusicOn(value) {
  enabled = !!value;
  local.set('music', enabled);
  if (bus) bus.gain.setTargetAtTime(enabled ? MUSIC_GAIN : 0, busCtx.currentTime, 0.1);
  for (const fn of listeners) fn(enabled);
}

export function onMusicChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Starts the track of a game (replacing any other). Waits silently until
// the browser allows audio (first click or key).
export function playMusic(gameId) {
  stopMusic();
  const track = trackFor(gameId);
  if (!track) return;
  song = { track, data: buildSong(track, track.seed), step: 0, next: 0, out: null, echo: null };
  timer = setInterval(pump, TIMER_MS);
  pump();
}

export function stopMusic() {
  clearInterval(timer);
  timer = 0;
  const out = song?.out;
  if (out && busCtx) {
    out.gain.setTargetAtTime(0, busCtx.currentTime, FADE_S / 4);
    setTimeout(() => out.disconnect(), FADE_S * 1000 + 400);
  }
  song = null;
}

function ensureBus(o) {
  if (busCtx === o.ctx) return;
  busCtx = o.ctx;
  bus = o.ctx.createGain();
  bus.gain.value = enabled ? MUSIC_GAIN : 0;
  bus.connect(o.master);
}

// The song's own output (for fading) and its echo send.
function ensureOutput(ctx, stepDur) {
  if (song.out) return;
  song.out = ctx.createGain();
  song.out.gain.value = song.track.vol ?? 1;
  song.out.connect(bus);
  const send = ctx.createGain();
  const delay = ctx.createDelay(1);
  const feedback = ctx.createGain();
  const wet = ctx.createGain();
  delay.delayTime.value = Math.min(0.9, stepDur * 3); // a dotted eighth
  feedback.gain.value = ECHO_FEEDBACK;
  wet.gain.value = ECHO_WET;
  send.connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(wet).connect(song.out);
  song.echo = send;
}

function pump() {
  if (!song) return;
  const o = audioOut();
  if (!o || document.hidden) {
    song.next = 0; // pick up again right where we were
    return;
  }
  const { ctx } = o;
  ensureBus(o);
  const stepDur = 60 / song.data.bpm / 4;
  ensureOutput(ctx, stepDur);
  // First start, or the timer fell behind (hidden tab, busy frame): resync.
  if (!song.next || song.next < ctx.currentTime) song.next = ctx.currentTime + 0.06;
  while (song.next < ctx.currentTime + LOOKAHEAD_S) {
    const idx = song.step % song.data.length;
    const t = song.next + (idx % 4 === 2 ? song.data.swing * stepDur : 0);
    for (const ev of song.data.steps[idx]) playEvent(o, ev, t, stepDur);
    song.next += stepDur;
    song.step++;
  }
}

function playEvent(o, ev, t, stepDur) {
  if (DRUM_KINDS.has(ev.i)) return drum(o, ev.i, t, ev.v);
  const inst = song.track[ev.i];
  if (!inst) return;
  const dur = ev.d * stepDur;
  if (Array.isArray(ev.n)) for (const n of ev.n) voice(o.ctx, inst, n, t, dur, ev.v);
  else voice(o.ctx, inst, ev.n, t, dur, ev.v);
}

// One synth note: 1-2 oscillators (+ an optional sine partial), optional
// low-pass and vibrato, an attack/decay/sustain/release envelope.
function voice(ctx, inst, midi, t, dur, vel) {
  const f = mtof(midi);
  const peak = inst.vol * vel;
  const a = inst.a ?? 0.005;
  const d = inst.d ?? 0.2;
  const s = inst.s ?? 0.6;
  const r = inst.r ?? 0.1;
  const off = t + Math.max(dur, a + 0.01);
  const end = Math.max(off + r, t + a + d) + 0.1;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + a);
  env.gain.setTargetAtTime(peak * s, t + a, d / 3);
  if (s > 0) env.gain.setTargetAtTime(0, off, r / 3);
  let dest = env;
  if (inst.cut) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = inst.cut;
    lp.Q.value = inst.q ?? 0.8;
    lp.connect(env);
    dest = lp;
  }
  const oscs = [];
  const osc = (type, freq, cents, level) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = cents;
    if (level === 1) o.connect(dest);
    else {
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(dest);
    }
    oscs.push(o);
  };
  if (inst.detune) {
    osc(inst.wave, f, -inst.detune, 0.6);
    osc(inst.wave, f, inst.detune, 0.6);
  } else osc(inst.wave, f, 0, 1);
  if (inst.partial) osc('sine', f * inst.partial, 0, inst.partialVol ?? 0.25);
  if (inst.vib) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 5.5;
    depth.gain.value = f * inst.vib;
    lfo.connect(depth);
    for (const o of oscs) depth.connect(o.frequency);
    lfo.start(t);
    lfo.stop(end);
  }
  env.connect(song.out);
  if (inst.echo) env.connect(song.echo);
  for (const o of oscs) {
    o.start(t);
    o.stop(end);
  }
}

function drum(o, kind, t, vel) {
  const { ctx } = o;
  const chip = song.track.kit === 'chip';
  const v = vel * (song.track.drumVol ?? 1);
  if (kind === 'kick') {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = chip ? 'square' : 'sine';
    osc.frequency.setValueAtTime(chip ? 120 : 150, t);
    osc.frequency.exponentialRampToValueAtTime(chip ? 40 : 45, t + 0.12);
    g.gain.setValueAtTime((chip ? 0.14 : 0.45) * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(g).connect(song.out);
    osc.start(t);
    osc.stop(t + 0.3);
    return;
  }
  const p = NOISE_DRUMS[kind];
  const dur = chip ? p.dur * 0.6 : p.dur;
  const src = ctx.createBufferSource();
  src.buffer = o.noise;
  const filter = ctx.createBiquadFilter();
  filter.type = p.type;
  filter.frequency.value = p.f;
  if (p.q) filter.Q.value = p.q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(p.vol * v, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(song.out);
  src.start(t, Math.random() * 0.5, dur + 0.05);
  if (p.body) {
    // The snare's drum body under the noise.
    const body = ctx.createOscillator();
    const bg = ctx.createGain();
    body.type = 'triangle';
    body.frequency.setValueAtTime(p.body, t);
    body.frequency.exponentialRampToValueAtTime(p.body * 0.6, t + 0.08);
    bg.gain.setValueAtTime(0.12 * v, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    body.connect(bg).connect(song.out);
    body.start(t);
    body.stop(t + 0.12);
  }
}
