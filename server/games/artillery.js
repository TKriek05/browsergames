// Knalkanon (server side): turn-based artillery on a hilly landscape.
// On your turn: drive a little, aim (angle + power), pick a weapon and fire.
// The server flies the shell (gravity + wind), sends the path for the
// animation and applies craters and damage when it lands.
import { createRng } from '../../shared/rng.js';
import { ART, WEAPONS, makeTerrain, carve, flyShell, muzzle } from '../../shared/games/artillery.js';
import { planShot } from './artillery-bots.js';

const INTRO_S = 2.5;
const SETTLE_S = 1.2;
const ROUND_END_S = 4;
const END_HOLD_S = 5;
const TRIPLE_SPREAD = 4; // degrees between the shells of Driedubbel
const THEMES = ['gras', 'woestijn', 'sneeuw'];
const BOT_THINK_S = { easy: 2.4, normal: 1.8, hard: 1.2 };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

class ArtilleryGame {
  constructor(room, settings) {
    this.room = room;
    this.rng = createRng(settings.seed);
    this.rounds = settings.rounds ?? 1;
    this.landscape = settings.landscape ?? 'mix';
    this.cannons = new Map();
    this.sentRev = new Map(); // player id → terrain revision last sent
    this.time = 0;
    this.round = 0;
    this.rev = 0;
    this.shotId = 0;
    this.shot = null;
    this.pending = null;
    for (const p of room.gamePlayers()) this.onJoin(p);
    this._newRound();
  }

  // ---------------------------------------------------------------------------
  // Players
  // ---------------------------------------------------------------------------
  onJoin(player) {
    if (this.cannons.has(player.id)) return;
    this.cannons.set(player.id, {
      player, x: 0, y: 0, hp: 0, alive: false, angle: 60, power: 60, weapon: 0, ammo: WEAPONS.map((w) => w.ammo),
      fuel: 0, wins: 0, dmg: 0, kills: 0,
    });
    this.dirty = true;
  }

  onLeave(player) {
    const wasTurn = this.current()?.player.id === player.id;
    this.cannons.delete(player.id);
    this.order = this.order?.filter((id) => id !== player.id);
    if (wasTurn && this.phase === 'aim') this._nextTurn();
    this.dirty = true;
  }

  onBotTakeover() {
    this.dirty = true;
  }

  onReconnect(player) {
    this.sentRev.delete(player.id);
    this.dirty = true;
  }

