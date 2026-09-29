// Turbo Kart GP: values both sides need.
export const KART_PHASE = { COUNTDOWN: 0, RACE: 1, RESULTS: 2, END: 3 };

// The id is the wire value (and the index in ITEMS).
export const ITEM = { NONE: 0, TURBO: 1, ORB: 2, OIL: 3, SHIELD: 4, ROCKET: 5, LIGHTNING: 6, BOMB: 7, TURBO3: 8, TURBO2: 9, STAR: 10 };
export const ITEMS = [
  null,
  { key: 'turbo', name: 'Turbo', color: '#ffb020' },
  { key: 'orb', name: 'Stuiterbal', color: '#ff5a36' },
  { key: 'oil', name: 'Olievlek', color: '#8a7a9a' },
  { key: 'shield', name: 'Schild', color: '#5dff8a' },
  { key: 'rocket', name: 'Raket', color: '#ff3b5c' }, // homes in on the kart ahead of you
  { key: 'lightning', name: 'Bliksem', color: '#ffe14d' }, // everybody else spins
  { key: 'bomb', name: 'Bom', color: '#3a3a44' }, // thrown ahead, explodes where it lands
  { key: 'turbo3', name: 'Turbo ×3', color: '#ffb020' },
  { key: 'turbo2', name: 'Turbo ×2', color: '#ffb020' },
  { key: 'star', name: 'Superster', color: '#ffd23e' }, // boost + untouchable, bumping spins others
];

export const KART_RULES = {
  COUNTDOWN_S: 4, // three lights + go
  RESULTS_S: 6, // standings between Grand Prix races
  FINISH_GRACE_S: 30, // after the winner finishes, the rest gets this long
  LAP_CAP_S: 100, // a race never takes longer than laps × this
  POINTS: [10, 8, 6, 5, 4, 3],
  BOX_RESPAWN_S: 2.5,
  BOX_RADIUS: 12,
  ORB_SPEED: 330,
  ORB_LIFE_S: 3.5,
  ORB_RADIUS: 7,
  OIL_RADIUS: 13,
  OIL_LIFE_S: 25,
  SPIN_S: 1.1,
  SHIELD_S: 6,
  BUMP_RADIUS: 8,
  OIL_GRACE_S: 1.5, // the one who dropped the oil is safe until clear of it (or this long)
  ROCKET_SPEED: 300,
  ROCKET_TURN: 5, // rad/s
  ROCKET_LIFE_S: 7,
  ROCKET_RADIUS: 8,
  LIGHTNING_SPIN_S: 0.8,
  BOMB_SPEED: 170,
  BOMB_FLIGHT_S: 0.75,
  BOMB_RADIUS: 36,
  STAR_S: 5,
};

export const KART_FLAG = { BOT: 1, CONNECTED: 2, FINISHED: 4, SHIELD: 8, STAR: 16 };

export const placeText = (n) => `${n}e`;
