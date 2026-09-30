// Spetterveld (paintball): values both sides need. Phases are the shared
// ARCADE_PHASE values (the server uses the ArcadeGame base).

export const PB_RULES = {
  HP: 3, // hits before you are "gespetterd"
  COOLDOWN_S: 0.2, // 5 balls a second
  HOPPER: 10,
  RELOAD_S: 1.4,
  RANGE: 560,
  MAX_PITCH: 1.35, // how far you can look up or down (radians)
  RESPAWN_S: 3,
  SHIELD_S: 1.5, // after (re)spawning; firing ends it early
  REGEN_S: 6, // one hit point back after this long without being hit
  MAX_SHOT_OFFSET: 14, // how far a claimed muzzle position may be from the server's
};

// Player flag bits in the snapshot.
export const PB_FLAG = { BOT: 1, CONNECTED: 2, ALIVE: 4, SHIELD: 8, RELOAD: 16, CAMO: 32, RAPID: 64, SPREAD: 128 };

// Power-ups on the pads of a field (setting 'powerups'). The id is the index
// and the wire value. Sprint lives in the shared runner state (predicted).
export const PB_POWER = { RAPID: 0, SPREAD: 1, ARMOR: 2, SPRINT: 3, CAMO: 4 };
export const PB_POWERS = [
  { id: 'rapid', name: 'Snelvuur', tip: 'Dubbel zo snel schieten, zonder herladen', color: '#ff8a1e', seconds: 7 },
  { id: 'spread', name: 'Hagel', tip: 'Drie ballen per schot', color: '#b36bff', seconds: 8 },
  { id: 'armor', name: 'Pantser', tip: 'De volgende twee treffers kaats je af', color: '#9fb4c8', seconds: 0 },
  { id: 'sprint', name: 'Sprint', tip: 'Je rent een stuk sneller', color: '#2bd4a4', seconds: 8 },
  { id: 'camo', name: 'Camouflage', tip: 'Je bent bijna onzichtbaar', color: '#8fbf5a', seconds: 9 },
];
export const PB_POWER_RULES = {
  FIRST_S: 5, // the pads fill up this long after the start
  RESPAWN_S: [12, 18], // a taken pad gets a new power-up after this long
  PAD_R: 6, // pick-up reach (plus the body radius)
  PAD_UP: 6, // … and this far above or below the pad
  RAPID_COOLDOWN_S: 0.1,
  SPREAD_RAD: 0.075, // angle between the balls of a spread shot
  ARMOR: 2,
  CAMO_SIGHT: 45, // bots only spot a camouflaged player this close
};

// View angle (and pitch) travel as i16.
export const yawToI16 = (a) => Math.round(Math.max(-Math.PI, Math.min(Math.PI, a)) / Math.PI * 32767);
export const i16ToYaw = (v) => (v / 32767) * Math.PI;

// Wrap an angle to -PI..PI.
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
