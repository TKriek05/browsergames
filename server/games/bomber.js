// Boemstad (server side): place bombs, blast blocks, grab power-ups and be
// the last one standing. First to N round wins. After a while the walls
// close in (sudden death).
import { ArcadeGame } from './arcade.js';
import { BTN } from '../../shared/messages.js';
import {
  BOMB_COLS, BOMB_ROWS, BT, ITEM, SPAWNS, MAX_SPEED_LV, buildArena, stepWalker, tileIndex, tileAt, centre, overlapped, spiralOrder,
} from '../../shared/games/bomber.js';
import { bomberBot } from './bomber-bots.js';

const FUSE_S = 2.4;
const FLAME_S = 0.55;
const ITEM_CHANCE = 0.32;
const ROUND_END_S = 3;
const SUDDEN_AT_S = 90;
const SUDDEN_EVERY_S = 0.45;
const SPIRAL = spiralOrder();

class BomberGame extends ArcadeGame {
  constructor(room, settings) {
    super(room, settings);
    this.winsNeeded = settings.wins ?? 2;
    this.round = 0;
    this.addPlayers();
    this._newRound();
  }

  createEntity() {
    return { s: { x: 0, y: 0, dir: 1, speed: 0 }, alive: false, bombsMax: 1, range: 2, wins: 0, kills: 0, deaths: 0, prevA: false, bot: {} };
  }

  onJoin(player) {
    super.onJoin(player);
    if (this.tiles) this.ent(player.id).alive = false; // late joiners wait for the next round
  }

  _newRound() {
    this.round++;
    this.tiles = buildArena(this.rng);
    this.bombs = []; // { x, y, fuse, range, owner }
    this.bombAt = new Uint8Array(BOMB_COLS * BOMB_ROWS);
    this.flames = new Float32Array(BOMB_COLS * BOMB_ROWS); // seconds left per tile
    this.flameOwner = new Array(BOMB_COLS * BOMB_ROWS).fill(null);
    this.items = new Int8Array(BOMB_COLS * BOMB_ROWS).fill(-1);
    this.hidden = new Int8Array(BOMB_COLS * BOMB_ROWS).fill(-1); // items under blocks
    for (let i = 0; i < this.tiles.length; i++) {
      if (this.tiles[i] === BT.BLOCK && this.rng() < ITEM_CHANCE) this.hidden[i] = Math.floor(this.rng() * 3);
    }
    this.roundTime = 0;
    this.sudden = 0;
    this.suddenT = 0;
    this.ents.forEach((e, i) => {
      const [x, y] = SPAWNS[i % SPAWNS.length];
      Object.assign(e.s, { x: centre(x), y: centre(y), dir: 1, speed: 0 });
      e.alive = true;
      e.bombsMax = 1;
      e.range = 2;
      e.bot = {};
    });
    this.startCountdown(3);
    this.room.emit('round', { n: this.round });
  }

  nextRound() {
    if (this.ents.some((e) => e.wins >= this.winsNeeded)) this.finish({});
    else this._newRound();
  }

  step(dt) {
    this.roundTime += dt;
    for (const e of this.ents) {
      if (!e.alive) {
        if (!e.player.isBot) this.eachInput(e, () => {});
        continue;
      }
      if (e.player.isBot) {
        const inp = bomberBot(e, this, dt);
        stepWalker(e.s, inp.ax, inp.ay, dt, this.tiles, this.bombAt);
        if (inp.bomb) this._placeBomb(e);
      } else {
        this.eachInput(e, (inp) => {
          stepWalker(e.s, inp.ax, inp.ay, dt, this.tiles, this.bombAt);
          const a = (inp.buttons & BTN.A) !== 0;
          if (a && !e.prevA) this._placeBomb(e);
          e.prevA = a;
        });
      }
      this._pickup(e);
    }
    this._stepBombs(dt);
    this._stepSudden(dt);
    this._burnPlayers();

    const alive = this.ents.filter((e) => e.alive);
    if (alive.length <= (this.ents.length > 1 ? 1 : 0)) {
      const winner = alive[0] ?? null;
      if (winner) winner.wins++;
      this.endRound(ROUND_END_S, { s: winner ? winner.player.slot : -1 });
    }
  }

  _placeBomb(e) {
    const tx = tileAt(e.s.x);
    const ty = tileAt(e.s.y);
    const i = tileIndex(tx, ty);
    let mine = 0;
    for (const b of this.bombs) if (b.owner === e) mine++;
    if (mine >= e.bombsMax || this.bombAt[i] || this.tiles[i] !== BT.FLOOR) return;
    this.bombs.push({ x: tx, y: ty, fuse: FUSE_S, range: e.range, owner: e });
    this.bombAt[i] = 1;
    this.room.emit('bomb', { s: e.player.slot });
  }

  _pickup(e) {
    for (const i of overlapped(e.s.x, e.s.y)) {
      const it = this.items[i];
      if (it < 0) continue;
      const tx = i % BOMB_COLS;
      const ty = (i - tx) / BOMB_COLS;
      // Only when the player's centre is on that tile.
      if (tileAt(e.s.x) !== tx || tileAt(e.s.y) !== ty) continue;
      this.items[i] = -1;
      if (it === ITEM.BOMB) e.bombsMax = Math.min(6, e.bombsMax + 1);
      else if (it === ITEM.RANGE) e.range = Math.min(7, e.range + 1);
      else if (it === ITEM.SPEED) e.s.speed = Math.min(MAX_SPEED_LV, e.s.speed + 1);
      this.room.emit('item', { s: e.player.slot, type: it });
    }
  }

