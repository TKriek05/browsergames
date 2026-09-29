// Neon Tikkertje power-ups, shared by server (rules) and client (drawing).
// Orbs appear on the field; who may take one depends on the role: the tagger
// ('it'), the runners ('run') or everybody ('any'). Taking one uses it at once.

export const POWER = Object.freeze({ TURBO: 0, REACH: 1, FREEZE: 2, SHIELD: 3, WARP: 4 });

export const POWERS = [
  { id: POWER.TURBO, role: 'any', name: 'TURBO', help: 'even sneller', color: '#ffe14d', weight: 2 },
  { id: POWER.REACH, role: 'it', name: 'LANGE ARM', help: 'tik van verder weg', color: '#ff4d6d', weight: 1 },
  { id: POWER.FREEZE, role: 'it', name: 'VRIESGOLF', help: 'lopers dichtbij worden traag', color: '#7fd8ff', weight: 1 },
  { id: POWER.SHIELD, role: 'run', name: 'SCHILD', help: 'even niet te tikken', color: '#5dff9a', weight: 1.4 },
  { id: POWER.WARP, role: 'run', name: 'WARP', help: 'weg van de tikker', color: '#c07bff', weight: 1 },
];

export const POWER_TUNING = {
  FIRST_SPAWN_S: 3, // after "go"
  SPAWN_EVERY_S: 4.5,
  MAX_ORBS: 3,
  ORB_LIFE_S: 12,
  ORB_RADIUS: 5,
  TURBO_S: 3,
  REACH_S: 5,
  REACH_BONUS: 7, // extra tag distance (px)
  FREEZE_RADIUS: 70,
  FREEZE_S: 2.5,
  SHIELD_S: 4,
};

// May this runner take this power right now?
export function canTake(power, isIt) {
  return power.role === 'any' || (power.role === 'it') === isIt;
}
