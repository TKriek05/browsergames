// Tank Tumult arenas. Each map is drawn as its top-left quadrant (16 × 10
// tiles) and mirrored to 32 × 20, so every spawn has the same chances.
//   #  wall (indestructible)     x  crate (can be shot to pieces)
//   S  spawn point               P  power-up spot            .  floor
export const TANK_TILE = 16;
export const TANK_COLS = 32;
export const TANK_ROWS = 20;
export const TANK_WORLD = { width: TANK_COLS * TANK_TILE, height: TANK_ROWS * TANK_TILE };

export const TILE = { FLOOR: 0, WALL: 1, CRATE: 2 };

const QUADRANTS = {
  kruispunt: [
    '################',
    '#S..............',
    '#...........S...',
    '#..xx.....##....',
    '#..x......#.....',
    '#.........#..P..',
    '#....###........',
    '#....#......x...',
    '#....#......x...',
    '#.......x.......',
  ],
  doolhof: [
    '################',
    '#S....#.........',
    '#.....#...x..S..',
    '#..####...x..##.',
    '#.........x..#..',
    '#...P....###.#..',
    '#####....#......',
    '#........#..x...',
    '#..xx...........',
    '#..x......##.P..',
  ],
  fort: [
    '################',
    '#S..............',
    '#...........S...',
    '#...x.....##....',
    '#.......####xxxx',
    '#..P....#.......',
    '#.......#.......',
    '#...##..x.......',
    '#...............',
    '#.....x.......P.',
  ],
};

function mirror(quad) {
  const top = quad.map((row) => row + [...row].reverse().join(''));
  return [...top, ...[...top].reverse()];
}

// Parsed maps: { rows, tiles: Uint8Array (TILE.*), spawns, pickups, crates: [tileIndex] }
export const TANK_ARENAS = Object.fromEntries(
  Object.entries(QUADRANTS).map(([key, quad]) => {
    const rows = mirror(quad);
    const tiles = new Uint8Array(TANK_COLS * TANK_ROWS);
    const spawns = [];
    const pickups = [];
    const crates = [];
    rows.forEach((row, ty) => {
      [...row].forEach((ch, tx) => {
        const i = ty * TANK_COLS + tx;
        const cx = (tx + 0.5) * TANK_TILE;
        const cy = (ty + 0.5) * TANK_TILE;
        if (ch === '#') tiles[i] = TILE.WALL;
        else if (ch === 'x') { tiles[i] = TILE.CRATE; crates.push(i); }
        else if (ch === 'S') spawns.push({ x: cx, y: cy });
        else if (ch === 'P') pickups.push({ x: cx, y: cy });
      });
    });
    return [key, { key, rows, tiles, spawns, pickups, crates }];
  }),
);
