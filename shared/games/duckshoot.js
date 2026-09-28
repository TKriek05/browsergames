// Kwek Kwek Knal: values both sides need (field, ammo, duck types, layout).
// Ducks are simulated on the server only; clients interpolate them.

export const DUCK_FIELD = { width: 320, height: 180, grassY: 146 };

export const DUCK_PHASE = { COUNTDOWN: 0, PLAY: 1, ROUND_END: 2, END: 3 };
export const DUCK_STATE = { FLY: 0, HIT: 1, FALL: 2, ESCAPE: 3 };
export const DUCK_MODE = { VERSUS: 0, COOP: 1 };

export const AMMO = {
  MAGAZINE: 5,
  RELOAD_S: 1.0,
  COOLDOWN_S: 0.2,
};

// Duck types. radius = hit radius in pixels (sprites are 16×16).
export const DUCK_TYPES = [
  { key: 'wild', name: 'Wilde eend', points: 100, speed: 52, radius: 8, life: 8, turn: 0.35 },
  { key: 'blue', name: 'Blauwe flitser', points: 200, speed: 82, radius: 7.5, life: 6.5, turn: 0.6 },
  { key: 'gold', name: 'Gouden eend', points: 500, speed: 112, radius: 6.5, life: 4.5, turn: 0.9 },
  // Decoy: shooting the rubber duck costs points.
  { key: 'rubber', name: 'Badeend', points: -150, speed: 38, radius: 8, life: 7, turn: 0.2 },
];

export const COOP_QUOTA = 0.6; // share of a round's ducks the team must hit
export const DOUBLE_BONUS = 2; // points multiplier when one shot hits two ducks

// Cursor positions travel as the input axes (-1..1) of the binary packet.
export const cursorToAxis = (x, y) => [x / (DUCK_FIELD.width / 2) - 1, y / (DUCK_FIELD.height / 2) - 1];
export const axisToCursor = (ax, ay) => [(ax + 1) * (DUCK_FIELD.width / 2), (ay + 1) * (DUCK_FIELD.height / 2)];
