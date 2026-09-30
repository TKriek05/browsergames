// Spetterveld (client side): first-person paintball in 3D. You are predicted
// with the shared physics (walking, jumping, stairs); the others are
// interpolated. Mouse look via pointer lock (click the field: left/right and
// up/down), WASD to walk, space to jump, click to shoot. Touch: stick on the
// left, drag on the right to look. Your shots show at once; the server
// decides what they hit (lag compensated) and tells everyone. Power-ups lie
// on four pads; paint stays where it lands, also on the players.
import { INTERP_DELAY_MS } from '../../../shared/constants.js';
import { BTN, C2S } from '../../../shared/messages.js';
import { PB_ARENAS } from '../../../shared/maps/paintball-arenas.js';
import { PB_PHYS, stepRunner, raycast, rayPlayer, aimDir, lineOfSight, groundHeight } from '../../../shared/physics/paintball.js';
import { PB_RULES as R, PB_FLAG, PB_POWERS, PB_POWER, PB_POWER_RULES as PR, i16ToYaw, wrapAngle } from '../../../shared/games/paintball.js';
import { createArcadeCore, ARCADE_PHASE } from '../common/arcade.js';
import { Predictor } from '../../js/core/predict.js';
import { isTouchDevice } from '../../js/core/input.js';
import { rgb } from '../../js/gl/mesh.js';
import { createPaintScene } from './scene.js';
import { createPaintHud, createFallback2D } from './hud.js';
import { createControls } from './controls.js';
import { drawPowerHud } from './powers.js';

export const meta = {
  width: 480,
  height: 270,
  pixelated: false,
  gl: true,
  step: PB_PHYS.DT,
  touchButtons: [{ label: 'LAAD', bit: BTN.B }, { label: 'SPRING', bit: BTN.X }, { label: 'VUUR', bit: BTN.A }],
  keys: {
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    left: ['KeyA'],
    right: ['KeyD'],
    A: ['KeyJ', 'Enter', 'KeyF'],
    B: ['KeyR'],
    X: ['Space'],
    turnLeft: ['ArrowLeft', 'KeyQ'],
    turnRight: ['ArrowRight', 'KeyE'],
    lookUp: ['PageUp', 'KeyT'],
    lookDown: ['PageDown', 'KeyG'],
  },
};

const KEY_TURN = 2.6; // rad/s
const KEY_TILT = 1.4;
const PAD_TURN = 3.4;
const PAD_TILT = 2;
const ASSIST_RAD = 0.085; // touch/gamepad: shots snap to a player this close to the crosshair
const CHEST = 10; // aim assist and labels: this high above a player's feet
const LOOK_EVERY_MS = 150; // tell the server where you look (up/down) at most this often
const FEED_S = 6;
const MAX_MARKS = 4; // paint spots on a player
const CAMO_ALPHA = 0.14;

function decode(r, time) {
  const s = { time, phase: r.u8(), endsAt: 0, ents: [], pads: [] };
  s.endsAt = time + r.f32() * 1000;
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    const slot = r.u8();
    const flags = r.u8();
    s.ents.push({
      slot, flags, ack: r.u16(),
      x: r.f32(), y: r.f32(), z: r.f32(), vx: r.f32(), vy: r.f32(), vz: r.f32(), boost: r.f32(), ground: r.u8(),
      yaw: i16ToYaw(r.i16()), pitch: i16ToYaw(r.i16()),
      hp: r.u8(), ammo: r.u8(), kills: r.i16(), deaths: r.u8(), respawn: r.u8() / 10, reload: r.u8() / 10,
      armor: r.u8(), rapid: r.u8() / 10, spread: r.u8() / 10, camo: r.u8() / 10,
      alive: (flags & PB_FLAG.ALIVE) !== 0,
    });
  }
  const m = r.u8();
  for (let i = 0; i < m; i++) s.pads.push(r.u8());
  return s;
}

const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;
// Radius of the round solid a ray hit (0 = flat): splats bend around it.
const bendOf = (arena, i, nz) => (i >= 0 && arena.solids[i].t === 'can' && Math.abs(nz) < 0.5 ? arena.solids[i].r : 0);
const clampPitch = (p) => Math.max(-R.MAX_PITCH, Math.min(R.MAX_PITCH, p));

