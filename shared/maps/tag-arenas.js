// Arenas for Neon Tikkertje as plain data. Coordinates are logical pixels on a
// 320x180 field. Add a new arena by adding an entry here and an option in
// shared/catalog.js; nothing else needs to change.

export const TAG_FIELD = { width: 320, height: 180 };

export const TAG_ARENAS = {
  open: {
    name: 'Open veld',
    walls: [],
  },
  pillars: {
    name: 'Pilaren',
    walls: [
      { x: 70, y: 40, w: 16, h: 16 },
      { x: 234, y: 40, w: 16, h: 16 },
      { x: 70, y: 124, w: 16, h: 16 },
      { x: 234, y: 124, w: 16, h: 16 },
      { x: 148, y: 70, w: 24, h: 40 },
    ],
  },
  maze: {
    name: 'Doolhofje',
    walls: [
      { x: 50, y: 30, w: 80, h: 8 },
      { x: 190, y: 30, w: 80, h: 8 },
      { x: 50, y: 142, w: 80, h: 8 },
      { x: 190, y: 142, w: 80, h: 8 },
      { x: 100, y: 70, w: 8, h: 40 },
      { x: 212, y: 70, w: 8, h: 40 },
      { x: 140, y: 86, w: 40, h: 8 },
      { x: 20, y: 86, w: 36, h: 8 },
      { x: 264, y: 86, w: 36, h: 8 },
    ],
  },
};

// Six spawn points, far enough from walls in every arena.
export const TAG_SPAWNS = [
  { x: 30, y: 20 },
  { x: 290, y: 160 },
  { x: 290, y: 20 },
  { x: 30, y: 160 },
  { x: 160, y: 20 },
  { x: 160, y: 160 },
];
