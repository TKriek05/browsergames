// Boemstad maps: a 15 × 13 layout per map as plain text, one character per tile.
//   '#' fixed wall        '~' water (fixed, drawn as water or ice)
//   'T' tree / tower      (fixed, drawn per theme)
//   '.' open: a random block may appear here
//   ',' always open (spawn corners, bridges, gates)
//   'B' always a block
// The border is always wall. Spawn tiles and their neighbours stay open
// (see shared/games/bomber.js). 'stad' has no layout: the classic pillars.

export const BOMB_MAPS = {
  stad: {
    name: 'Dorpsplein',
    density: 0.72,
    layout: null,
  },
  park: {
    name: 'Stadspark',
    density: 0.62,
    layout: [
      '###############',
      '#,,.........,,#',
      '#,T.T.#.#.T.T,#',
      '#.............#',
      '#.T.#~~~~~#.T.#',
      '#.....~~~.....#',
      '#.#.T.~~~.T.#.#',
      '#.....~~~.....#',
      '#.T.#~~~~~#.T.#',
      '#.............#',
      '#,T.T.#.#.T.T,#',
      '#,,.........,,#',
      '###############',
    ],
  },
  haven: {
    name: 'Haven',
    density: 0.7,
    layout: [
      '###############',
      '#,,.........,,#',
      '#,#.##...##.#,#',
      '#.............#',
      '#.##.#.#.#.##.#',
      '#.............#',
      '#~~~,~~~~~,~~~#',
      '#.............#',
      '#.##.#.#.#.##.#',
      '#.............#',
      '#,#.##...##.#,#',
      '#,,.........,,#',
      '###############',
    ],
  },
  kasteel: {
    name: 'Kasteel',
    density: 0.66,
    layout: [
      '###############',
      '#,,.........,,#',
      '#,#.#.#.#.#.#,#',
      '#.............#',
      '#.#.T##,##T.#.#',
      '#...#.....#...#',
      '#.#,,..B..,,#.#',
      '#...#.....#...#',
      '#.#.T##,##T.#.#',
      '#.............#',
      '#,#.#.#.#.#.#,#',
      '#,,.........,,#',
      '###############',
    ],
  },
  winter: {
    name: 'Winterdorp',
    density: 0.68,
    layout: [
      '###############',
      '#,,.........,,#',
      '#,T.#.T.T.#.T,#',
      '#.....#.#.....#',
      '#.#.T.....T.#.#',
      '#...#.~~~.#...#',
      '#.T...~~~...T.#',
      '#...#.~~~.#...#',
      '#.#.T.....T.#.#',
      '#.....#.#.....#',
      '#,T.#.T.T.#.T,#',
      '#,,.........,,#',
      '###############',
    ],
  },
};

export const BOMB_MAP_IDS = Object.keys(BOMB_MAPS);
// Setting value that plays a different map every round.
export const BOMB_MAP_MIX = 'wissel';
