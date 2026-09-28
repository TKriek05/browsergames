// Spookjesdoolhof: maze, grid movement and constants shared by server and
// client (players are predicted with the same integer movement code, so it
// is exactly deterministic).
//
// Maze legend: # wall, . dot, o power pellet, - ghost-house door,
// space empty corridor, S player start, G ghost start. Row 10 is a
// wrap-around tunnel.
export const MAZE_ROWS = [
  '###########################',
  '#............#............#',
  '#.####.#####.#.#####.####.#',
  '#o####.#####.#.#####.####o#',
  '#.........................#',
  '#.####.##.#######.##.####.#',
  '#......##....#....##......#',
  '######.##### # #####.######',
  '     #.##         ##.#     ',
  '######.## ###-### ##.######',
  '      .   #  G  #   .      ',
  '######.## #G G G# ##.######',
  '     #.## ####### ##.#     ',
  '######.##         ##.######',
  '#............#............#',
  '#.####.#####.#.#####.####.#',
  '#o..##..S....S....S..##..o#',
  '###.##.##.#######.##.##.###',
  '#......##....#....##......#',
  '#.##########.#.##########.#',
  '#.........................#',
  '###########################',
];
export const MAZE_W = MAZE_ROWS[0].length; // 27
export const MAZE_H = MAZE_ROWS.length; // 22
export const TUNNEL_ROW = 10;

// Movement in integer sub-units: one tile = 12 units.
export const UNIT = 12;
export const PLAYER_SPEED = 2; // units per tick (30 Hz) → 5 tiles per second
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // right, down, left, up
export const opposite = (d) => (d + 2) % 4;

export const GHOST_PHASE = { COUNTDOWN: 0, PLAY: 1, ROUND_END: 2, END: 3 };
export const GHOST_MODE = { SCATTER: 0, CHASE: 1, FRIGHT: 2, EYES: 3, HOUSE: 4 };

export function parseMaze() {
  const walls = new Uint8Array(MAZE_W * MAZE_H);
  const dots = new Uint8Array(MAZE_W * MAZE_H); // 1 dot, 2 power pellet
  const playerStarts = [];
  const ghostStarts = [];
  let door = null;
  MAZE_ROWS.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const i = y * MAZE_W + x;
      if (ch === '#') walls[i] = 1;
      else if (ch === '-') { walls[i] = 2; door = door ?? { x, y }; }
      else if (ch === '.') dots[i] = 1;
      else if (ch === 'o') dots[i] = 2;
      else if (ch === 'S') playerStarts.push({ x, y });
      else if (ch === 'G') ghostStarts.push({ x, y });
    });
  });
  return { walls, dots, playerStarts, ghostStarts, door };
}

export const MAZE = parseMaze();

// Is tile (x, y) walkable? Doors only for ghosts (canDoor).
export function open(x, y, canDoor = false) {
  if (y === TUNNEL_ROW && (x < 0 || x >= MAZE_W)) return true;
  if (x < 0 || y < 0 || x >= MAZE_W || y >= MAZE_H) return false;
  const w = MAZE.walls[y * MAZE_W + x];
  return w === 0 || (w === 2 && canDoor);
}

// s: { x, y (units), dir, want }. Moves `speed` units; turns at tile centres.
export function stepMover(s, speed, canDoor = false) {
  if (s.want >= 0 && s.want === opposite(s.dir)) s.dir = s.want;
  for (let n = 0; n < speed; n++) {
    const atCentre = s.x % UNIT === 0 && s.y % UNIT === 0;
    if (atCentre) {
      const tx = s.x / UNIT;
      const ty = s.y / UNIT;
      if (s.want >= 0 && open(tx + DIRS[s.want][0], ty + DIRS[s.want][1], canDoor)) s.dir = s.want;
      if (s.dir < 0 || !open(tx + DIRS[s.dir][0], ty + DIRS[s.dir][1], canDoor)) return;
    }
    if (s.dir < 0) return;
    s.x += DIRS[s.dir][0];
    s.y += DIRS[s.dir][1];
    // Tunnel wrap
    if (s.x < -UNIT) s.x += (MAZE_W + 1) * UNIT;
    if (s.x > MAZE_W * UNIT) s.x -= (MAZE_W + 1) * UNIT;
  }
}

export const tileOf = (v) => Math.round(v / UNIT);
