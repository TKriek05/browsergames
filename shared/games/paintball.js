// Spetterveld (paintball): values both sides need. Phases are the shared
// ARCADE_PHASE values (the server uses the ArcadeGame base).

export const PB_RULES = {
  HP: 3, // hits before you are "gespetterd"
  COOLDOWN_S: 0.2, // 5 balls a second
  HOPPER: 10,
  RELOAD_S: 1.4,
  RANGE: 420,
  RESPAWN_S: 3,
  SHIELD_S: 1.5, // after (re)spawning; firing ends it early
  REGEN_S: 6, // one hit point back after this long without being hit
  MAX_SHOT_OFFSET: 14, // how far a claimed muzzle position may be from the server's
};

// Player flag bits in the snapshot.
export const PB_FLAG = { BOT: 1, CONNECTED: 2, ALIVE: 4, SHIELD: 8, RELOAD: 16 };

// View angle travels as i16.
export const yawToI16 = (a) => Math.round(Math.max(-Math.PI, Math.min(Math.PI, a)) / Math.PI * 32767);
export const i16ToYaw = (v) => (v / 32767) * Math.PI;

// Wrap an angle to -PI..PI.
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
