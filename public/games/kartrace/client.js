// Turbo Kart GP (client side): your kart is predicted with the shared
// physics (including drift, boosts and item use), the others are
// interpolated. Chase camera in 3D, HUD on top.
import { PLAYER_COLORS } from '../../../shared/constants.js';
import { BTN } from '../../../shared/messages.js';
import { ByteWriter, encodeInput, quantizeAxis } from '../../../shared/binary.js';
import { stepKart, createKartState, KART_PHYS, KART_STATE_KEYS } from '../../../shared/physics/kart.js';
import { KART_TRACKS, KART_TRACK_IDS, trackQuery } from '../../../shared/maps/kart-tracks.js';
import { KART_PHASE, KART_FLAG, ITEM } from '../../../shared/games/kartrace.js';
import { SnapshotBuffer, lerp } from '../../js/core/interp.js';
import { Predictor } from '../../js/core/predict.js';
import { rgb } from '../../js/gl/mesh.js';
import { createKartScene } from './scene.js';
import { createKartHud, createFallback2D } from './hud.js';

export const meta = {
  width: 480,
  height: 270,
  pixelated: false, // smooth 3D at screen resolution
  gl: true,
  step: KART_PHYS.DT,
  touchButtons: [{ label: 'GAS', bit: BTN.A }, { label: 'DRIFT', bit: BTN.B }, { label: 'ITEM', bit: BTN.X }],
};

const ROULETTE_MS = 900;
const KMH = 0.72; // world units/s → a speedometer number that feels right

function decode(snap) {
  const r = snap.reader;
  const s = {
    time: snap.time, phase: r.u8(), track: r.u8(), raceNo: r.u8(), races: r.u8(), laps: r.u8(),
    endsAt: 0, raceTime: 0, karts: [], boxMask: 0, objects: [],
  };
  s.endsAt = snap.time + r.f32() * 1000;
  s.raceTime = r.f32();
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    const k = { slot: r.u8(), flags: r.u8(), ack: r.u16() };
    k.x = r.f32(); k.y = r.f32(); k.hx = r.f32(); k.hy = r.f32(); k.v = r.f32(); k.vs = r.f32();
    k.drift = r.i8(); k.charge = r.f32(); k.boost = r.f32(); k.spin = r.f32();
    k.item = r.u8(); k.prev = r.u8(); k.off = r.u8();
    k.lap = r.u8(); k.place = r.u8(); k.finishTime = r.f32(); k.points = r.u16();
    k.finished = (k.flags & KART_FLAG.FINISHED) !== 0;
    k.shield = (k.flags & KART_FLAG.SHIELD) !== 0;
    s.karts.push(k);
  }
  s.boxMask = r.u16();
  const m = r.u8();
  for (let i = 0; i < m; i++) s.objects.push({ id: r.u16(), type: r.u8(), x: r.i16() / 4, y: r.i16() / 4 });
  return s;
}

const find = (list, slot) => {
  for (let i = 0; i < list.length; i++) if (list[i].slot === slot) return list[i];
  return null;
};