export function createGame() {
  let net, input, sfx, view, scene, hud, flat, arena, reduced, controls;
  let yaw = 0;
  let pitch = 0;
  let sentPitch = 0;
  let lookAt = 0;
  let syncYaw = true;
  let touch = false;
  let ammo = R.HOPPER;
  let reload = 0;
  let cooldown = 0;
  let lastShotAt = 0;
  let hitAt = -10;
  let deathAt = 0;
  let killer = '';
  let banner = null;
  let walkMe = 0;
  let lastFrame = 0;
  let wasAlive = false;
  const feed = []; // { by, byColor, victim, victimColor, at }
  const walk = new Map(); // slot → walk phase
  const shownYaw = new Map(); // slot → smoothed body angle
  const drawn = new Map(); // slot → { x, y, z } where others were drawn (for local hit tests)
  const marks = new Map(); // slot → paint colours on that player
  const scratch = { x: 0, y: 0, depth: 0 };
  const ray = { nx: 0, ny: 0, nz: 0, solid: -1 };
  const dir = { x: 0, y: 0, z: 0 };
  const timers = [[PB_POWER.RAPID, 0], [PB_POWER.SPREAD, 0], [PB_POWER.SPRINT, 0], [PB_POWER.CAMO, 0], [PB_POWER.ARMOR, 0]];

  const KEYS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'boost', 'ground'];
  const predictor = new Predictor({
    create: () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, boost: 0, ground: 1 }),
    copy: (d, s) => { for (const k of KEYS) d[k] = s[k]; },
    step: (s, inp) => stepRunner(s, inp.ax, inp.ay, (inp.buttons & BTN.X) !== 0, PB_PHYS.DT, arena),
    smoothKeys: ['x', 'y', 'z'],
  });
  const core = createArcadeCore({
    decode,
    predictor,
    toServer: (m, o) => { for (const k of KEYS) o[k] = m[k]; },
  });
  // The floor under a player (paint drops there, also when they were jumping).
  const floorUnder = (x, y, z) => groundHeight(arena, x, y, PB_PHYS.RADIUS - 0.5, z + PB_PHYS.STEP);
  const turnFromControls = () => {
    if (!controls) return;
    yaw = wrapAngle(yaw + controls.take());
    pitch = clampPitch(pitch + controls.takePitch());
  };
  const nowS = () => performance.now() / 1000;

  function startReload() {
    if (reload > 0 || ammo >= R.HOPPER) return;
    reload = R.RELOAD_S;
    sfx.play('reload');
  }

  // Touch and gamepad players get a little help: aim at a visible player right
  // next to the crosshair. Writes the view angle and pitch into aim.
  const aim = { a: 0, p: 0 };
  function assisted(a, p, px, py, pz) {
    aim.a = a;
    aim.p = p;
    if (input.lastSource === 'keyboard' || controls.locked) return aim;
    let bestD = ASSIST_RAD;
    for (const [, q] of drawn) {
      const ta = Math.atan2(q.y - py, q.x - px);
      const tp = Math.atan2(q.z + CHEST - pz, Math.hypot(q.x - px, q.y - py));
      const d = Math.hypot(wrapAngle(ta - a), tp - p);
      if (d < bestD && Math.hypot(q.x - px, q.y - py) < 300 && lineOfSight(arena, px, py, pz, q.x, q.y, q.z + CHEST)) {
        bestD = d;
        aim.a = ta;
        aim.p = tp;
      }
    }
    return aim;
  }

  function fire(mine) {
    if (cooldown > 0 || reload > 0) return;
    if (ammo <= 0) return startReload();
    const rapid = (mine.flags & PB_FLAG.RAPID) !== 0;
    cooldown = rapid ? PR.RAPID_COOLDOWN_S : R.COOLDOWN_S;
    if (!rapid) ammo--;
    lastShotAt = nowS();
    const px = predictor.state.x;
    const py = predictor.state.y;
    const pz = predictor.state.z + PB_PHYS.EYE;
    const { a, p } = assisted(yaw, pitch, px, py, pz);
    const round2 = (v) => Math.round(v * 100) / 100;
    net.send(C2S.INPUT, { data: { a, p, t: net.serverNow() - INTERP_DELAY_MS, x: round2(px), y: round2(py), z: round2(pz) } });
    sentPitch = p;
    // Show the ball(s) right away: each stops at the first surface or player we see.
    const offsets = mine.flags & PB_FLAG.SPREAD ? [0, -PR.SPREAD_RAD, PR.SPREAD_RAD] : [0];
    for (const off of offsets) {
      const d = aimDir(a + off, p, dir);
      let end = raycast(arena, px, py, pz, d.x, d.y, d.z, R.RANGE, ray);
      let paint = ray.solid >= 0 || ray.solid === -2;
      for (const [, q] of drawn) {
        const t = rayPlayer(px, py, pz, d.x, d.y, d.z, q.x, q.y, q.z);
        if (t < end) {
          end = t;
          paint = false;
        }
      }
      scene?.ball(px, py, pz, a + off, p, px + d.x * end, py + d.y * end, pz + d.z * end, core.hex(core.mySlot()), paint, ray, bendOf(arena, ray.solid, ray.nz));
    }
    scene?.kick();
    sfx.play('marker');
    if (ammo === 0) startReload();
  }

  function addMark(slot, color) {
    const list = marks.get(slot) ?? [];
    list.push(color);
    if (list.length > MAX_MARKS) list.shift();
    marks.set(slot, list);
  }

  // Keep the local hopper in step with the server when we are not shooting.
  function syncAmmo(mine) {
    if (nowS() - lastShotAt < 0.6) return;
    const serverReloading = (mine.flags & PB_FLAG.RELOAD) !== 0;
    if (serverReloading && reload <= 0) reload = mine.reload;
    else if (!serverReloading) {
      if (reload > 0 && mine.ammo === R.HOPPER) reload = 0;
      if (reload <= 0) ammo = mine.ammo;
    }
  }

  return {
    mount(v, netRef, ctx) {
      view = v;
      net = netRef;
      input = ctx.input;
      sfx = ctx.sfx;
      reduced = ctx.reducedMotion;
      touch = isTouchDevice();
      core.mount(netRef, ctx);
      arena = PB_ARENAS[ctx.start.settings.arena] ?? PB_ARENAS.haven;
      hud = createPaintHud(view);
      scene = view.glCanvas ? createPaintScene(view.glCanvas, { arena, reducedMotion: reduced }) : null;
      if (!scene) {
        view.glCanvas?.remove();
        flat = createFallback2D(view, arena);
      }
      view.canvas.style.touchAction = 'none';
      controls = createControls(view.canvas, touch);
    },

    onSnapshot(snap) {
      core.onSnapshot(snap);
      const mine = core.mine();
      if (mine) syncAmmo(mine);
    },

    onEvent(msg) {
      const me = core.mySlot();
      switch (msg.e) {
        case 'go': sfx.play('go'); break;
        case 'shot': {
          if (msg.s === me) break; // already shown when we fired
          const dx = msg.x1 - msg.x0;
          const dy = msg.y1 - msg.y0;
          const dz = msg.z1 - msg.z0;
          const len = Math.hypot(dx, dy, dz) || 1;
          let paint = false;
          if (msg.h < 0) {
            raycast(arena, msg.x0, msg.y0, msg.z0, dx / len, dy / len, dz / len, len + 1, ray);
            paint = ray.solid >= 0 || ray.solid === -2;
          }
          const a = Math.atan2(dy, dx);
          const p = Math.atan2(dz, Math.hypot(dx, dy));
          scene?.ball(msg.x0, msg.y0, msg.z0, a, p, msg.x1, msg.y1, msg.z1, core.hex(msg.s), paint, ray, paint ? bendOf(arena, ray.solid, ray.nz) : 0);
          scene?.muzzle(msg.x0, msg.y0, msg.z0, a, core.hex(msg.s));
          sfx.play('markerFar');
          break;
        }
        case 'hit': {
          const p = drawn.get(msg.s);
          if (p) scene?.paintHit(p.x, p.y, p.z, floorUnder(p.x, p.y, p.z), core.hex(msg.by), false);
          addMark(msg.s, core.hex(msg.by));
          if (msg.s === me) {
            hud.splash(core.hex(msg.by));
            sfx.play('hit');
          } else if (msg.by === me) {
            hitAt = nowS();
            sfx.play('splat');
          }
          break;
        }
        case 'splat': {
          scene?.paintHit(msg.x, msg.y, msg.z, floorUnder(msg.x, msg.y, msg.z), core.hex(msg.by), true);
          feed.unshift({ by: core.name(msg.by), byColor: core.hex(msg.by), victim: core.name(msg.s), victimColor: core.hex(msg.s), at: nowS() });
          feed.length = Math.min(feed.length, 4);
          if (msg.s === me) {
            deathAt = nowS();
            killer = core.name(msg.by);
            hud.splash(core.hex(msg.by));
            hud.splash(core.hex(msg.by));
            sfx.play('lose');
          } else if (msg.by === me) {
            banner = { text: 'SPETTER!', sub: `${core.name(msg.s)} is uitgeschakeld`, color: '#ffe14d', until: nowS() + 1.4 };
            sfx.play('coin');
          }
          break;
        }
        case 'block': sfx.play('react'); break;
        case 'armor': {
          const p = drawn.get(msg.s);
          if (p) scene?.deflect(p.x, p.y, p.z);
          sfx.play(msg.s === me ? 'thud' : 'react');
          if (msg.by === me) hitAt = nowS();
          break;
        }
        case 'power': {
          const pw = PB_POWERS[msg.type];
          const pad = arena.pads[msg.pad];
          if (pad) scene?.pickup(pad.x, pad.y, pad.z, pw.color);
          if (msg.s === me) {
            banner = { text: pw.name.toUpperCase() + '!', sub: pw.tip, color: pw.color, until: nowS() + 1.6 };
            sfx.play('item');
            if (msg.type === PB_POWER.RAPID) {
              ammo = R.HOPPER;
              reload = 0;
            }
          } else sfx.play('coin');
          break;
        }
        case 'spawn':
          marks.delete(msg.s);
          if (msg.s === me) {
            predictor.reset();
            syncYaw = true;
            ammo = R.HOPPER;
            reload = 0;
            sfx.play('join');
          }
          break;
        case 'reload':
          if (msg.s === me && reload <= 0 && ammo < R.HOPPER) reload = R.RELOAD_S;
          break;
        case 'end': sfx.play('win'); break;
        default: break;
      }
    },

    onReconnect() {
      core.reset();
      syncYaw = true;
    },

    update(dt) {
      scene?.update(dt);
      core.beep();
      cooldown = Math.max(0, cooldown - dt);
      if (reload > 0) {
        reload -= dt;
        if (reload <= 0) {
          reload = 0;
          ammo = R.HOPPER;
        }
      }
      const L = core.latest;
      const mine = core.mine();
      const alive = !!mine && mine.alive;
      if (alive && !wasAlive) syncYaw = true;
      wasAlive = alive;
      turnFromControls();
      if (syncYaw && alive) {
        yaw = mine.yaw;
        pitch = 0;
        syncYaw = false;
      }
      if (!L || !mine || !alive) {
        core.idle();
        return;
      }
      const inp = input.sample();
      const turn = (input.pressed('turnRight') ? 1 : 0) - (input.pressed('turnLeft') ? 1 : 0);
      const tilt = (input.pressed('lookUp') ? 1 : 0) - (input.pressed('lookDown') ? 1 : 0);
      yaw = wrapAngle(yaw + turn * KEY_TURN * dt + inp.rx * PAD_TURN * dt);
      pitch = clampPitch(pitch + tilt * KEY_TILT * dt - inp.ry * PAD_TILT * dt);
      // Let the others see where you look (up or down).
      const nowMs = performance.now();
      if (Math.abs(pitch - sentPitch) > 0.04 && nowMs - lookAt > LOOK_EVERY_MS) {
        net.send(C2S.INPUT, { data: { p: Math.round(pitch * 1000) / 1000 } });
        sentPitch = pitch;
        lookAt = nowMs;
      }
      if (L.phase !== ARCADE_PHASE.PLAY || !predictor.ready) {
        core.idle();
        return;
      }
      const fwd = -inp.ay;
      const side = inp.ax;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      let wx = c * fwd - s * side;
      let wy = s * fwd + c * side;
      const len = Math.hypot(wx, wy);
      if (len > 1) { wx /= len; wy /= len; }
      core.send(wx, wy, inp.buttons & BTN.B, yaw);
      if (inp.buttons & BTN.B) startReload();
      if (inp.buttons & BTN.A || controls.mouseFire) fire(mine);
    },

    render(alpha) {
      hud.clear();
      turnFromControls();
      const frameNow = performance.now();
      const frameDt = lastFrame ? Math.min(0.1, (frameNow - lastFrame) / 1000) : 0;
      lastFrame = frameNow;
      const L = core.latest;
      const me = core.mySlot();
      const mine = core.mine();
      const alive = !!mine && mine.alive && predictor.ready;
      const px = alive ? predictor.get('x', alpha) : mine?.x ?? arena.width / 2;
      const py = alive ? predictor.get('y', alpha) : mine?.y ?? arena.height / 2;
      const pz = alive ? predictor.get('z', alpha) : mine?.z ?? 0;
      const onGround = alive && predictor.state.ground;
      const speed = onGround ? Math.hypot(predictor.state.vx, predictor.state.vy) : 0;
      walkMe += speed * frameDt * 0.2;
      const bob = alive && !reduced ? Math.sin(walkMe * 2) * 0.28 * Math.min(1, speed / PB_PHYS.SPEED) : 0;
      const dead = mine && !mine.alive ? Math.max(0.01, nowS() - deathAt) : 0;
      if (scene) {
        if (!scene.begin({ x: px, y: py, z: pz, yaw, pitch, bob, dead, overview: me < 0 || !L })) return;
      } else flat.begin();
      if (!L) {
        scene?.endWorld();
        return;
      }

      const sample = core.sample();
      const labels = [];
      const shields = [];
      drawn.clear();
      if (scene) scene.pads(arena.pads, L.pads);
      core.each(sample, 'ents', 'slot', (eb, x, y, z) => {
        if (!eb.alive) return;
        const hex = core.hex(eb.slot);
        const camo = (eb.flags & PB_FLAG.CAMO) !== 0;
        if (eb.slot === me) {
          if (!scene) flat.player(px, py, yaw, hex, true);
          return;
        }
        const sy = lerpAngle(shownYaw.get(eb.slot) ?? eb.yaw, eb.yaw, Math.min(1, frameDt * 14));
        shownYaw.set(eb.slot, sy);
        const sp = eb.ground ? Math.hypot(eb.vx, eb.vy) : 0;
        const w = (walk.get(eb.slot) ?? 0) + sp * frameDt * 0.2;
        walk.set(eb.slot, w);
        drawn.set(eb.slot, { x, y, z });
        const near = Math.hypot(x - px, y - py, z - pz) < PR.CAMO_SIGHT;
        if (scene) scene.player(x, y, z, sy, eb.pitch, w, sp, rgb(hex), marks.get(eb.slot), camo ? CAMO_ALPHA : 1, !eb.ground);
        else if (!camo || near) flat.player(x, y, sy, hex, false);
        if (eb.flags & PB_FLAG.SHIELD && (!camo || near)) shields.push([x, y, z, hex]);
        if ((!camo || near || me < 0) && (me < 0 || !alive || lineOfSight(arena, px, py, pz + PB_PHYS.EYE, x, y, z + CHEST))) labels.push([x, y, z, eb.slot, hex]);
      });
      if (scene) {
        scene.balls();
        for (const [x, y, z, hex] of shields) scene.shield(x, y, z, rgb(hex));
        scene.endWorld();
        if (alive) scene.viewGun(rgb(core.hex(me)), reload > 0, mine.camo > 0);
      }

      // --- HUD ---
      for (const [x, y, z, slot, hex] of labels) {
        const p = scene ? scene.project(x, y, z + 20, scratch) : null;
        if (p && p.depth < 320) hud.label(p.x, p.y, core.name(slot), hex);
      }
      if (alive) hud.splashes();
      const left = core.secondsLeft();
      if (L.phase === ARCADE_PHASE.PLAY) hud.timer(`${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`);
      hud.scoreboard([...L.ents].sort((a, b) => b.kills - a.kills).slice(0, 6)
        .map((e) => ({ name: core.name(e.slot), color: core.hex(e.slot), kills: e.kills, me: e.slot === me })));
      const t = nowS();
      hud.feed(feed.filter((f) => t - f.at < FEED_S));

      if (alive) {
        hud.crosshair(t - hitAt, core.hex(me));
        hud.health(mine.hp);
        hud.ammo(ammo, reload, core.hex(me), (mine.flags & PB_FLAG.RAPID) !== 0);
        timers[0][1] = mine.rapid;
        timers[1][1] = mine.spread;
        timers[2][1] = predictor.state.boost;
        timers[3][1] = mine.camo;
        timers[4][1] = mine.armor;
        drawPowerHud(hud.ctx, timers, 8, view.height - 42);
      }
      if (L.phase === ARCADE_PHASE.COUNTDOWN) hud.center(String(Math.max(1, Math.ceil(left))), 'SPETTER ZE ONDER DE VERF!');
      else if (L.phase === ARCADE_PHASE.END) hud.center('EINDE!', '');
      else if (mine && !mine.alive) hud.center('GESPETTERD!', `${killer ? `door ${killer} · ` : ''}terug over ${Math.max(1, Math.ceil(mine.respawn))}`, '#ff5c7a');
      else if (banner && t < banner.until) hud.center(banner.text, banner.sub, banner.color);
      else if (me < 0) hud.center('', 'JE KIJKT MEE');
      if (alive && !touch && !controls.locked && !controls.lockFailed) hud.hint('Klik om te richten met de muis · Esc = muis los');
    },

    unmount() {
      controls?.destroy();
      scene?.destroy();
      core.reset();
    },
  };
}
