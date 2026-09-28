// Kwek Kwek Knal (client side). Your crosshair is local (mouse, touch, keys
// or gamepad). A shot is sent with the server time you were looking at, so
// the server can rewind the ducks (lag compensation). Ducks and the other
// crosshairs are interpolated from snapshots.
import { PLAYER_COLORS, INTERP_DELAY_MS } from '../../../shared/constants.js';
import { C2S, BTN } from '../../../shared/messages.js';
import { ByteWriter, encodeInput } from '../../../shared/binary.js';
import { DUCK_FIELD, DUCK_PHASE, DUCK_MODE, AMMO, cursorToAxis } from '../../../shared/games/duckshoot.js';
import { SnapshotBuffer, lerp } from '../../js/core/interp.js';
import { createDuckRenderer } from './render.js';

export const meta = {
  width: DUCK_FIELD.width,
  height: DUCK_FIELD.height,
  pixelated: true,
  step: 1 / 30,
  touchControls: false, // tap the ducks directly
};

const CURSOR_SPEED = 190; // px/s with keys or a gamepad
const LOCAL_TRUST_MS = 350; // prefer our own ammo count this long after a shot

function decode(snap) {
  const r = snap.reader;
  const s = {
    time: snap.time,
    phase: r.u8(), mode: r.u8(), round: r.u8(), rounds: r.u8(),
    endsAt: 0, roundHits: 0, roundTotal: 0, quota: 0, teamScore: 0,
    shooters: [], ducks: [],
  };
  s.endsAt = snap.time + r.f32() * 1000;
  s.roundHits = r.u8();
  s.roundTotal = r.u8();
  s.quota = r.u8();
  s.teamScore = r.i32();
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    const slot = r.u8();
    const flags = r.u8();
    s.shooters.push({
      slot, bot: (flags & 1) !== 0, connected: (flags & 2) !== 0, reloading: (flags & 4) !== 0,
      score: r.i32(), ammo: r.u8(), hits: r.u16(), shots: r.u16(),
      cx: r.u16() / 100, cy: r.u16() / 100, reload: r.u8() / 255,
    });
  }
  const m = r.u8();
  for (let i = 0; i < m; i++) {
    const id = r.u16();
    const type = r.u8();
    const st = r.u8();
    s.ducks.push({ id, type, state: st & 15, left: (st & 16) !== 0, x: r.i16() / 8, y: r.i16() / 8 });
  }
  return s;
}

