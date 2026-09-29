// Turbo Kart GP (client side): your kart is predicted with the shared
// physics (including drift, boosts and item use), the others are
// interpolated. Chase camera in 3D, HUD on top.
import { PLAYER_COLORS } from '../../../shared/constants.js';
import { BTN } from '../../../shared/messages.js';
import { ByteWriter, encodeInput, quantizeAxis } from '../../../shared/binary.js';
import { stepKart, createKartState, KART_PHYS, KART_STATE_KEYS } from '../../../shared/physics/kart.js';
import { KART_TRACKS, KART_TRACK_IDS, KART_CUPS, trackQuery, createTrackQuery } from '../../../shared/maps/kart-tracks.js';
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
    k.star = (k.flags & KART_FLAG.STAR) !== 0;
    s.karts.push(k);
  }
  s.boxMask = r.u16();
  const m = r.u8();
  for (let i = 0; i < m; i++) s.objects.push({ id: r.u16(), type: r.u8(), x: r.i16() / 4, y: r.i16() / 4, aux: r.u8() });
  return s;
}

const find = (list, slot) => {
  for (let i = 0; i < list.length; i++) if (list[i].slot === slot) return list[i];
  return null;
};

export function createGame() {
  let net, session, input, sfx, view, scene, hud, flat, reducedMotion;
  let track = KART_TRACKS.ring;
  let latest = null;
  let lastLight = 0;
  let banner = null;
  let rollUntil = 0;
  let engine = null; // your own engine
  let rival = null; // the nearest other kart's engine
  let screech = null; // tyres while drifting
  let rumble = null; // grass under the wheels
  let engineTry = 0;
  let lastCharge = 0;
  let lastFrame = 0;
  const buffer = new SnapshotBuffer();
  const writer = new ByteWriter(16);
  const sendInput = { ax: 0, ay: 0, buttons: 0, aim: 0 };
  const serverState = createKartState();
  const scratch = { x: 0, y: 0, depth: 0 };
  const q = createTrackQuery();
  let boxH = [];
  let flashUntil = 0; // lightning: a white flash over the screen

  // Road height under (x, y): 0 on flat tracks.
  const groundAt = (x, y) => (track.hilly ? trackQuery(track, x, y, q).h : 0);
  // Height and slope along the heading for a kart.
  function ground(k) {
    if (!track.hilly) {
      k.h = 0;
      k.climb = 0;
      return;
    }
    trackQuery(track, k.x, k.y, q);
    k.h = q.h;
    k.climb = q.slope * (k.hx * track.tx[q.seg] + k.hy * track.ty[q.seg]);
  }
  const lerpObj = (sample, o, key) => {
    const prev = sample ? sample.a.state.objects.find((p) => p.id === o.id) : null;
    const next = sample ? sample.b.state.objects.find((p) => p.id === o.id) : null;
    return prev && next ? lerp(prev[key], next[key], sample.t) : o[key];
  };

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
    boxH = t.boxes.map((bx) => groundAt(bx.x, bx.y));
    scene?.setTrack(t);
    hud.setTrack(t);
    predictor.reset();
    buffer.clear();
  }

  return {
    mount(v, netRef, ctx) {
      view = v;
      reducedMotion = ctx.reducedMotion;
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
      setTrack(Math.max(0, KART_TRACK_IDS.indexOf(KART_CUPS[first]?.[0] ?? first)));
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
          if (msg.item === ITEM.ORB) sfx.play('shoot');
          else if (msg.item === ITEM.OIL) sfx.play('splat');
          else if (msg.item === ITEM.SHIELD) sfx.play('ready');
          else if (msg.item === ITEM.ROCKET) sfx.play('rocket');
          else if (msg.item === ITEM.BOMB) sfx.play('throw');
          else if (msg.item === ITEM.STAR) {
            sfx.play('star');
            if (msg.s === slot) banner = { text: 'SUPERSTER!', sub: 'niemand kan je raken', color: '#ffd23e', until: now + 1500 };
          }
          break;
        case 'zap':
          sfx.play('zap');
          if (!reducedMotion) flashUntil = now + 140;
          if (msg.s !== slot) banner = { text: 'BLIKSEM!', sub: `door ${playerBySlot(msg.s)?.name ?? '?'}`, color: '#ffe14d', until: now + 1300 };
          break;
        case 'boom':
          scene?.burst(msg.x, msg.y, '#ff8a2a', 60, groundAt(msg.x, msg.y), true);
          scene?.burst(msg.x, msg.y, '#5a5550', 24, groundAt(msg.x, msg.y), true);
          sfx.play('explode');
          break;
        case 'spin': {
          const h = groundAt(msg.x, msg.y);
          if (msg.item === ITEM.LIGHTNING) scene?.zap(msg.x, msg.y, h);
          else scene?.burst(msg.x, msg.y, '#ff5a36', 26, h);
          if (msg.item !== ITEM.LIGHTNING) sfx.play(msg.s === slot ? 'spin' : 'hit');
          else if (msg.s === slot) sfx.play('spin');
          if (msg.s === slot) banner = { text: 'OEPS!', sub: msg.by !== slot ? `geraakt door ${playerBySlot(msg.by)?.name ?? '?'}` : '', color: '#ff4d6d', until: now + 1200 };
          break;
        }
        case 'block': scene?.burst(msg.x, msg.y, '#7de0ff', 16, groundAt(msg.x, msg.y)); sfx.play('react'); break;
        case 'bump': sfx.play('bump'); break;
        case 'scrape': if (msg.s === slot) sfx.play('scrape'); break;
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

      // Sounds that follow your kart: engine (with gears), drift screech,
      // grass rumble, and the engine of whoever is right next to you.
      const now = performance.now();
      if (!engine && now > engineTry) {
        engine = sfx.engineSound?.() ?? null;
        rival = sfx.engineSound?.() ?? null;
        screech = sfx.loopSound?.('screech') ?? null;
        rumble = sfx.loopSound?.('rumble') ?? null;
        engineTry = now + 1000;
      }
      const s = predictor.ready && mine ? predictor.state : null;
      const racingNow = latest?.phase === KART_PHASE.RACE || latest?.phase === KART_PHASE.COUNTDOWN;
      if (engine) {
        if (s && racingNow) engine.set(Math.min(1.2, Math.abs(s.v) / KART_PHYS.MAX_SPEED), s.boost > 0);
        else engine.set(0, false, s ? 0.4 : 0); // idling on the grid; silent for spectators
      }
      screech?.set(s && racingNow && s.drift !== 0 ? 0.6 + Math.min(0.4, s.charge / KART_PHYS.CHARGE_2) : s && s.spin > 0 ? 0.8 : 0);
      rumble?.set(s && racingNow && s.off ? Math.min(1, Math.abs(s.v) / KART_PHYS.OFFROAD_SPEED) : 0);
      if (s && s.drift !== 0) {
        // A blip when the mini turbo charges up a level.
        const level = s.charge >= KART_PHYS.CHARGE_2 ? 2 : s.charge >= KART_PHYS.CHARGE_1 ? 1 : 0;
        if (level > lastCharge) sfx.play(level === 2 ? 'charge2' : 'charge1');
        lastCharge = level;
      } else lastCharge = 0;
      if (rival && latest) {
        let best = null;
        let bestD = 140;
        for (const k of latest.karts) {
          if (k.slot === mySlot() || !s) continue;
          const d = Math.hypot(k.x - s.x, k.y - s.y);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
        if (best && racingNow) rival.set(Math.min(1.2, Math.abs(best.v) / KART_PHYS.MAX_SPEED), best.boost > 0, 0.55 * (1 - bestD / 140));
        else rival.set(0, false, 0);
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
          ground(k);
          drawn.push(k);
        }
      }

      // Camera: you, or the leader when you watch.
      const leader = [...latest.karts].sort((p, q2) => p.place - q2.place)[0];
      const focus = drawn.find((k) => k.me) ?? drawn.find((k) => k.slot === leader?.slot) ?? drawn[0];
      if (scene) {
        if (focus) {
          const finished = mine?.finished || (latest.phase !== KART_PHASE.RACE && latest.phase !== KART_PHASE.COUNTDOWN);
          scene.camera(focus.x, focus.y, focus.hx, focus.hy, Math.min(1, Math.abs(focus.v) / KART_PHYS.MAX_SPEED), focus.boost > 0, frameDt,
            finished ? 'orbit' : 'chase', focus.h, track.hilly ? groundAt : null);
        }
        if (!scene.begin()) return;
        const hue = (frameNow / 600) % 1;
        track.boxes.forEach((bx, i) => {
          if (latest.boxMask & (1 << i)) scene.itemBox(bx.x, bx.y, hsl(hue + i * 0.08), boxH[i] ?? 0);
        });
        for (const o of latest.objects) {
          const x = lerpObj(sample, o, 'x');
          const y = lerpObj(sample, o, 'y');
          const h = groundAt(x, y);
          if (o.type === ITEM.ORB) scene.orb(x, y, h);
          else if (o.type === ITEM.ROCKET) {
            const prev = sample ? sample.a.state.objects.find((p) => p.id === o.id) : null;
            scene.rocket(x, y, prev ? o.x - prev.x : 1, prev ? o.y - prev.y : 0, h);
          } else if (o.type === ITEM.BOMB) scene.bomb(x, y, lerpObj(sample, o, 'aux') / 255, h);
          else scene.oil(x, y, h);
        }
        for (const k of drawn) {
          const steer = k.me ? input.state.ax : 0;
          scene.kart(k.x, k.y, k.hx, k.hy, rgb(hexOf(k.slot)), { drift: k.drift, steer, spin: k.spin, h: k.h, climb: k.climb, star: k.src.star });
          scene.effects(k.x, k.y, k.hx, k.hy, k);
        }
        for (const k of drawn) {
          scene.shadow(k.x, k.y, k.h);
          if (k.src.shield) scene.shield(k.x, k.y, k.h);
        }
        scene.endParticles();
        // Names above the other karts: nearest first, skip labels that would overlap.
        const labels = [];
        for (const k of drawn) {
          if (k.me) continue;
          const p = scene.project(k.x, k.y, 13 + k.h, scratch);
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
      if (frameNow < flashUntil) hud.flash((flashUntil - frameNow) / 140);
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
      for (const snd of [engine, rival, screech, rumble]) snd?.stop();
      engine = rival = screech = rumble = null;
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
