// Knalkanon: shared values, the terrain (a height per column) and the flight
// of a shell (gravity + wind). The server decides every shot; the client uses
// the same flight code only for the short aiming preview.
// Coordinates: x 0..WIDTH to the right, y up from the bottom (0 = sea level).

export const ART = {
  WIDTH: 720,
  HEIGHT: 405,
  G: 300, // gravity, px/s²
  SPEED_PER_POWER: 7, // shell speed = power (0..100) × this
  WIND_MAX: 60, // px/s² sideways at full wind
  DT: 1 / 60, // flight simulation step
  MAX_FLIGHT_S: 9,
  CANNON_R: 7, // hit radius of a cannon
  HP: 100,
  FUEL: 60, // px a cannon may drive per turn
  MOVE_STEP: 4,
  TURN_S: 25,
  FALL_DAMAGE: 0.4, // hp per px fallen beyond 20 px
};

// Weapons: radius of the crater, damage in the centre, shells, ammo per round (-1 = unlimited).
export const WEAPONS = [
  { key: 'kogel', name: 'Kogel', radius: 24, damage: 42, shells: 1, ammo: -1 },
  { key: 'knal', name: 'Grote knal', radius: 40, damage: 58, shells: 1, ammo: 1 },
  { key: 'drie', name: 'Driedubbel', radius: 15, damage: 24, shells: 3, ammo: 2 },
];

// A landscape from a few seeded sine waves, with room for the cannons.
export function makeTerrain(rng) {
  const p = Array.from({ length: 4 }, () => [rng() * Math.PI * 2, 0.6 + rng() * 0.8]);
  const base = 120 + rng() * 60;
  const h = new Array(ART.WIDTH);
  for (let x = 0; x < ART.WIDTH; x++) {
    const u = x / ART.WIDTH;
    let y = base;
    y += Math.sin(u * Math.PI * 2 * p[0][1] + p[0][0]) * 55;
    y += Math.sin(u * Math.PI * 5 * p[1][1] + p[1][0]) * 28;
    y += Math.sin(u * Math.PI * 11 * p[2][1] + p[2][0]) * 9;
    y += Math.sin(u * Math.PI * 23 * p[3][1] + p[3][0]) * 3;
    h[x] = Math.round(Math.max(40, Math.min(300, y)));
  }
  return h;
}

export const groundAt = (terrain, x) => {
  const i = Math.round(x);
  return i < 0 || i >= terrain.length ? -Infinity : terrain[i];
};

// Carve a round crater out of the terrain (in place). Earth above a hole
// sinks in (a height map has no caves).
export function carve(terrain, cx, cy, r) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(terrain.length - 1, Math.ceil(cx + r));
  for (let x = x0; x <= x1; x++) {
    const dx = x - cx;
    const s = Math.sqrt(Math.max(0, r * r - dx * dx));
    const bottom = cy - s;
    const top = cy + s;
    const h = terrain[x];
    if (bottom >= h) continue;
    terrain[x] = Math.max(0, Math.round(top >= h ? bottom : h - (top - bottom)));
  }
}

// Fly one shell. targets: [{ id, x, y }] (cannons that stop it).
// Returns { path: [x, y, …] every 3rd step, x, y, hit: id|null, t, out }.
export function flyShell(terrain, x, y, angleDeg, power, wind, targets = [], skipId = null) {
  const a = (angleDeg * Math.PI) / 180;
  let vx = Math.cos(a) * power * ART.SPEED_PER_POWER;
  let vy = Math.sin(a) * power * ART.SPEED_PER_POWER;
  const path = [Math.round(x), Math.round(y)];
  const r2 = ART.CANNON_R * ART.CANNON_R;
  let t = 0;
  for (let step = 1; t < ART.MAX_FLIGHT_S; step++) {
    vx += wind * ART.DT;
    vy -= ART.G * ART.DT;
    x += vx * ART.DT;
    y += vy * ART.DT;
    t += ART.DT;
    if (step % 3 === 0) path.push(Math.round(x), Math.round(y));
    if (x < -60 || x > ART.WIDTH + 60 || y < -20) return { path, x, y, hit: null, t, out: true };
    for (const c of targets) {
      if (c.id === skipId && t < 0.25) continue; // not your own barrel on the way out
      const dx = c.x - x;
      const dy = c.y + 4 - y;
      if (dx * dx + dy * dy < r2) {
        path.push(Math.round(x), Math.round(y));
        return { path, x, y, hit: c.id, t, out: false };
      }
    }
    if (x >= 0 && x < ART.WIDTH && y <= terrain[Math.round(Math.min(ART.WIDTH - 1, Math.max(0, x)))]) {
      path.push(Math.round(x), Math.round(y));
      return { path, x, y, hit: null, t, out: false };
    }
  }
  return { path, x, y, hit: null, t, out: true };
}

// Where the barrel ends: shells start here.
export function muzzle(cx, cy, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + Math.cos(a) * 11, y: cy + 7 + Math.sin(a) * 11 };
}
