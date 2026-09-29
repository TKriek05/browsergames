// Neon Tikkertje (client side): prediction for your own runner, snapshot
// interpolation for everybody else, power-up orbs, sounds and effects.
import { TAG_PHYS, stepRunner } from '../../../shared/physics/tag.js';
import { POWERS, POWER, canTake } from '../../../shared/games/tag-powers.js';
import { TAG_ARENAS } from '../../../shared/maps/tag-arenas.js';
import { PLAYER_COLORS } from '../../../shared/constants.js';
import { ByteWriter, encodeInput, quantizeAxis } from '../../../shared/binary.js';
import { SnapshotBuffer, lerp } from '../../js/core/interp.js';
import { Predictor } from '../../js/core/predict.js';
import { createRenderer } from './render.js';

export const meta = {
  width: 320,
  height: 180,
  pixelated: true,
  step: TAG_PHYS.DT, // same fixed step as the server simulation
  touchButtons: [], // joystick only
};

const PHASE = { COUNTDOWN: 0, PLAY: 1, END: 2 };

// Snapshot body, see server/games/tag.js
function decode(snap) {
  const r = snap.reader;
  const phase = r.u8();
  const remaining = r.f32();
  const itSlot = r.u8();
  const count = r.u8();
  const ents = new Array(count);
  for (let i = 0; i < count; i++) {
    const slot = r.u8();
    const flags = r.u8();
    ents[i] = {
      slot,
      bot: (flags & 1) !== 0,
      immune: (flags & 2) !== 0,
      connected: (flags & 4) !== 0,
      shield: (flags & 8) !== 0,
      reach: (flags & 16) !== 0,
      ack: r.u16(),
      x: r.f32(), y: r.f32(), vx: r.f32(), vy: r.f32(), stun: r.f32(), boost: r.f32(), slow: r.f32(),
      itTime: r.u16() / 10,
      tags: r.u8(),
    };
  }
  const orbCount = r.u8();
  const orbs = new Array(orbCount);
  for (let i = 0; i < orbCount; i++) orbs[i] = { id: r.u8(), power: r.u8(), x: r.u16(), y: r.u16(), life: r.u8() / 10 };
  return { time: snap.time, phase, endsAt: snap.time + remaining * 1000, itSlot, ents, orbs };
}

const findSlot = (ents, slot) => {
  for (let i = 0; i < ents.length; i++) if (ents[i].slot === slot) return ents[i];
  return null;
};