export function createGame() {
  let net, session, input, sfx, view, renderer;
  let latest = null;
  let lastPhase = -1;
  let lastCountdown = 0;
  let outro = null; // { hits, total, ok, at }
  const buffer = new SnapshotBuffer();
  const writer = new ByteWriter(16);
  const sendInput = { ax: 0, ay: 0, buttons: 0, aim: 0 };
  const cursor = { x: DUCK_FIELD.width / 2, y: 80, moved: false };
  const local = { ammo: AMMO.MAGAZINE, reload: 0, cooldown: 0, lastShotAt: 0 };
  let seq = 0;
  let prevButtons = 0;
  let sendTimer = 0;
  let lastSentX = -1;
  let lastSentY = -1;
  const cleanups = [];

  const mySlot = () => {
    const me = session.myPlayer;
    return me && me.role === 'player' ? me.slot : -1;
  };
  const playerBySlot = (slot) => session.room?.players.find((p) => p.slot === slot) ?? null;
  const colorOf = (slot) => PLAYER_COLORS[playerBySlot(slot)?.color ?? slot % PLAYER_COLORS.length].hex;
  const isPlaying = () => latest?.phase === DUCK_PHASE.PLAY && mySlot() >= 0;
  const skyIndex = () => (latest ? Math.min(2, Math.floor(((latest.round - 1) / Math.max(1, latest.rounds)) * 3)) : 0);

  function fire() {
    if (!isPlaying() || local.reload > 0 || local.cooldown > 0) return;
    if (local.ammo <= 0) {
      reload();
      return;
    }
    local.ammo--;
    local.cooldown = AMMO.COOLDOWN_S;
    local.lastShotAt = performance.now();
    if (local.ammo === 0) local.reload = AMMO.RELOAD_S;
    // The ducks on screen are INTERP_DELAY_MS old: that is the moment we aimed at.
    net.send(C2S.INPUT, { data: { x: round1(cursor.x), y: round1(cursor.y), t: Math.round(net.serverNow() - INTERP_DELAY_MS) } });
    sfx.play('gun');
    renderer.shotRing(cursor.x, cursor.y, colorOf(mySlot()));
    renderer.fx.shake(2);
  }

  function reload() {
    if (!isPlaying() || local.reload > 0 || local.ammo >= AMMO.MAGAZINE) return;
    local.reload = AMMO.RELOAD_S;
    local.lastShotAt = performance.now();
    net.send(C2S.INPUT, { data: { r: 1 } });
    sfx.play('reload');
  }

  function onPointer(e) {
    const p = view.toLogical(e.clientX, e.clientY);
    cursor.x = clamp(p.x, 0, DUCK_FIELD.width);
    cursor.y = clamp(p.y, 0, DUCK_FIELD.height);
    cursor.moved = true;
  }

  return {
    mount(v, netRef, ctx) {
      view = v;
      net = netRef;
      session = ctx.session;
      input = ctx.input;
      sfx = ctx.sfx;
      renderer = createDuckRenderer(view, { reducedMotion: ctx.reducedMotion });
      const canvas = view.canvas;
      canvas.classList.add('game-canvas--aim');
      const move = (e) => onPointer(e);
      const down = (e) => {
        onPointer(e);
        if (e.button === 2) reload();
        else fire();
        e.preventDefault();
      };
      const menu = (e) => e.preventDefault();
      const key = (e) => {
        if (e.code === 'KeyR' && !e.repeat) reload();
      };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('contextmenu', menu);
      window.addEventListener('keydown', key);
      cleanups.push(() => {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('contextmenu', menu);
        window.removeEventListener('keydown', key);
      });
    },

    onSnapshot(snap) {
      const s = decode(snap);
      if (latest && s.round !== latest.round) buffer.clear();
      latest = s;
      buffer.push(s.time, s);
      if (s.phase !== lastPhase) {
        if (s.phase === DUCK_PHASE.COUNTDOWN) {
          local.ammo = AMMO.MAGAZINE;
          local.reload = 0;
        }
        lastPhase = s.phase;
      }
      const mine = s.shooters.find((x) => x.slot === mySlot());
      if (mine && performance.now() - local.lastShotAt > LOCAL_TRUST_MS) {
        local.ammo = mine.ammo;
        local.reload = mine.reloading ? (1 - mine.reload) * AMMO.RELOAD_S : 0;
      }
    },

    onEvent(msg) {
      const slot = mySlot();
      switch (msg.e) {
        case 'go': sfx.play('go'); break;
        case 'round': outro = null; break;
        case 'quack': if (Math.random() < 0.6) sfx.play('quack'); break;
        case 'shot': {
          if (msg.s !== slot) {
            renderer.shotRing(msg.x, msg.y, colorOf(msg.s));
            sfx.play('gunFar');
          }
          let total = 0;
          for (const hit of msg.hits) {
            total += hit.p;
            const duck = latest?.ducks.find((d) => d.id === hit.id);
            renderer.feathers(msg.x, msg.y, duck?.type ?? 0);
          }
          if (msg.hits.length) {
            sfx.play(total < 0 ? 'pop' : 'hit');
            const text = msg.hits.length > 1 && total > 0 ? `DUBBEL! +${total}` : total > 0 ? `+${total}` : String(total);
            renderer.fx.text(text, msg.x, msg.y - 10, total < 0 ? '#ff4d6d' : colorOf(msg.s), msg.hits.length > 1 ? 2 : 1, 1.1);
            if (msg.s === slot) renderer.fx.shake(total < 0 ? 4 : 3);
          }
          break;
        }
        case 'land': sfx.play('thud'); break;
        case 'escape': sfx.play('flap'); break;
        case 'roundEnd':
          outro = { hits: msg.hits, total: msg.total, ok: msg.ok, at: performance.now() };
          sfx.play(msg.ok && msg.hits >= msg.total * 0.6 ? 'win' : 'laugh');
          break;
        case 'end': sfx.play(msg.failed ? 'lose' : 'win'); break;
        default: break;
      }
    },

    onReconnect() {
      buffer.clear();
      local.lastShotAt = 0;
    },

    update(dt) {
      renderer.update(dt);
      if (local.cooldown > 0) local.cooldown = Math.max(0, local.cooldown - dt);
      if (local.reload > 0) {
        local.reload -= dt;
        if (local.reload <= 0) {
          local.reload = 0;
          local.ammo = AMMO.MAGAZINE;
        }
      }

      const inp = input.sample();
      if (inp.ax || inp.ay) {
        cursor.x = clamp(cursor.x + inp.ax * CURSOR_SPEED * dt, 0, DUCK_FIELD.width);
        cursor.y = clamp(cursor.y + inp.ay * CURSOR_SPEED * dt, 0, DUCK_FIELD.height);
        cursor.moved = true;
      }
      const pressed = inp.buttons & ~prevButtons;
      prevButtons = inp.buttons;
      if (pressed & BTN.A) fire();
      if (pressed & BTN.B) reload();

      // Share the crosshair position (others see it); skip when it did not move.
      sendTimer -= dt;
      if (mySlot() >= 0 && (cursor.x !== lastSentX || cursor.y !== lastSentY || sendTimer <= 0)) {
        const [ax, ay] = cursorToAxis(cursor.x, cursor.y);
        sendInput.ax = ax;
        sendInput.ay = ay;
        seq = (seq + 1) & 0xffff;
        net.sendBinary(encodeInput(writer, seq, sendInput));
        lastSentX = cursor.x;
        lastSentY = cursor.y;
        sendTimer = 0.5;
      }

      if (latest?.phase === DUCK_PHASE.COUNTDOWN) {
        const left = Math.ceil((latest.endsAt - net.serverNow()) / 1000);
        if (left > 0 && left !== lastCountdown) sfx.play('countdown');
        lastCountdown = left;
      }
    },

    render() {
      renderer.begin(skyIndex());
      const now = net.serverNow();
      const sample = buffer.sample(now);
      const slot = mySlot();
      if (sample && latest) {
        const a = sample.a.state;
        const b = sample.b.state;
        for (const db of b.ducks) {
          const da = a.ducks.find((d) => d.id === db.id) ?? db;
          renderer.duck(lerp(da.x, db.x, sample.t), lerp(da.y, db.y, sample.t), db.type, db.state, db.left, db.id);
        }
      }
      renderer.foreground();

      if (latest) {
        const phase = latest.phase;
        if (phase === DUCK_PHASE.COUNTDOWN) renderer.intro(latest.round, (latest.endsAt - now) / 1000);
        if (phase === DUCK_PHASE.ROUND_END && outro) {
          renderer.outro({ ...outro, coop: latest.mode === DUCK_MODE.COOP, age: (performance.now() - outro.at) / 1000 });
        }
        if (phase === DUCK_PHASE.END) {
          const coop = latest.mode === DUCK_MODE.COOP;
          renderer.banner(coop && outro && !outro.ok ? 'GAME OVER' : 'EINDE!', coop ? `SAMEN ${latest.teamScore} PUNTEN` : '');
        }

        // Other crosshairs (interpolated), then your own on top.
        if (sample) {
          const a = sample.a.state;
          for (const sb of sample.b.state.shooters) {
            if (sb.slot === slot) continue;
            const sa = a.shooters.find((x) => x.slot === sb.slot) ?? sb;
            renderer.crosshair(lerp(sa.cx, sb.cx, sample.t), lerp(sa.cy, sb.cy, sample.t), colorOf(sb.slot), false);
          }
        }
        if (slot >= 0) renderer.crosshair(cursor.x, cursor.y, colorOf(slot), true);

        const players = latest.shooters.map((s) => ({
          name: playerBySlot(s.slot)?.name ?? '?',
          color: colorOf(s.slot),
          score: s.score,
          connected: s.connected,
          isMe: s.slot === slot,
        }));
        renderer.hud({
          round: latest.round,
          rounds: latest.rounds,
          coop: latest.mode === DUCK_MODE.COOP,
          roundHits: latest.roundHits,
          roundTotal: latest.roundTotal,
          quota: latest.quota,
          players,
          me: slot >= 0,
          ammo: local.ammo,
          reloading: local.reload > 0,
          reloadProgress: 1 - local.reload / AMMO.RELOAD_S,
          spectator: slot < 0,
        });
      }
      renderer.end();
    },

    unmount() {
      for (const fn of cleanups) fn();
      buffer.clear();
    },
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round1 = (v) => Math.round(v * 10) / 10;
