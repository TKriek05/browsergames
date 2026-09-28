// Turbo Kart GP: values both sides need.
export const KART_PHASE = { COUNTDOWN: 0, RACE: 1, RESULTS: 2, END: 3 };

export const ITEM = { NONE: 0, TURBO: 1, ORB: 2, OIL: 3, SHIELD: 4 };
export const ITEMS = [
  null,
  { key: 'turbo', name: 'Turbo', color: '#ffb020' },
  { key: 'orb', name: 'Stuiterbal', color: '#ff5a36' },
  { key: 'oil', name: 'Olievlek', color: '#8a7a9a' },
  { key: 'shield', name: 'Schild', color: '#5dff8a' },
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
};

export const KART_FLAG = { BOT: 1, CONNECTED: 2, FINISHED: 4, SHIELD: 8 };

export const placeText = (n) => `${n}e`;
