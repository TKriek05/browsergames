// Spetterveld: the paintball fields. Everything that blocks a shot is taller
// than the players' eyes, so the 2D world (x, y) is enough for the game.
// Obstacles: { t: 'box', x, y, w, h, hgt, kind } (centre + size) or
//            { t: 'can', x, y, r, hgt, kind }. `kind` only changes the looks.
export const PB_FIELD = { width: 420, height: 280 };

const box = (x, y, w, h, hgt, kind) => ({ t: 'box', x, y, w, h, hgt, kind });
const can = (x, y, r, hgt, kind) => ({ t: 'can', x, y, r, hgt, kind });

// Mirror a list of obstacles into all four quadrants (point-symmetric fields
// are fair: every spawn sees the same field).
function quad(list) {
  const W = PB_FIELD.width;
  const H = PB_FIELD.height;
  const out = [];
  for (const o of list) {
    out.push(o);
    out.push({ ...o, x: W - o.x });
    out.push({ ...o, y: H - o.y });
    out.push({ ...o, x: W - o.x, y: H - o.y });
  }
  return out;
}

// Left/right mirror only.
function mirror(list) {
  return list.flatMap((o) => [o, { ...o, x: PB_FIELD.width - o.x }]);
}

const SPAWNS = [
  { x: 18, y: 140 }, { x: 402, y: 140 },
  { x: 24, y: 22 }, { x: 396, y: 258 },
  { x: 396, y: 22 }, { x: 24, y: 258 },
];

export const PB_ARENAS = {
  // Speedball with bright inflatable bunkers.
  opblaas: {
    key: 'opblaas',
    name: 'Opblaasveld',
    spawns: SPAWNS,
    obstacles: [
      box(210, 140, 30, 20, 24, 'bunker'),
      can(210, 92, 7, 26, 'can'), can(210, 188, 7, 26, 'can'),
      ...quad([
        can(150, 82, 8, 26, 'can'),
        can(104, 58, 7, 24, 'can'),
        box(62, 64, 16, 16, 22, 'bunker'),
        box(166, 36, 44, 10, 21, 'bunker'),
        box(126, 124, 14, 14, 22, 'bunker'),
      ]),
      ...mirror([
        box(78, 140, 12, 40, 22, 'bunker'),
        box(40, 140, 10, 14, 22, 'bunker'),
      ]),
    ],
  },
  // Woodland: trees, pallet walls and a hut in the middle.
  bos: {
    key: 'bos',
    name: 'Bosveld',
    spawns: SPAWNS,
    obstacles: [
      box(210, 140, 44, 32, 34, 'hut'),
      ...quad([
        can(150, 70, 6, 70, 'tree'),
        can(110, 110, 5, 64, 'tree'),
        can(60, 50, 7, 76, 'tree'),
        can(180, 30, 5, 60, 'tree'),
        can(232, 62, 4, 58, 'tree'),
        box(96, 70, 26, 6, 20, 'pallet'),
        box(160, 110, 6, 26, 20, 'pallet'),
        box(58, 108, 16, 12, 22, 'logs'),
      ]),
      ...mirror([
        box(130, 140, 8, 30, 20, 'pallet'),
        can(62, 140, 6, 70, 'tree'),
      ]),
    ],
  },
  // Farmyard: hay bales, a water tank, crates and the barn wall.
  erf: {
    key: 'erf',
    name: 'Boerenerf',
    spawns: SPAWNS,
    obstacles: [
      can(210, 140, 14, 30, 'tank'),
      box(210, 70, 70, 12, 30, 'barn'),
      box(210, 210, 36, 18, 22, 'wagon'),
      ...quad([
        box(140, 104, 22, 11, 21, 'hay'),
        box(92, 60, 11, 22, 21, 'hay'),
        box(150, 44, 14, 14, 20, 'crate'),
        box(60, 112, 14, 14, 20, 'crate'),
        can(118, 150 - 12, 6, 22, 'barrel'),
      ]),
      ...mirror([
        box(40, 140, 12, 26, 21, 'hay'),
        box(272 + 10, 140, 12, 30, 21, 'hay'),
      ]),
    ],
  },
};

export const PB_ARENA_KEYS = Object.keys(PB_ARENAS);
