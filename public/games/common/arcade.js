// Client helper for the phase-5 arcade games: snapshot buffer, optional
// prediction for your own entity, input sending, player colours/names and
// the countdown beeps. A game supplies decode(reader, time) → state with
// `phase`, `endsAt` and an `ents` list of { slot, ack?, … }.
import { PLAYER_COLORS } from '../../../shared/constants.js';
import { ByteWriter, encodeInput, quantizeAxis } from '../../../shared/binary.js';
import { ARCADE_PHASE } from '../../../shared/games/arcade.js';
import { SnapshotBuffer, lerp } from '../../js/core/interp.js';

export { lerp, ARCADE_PHASE };

export function createArcadeCore({ decode, predictor = null, toServer = null }) {
  const buffer = new SnapshotBuffer();
  const writer = new ByteWriter(16);
  const input = { ax: 0, ay: 0, buttons: 0, aim: 0 };
  const serverScratch = predictor ? {} : null;
  let net = null;
  let session = null;
  let sfx = null;
  let latest = null;
  let seq = 0;
  let lastBeep = 0;

  const core = {
    buffer,
    get latest() { return latest; },

    mount(netRef, ctx) {
      net = netRef;
      session = ctx.session;
      sfx = ctx.sfx;
    },

    mySlot() {
      const me = session?.myPlayer;
      return me && me.role === 'player' ? me.slot : -1;
    },
    player: (slot) => session?.room?.players.find((p) => p.slot === slot) ?? null,
    hex(slot) {
      return PLAYER_COLORS[core.player(slot)?.color ?? slot % PLAYER_COLORS.length].hex;
    },
    name: (slot) => core.player(slot)?.name ?? '?',
    mine() {
      return latest ? core.find(latest.ents, core.mySlot()) : null;
    },
    find(list, slot) {
      for (let i = 0; i < list.length; i++) if (list[i].slot === slot) return list[i];
      return null;
    },

    onSnapshot(snap) {
      const s = decode(snap.reader, snap.time);
      latest = s;
      buffer.push(s.time, s);
      if (predictor) {
        const mine = core.find(s.ents, core.mySlot());
        if (mine && mine.alive !== false) {
          toServer(mine, serverScratch);
          predictor.reconcile(serverScratch, mine.ack);
        }
      }
      return s;
    },

    // Send one fixed-step input (and predict it when there is a predictor).
    send(ax, ay, buttons, aim = 0) {
      input.ax = quantizeAxis(ax);
      input.ay = quantizeAxis(ay);
      input.buttons = buttons;
      input.aim = aim;
      seq = predictor ? predictor.apply(input) : (seq + 1) & 0xffff;
      net.sendBinary(encodeInput(writer, seq, input));
    },

    idle() {
      predictor?.idle();
    },

    sample() {
      return buffer.sample(net.serverNow());
    },

    now: () => net.serverNow(),

    secondsLeft() {
      return latest ? Math.max(0, (latest.endsAt - net.serverNow()) / 1000) : 0;
    },

    // Countdown beeps + "go" (call from update).
    beep() {
      if (!latest || latest.phase !== ARCADE_PHASE.COUNTDOWN) return;
      const left = Math.ceil(core.secondsLeft());
      if (left > 0 && left !== lastBeep) sfx.play('countdown');
      lastBeep = left;
    },

    reset() {
      buffer.clear();
      predictor?.reset();
    },

    // Interpolated positions for a list in the snapshots (matched by `key`).
    // fn(entB, x, y) for every entity in the newer snapshot.
    each(sample, list, key, fn) {
      if (!sample) return;
      const a = sample.a.state[list];
      const b = sample.b.state[list];
      for (const eb of b) {
        let ea = null;
        for (const q of a) if (q[key] === eb[key]) { ea = q; break; }
        if (!ea) fn(eb, eb.x, eb.y);
        else fn(eb, lerp(ea.x, eb.x, sample.t), lerp(ea.y, eb.y, sample.t));
      }
    },
  };
  return core;
}

// Standard entity flags (see server/games/arcade.js).
export const isBot = (flags) => (flags & 1) !== 0;
export const isConnected = (flags) => (flags & 2) !== 0;