export function createGame() {
  let net, session, input, sfx, renderer;
  let walls = [];
  let latest = null;
  let lastCountdown = 0;
  let banner = null; // { text, sub, color, until } after taking a power-up
  const buffer = new SnapshotBuffer();
  const writer = new ByteWriter(16);
  const sendInput = { ax: 0, ay: 0, buttons: 0, aim: 0 };
  const serverState = { x: 0, y: 0, vx: 0, vy: 0, stun: 0, boost: 0, slow: 0, it: false };

  const predictor = new Predictor({
    create: () => ({ x: 0, y: 0, vx: 0, vy: 0, stun: 0, boost: 0, slow: 0, it: false }),
    copy: (d, s) => { d.x = s.x; d.y = s.y; d.vx = s.vx; d.vy = s.vy; d.stun = s.stun; d.boost = s.boost; d.slow = s.slow; d.it = s.it; },
    step: (s, inp) => stepRunner(s, inp.ax, inp.ay, TAG_PHYS.DT, walls, s.it),
  });

  const mySlot = () => {
    const me = session.myPlayer;
    return me && me.role === 'player' ? me.slot : -1;
  };
  const playerBySlot = (slot) => session.room?.players.find((p) => p.slot === slot) ?? null;
  const colorOf = (slot) => PLAYER_COLORS[playerBySlot(slot)?.color ?? slot % PLAYER_COLORS.length].hex;

  return {
    mount(view, netRef, ctx) {
      net = netRef;
      session = ctx.session;
      input = ctx.input;
      sfx = ctx.sfx;
      walls = (TAG_ARENAS[ctx.start.settings.arena] ?? TAG_ARENAS.pillars).walls;
      renderer = createRenderer(view, { walls, reducedMotion: ctx.reducedMotion });
    },

    onSnapshot(snap) {
      const s = decode(snap);
      latest = s;
      buffer.push(s.time, s);

      const slot = mySlot();
      const mine = slot >= 0 ? findSlot(s.ents, slot) : null;
      if (mine) {
        serverState.x = mine.x;
        serverState.y = mine.y;
        serverState.vx = mine.vx;
        serverState.vy = mine.vy;
        serverState.stun = mine.stun;
        serverState.boost = mine.boost;
        serverState.slow = mine.slow;
        serverState.it = s.itSlot === slot;
        predictor.reconcile(serverState, mine.ack);
      }
    },

    onEvent(msg) {
      if (msg.e === 'power') {
        const power = POWERS[msg.p];
        if (!power) return;
        renderer.burst(msg.x, msg.y, power.color, 18);
        if (msg.p === POWER.FREEZE) renderer.wave(msg.x, msg.y, power.color);
        if (msg.id === session.me) {
          banner = { text: power.name, sub: power.help, color: power.color, until: performance.now() + 1600 };
          sfx.play(msg.p === POWER.TURBO ? 'boost' : msg.p === POWER.FREEZE ? 'spin' : 'coin');
        } else sfx.play(msg.p === POWER.FREEZE ? 'spin' : 'item');
        return;
      }
      if (msg.e === 'warp') {
        const p = session.room?.players.find((x) => x.id === msg.id);
        const color = p ? PLAYER_COLORS[p.color].hex : '#c07bff';
        renderer.burst(msg.x0, msg.y0, '#c07bff', 16);
        renderer.burst(msg.x, msg.y, color, 16);
        return;
      }
      if (msg.e === 'go') sfx.play('go');
      else if (msg.e === 'end') sfx.play('countdown');
      else if (msg.e === 'tag' || msg.e === 'pass') {
        const to = session.room?.players.find((p) => p.id === msg.to);
        const color = to ? PLAYER_COLORS[to.color].hex : '#fff';
        if (msg.e === 'tag') renderer.burst(msg.x, msg.y, color, 28);
        const involvesMe = msg.to === session.me || msg.from === session.me;
        sfx.play(involvesMe ? 'tag' : 'hit');
        renderer.shake(involvesMe ? 5 : 2);
      }
    },

    onReconnect() {
      predictor.reset();
      buffer.clear();
    },

    update(dt) {
      const inp = input.sample();
      const slot = mySlot();
      const playing = latest && latest.phase === PHASE.PLAY && slot >= 0 && predictor.ready && findSlot(latest.ents, slot);
      if (playing) {
        // Quantize exactly like the wire does, so client and server compute the same.
        sendInput.ax = quantizeAxis(inp.ax);
        sendInput.ay = quantizeAxis(inp.ay);
        sendInput.buttons = inp.buttons;
        sendInput.aim = inp.aim;
        const seq = predictor.apply(sendInput);
        net.sendBinary(encodeInput(writer, seq, sendInput));
      } else {
        predictor.idle();
      }
      renderer.update(dt);

      if (latest?.phase === PHASE.COUNTDOWN) {
        const left = Math.ceil((latest.endsAt - net.serverNow()) / 1000);
        if (left > 0 && left !== lastCountdown) sfx.play('countdown');
        lastCountdown = left;
      }
    },

    render(alpha) {
      renderer.begin();
      const now = net.serverNow();
      const sample = buffer.sample(now);
      if (latest?.phase === PHASE.PLAY) {
        const slot = mySlot();
        const iAmIt = slot >= 0 && latest.itSlot === slot;
        for (const orb of latest.orbs) {
          const power = POWERS[orb.power];
          if (power) renderer.drawOrb(orb, power, slot < 0 || canTake(power, iAmIt));
        }
      }
      if (sample && latest) {
        const slot = mySlot();
        const b = sample.b.state;
        const a = sample.a.state;
        for (const eb of b.ents) {
          const player = playerBySlot(eb.slot);
          const color = colorOf(eb.slot);
          const isMe = eb.slot === slot && predictor.ready;
          let x, y, vx, vy;
          if (isMe) {
            x = predictor.get('x', alpha);
            y = predictor.get('y', alpha);
            vx = predictor.state.vx;
            vy = predictor.state.vy;
          } else {
            const ea = findSlot(a.ents, eb.slot) ?? eb;
            x = lerp(ea.x, eb.x, sample.t);
            y = lerp(ea.y, eb.y, sample.t);
            vx = eb.vx;
            vy = eb.vy;
          }
          // Use the newest known "it" so the crown switches without delay.
          const it = latest.itSlot === eb.slot;
          if (it && latest.phase === PHASE.PLAY) renderer.trail(x, y, color);
          const fx = isMe ? predictor.state : eb;
          renderer.drawRunner(x, y, vx, vy, color, {
            it,
            stunned: fx.stun > 0,
            boost: fx.boost > 0,
            slow: fx.slow > 0,
            shield: eb.shield,
            reach: eb.reach,
            immune: eb.immune,
            me: eb.slot === slot,
            name: player?.name ?? '?',
            connected: eb.connected,
          });
        }
      }
      renderer.drawParticles();

      if (latest) {
        const itPlayer = latest.itSlot !== 255 ? playerBySlot(latest.itSlot) : null;
        const left = Math.max(0, latest.endsAt - now);
        const secs = Math.ceil(left / 1000);
        renderer.drawHud({
          phase: latest.phase,
          countdown: latest.phase === PHASE.COUNTDOWN ? left / 1000 : 0,
          timeText: latest.phase === PHASE.PLAY ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '',
          itName: itPlayer?.name ?? '',
          itColor: itPlayer ? PLAYER_COLORS[itPlayer.color].hex : '#fff',
          spectator: mySlot() < 0,
          banner: banner && performance.now() < banner.until ? banner : null,
        });
      }
      renderer.end();
    },

    unmount() {
      buffer.clear();
    },
  };
}
