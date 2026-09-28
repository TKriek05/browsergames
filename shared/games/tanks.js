// Tank Tumult: values both sides need. Bullets and power-ups are simulated
// on the server only; the client interpolates them.

export const TANK_PHASE = { COUNTDOWN: 0, PLAY: 1, ROUND_END: 2, END: 3 };
export const TANK_MODE = { DEATHMATCH: 0, ROUNDS: 1 };

export const TANK_RULES = {
  HP: 3,
  FIRE_COOLDOWN_S: 0.45,
  MAX_BULLETS: 4, // per tank (more with triple shot)
  BULLET_SPEED: 150,
  BULLET_RADIUS: 2,
  BULLET_LIFE_S: 4,
  BOUNCES: 1,
  SELF_HIT_AFTER_S: 0.25, // your own bullet can hit you after a bounce
  RESPAWN_S: 3,
  SPAWN_SHIELD_S: 2,
  MUZZLE: 11, // bullets start this far in front of the tank centre
  CRATE_HP: 2,
  ROUNDS_TO_WIN: 3,
};

// Power-ups. `timed` ones last `seconds`.
export const POWERUPS = [
  { key: 'repair', name: 'Reparatie', color: '#5dff8a', seconds: 0 },
  { key: 'triple', name: 'Driedubbel', color: '#ffd23e', seconds: 8 },
  { key: 'speed', name: 'Turbo', color: '#3ef0ff', seconds: 8 },
  { key: 'shield', name: 'Schild', color: '#c77dff', seconds: 6 },
  { key: 'bounce', name: 'Stuiterkogels', color: '#ff9a3e', seconds: 10 },
];
export const POWERUP = Object.fromEntries(POWERUPS.map((p, i) => [p.key.toUpperCase(), i]));

// Tank flag bits in the snapshot.
export const TANK_FLAG = { BOT: 1, CONNECTED: 2, ALIVE: 4, SHIELD: 8, TRIPLE: 16, BOUNCE: 32 };

// Aim angle travels as i16 (radians × 10000 would overflow): angle / PI × 32767.
export const aimToI16 = (a) => Math.round(Math.max(-Math.PI, Math.min(Math.PI, a)) / Math.PI * 32767);
export const i16ToAim = (v) => (v / 32767) * Math.PI;