export function createGame() {
  let net, session, input, sfx, view, scene, hud, flat;
  let track = KART_TRACKS.ring;
  let latest = null;
  let lastLight = 0;
  let banner = null;
  let rollUntil = 0;
  let engine = null;
  let engineTry = 0;
  let lastFrame = 0;
  const buffer = new SnapshotBuffer();
  const writer = new ByteWriter(16);
  const sendInput = { ax: 0, ay: 0, buttons: 0, aim: 0 };
  const serverState = createKartState();
  const scratch = { x: 0, y: 0, depth: 0 };
  const q = { seg: 0, dist: 0, lateral: 0, nx: 0, ny: 0 };

  const predictor = new Predictor({
    create: createKartState,
    copy: (d, s) => { for (const k of KART_STATE_KEYS) d[k] = s[k]; },
    step: (s, inp) => stepKart(s, inp.ax, inp.ay, inp.buttons, KART_PHYS.DT, track),
  });

  const mySlot = () => {
    const me = session.myPlayer;
    return me && me.role === 'player' ? me.slot : -1;
  };
  const playerBySlot = (slot) => session.room?.players.find((p) => p.slot === slot) ?? null;
  const hexOf = (slot) => PLAYER_COLORS[playerBySlot(slot)?.color ?? slot % PLAYER_COLORS.length].hex;
  const myKart = () => (latest ? find(latest.karts, mySlot()) : null);

  function setTrack(idx) {
    const t = KART_TRACKS[KART_TRACK_IDS[idx]] ?? KART_TRACKS.ring;
    if (t === track && scene) {
      scene.setTrack(t);
      hud.setTrack(t);
      return;
    }
    track = t;
    scene?.setTrack(t);
    hud.setTrack(t);
    predictor.reset();
    buffer.clear();
  }

  return {
    mount(v, netRef, ctx) {
      view = v;
      net = netRef;
      session = ctx.session;
      input = ctx.input;
      sfx = ctx.sfx;
      hud = createKartHud(view);
      scene = view.glCanvas ? createKartScene(view.glCanvas, { reducedMotion: ctx.reducedMotion }) : null;
      if (!scene) {
        view.glCanvas?.remove();
        flat = createFallback2D(view);
      }
      const first = ctx.start.settings.track;
      setTrack(Math.max(0, KART_TRACK_IDS.indexOf(first === 'gp' ? 'ring' : first)));
    },

    onSnapshot(snap) {
      const s = decode(snap);
      if (!latest || s.track !== latest.track || s.raceNo !== latest.raceNo) setTrack(s.track);
      latest = s;
      buffer.push(s.time, s);
      const mine = find(s.karts, mySlot());
      if (mine) {
        for (const k of KART_STATE_KEYS) serverState[k] = mine[k];
        predictor.reconcile(serverState, mine.ack);
      }
    },

    onEvent(msg) {
      const slot = mySlot();
      const now = performance.now();
      switch (msg.e) {
        case 'race': banner = null; break;
        case 'go': sfx.play('go'); break;
        case 'lap':
          if (msg.s === slot) {
            sfx.play('coin');
            const last = latest && msg.lap === latest.laps;
            banner = { text: last ? 'LAATSTE RONDE!' : `RONDE ${msg.lap}`, sub: '', color: last ? '#ff4d6d' : '#ffffff', until: now + 1600 };
          }
          break;
        case 'finish':
          if (msg.s === slot) {
            sfx.play(msg.place <= 3 ? 'win' : 'ready');
            banner = { text: 'FINISH!', sub: `${msg.place}e plaats`, color: '#ffe14d', until: now + 4000 };
          } else sfx.play('ready');
          break;
        case 'item': if (msg.s === slot) { rollUntil = now + ROULETTE_MS; sfx.play('item'); } break;
        case 'box': sfx.play('click'); break;
        case 'use':
          if (msg.item === ITEM.TURBO && msg.s === slot) sfx.play('boost');
          else if (msg.item === ITEM.ORB) sfx.play('shoot');
          else if (msg.item === ITEM.OIL) sfx.play('thud');
          else if (msg.item === ITEM.SHIELD) sfx.play('ready');
          break;
        case 'spin':
          scene?.burst(msg.x, msg.y, '#ff5a36', 26);
          sfx.play(msg.s === slot ? 'spin' : 'hit');
          if (msg.s === slot) banner = { text: 'OEPS!', sub: msg.by !== slot ? `geraakt door ${playerBySlot(msg.by)?.name ?? '?'}` : '', color: '#ff4d6d', until: now + 1200 };
          break;
        case 'block': scene?.burst(msg.x, msg.y, '#7de0ff', 16); sfx.play('react'); break;
        case 'bump': sfx.play('thud'); break;
        case 'scrape': if (msg.s === slot) sfx.play('hit'); break;
        default: break;
      }
    },

    onReconnect() {
      predictor.reset();
      buffer.clear();
    },

    update(dt) {
      scene?.update(dt);
      const inp = input.sample();
      const mine = myKart();
      const racing = latest && latest.phase === KART_PHASE.RACE && mine && predictor.ready;
      if (racing) {
        sendInput.ax = quantizeAxis(inp.ax);
        sendInput.ay = quantizeAxis(inp.ay);
        sendInput.buttons = inp.buttons;
        const before = predictor.state.boost;
        const seq = predictor.apply(sendInput);
        net.sendBinary(encodeInput(writer, seq, sendInput));
        // Predicted feedback for a mini turbo from a drift.
        if (predictor.state.boost > before + 0.3 && predictor.state.drift === 0) sfx.play('boost');
      } else {
        predictor.idle();
      }
      if (latest?.phase === KART_PHASE.COUNTDOWN) {
        const left = Math.ceil((latest.endsAt - net.serverNow()) / 1000);
        if (left !== lastLight && left >= 1 && left <= 4) sfx.play(left === 1 ? 'go' : 'countdown');
        lastLight = left;
      }

      // Engine hum follows your own speed.
      if (!engine && mine && performance.now() > engineTry) {
        engine = sfx.engineSound?.() ?? null;
        engineTry = performance.now() + 1000;
      }
      if (engine) {
        const s = predictor.state;
        engine.set(Math.min(1, Math.abs(s.v) / KART_PHYS.MAX_SPEED), s.boost > 0);
      }
    },

    render(alpha) {
      hud.clear();
      const frameNow = performance.now();
      const frameDt = lastFrame ? Math.min(0.1, (frameNow - lastFrame) / 1000) : 0;
      lastFrame = frameNow;
      if (!latest) return;
      const now = net.serverNow();
      const sample = buffer.sample(now);
      const slot = mySlot();
      const mine = myKart();
      const drawn = [];

      // Everyone's render position this frame.
      if (sample) {
        const a = sample.a.state;
        const b = sample.b.state;
        for (const kb of b.karts) {
          const ka = find(a.karts, kb.slot) ?? kb;
          const me = kb.slot === slot && predictor.ready;
          const k = { slot: kb.slot, src: kb, me };
          if (me) {
            const s = predictor.state;
            k.x = predictor.get('x', alpha);
            k.y = predictor.get('y', alpha);
            k.hx = s.hx; k.hy = s.hy; k.v = s.v; k.drift = s.drift; k.charge = s.charge; k.boost = s.boost; k.spin = s.spin; k.off = s.off;
          } else {
            k.x = lerp(ka.x, kb.x, sample.t);
            k.y = lerp(ka.y, kb.y, sample.t);
            const hx = lerp(ka.hx, kb.hx, sample.t);
            const hy = lerp(ka.hy, kb.hy, sample.t);
            const len = Math.hypot(hx, hy) || 1;
            k.hx = hx / len; k.hy = hy / len; k.v = kb.v; k.drift = kb.drift; k.charge = kb.charge; k.boost = kb.boost; k.spin = kb.spin; k.off = kb.off;
          }
          drawn.push(k);
        }
      }

      // Camera: you, or the leader when you watch.
      const leader = [...latest.karts].sort((p, q2) => p.place - q2.place)[0];
      const focus = drawn.find((k) => k.me) ?? drawn.find((k) => k.slot === leader?.slot) ?? drawn[0];
      if (scene) {
        if (focus) {
          const finished = mine?.finished || (latest.phase !== KART_PHASE.RACE && latest.phase !== KART_PHASE.COUNTDOWN);
          scene.camera(focus.x, focus.y, focus.hx, focus.hy, Math.min(1, Math.abs(focus.v) / KART_PHYS.MAX_SPEED), focus.boost > 0, frameDt, finished ? 'orbit' : 'chase');
        }
        if (!scene.begin()) return;
        const hue = (frameNow / 600) % 1;
        track.boxes.forEach((bx, i) => {
          if (latest.boxMask & (1 << i)) scene.itemBox(bx.x, bx.y, hsl(hue + i * 0.08));
        });
        for (const o of latest.objects) {
          if (o.type === ITEM.ORB) {
            const prev = sample ? sample.a.state.objects.find((p) => p.id === o.id) : null;
            const next = sample ? sample.b.state.objects.find((p) => p.id === o.id) : null;
            if (prev && next) scene.orb(lerp(prev.x, next.x, sample.t), lerp(prev.y, next.y, sample.t));
            else scene.orb(o.x, o.y);
          } else scene.oil(o.x, o.y);
        }
        for (const k of drawn) {
          const steer = k.me ? input.state.ax : 0;
          scene.kart(k.x, k.y, k.hx, k.hy, rgb(hexOf(k.slot)), { drift: k.drift, steer, spin: k.spin });
          scene.effects(k.x, k.y, k.hx, k.hy, k);
        }
        for (const k of drawn) {
          scene.shadow(k.x, k.y);
          if (k.src.shield) scene.shield(k.x, k.y);
        }
        scene.endParticles();
        // Names above the other karts: nearest first, skip labels that would overlap.
        const labels = [];
        for (const k of drawn) {
          if (k.me) continue;
          const p = scene.project(k.x, k.y, 13, scratch);
          if (p && p.depth < 260 && p.x > 0 && p.x < view.width) labels.push({ x: p.x, y: p.y - 8, depth: p.depth, slot: k.slot });
        }
        labels.sort((a, b) => a.depth - b.depth);
        const placed = [];
        for (const l of labels) {
          const name = playerBySlot(l.slot)?.name ?? '?';
          const w = name.length * 6;
          if (placed.some((o) => Math.abs(o.x - l.x) < (o.w + w) / 2 && Math.abs(o.y - l.y) < 9)) continue;
          placed.push({ x: l.x, y: l.y, w });
          hud.label(l.x, l.y, name, hexOf(l.slot));
        }
      } else if (focus) {
        flat.draw(track, focus, drawn.map((k) => ({ x: k.x, y: k.y, hx: k.hx, hy: k.hy, color: hexOf(k.slot) })), latest.objects);
      }

      // --- HUD ---
      hud.minimap(drawn.map((k) => ({ x: k.x, y: k.y, color: hexOf(k.slot), me: k.me })));
      const raceTime = latest.phase === KART_PHASE.RACE ? latest.raceTime + Math.max(0, now - latest.time) / 1000 : latest.raceTime;
      if (mine) {
        hud.place(mine.place, latest.karts.length);
        hud.lap(mine.lap, latest.laps);
        hud.time(mine.finished ? mine.finishTime : raceTime);
        hud.item(predictor.ready ? predictor.state.item : mine.item, frameNow < rollUntil ? 1 : 0);
        hud.speed(Math.abs(predictor.ready ? predictor.state.v : mine.v) * KMH);
        // Wrong way?
        if (latest.phase === KART_PHASE.RACE && focus?.me && Math.abs(focus.v) > 25 && !mine.finished) {
          trackQuery(track, focus.x, focus.y, q);
          if (focus.hx * track.tx[q.seg] + focus.hy * track.ty[q.seg] < -0.4) hud.banner('VERKEERDE KANT!', 'draai om', '#ff4d6d');
        }
      } else {
        hud.time(raceTime);
        if (latest.phase === KART_PHASE.RACE) hud.label(view.width / 2, 40, 'JE KIJKT MEE', '#ffe14d');
      }

      if (latest.phase === KART_PHASE.COUNTDOWN) {
        const left = (latest.endsAt - now) / 1000;
        hud.lights(left);
        if (left > 3) hud.banner(track.name.toUpperCase(), latest.races > 1 ? `Grand Prix · race ${latest.raceNo} van ${latest.races}` : `${latest.laps} rondes`, '#ffffff');
      } else if (latest.phase === KART_PHASE.RESULTS || latest.phase === KART_PHASE.END) {
        const rows = [...latest.karts]
          .sort((p, q2) => (latest.races > 1 ? q2.points - p.points : 0) || p.place - q2.place)
          .map((k) => ({ name: playerBySlot(k.slot)?.name ?? '?', color: hexOf(k.slot), points: k.points, me: k.slot === slot }));
        hud.standings(rows, latest.races > 1 ? `STAND NA RACE ${latest.raceNo} VAN ${latest.races}` : 'UITSLAG');
      } else if (banner && frameNow < banner.until) {
        hud.banner(banner.text, banner.sub, banner.color);
      }
    },

    unmount() {
      engine?.stop();
      engine = null;
      scene?.destroy();
      buffer.clear();
    },
  };
}

function hsl(h) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return 0.75 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