  _stepBombs(dt) {
    for (let i = 0; i < this.flames.length; i++) if (this.flames[i] > 0) this.flames[i] = Math.max(0, this.flames[i] - dt);
    for (const b of this.bombs) b.fuse -= dt;
    // Explode everything that is due, including chain reactions.
    let due = this.bombs.find((b) => b.fuse <= 0);
    while (due) {
      this._explode(due);
      due = this.bombs.find((b) => b.fuse <= 0);
    }
  }

  _explode(b) {
    this.bombs.splice(this.bombs.indexOf(b), 1);
    this.bombAt[tileIndex(b.x, b.y)] = 0;
    const burn = [[b.x, b.y]];
    const reveal = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let k = 1; k <= b.range; k++) {
        const x = b.x + dx * k;
        const y = b.y + dy * k;
        const i = tileIndex(x, y);
        const t = this.tiles[i];
        if (t === BT.WALL) break;
        burn.push([x, y]);
        if (t === BT.BLOCK) {
          this.tiles[i] = BT.FLOOR;
          if (this.hidden[i] >= 0) reveal.push(i);
          break;
        }
        if (this.bombAt[i]) {
          const other = this.bombs.find((o) => o.x === x && o.y === y);
          if (other) other.fuse = 0; // chain reaction
        }
      }
    }
    for (const [x, y] of burn) {
      const i = tileIndex(x, y);
      this.flames[i] = FLAME_S;
      this.flameOwner[i] = b.owner;
      this.items[i] = -1; // items in the blast burn up…
    }
    for (const i of reveal) {
      this.items[i] = this.hidden[i]; // …but the ones it just uncovered survive
      this.hidden[i] = -1;
    }
    this.room.emit('boom', { x: b.x, y: b.y, s: b.owner.player.slot });
  }

  _burnPlayers() {
    for (const e of this.ents) {
      if (!e.alive) continue;
      const i = tileIndex(tileAt(e.s.x), tileAt(e.s.y));
      if (this.flames[i] <= 0 && this.tiles[i] !== BT.WALL) continue;
      e.alive = false;
      e.deaths++;
      const by = this.tiles[i] === BT.WALL ? null : this.flameOwner[i];
      if (by && by !== e) by.kills++;
      this.room.emit('die', { s: e.player.slot, x: e.s.x, y: e.s.y, by: by ? by.player.slot : -1 });
    }
  }

  // Sudden death: walls drop in a spiral from the outside in.
  _stepSudden(dt) {
    if (this.roundTime < SUDDEN_AT_S || this.sudden >= SPIRAL.length) return;
    if (this.sudden === 0 && this.suddenT === 0) this.room.emit('sudden');
    this.suddenT -= dt;
    if (this.suddenT > 0) return;
    this.suddenT = SUDDEN_EVERY_S;
    const [x, y] = SPIRAL[this.sudden++];
    const i = tileIndex(x, y);
    this.tiles[i] = BT.WALL;
    this.items[i] = -1;
    if (this.bombAt[i]) {
      this.bombs = this.bombs.filter((b) => b.x !== x || b.y !== y);
      this.bombAt[i] = 0;
    }
    this.room.emit('wallDrop', { x, y });
  }

  // Body: u8 phase, f32 left, u8 round, u8 winsNeeded, u8 sudden,
  // u8 n × [u8 slot, u8 flags, u16 ack, f32 x, f32 y, u8 dir, u8 alive, u8 bombsMax, u8 range, u8 speed, u8 wins],
  // tiles (2 bits each), u8 bombs × [u8 x, u8 y, u8 fuse(ds)], u8 flames × [u8 x, u8 y], u8 items × [u8 x, u8 y, u8 type]
  snapshot(w) {
    this.writePhase(w);
    w.u8(this.round).u8(this.winsNeeded).u8(this.roundTime >= SUDDEN_AT_S ? 1 : 0);
    w.u8(this.ents.length);
    for (const e of this.ents) {
      w.u8(e.player.slot).u8(ArcadeGame.flags(e.player)).u16(e.queue.ackSeq).f32(e.s.x).f32(e.s.y);
      w.u8(e.s.dir).u8(e.alive ? 1 : 0).u8(e.bombsMax).u8(e.range).u8(e.s.speed).u8(e.wins);
    }
    for (let i = 0; i < this.tiles.length; i += 4) {
      let v = 0;
      for (let k = 0; k < 4 && i + k < this.tiles.length; k++) v |= this.tiles[i + k] << (k * 2);
      w.u8(v);
    }
    w.u8(this.bombs.length);
    for (const b of this.bombs) w.u8(b.x).u8(b.y).u8(Math.max(0, Math.ceil(b.fuse * 10)));
    let nf = 0;
    for (const t of this.flames) if (t > 0) nf++;
    w.u8(nf);
    for (let i = 0; i < this.flames.length; i++) if (this.flames[i] > 0) w.u8(i % BOMB_COLS).u8(Math.floor(i / BOMB_COLS));
    let ni = 0;
    for (const it of this.items) if (it >= 0) ni++;
    w.u8(ni);
    for (let i = 0; i < this.items.length; i++) if (this.items[i] >= 0) w.u8(i % BOMB_COLS).u8(Math.floor(i / BOMB_COLS)).u8(this.items[i]);
  }

  results() {
    const sorted = [...this.ents].sort((a, b) => b.wins - a.wins || b.kills - a.kills || a.deaths - b.deaths);
    return {
      title: 'Uitslag Boemstad',
      columns: ['Rondes', 'Uitgeschakeld', 'Keer af'],
      rows: this.rows(sorted, (e) => [e.wins, e.kills, e.deaths]),
    };
  }
}

export default {
  id: 'bomber',
  realtime: true,
  create: (room, settings) => new BomberGame(room, settings),
};