  current() {
    return this.cannons.get(this.order?.[this.turn]) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Rounds and turns
  // ---------------------------------------------------------------------------
  _newRound() {
    this.round++;
    this.terrain = makeTerrain(this.rng);
    this.theme = this.landscape === 'mix' ? THEMES[(this.round - 1 + Math.floor(this.rng() * 3)) % 3] : this.landscape;
    this.rev++;
    const list = [...this.cannons.values()];
    // Shuffle the positions, spread them evenly over the landscape.
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    const margin = 50;
    list.forEach((c, i) => {
      const x = list.length === 1 ? ART.WIDTH / 2 : Math.round(margin + ((ART.WIDTH - margin * 2) * i) / (list.length - 1));
      this._flatten(x);
      Object.assign(c, {
        x, y: this.terrain[x], hp: ART.HP, alive: true, fuel: ART.FUEL, weapon: 0, ammo: WEAPONS.map((w) => w.ammo),
        angle: x < ART.WIDTH / 2 ? 55 : 125, power: 60,
      });
    });
    this.order = list.map((c) => c.player.id);
    this.turn = 0;
    this.wind = this._newWind(0);
    this.shot = null;
    this.phase = 'intro';
    this.phaseEnd = this.time + INTRO_S;
    this.room.emit('round', { r: this.round });
    this.dirty = true;
  }

  // A small flat spot for a cannon.
  _flatten(x) {
    const h = this.terrain[x];
    for (let dx = -7; dx <= 7; dx++) {
      const i = x + dx;
      if (i >= 0 && i < ART.WIDTH) this.terrain[i] = h;
    }
  }

  _newWind(prev) {
    return Math.round(clamp(prev * 0.4 + (this.rng() * 2 - 1) * ART.WIND_MAX, -ART.WIND_MAX, ART.WIND_MAX));
  }

  _startTurn() {
    const c = this.current();
    this.phase = 'aim';
    this.phaseEnd = this.time + ART.TURN_S;
    c.fuel = ART.FUEL;
    this.botPlan = null;
    this.botAt = 0;
    this.room.emit('turn', { id: c.player.id });
    this.dirty = true;
  }

  _nextTurn() {
    const alive = [...this.cannons.values()].filter((c) => c.alive);
    if (alive.length <= (this.cannons.size > 1 ? 1 : 0)) {
      const winner = alive[0] ?? null;
      if (winner) winner.wins++;
      this.phase = 'roundEnd';
      this.phaseEnd = this.time + ROUND_END_S;
      this.room.emit('roundEnd', { id: winner ? winner.player.id : null });
      this.dirty = true;
      return;
    }
    for (let k = 1; k <= this.order.length; k++) {
      const idx = (this.turn + k) % this.order.length;
      if (this.cannons.get(this.order[idx])?.alive) {
        this.turn = idx;
        break;
      }
    }
    this.wind = this._newWind(this.wind);
    this._startTurn();
  }

  // ---------------------------------------------------------------------------
  // Input from the player whose turn it is
  // ---------------------------------------------------------------------------
  onInput(player, data) {
    const c = this.cannons.get(player.id);
    if (!c || !data || typeof data !== 'object' || this.phase !== 'aim' || this.current() !== c) return;
    if (Number.isFinite(data.angle)) c.angle = Math.round(clamp(data.angle, 0, 180) * 10) / 10;
    if (Number.isFinite(data.power)) c.power = Math.round(clamp(data.power, 5, 100) * 10) / 10;
    if (Number.isInteger(data.weapon) && data.weapon >= 0 && data.weapon < WEAPONS.length && c.ammo[data.weapon] !== 0) c.weapon = data.weapon;
    if (data.type === 'move' && (data.dir === -1 || data.dir === 1)) this._move(c, data.dir);
    if (data.type === 'fire') this._fire(c);
    this.dirty = true;
  }

  _move(c, dir) {
    if (c.fuel < ART.MOVE_STEP) return;
    const nx = clamp(c.x + dir * ART.MOVE_STEP, 8, ART.WIDTH - 9);
    const ny = this.terrain[nx];
    if (ny - c.y > 10) return; // too steep to climb
    c.x = nx;
    c.y = ny;
    c.fuel -= ART.MOVE_STEP;
  }

  // Fly every shell now; craters and damage follow when they land.
  _fire(c) {
    if (c.ammo[c.weapon] === 0) c.weapon = 0;
    const w = WEAPONS[c.weapon];
    if (c.ammo[c.weapon] > 0) c.ammo[c.weapon]--;
    const angles = w.shells === 3 ? [c.angle - TRIPLE_SPREAD, c.angle, c.angle + TRIPLE_SPREAD] : [c.angle];
    const targets = [...this.cannons.values()].filter((o) => o.alive).map((o) => ({ id: o.player.id, x: o.x, y: o.y }));
    const start = muzzle(c.x, c.y, c.angle);
    const paths = [];
    const booms = [];
    let flight = 0;
    for (const a of angles) {
      const res = flyShell(this.terrain, start.x, start.y, a, c.power, this.wind, targets, c.player.id);
      paths.push(res.path);
      flight = Math.max(flight, res.t);
      if (!res.out) booms.push({ x: Math.round(res.x), y: Math.round(res.y), r: w.radius, hit: res.hit });
    }
    this.shotId++;
    this.shot = { id: this.shotId, by: c.player.id, weapon: c.weapon, paths, booms: booms.map(({ x, y, r }) => ({ x, y, r })), t: flight };
    this.pending = { by: c, weapon: w, booms };
    this.phase = 'flight';
    this.phaseEnd = this.time + Math.min(ART.MAX_FLIGHT_S, flight) + 0.25;
    this.room.emit('shot', this.shot);
  }

  _land() {
    const { by, weapon, booms } = this.pending;
    this.pending = null;
    const cannons = [...this.cannons.values()].filter((o) => o.alive);
    const damage = new Map();
    for (const b of booms) {
      for (const o of cannons) {
        const d = Math.hypot(o.x - b.x, o.y + 4 - b.y);
        let dmg = d < b.r + ART.CANNON_R ? Math.round(weapon.damage * (1 - Math.max(0, d - ART.CANNON_R) / b.r)) : 0;
        if (b.hit === o.player.id) dmg = Math.max(dmg, weapon.damage);
        if (dmg > 0) damage.set(o, (damage.get(o) ?? 0) + dmg);
      }
      carve(this.terrain, b.x, b.y, b.r);
    }
    if (booms.length) this.rev++;
    // Cannons fall onto the new ground (a long fall hurts; the sea is fatal).
    for (const o of cannons) {
      const ground = this.terrain[o.x];
      const drop = o.y - ground;
      if (drop > 20) damage.set(o, (damage.get(o) ?? 0) + Math.round((drop - 20) * ART.FALL_DAMAGE));
      o.y = ground;
      if (ground <= 2) damage.set(o, ART.HP);
    }
    for (const [o, dmg] of damage) {
      o.hp = Math.max(0, o.hp - dmg);
      if (o !== by) by.dmg += dmg;
      if (o.hp <= 0) {
        o.alive = false;
        if (o !== by) by.kills++;
        this.room.emit('destroyed', { id: o.player.id, by: by.player.id });
      }
    }
    this.room.emit('landed', { hits: [...damage].map(([o, dmg]) => ({ id: o.player.id, dmg })) });
    this.phase = 'settle';
    this.phaseEnd = this.time + SETTLE_S;
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------
  // Tick: timers and bots
  // ---------------------------------------------------------------------------
  tick(dt) {
    this.time += dt;
    if (this.phase === 'aim') this._botTurn();
    if (this.time < this.phaseEnd) return;
    switch (this.phase) {
      case 'intro':
        this._startTurn();
        break;
      case 'aim':
        this.room.emit('timeout', { id: this.current()?.player.id });
        this._nextTurn();
        break;
      case 'flight':
        this._land();
        break;
      case 'settle':
        this._nextTurn();
        break;
      case 'roundEnd':
        if ([...this.cannons.values()].some((c) => c.wins >= this.rounds)) {
          this.phase = 'end';
          this.phaseEnd = this.time + END_HOLD_S;
          this.room.emit('end');
          this.dirty = true;
        } else this._newRound();
        break;
      case 'end':
        this.room.endGame(this.results());
        break;
      default:
    }
  }

  // Bots think a moment, turn their barrel towards the plan, then fire.
  _botTurn() {
    const c = this.current();
    if (!c || !c.player.isBot) return;
    const level = c.player.botLevel ?? 'normal';
    if (!this.botPlan) {
      this.botPlan = planShot(this, c, level, this.rng);
      this.botFrom = { angle: c.angle, power: c.power };
      this.botStart = this.time;
      this.botAt = this.time + (BOT_THINK_S[level] ?? 1.8) * (0.8 + this.rng() * 0.4);
      c.weapon = this.botPlan.weapon;
    }
    const k = clamp((this.time - this.botStart) / Math.max(0.1, this.botAt - this.botStart - 0.3), 0, 1);
    const angle = Math.round((this.botFrom.angle + (this.botPlan.angle - this.botFrom.angle) * k) * 10) / 10;
    const power = Math.round((this.botFrom.power + (this.botPlan.power - this.botFrom.power) * k) * 10) / 10;
    if (angle !== c.angle || power !== c.power) {
      c.angle = angle;
      c.power = power;
      this.dirty = true;
    }
    if (this.time >= this.botAt) {
      c.angle = this.botPlan.angle;
      c.power = this.botPlan.power;
      this._fire(c);
      this.dirty = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Output
  // ---------------------------------------------------------------------------
  // The terrain (720 heights) only goes to a player when it changed since
  // the last snapshot they got.
  snapshot(player) {
    const key = player?.id ?? '-';
    const sendTerrain = this.sentRev.get(key) !== this.rev;
    if (sendTerrain) this.sentRev.set(key, this.rev);
    return {
      phase: this.phase,
      left: Math.max(0, this.phaseEnd - this.time),
      round: this.round,
      rounds: this.rounds,
      theme: this.theme,
      wind: this.wind,
      turn: this.current()?.player.id ?? null,
      shot: this.shot ? { id: this.shot.id, by: this.shot.by } : null,
      rev: this.rev,
      terrain: sendTerrain ? this.terrain : undefined,
      cannons: [...this.cannons.values()].map((c) => ({
        id: c.player.id, x: c.x, y: c.y, hp: c.hp, alive: c.alive, angle: c.angle, power: c.power,
        weapon: c.weapon, ammo: c.ammo, fuel: c.fuel, wins: c.wins,
      })),
    };
  }

  results() {
    const list = [...this.cannons.values()].sort((a, b) => b.wins - a.wins || b.kills - a.kills || b.dmg - a.dmg);
    return {
      title: 'Uitslag Knalkanon',
      columns: this.rounds > 1 ? ['Rondes', 'Raak (schade)', 'Uitgeschakeld'] : ['Raak (schade)', 'Uitgeschakeld'],
      rows: list.map((c, i) => ({
        id: c.player.id,
        name: c.player.name,
        color: c.player.color,
        rank: i + 1,
        values: this.rounds > 1 ? [String(c.wins), String(c.dmg), String(c.kills)] : [String(c.dmg), String(c.kills)],
      })),
    };
  }
}

export default {
  id: 'artillery',
  realtime: false,
  create: (room, settings) => new ArtilleryGame(room, settings),
};
